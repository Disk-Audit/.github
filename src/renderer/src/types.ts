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

export interface DriveInfo {
  letter: string;
  label: string;
  totalBytes: number;
  freeBytes: number;
  fileSystem: string;
  driveType: 'fixed' | 'removable';
}

// ── Formatting ────────────────────────────────────────────────────────────

export function formatBytes(b: number): string {
  if (b == null || !isFinite(b)) return '—';
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  if (b < 1024 ** 4) return `${(b / 1024 ** 3).toFixed(2)} GB`;
  return `${(b / 1024 ** 4).toFixed(2)} TB`;
}

export function shortenPath(p: string, max = 36): string {
  if (!p || p.length <= max) return p;
  const parts = p.split('\\');
  if (parts.length <= 3) return p;
  return parts[0] + '\\…\\' + parts.slice(-2).join('\\');
}

// ── File-kind classification ─────────────────────────────────────────────
// Categories used for coloring + filtering. Kind is derived from extension.

export type Kind =
  | 'video' | 'image' | 'audio' | 'archive' | 'document'
  | 'code' | 'app' | 'disk' | 'system' | 'cache' | 'log' | 'data' | 'other';

const EXT_TO_KIND: Record<string, Kind> = {
  // Video
  mp4: 'video', mkv: 'video', mov: 'video', avi: 'video', webm: 'video',
  wmv: 'video', flv: 'video', m4v: 'video', ts: 'video', mts: 'video',
  // Image
  jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', webp: 'image',
  heic: 'image', heif: 'image', bmp: 'image', tiff: 'image', tif: 'image',
  svg: 'image', raw: 'image', cr2: 'image', nef: 'image', arw: 'image',
  psd: 'image', ai: 'image',
  // Audio
  mp3: 'audio', flac: 'audio', wav: 'audio', aac: 'audio', ogg: 'audio',
  m4a: 'audio', opus: 'audio', wma: 'audio', aiff: 'audio',
  // Archives
  zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive',
  gz: 'archive', bz2: 'archive', xz: 'archive', cab: 'archive',
  // Documents
  pdf: 'document', doc: 'document', docx: 'document', xls: 'document',
  xlsx: 'document', ppt: 'document', pptx: 'document', txt: 'document',
  md: 'document', rtf: 'document', csv: 'document', odt: 'document',
  // Code / config
  js: 'code', mjs: 'code', cjs: 'code', tsx: 'code', jsx: 'code',
  py: 'code', rb: 'code', java: 'code', cs: 'code', cpp: 'code', c: 'code',
  h: 'code', hpp: 'code', go: 'code', rs: 'code', php: 'code', swift: 'code',
  kt: 'code', html: 'code', htm: 'code', css: 'code', scss: 'code', sass: 'code',
  less: 'code', json: 'code', xml: 'code', yaml: 'code', yml: 'code',
  toml: 'code', sh: 'code', bash: 'code', ps1: 'code',
  // Applications / DLLs
  exe: 'app', dll: 'app', msi: 'app', appx: 'app', msix: 'app',
  // System
  sys: 'system', drv: 'system', cat: 'system', inf: 'system',
  bin: 'system', com: 'system', bat: 'system', cmd: 'system',
  // Disk images / VMs
  iso: 'disk', img: 'disk', vhd: 'disk', vhdx: 'disk', vmdk: 'disk',
  dmg: 'disk',
  // Cache / temp
  cache: 'cache', tmp: 'cache', temp: 'cache', bak: 'cache', old: 'cache',
  // Logs
  log: 'log',
  // Generic data / db
  db: 'data', sqlite: 'data', dat: 'data', mdb: 'data'
};

export function kindFor(ext: string | undefined): Kind {
  if (!ext) return 'other';
  return EXT_TO_KIND[ext.toLowerCase()] || 'other';
}

// Stable list of kinds for display + palette. Hues are oklch hue values;
// the actual --k-<id> CSS variables are built from --k-l / --k-c in styles.
export interface KindMeta {
  id: Kind;
  label: string;
  hue: number;
}

export const KIND_META: KindMeta[] = [
  { id: 'video',    label: 'Video',        hue: 25  },
  { id: 'image',    label: 'Images',       hue: 65  },
  { id: 'audio',    label: 'Audio',        hue: 305 },
  { id: 'archive',  label: 'Archives',     hue: 175 },
  { id: 'document', label: 'Documents',    hue: 240 },
  { id: 'code',     label: 'Code',         hue: 145 },
  { id: 'app',      label: 'Applications', hue: 280 },
  { id: 'disk',     label: 'Disk images',  hue: 200 },
  { id: 'system',   label: 'System',       hue: 255 },
  { id: 'cache',    label: 'Cache',        hue: 50  },
  { id: 'log',      label: 'Logs',         hue: 95  },
  { id: 'data',     label: 'Data',         hue: 215 },
  { id: 'other',    label: 'Other',        hue: 0   }
];

// ── Tree helpers ─────────────────────────────────────────────────────────

export function findByPath(root: FsNode, path: string): FsNode | null {
  if (root.path === path) return root;
  if (!root.children) return null;
  for (const c of root.children) {
    const r = findByPath(c, path);
    if (r) return r;
  }
  return null;
}

export type KindRollup = Partial<Record<Kind, number>>;

export function rollupByKind(node: FsNode, agg: KindRollup = {}): KindRollup {
  if (node.type === 'file') {
    const k = kindFor(node.ext);
    agg[k] = (agg[k] || 0) + node.size;
  } else if (node.children) {
    for (const c of node.children) rollupByKind(c, agg);
  }
  return agg;
}

export function containsKind(node: FsNode, kind: Kind): boolean {
  if (node.type === 'file') return kindFor(node.ext) === kind;
  if (!node.children) return false;
  for (const c of node.children) {
    if (containsKind(c, kind)) return true;
  }
  return false;
}

export function countFiles(node: FsNode): number {
  if (node.type === 'file') return 1;
  let n = 0;
  if (node.children) for (const c of node.children) n += countFiles(c);
  return n;
}

export function countDirs(node: FsNode): number {
  if (node.type !== 'dir') return 0;
  let n = 0;
  if (node.children) {
    for (const c of node.children) {
      if (c.type === 'dir') n += 1 + countDirs(c);
    }
  }
  return n;
}
