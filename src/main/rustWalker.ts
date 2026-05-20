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

function getBinaryPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'mft_scanner.exe');
  }
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
 * Scan using the Rust FindFirstFileW walker. Returns the tree on success,
 * or null if the binary is missing or fails (caller falls back to Node).
 */
export async function tryRustWalk(
  rootPath: string,
  onProgress: (p: WalkerProgress) => void
): Promise<FsNode | null> {
  const binaryPath = getBinaryPath();
  try {
    await fs.access(binaryPath);
  } catch {
    console.warn('[walker] binary not found at', binaryPath);
    return null;
  }

  return new Promise<FsNode | null>((resolve) => {
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
      console.warn('[walker] spawn error:', err);
      resolve(null);
    });

    child.on('exit', (code) => {
      if (code !== 0) {
        console.warn(
          `[walker] exited with code ${code}\n${stderrTail.trim() || '(no stderr)'}`
        );
        resolve(null);
        return;
      }
      try {
        const json = Buffer.concat(stdoutChunks).toString('utf8');
        if (!json.trim()) {
          console.warn('[walker] empty stdout');
          resolve(null);
          return;
        }
        resolve(JSON.parse(json) as FsNode);
      } catch (e) {
        console.warn('[walker] failed to parse output:', e);
        resolve(null);
      }
    });
  });
}
