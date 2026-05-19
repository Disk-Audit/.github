import { promises as fs } from 'fs';
import { join } from 'path';

export interface FsNode {
  name: string;
  path: string;
  size: number;
  type: 'file' | 'dir';
  children?: FsNode[];
  error?: string;
  ext?: string;
}

export interface ScanProgress {
  bytes: number;
  files: number;
  currentPath: string;
}

const isWindows = process.platform === 'win32';

// Prefix absolute Windows paths with \\?\ to bypass the 260-character MAX_PATH limit.
// Without this, deep paths (think node_modules) silently fail to read.
function toLongPath(p: string): string {
  if (!isWindows) return p;
  if (p.startsWith('\\\\?\\')) return p;
  if (/^[A-Za-z]:\\/.test(p)) return '\\\\?\\' + p;
  return p;
}

function basename(p: string): string {
  const segments = p.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] || p;
}

function getExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return '';
  return name.slice(dot + 1).toLowerCase();
}

export async function scan(
  rootPath: string,
  onProgress: (p: ScanProgress) => void
): Promise<FsNode> {
  let totalBytes = 0;
  let totalFiles = 0;
  let lastProgressTime = 0;

  // Throttle progress updates so IPC doesn't get overwhelmed
  function reportProgress(currentPath: string, force = false): void {
    const now = Date.now();
    if (force || now - lastProgressTime > 80) {
      lastProgressTime = now;
      onProgress({ bytes: totalBytes, files: totalFiles, currentPath });
    }
  }

  async function walk(dirPath: string): Promise<FsNode> {
    let entries;
    try {
      entries = await fs.readdir(toLongPath(dirPath), { withFileTypes: true });
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      return {
        name: basename(dirPath),
        path: dirPath,
        size: 0,
        type: 'dir',
        error: err.code || 'UNKNOWN'
      };
    }

    const children: FsNode[] = [];
    let totalSize = 0;

    // Process in parallel batches. Higher = faster on SSDs, but watch out on HDDs.
    const BATCH = 24;
    for (let i = 0; i < entries.length; i += BATCH) {
      const slice = entries.slice(i, i + BATCH);
      const results = await Promise.all(
        slice.map(async (entry): Promise<FsNode | null> => {
          const full = join(dirPath, entry.name);

          // Skip symlinks and junctions to avoid infinite loops and double-counting.
          // (Windows uses junctions heavily, e.g. C:\Users\All Users)
          if (entry.isSymbolicLink()) return null;

          if (entry.isDirectory()) {
            return walk(full);
          }

          if (entry.isFile()) {
            try {
              const stat = await fs.stat(toLongPath(full));
              totalBytes += stat.size;
              totalFiles++;
              if (totalFiles % 500 === 0) reportProgress(full);
              return {
                name: entry.name,
                path: full,
                size: stat.size,
                type: 'file',
                ext: getExtension(entry.name)
              };
            } catch (e) {
              const err = e as NodeJS.ErrnoException;
              return {
                name: entry.name,
                path: full,
                size: 0,
                type: 'file',
                error: err.code || 'UNKNOWN',
                ext: getExtension(entry.name)
              };
            }
          }

          // Block devices, FIFOs, sockets etc. — skip
          return null;
        })
      );

      for (const node of results) {
        if (!node) continue;
        children.push(node);
        totalSize += node.size;
      }
    }

    return {
      name: basename(dirPath),
      path: dirPath,
      size: totalSize,
      type: 'dir',
      children
    };
  }

  const result = await walk(rootPath);
  reportProgress(rootPath, true);
  return result;
}
