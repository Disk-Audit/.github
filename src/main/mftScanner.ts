import { app } from 'electron';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { FsNode } from './scanner';

export interface MftProgress {
  bytes: number;
  files: number;
  currentPath: string;
}

function getBinaryPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'mft_scanner.exe');
  }
  // In dev, __dirname = <project>/out/main, so go up two levels to project root
  return path.join(
    __dirname,
    '..',
    '..',
    'mft_scanner',
    'target',
    'release',
    'mft_scanner.exe'
  );
}

/**
 * Try to scan the given drive using the Rust MFT scanner.
 * Returns the FsNode tree on success, or null if:
 *   - the binary is missing
 *   - the user cancels the UAC prompt
 *   - the drive isn't NTFS (or any other Rust error)
 *
 * On null, the caller should fall back to the Node scanner.
 */
export async function tryMftScan(
  drivePath: string,
  onProgress: (p: MftProgress) => void
): Promise<FsNode | null> {
  const driveLetter = drivePath.charAt(0).toUpperCase();
  if (!/[A-Z]/.test(driveLetter)) {
    return null;
  }

  const binaryPath = getBinaryPath();
  try {
    await fs.access(binaryPath);
  } catch {
    console.warn('[mft] binary not found at', binaryPath);
    return null;
  }

  const tempId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const tempDir = os.tmpdir();
  const outputPath = path.join(tempDir, `dz-mft-${tempId}.json`);
  const progressPath = path.join(tempDir, `dz-mft-${tempId}.progress`);
  const batPath = path.join(tempDir, `dz-mft-${tempId}.bat`);

  // Bat script run elevated. It invokes the Rust binary with stdout -> JSON
  // file, stderr -> progress file. Elevated stdout can't stream back to us,
  // but writing to temp files works fine since admin can write to user temp.
  const batContent =
    `@echo off\r\n` +
    `"${binaryPath}" ${driveLetter} 1>"${outputPath}" 2>"${progressPath}"\r\n` +
    `exit /b %ERRORLEVEL%\r\n`;

  await fs.writeFile(batPath, batContent, 'utf8');

  onProgress({
    bytes: 0,
    files: 0,
    currentPath: 'Requesting administrator permission…'
  });

  return new Promise<FsNode | null>((resolve) => {
    let finished = false;

    // Launch the bat file elevated. -Wait blocks until the elevated child finishes.
    const launcher = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `Start-Process '${batPath}' -Verb RunAs -WindowStyle Hidden -Wait`
      ],
      { windowsHide: true }
    );

    let launcherStderr = '';
    launcher.stderr.on('data', (chunk) => {
      launcherStderr += chunk.toString();
    });

    // Poll the progress file every ~400 ms to update the UI
    const pollInterval = setInterval(async () => {
      if (finished) return;
      try {
        const data = await fs.readFile(progressPath, 'utf8');
        // Find the most recent PROGRESS:done:total line
        const matches = [...data.matchAll(/PROGRESS:(\d+):(\d+)/g)];
        if (matches.length > 0) {
          const last = matches[matches.length - 1];
          const done = parseInt(last[1], 10);
          const total = parseInt(last[2], 10);
          onProgress({
            bytes: done * 1024, // approximate, just for visual feedback
            files: done,
            currentPath: `Reading MFT: ${done.toLocaleString()} / ${total.toLocaleString()} records`
          });
        }
      } catch {
        // file doesn't exist yet — fine
      }
    }, 400);

    const cleanup = async (): Promise<void> => {
      try { await fs.unlink(batPath); } catch { /* ignore */ }
      try { await fs.unlink(outputPath); } catch { /* ignore */ }
      try { await fs.unlink(progressPath); } catch { /* ignore */ }
    };

    launcher.on('exit', async (code) => {
      finished = true;
      clearInterval(pollInterval);

      // Non-zero exit = UAC cancelled, scanner crashed, or other failure
      if (code !== 0) {
        const errLower = launcherStderr.toLowerCase();
        if (errLower.includes('cancel') || code === 1223) {
          console.warn('[mft] user cancelled UAC');
        } else {
          console.warn('[mft] launcher exited with code', code, launcherStderr);
        }
        await cleanup();
        return resolve(null);
      }

      // Read the JSON tree output
      try {
        const stat = await fs.stat(outputPath);
        if (stat.size === 0) {
          console.warn('[mft] empty output file');
          await cleanup();
          return resolve(null);
        }

        const json = await fs.readFile(outputPath, 'utf8');
        const tree = JSON.parse(json) as FsNode;
        await cleanup();

        // Final progress update so the UI reflects completion
        onProgress({
          bytes: tree.size,
          files: countFiles(tree),
          currentPath: 'Done'
        });

        resolve(tree);
      } catch (e) {
        console.warn('[mft] failed to read/parse output:', e);
        await cleanup();
        resolve(null);
      }
    });

    launcher.on('error', async (err) => {
      finished = true;
      clearInterval(pollInterval);
      console.warn('[mft] launcher error:', err);
      await cleanup();
      resolve(null);
    });
  });
}

function countFiles(node: FsNode): number {
  let count = node.type === 'file' ? 1 : 0;
  if (node.children) {
    for (const child of node.children) {
      count += countFiles(child);
    }
  }
  return count;
}
