import { app } from 'electron';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import type { FsNode } from './scanner';

export interface WalkerProgress {
  bytes: number;
  files: number;
  currentPath: string;
}

const isWindows = process.platform === 'win32';

function getBinaryPath(): string {
  const binName = isWindows ? 'mft_scanner.exe' : 'mft_scanner';
  if (app.isPackaged) {
    return path.join(process.resourcesPath, binName);
  }
  return path.join(
    __dirname,
    '..',
    '..',
    'mft_scanner',
    'target',
    'release',
    binName
  );
}

/**
 * Scan using the Rust FindFirstFileW walker. Returns the tree on success,
 * or null if the binary is missing or fails (caller falls back to Node).
 *
 * The current Rust walker is Windows-only — on Linux/macOS this returns null
 * immediately and the Node walker handles everything. Ported Rust walker for
 * Unix is a future enhancement; the Node walker is fine for typical home
 * directory sizes.
 */
export async function tryRustWalk(
  rootPath: string,
  onProgress: (p: WalkerProgress) => void
): Promise<FsNode | null> {
  if (!isWindows) {
    // The Rust binary only exists for Windows right now. Fall through to Node.
    return null;
  }

  const binaryPath = getBinaryPath();
  try {
    await fs.access(binaryPath);
  } catch {
    console.warn('[walker] binary not found at', binaryPath);
    return null;
  }

  return new Promise<FsNode | null>((resolve) => {
    const t0 = Date.now();
    console.log(`[scan] rust walker starting on ${rootPath}`);
    const child = spawn(binaryPath, ['--walk', rootPath], { windowsHide: true });

    const stdoutChunks: Buffer[] = [];
    let stderrTail = '';
    let stderrLeftover = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });

    child.stderr.on('data', (chunk: Buffer) => {
      const text = stderrLeftover + chunk.toString('utf8');
      const lines = text.split(/\r?\n/);
      stderrLeftover = lines.pop() ?? '';

      for (const line of lines) {
        // PROGRESS:<files>:<bytes>:<currentPath> — path may contain colons,
        // so we greedy-match everything after the third colon.
        const m = line.match(/^PROGRESS:(\d+):(\d+):(.*)$/);
        if (m) {
          onProgress({
            files: parseInt(m[1], 10),
            bytes: parseInt(m[2], 10),
            currentPath: m[3]
          });
        } else if (line.trim()) {
          stderrTail += line + '\n';
          if (stderrTail.length > 2000) stderrTail = stderrTail.slice(-2000);
        }
      }
    });

    child.on('error', (err) => {
      console.warn('[scan] rust walker spawn error:', err);
      resolve(null);
    });

    child.on('exit', (code) => {
      const tWalkDone = Date.now();
      console.log(
        `[scan] rust walker spawn-to-exit: ${tWalkDone - t0} ms (exit code ${code})`
      );
      if (code !== 0) {
        console.warn(
          `[scan] rust walker exited non-zero\n${stderrTail.trim() || '(no stderr)'}`
        );
        resolve(null);
        return;
      }
      try {
        const json = Buffer.concat(stdoutChunks).toString('utf8');
        const tConcatDone = Date.now();
        console.log(
          `[scan] buffer concat: ${tConcatDone - tWalkDone} ms (${(json.length / 1024 / 1024).toFixed(1)} MB of JSON)`
        );
        if (!json.trim()) {
          console.warn('[scan] empty stdout');
          resolve(null);
          return;
        }
        const parsed = JSON.parse(json) as FsNode;
        const tParseDone = Date.now();
        console.log(`[scan] JSON.parse: ${tParseDone - tConcatDone} ms`);
        console.log(`[scan] rust walker total: ${tParseDone - t0} ms`);
        resolve(parsed);
      } catch (e) {
        console.warn('[scan] failed to parse output:', e);
        resolve(null);
      }
    });
  });
}
