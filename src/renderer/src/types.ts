export interface FsNode {
  name: string;
  path: string;
  size: number;
  type: 'file' | 'dir';
  children?: FsNode[];
  error?: string;
  ext?: string;
  /** Optional tag for synthetic nodes (not real filesystem entries). When
   * set, the renderer treats this node specially — no drill-in, no Open in
   * Explorer, different styling. */
  kind?: 'free-space';
}

export interface ScanProgress {
  bytes: number;
  files: number;
  currentPath: string;
}

export interface DriveInfo {
  letter: string;
  /** Full scannable path. "C:\\" on Windows, "\\\\server\\share\\" for
   * network mappings, "/" or "/home" on Linux. */
  path: string;
  label: string;
  totalBytes: number;
  freeBytes: number;
  fileSystem: string;
  driveType: 'fixed' | 'removable' | 'network';
  mediaType: 'ssd' | 'hdd' | 'unknown';
  /** UNC path a mapped letter points to. Empty/absent for local drives. */
  remotePath?: string;
}

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

export interface ExtensionBreakdown {
  ext: string;
  size: number;
  count: number;
}

export function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  if (b < 1024 ** 4) return `${(b / 1024 ** 3).toFixed(2)} GB`;
  return `${(b / 1024 ** 4).toFixed(2)} TB`;
}
