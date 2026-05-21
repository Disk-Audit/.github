import * as fs from 'fs/promises';
import { createReadStream } from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export interface DuplicateFile {
  path: string;
  size: number;
  mtimeMs: number;
}

export interface DuplicateGroup {
  hash: string;
  size: number;
  files: DuplicateFile[];
  wastedBytes: number;
}

export interface DuplicateScanProgress {
  phase: 'sizing' | 'hashing' | 'done';
  filesSeen: number;
  candidatesHashed: number;
  candidatesTotal: number;
  currentPath: string;
}

export interface DuplicateScanResult {
  groups: DuplicateGroup[];
  totalWasted: number;
  filesScanned: number;
}

// Folders we refuse to touch: system content + virtual mounts. Comparing path
// segments case-insensitively, so this works the same on NTFS (case-insensitive)
// and ext4 (case-sensitive).
const FORBIDDEN_SEGMENTS = new Set([
  'windows',
  'program files',
  'program files (x86)',
  'programdata',
  'system volume information',
  '$recycle.bin',
  '$winreagent',
  '$windows.~ws',
  '$windows.~bt',
  'recovery',
  'msdownld.tmp',
  'proc',
  'sys',
  'dev',
  'run',
  'snap'
]);

function isForbidden(p: string): boolean {
  const parts = p.split(/[\\/]/);
  for (const part of parts) {
    if (FORBIDDEN_SEGMENTS.has(part.toLowerCase())) return true;
  }
  return false;
}

// Files smaller than 64 KB aren't worth the hashing overhead — too many of them
// collide at common sizes (icons, configs) and the reclaim per dupe is trivial.
const MIN_FILE_SIZE = 64 * 1024;

function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const s = createReadStream(filePath, { highWaterMark: 256 * 1024 });
    s.on('data', (chunk) => h.update(chunk));
    s.on('end', () => resolve(h.digest('hex')));
    s.on('error', reject);
  });
}

async function collectCandidates(
  rootPath: string,
  onProgress: (p: DuplicateScanProgress) => void
): Promise<DuplicateFile[]> {
  const out: DuplicateFile[] = [];
  let filesSeen = 0;
  let lastProgress = Date.now();

  async function walk(p: string): Promise<void> {
    if (isForbidden(p)) return;
    let entries: import('fs').Dirent[] = [];
    try {
      entries = await fs.readdir(p, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const child = path.join(p, e.name);
      try {
        if (e.isSymbolicLink()) continue;
        if (e.isDirectory()) {
          await walk(child);
        } else if (e.isFile()) {
          filesSeen++;
          const st = await fs.lstat(child);
          if (!st.isFile()) continue;
          if (st.size < MIN_FILE_SIZE) continue;
          out.push({ path: child, size: st.size, mtimeMs: st.mtimeMs });

          const now = Date.now();
          if (now - lastProgress > 80) {
            lastProgress = now;
            onProgress({
              phase: 'sizing',
              filesSeen,
              candidatesHashed: 0,
              candidatesTotal: 0,
              currentPath: child
            });
          }
        }
      } catch {
        // entry vanished mid-walk — just skip
      }
    }
  }

  await walk(rootPath);
  return out;
}

export async function findDuplicates(
  rootPath: string,
  onProgress: (p: DuplicateScanProgress) => void
): Promise<DuplicateScanResult> {
  // Normalize bare Windows drive letters: "C:" by itself refers to the
  // *current directory* on C: (a Win32 quirk), not the root. Append a slash
  // so fs.readdir actually walks from the top of the drive.
  let normalized = rootPath;
  if (/^[A-Za-z]:$/.test(normalized)) {
    normalized = normalized + '\\';
  }

  const candidates = await collectCandidates(normalized, onProgress);

  // Group by size. Only sizes with >= 2 files can have duplicates.
  const bySize = new Map<number, DuplicateFile[]>();
  for (const f of candidates) {
    const arr = bySize.get(f.size);
    if (arr) arr.push(f);
    else bySize.set(f.size, [f]);
  }
  const candidateGroups = [...bySize.values()].filter((g) => g.length > 1);
  const totalToHash = candidateGroups.reduce((s, g) => s + g.length, 0);

  // Hash each candidate, then group by hash. Files with the same hash are
  // byte-identical (SHA-256 collisions for arbitrary file contents don't happen
  // in practice).
  const byHash = new Map<string, { size: number; files: DuplicateFile[] }>();
  let hashedCount = 0;
  let lastProgress = 0;

  for (const group of candidateGroups) {
    for (const f of group) {
      try {
        const h = await hashFile(f.path);
        const key = `${f.size}:${h}`;
        const existing = byHash.get(key);
        if (existing) existing.files.push(f);
        else byHash.set(key, { size: f.size, files: [f] });
        hashedCount++;

        const now = Date.now();
        if (now - lastProgress > 80) {
          lastProgress = now;
          onProgress({
            phase: 'hashing',
            filesSeen: candidates.length,
            candidatesHashed: hashedCount,
            candidatesTotal: totalToHash,
            currentPath: f.path
          });
        }
      } catch {
        hashedCount++;
      }
    }
  }

  const groups: DuplicateGroup[] = [];
  let totalWasted = 0;
  for (const [key, v] of byHash.entries()) {
    if (v.files.length < 2) continue;
    const wasted = v.size * (v.files.length - 1);
    // Newest first — UI default-keeps the newest copy.
    v.files.sort((a, b) => b.mtimeMs - a.mtimeMs);
    groups.push({
      hash: key.split(':')[1],
      size: v.size,
      files: v.files,
      wastedBytes: wasted
    });
    totalWasted += wasted;
  }
  groups.sort((a, b) => b.wastedBytes - a.wastedBytes);

  onProgress({
    phase: 'done',
    filesSeen: candidates.length,
    candidatesHashed: hashedCount,
    candidatesTotal: totalToHash,
    currentPath: ''
  });

  return {
    groups,
    totalWasted,
    filesScanned: candidates.length
  };
}

export function isPathSafeToTrash(p: string): boolean {
  return !isForbidden(p);
}
