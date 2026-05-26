import { app } from 'electron';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import type { FsNode } from './scanner';
import type { WalkerProgress } from './rustWalker';

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
 * MFT-based fast scan for local NTFS volumes. Requires admin privileges and
 * an NTFS volume — the binary's manifest requests admin at launch.
 *
 * Returns the tree on success, or null if anything goes wrong: not Windows,
 * binary missing, non-NTFS, non-elevated, ntfs-reader internal error,
 * malformed output. In every failure case the caller falls through to
 * `tryRustWalk` and then to the Node walker, so MFT failure never breaks
 * scanning — it just removes the speedup.
 *
 * Should only be called for drive *roots* (e.g. "C:\\"). The MFT enumerates
 * the entire volume; for subdirectory scans the caller should skip MFT
 * entirely and use the walker.
 */
export async function tryMftScan(
  driveLetter: string,
  onProgress: (p: WalkerProgress) => void
): Promise<FsNode | null> {
  if (!isWindows) return null;

  // Sanity check: we expect a single letter, possibly with a trailing colon
  // or backslash. The Rust side validates more strictly.
  const cleaned = driveLetter.trim().replace(/[:\\]/g, '');
  if (cleaned.length !== 1 || !/^[A-Za-z]$/.test(cleaned)) {
    return null;
  }

  const binaryPath = getBinaryPath();
  try {
    await fs.access(binaryPath);
  } catch {
    console.warn('[mft] binary not found at', binaryPath);
    return null;
  }

  return new Promise<FsNode | null>((resolve) => {
    const t0 = Date.now();
    console.log(`[scan] MFT scan starting on ${cleaned}:`);
    const child = spawn(binaryPath, ['--mft-scan', cleaned], {
      windowsHide: true
    });

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
        // Same PROGRESS:<files>:<bytes>:<currentPath> protocol the walker uses
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
      console.warn('[scan] MFT spawn error:', err);
      resolve(null);
    });

    child.on('exit', (code) => {
      const tDone = Date.now();
      console.log(
        `[scan] MFT spawn-to-exit: ${tDone - t0} ms (exit code ${code})`
      );
      if (code !== 0) {
        // Exit code 3 is the structured "MFT not available, fall through"
        // path — non-NTFS, no admin, etc. Anything else is also treated
        // as fall-through; the caller has the walker as a safety net.
        console.warn(
          `[scan] MFT exit ${code} — falling through to walker\n${stderrTail.trim() || '(no stderr)'}`
        );
        resolve(null);
        return;
      }
      try {
        const json = Buffer.concat(stdoutChunks).toString('utf8');
        if (!json.trim()) {
          console.warn('[scan] MFT empty stdout');
          resolve(null);
          return;
        }
        const parsed = JSON.parse(json) as FsNode;
        console.log(
          `[scan] MFT total: ${Date.now() - t0} ms (${(json.length / 1024 / 1024).toFixed(1)} MB JSON)`
        );
        resolve(parsed);
      } catch (e) {
        console.warn('[scan] MFT failed to parse output:', e);
        resolve(null);
      }
    });
  });
}

/**
 * True for paths that are drive roots like "C:\", "D:\", "Z:\". Used by the
 * dispatcher to decide whether MFT is even a candidate.
 */
export function isDriveRoot(p: string): boolean {
  return /^[A-Za-z]:[\\/]?$/.test(p.trim());
}

/**
 * Extract the bare drive letter from a path like "C:\". Returns null for
 * non-Windows-style paths.
 */
export function driveLetterOf(p: string): string | null {
  const m = p.trim().match(/^([A-Za-z]):[\\/]?$/);
  return m ? m[1].toUpperCase() : null;
}
