#!/usr/bin/env node
import { resolve } from 'path';
import { scan, FsNode } from './main/scanner';
import { promises as fs, statfsSync } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const SIZE_WIDTH = 9;
const isWindows = process.platform === 'win32';

function formatSize(bytes: number): string {
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(1)} TB`;
  if (bytes >= 1e9)  return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6)  return `${(bytes / 1e6).toFixed(1)} MB`;
  if (bytes >= 1e3)  return `${(bytes / 1e3).toFixed(1)} KB`;
  return `${bytes} B`;
}

function parseMinSize(s: string): number {
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|tb)?$/i);
  if (!m) throw new Error(`Invalid size: "${s}". Use a number with optional unit (e.g. 10mb, 1gb).`);
  const n = parseFloat(m[1]);
  const unit = (m[2] ?? 'b').toLowerCase();
  const multiplier: Record<string, number> = { b: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12 };
  return n * (multiplier[unit] ?? 1);
}

function countFiles(node: FsNode): number {
  if (node.type === 'file') return 1;
  return (node.children ?? []).reduce((s, c) => s + countFiles(c), 0);
}

interface Options {
  depth: number;
  top: number;
  minSize: number;
  json: boolean;
}

function printNode(node: FsNode, prefix: string, isLast: boolean, depth: number, opts: Options): void {
  const connector = isLast ? '└── ' : '├── ';
  const label = node.name + (node.type === 'dir' ? '/' : '');
  const sizeStr = formatSize(node.size).padStart(SIZE_WIDTH);
  console.log(`${sizeStr}  ${prefix}${connector}${label}`);

  if (node.type !== 'dir' || depth >= opts.depth || !node.children) return;

  const children = node.children
    .filter(c => c.size >= opts.minSize)
    .sort((a, b) => b.size - a.size)
    .slice(0, opts.top);

  const childPrefix = prefix + (isLast ? '    ' : '│   ');
  children.forEach((child, i) => {
    printNode(child, childPrefix, i === children.length - 1, depth + 1, opts);
  });
}

// ── Drive detection (no-electron, works in standalone CLI) ───────────────────

interface DriveEntry {
  label: string;
  path: string;
  totalBytes: number;
  freeBytes: number;
  fsType: string;
}

const PSEUDO_FS = new Set([
  'proc', 'sysfs', 'devtmpfs', 'tmpfs', 'devpts', 'cgroup', 'cgroup2',
  'pstore', 'autofs', 'mqueue', 'debugfs', 'tracefs', 'configfs',
  'fusectl', 'hugetlbfs', 'bpf', 'nsfs', 'binfmt_misc', 'rpc_pipefs',
  'securityfs', 'efivarfs', 'overlay', 'overlayfs', 'squashfs',
  'ramfs', 'aufs', 'unionfs', '9p', 'cifs', 'smbfs', 'smb3',
  'nfs', 'nfs4', 'sshfs', 'fuse.sshfs'
]);

const PSEUDO_PREFIXES = [
  '/proc', '/sys', '/dev', '/run', '/snap',
  '/var/lib/docker', '/var/lib/snapd', '/var/lib/lxd',
  '/var/lib/containers', '/mnt/wsl'
];

async function listDrivesLinux(): Promise<DriveEntry[]> {
  let content: string;
  try {
    content = await fs.readFile('/proc/mounts', 'utf8');
  } catch {
    return [{ label: '/', path: '/', totalBytes: 0, freeBytes: 0, fsType: 'unknown' }];
  }

  const result: DriveEntry[] = [];
  const seenMountPoints = new Set<string>();
  const seenDevices = new Set<string>();

  for (const line of content.split('\n')) {
    const parts = line.split(/\s+/);
    if (parts.length < 4) continue;
    const unescape = (s: string) =>
      s.replace(/\\([0-3][0-7][0-7])/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
    const device = unescape(parts[0]);
    const mountPoint = unescape(parts[1]);
    const fsType = parts[2];

    if (seenMountPoints.has(mountPoint)) continue;
    if (PSEUDO_FS.has(fsType)) continue;
    if (fsType.startsWith('fuse.')) continue;
    if (PSEUDO_PREFIXES.some(p => mountPoint.startsWith(p + '/'))) continue;
    if (PSEUDO_PREFIXES.includes(mountPoint) && mountPoint !== '/') continue;
    seenMountPoints.add(mountPoint);

    if (device.startsWith('/dev/')) {
      let realDevice = device;
      try { realDevice = await fs.realpath(device); } catch { /* ignore */ }
      if (seenDevices.has(realDevice)) continue;
      seenDevices.add(realDevice);
    }

    let totalBytes = 0;
    let freeBytes = 0;
    try {
      const st = statfsSync(mountPoint);
      totalBytes = Number(st.blocks) * Number(st.bsize);
      freeBytes = Number(st.bavail) * Number(st.bsize);
    } catch { /* statfsSync unavailable in pkg — fallback handled below */ }

    if (totalBytes === 0) {
      try {
        const { stdout } = await execAsync(`df -B1 --output=size,avail "${mountPoint}"`, { timeout: 3000 });
        const lines = stdout.trim().split('\n');
        if (lines.length >= 2) {
          const nums = lines[1].trim().split(/\s+/);
          totalBytes = parseInt(nums[0], 10) || 0;
          freeBytes = parseInt(nums[1], 10) || 0;
        }
      } catch { /* leave zeros */ }
    }

    if (totalBytes > 200 * 1024 ** 4) continue;

    result.push({ label: mountPoint, path: mountPoint, totalBytes, freeBytes, fsType });
  }

  result.sort((a, b) => {
    if (a.path === '/') return -1;
    if (b.path === '/') return 1;
    if (a.path === '/home') return -1;
    if (b.path === '/home') return 1;
    return a.path.localeCompare(b.path);
  });

  return result;
}

const PS_DRIVES = `
$ErrorActionPreference = 'SilentlyContinue'
Get-CimInstance -ClassName Win32_LogicalDisk |
  Where-Object { $_.DriveType -in 2,3,4 } |
  Select-Object DeviceID, VolumeName, Size, FreeSpace, FileSystem |
  ConvertTo-Json -Compress
