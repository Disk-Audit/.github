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

export function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  if (b < 1024 ** 4) return `${(b / 1024 ** 3).toFixed(2)} GB`;
  return `${(b / 1024 ** 4).toFixed(2)} TB`;
}