`;

async function listDrivesWindows(): Promise<DriveEntry[]> {
  try {
    const encoded = Buffer.from(PS_DRIVES, 'utf16le').toString('base64');
    const { stdout } = await execAsync(
      `powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}`,
      { maxBuffer: 1024 * 1024 }
    );
    if (!stdout.trim()) return [];
    const parsed = JSON.parse(stdout);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    return arr.filter(Boolean).map((d: any) => ({
      label: d.DeviceID || '',
      path: d.DeviceID ? d.DeviceID + '\\' : '',
      totalBytes: Number(d.Size) || 0,
      freeBytes: Number(d.FreeSpace) || 0,
      fsType: d.FileSystem || ''
    }));
  } catch {
    return [];
  }
}

async function listDrives(): Promise<DriveEntry[]> {
  return isWindows ? listDrivesWindows() : listDrivesLinux();
}

function usageBar(used: number, total: number, width = 20): string {
  if (total === 0) return '[' + '?'.repeat(width) + ']';
  const filled = Math.round((used / total) * width);
  return '[' + '█'.repeat(filled) + '░'.repeat(width - filled) + ']';
}

function showDrives(drives: DriveEntry[]): void {
  if (drives.length === 0) {
    console.log('No drives detected.');
    return;
  }
  console.log('Detected drives:\n');
  for (const d of drives) {
    const used = d.totalBytes > 0 ? d.totalBytes - d.freeBytes : 0;
    const usedStr = d.totalBytes > 0 ? formatSize(used) : '?';
    const totalStr = d.totalBytes > 0 ? formatSize(d.totalBytes) : '?';
    const pct = d.totalBytes > 0 ? Math.round((used / d.totalBytes) * 100) : 0;
    const bar = usageBar(used, d.totalBytes);
    const pctStr = d.totalBytes > 0 ? `${pct}%` : '?';
    console.log(`  ${d.label}`);
    console.log(`  ${bar}  ${usedStr} used / ${totalStr} total  (${pctStr} full)`);
    if (d.fsType) console.log(`  Filesystem: ${d.fsType}`);
    console.log();
  }
  const example = drives[0]?.path ?? (isWindows ? 'C:\\' : '/');
  console.log(`Run \`ledgeon ${example}\` to analyze a drive or folder.`);
  console.log(`Run \`ledgeon\` to analyze the current directory.`);
}

// ── Help ─────────────────────────────────────────────────────────────────────

function showHelp(): void {
  console.log(`
Disk Analyzer CLI

Usage:
  ledgeon [path] [options]  Analyze disk usage (default: current directory)
  ledgeon list              List detected drives

Options:
  -d, --depth N     Levels deep to display (default: 3)
  -n, --top N       Max entries per level, sorted by size (default: 10)
  -s, --min-size N  Omit entries smaller than N (e.g. 10mb, 1gb) (default: 0)
      --json        Output full JSON tree instead of formatted display
  -h, --help        Show this help

Examples:
  ledgeon
  ledgeon list
  ledgeon /
  ledgeon /home/user --depth 4 --top 5
  ledgeon C:\\Users --min-size 100mb
  ledgeon /var --json > scan.json
`.trim());
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    showHelp();
    process.exit(0);
  }

  const opts: Options = { depth: 3, top: 10, minSize: 0, json: false };
  let targetPath: string = process.cwd();
  let listMode = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === 'list') {
      listMode = true;
    } else if ((a === '--depth' || a === '-d') && args[i + 1]) {
      opts.depth = parseInt(args[++i], 10);
    } else if ((a === '--top' || a === '-n') && args[i + 1]) {
      opts.top = parseInt(args[++i], 10);
    } else if ((a === '--min-size' || a === '-s') && args[i + 1]) {
      opts.minSize = parseMinSize(args[++i]);
    } else if (a === '--json') {
      opts.json = true;
    } else if (!a.startsWith('-')) {
      targetPath = resolve(a);
    } else {
      console.error(`Unknown option: ${a}\nRun with --help for usage.`);
      process.exit(1);
    }
  }

  // list subcommand — show detected drives
  if (listMode) {
    const drives = await listDrives();
    if (opts.json) {
      console.log(JSON.stringify(drives, null, 2));
    } else {
      showDrives(drives);
    }
    return;
  }

  // Scan path (default: cwd) and print tree
  const tree = await scan(targetPath, () => {});

  if (opts.json) {
    console.log(JSON.stringify(tree, null, 2));
    return;
  }

  console.log(`${formatSize(tree.size).padStart(SIZE_WIDTH)}  ${tree.path}/`);

  const topChildren = (tree.children ?? [])
    .filter(c => c.size >= opts.minSize)
    .sort((a, b) => b.size - a.size)
    .slice(0, opts.top);

  topChildren.forEach((child, i) => {
    printNode(child, '', i === topChildren.length - 1, 1, opts);
  });
}

main().catch(e => {
  console.error(`Error: ${(e as Error).message}`);
  process.exit(1);
});
