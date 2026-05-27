import { app } from 'electron';
import { exec } from 'child_process';
import { promisify } from 'util';
import { promises as fs, statfsSync } from 'fs';
import path from 'path';

const execAsync = promisify(exec);

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

const isWindows = process.platform === 'win32';

function rustBinaryName(): string {
  return isWindows ? 'mft_scanner.exe' : 'mft_scanner';
}

function rustBinaryPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, rustBinaryName());
  }
  return path.join(
    __dirname,
    '..',
    '..',
    'mft_scanner',
    'target',
    'release',
    rustBinaryName()
  );
}

// =========================================================================
// Windows — same fast path as before: Rust binary first, PowerShell fallback
// =========================================================================

async function tryRustList(): Promise<DriveInfo[] | null> {
  const binaryPath = rustBinaryPath();
  try {
    await fs.access(binaryPath);
  } catch {
    return null;
  }
  try {
    const { stdout } = await execAsync(`"${binaryPath}" --list-drives`, {
      maxBuffer: 1024 * 1024,
      timeout: 5000,
      windowsHide: true
    });
    if (!stdout.trim()) return [];
    const drives = JSON.parse(stdout) as Omit<DriveInfo, 'path'>[];
    // Older Rust binaries don't emit `path` — synthesise it from the letter.
    return drives.map((d) => ({
      ...d,
      path: (d as DriveInfo).path || d.letter + '\\'
    }));
  } catch (e) {
    console.warn('[drives] Rust listing failed, falling back to PowerShell:', e);
    return null;
  }
}

const PS_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$result = @(Get-CimInstance -ClassName Win32_LogicalDisk |
    Where-Object { $_.DriveType -in 2,3,4 } |
    Select-Object DeviceID, VolumeName, Size, FreeSpace, FileSystem, DriveType, ProviderName)
$result | ConvertTo-Json -Compress
`;

async function powershellList(): Promise<DriveInfo[]> {
  try {
    const encoded = Buffer.from(PS_SCRIPT, 'utf16le').toString('base64');
    const cmd = `powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}`;
    const { stdout } = await execAsync(cmd, { maxBuffer: 1024 * 1024 });
    if (!stdout.trim()) return [];
    const parsed = JSON.parse(stdout);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    return arr.filter(Boolean).map((d: any) => {
      const letter = d.DeviceID || '';
      const driveType: DriveInfo['driveType'] =
        d.DriveType === 4 ? 'network' : d.DriveType === 2 ? 'removable' : 'fixed';
      const providerName = (d.ProviderName || '').trim();
      // For network drives, prefer scanning the UNC directly (avoids the
      // mapped-letter redirector hop). Fall back to the letter if the
      // ProviderName field is missing for any reason.
      const path =
        driveType === 'network' && providerName
          ? providerName.endsWith('\\') ? providerName : providerName + '\\'
          : letter
            ? letter + '\\'
            : '';
      return {
        letter,
        path,
        label: (d.VolumeName || '').trim(),
        totalBytes: Number(d.Size) || 0,
        freeBytes: Number(d.FreeSpace) || 0,
        fileSystem: (d.FileSystem || '').trim(),
        driveType,
        mediaType: 'unknown' as const,
        remotePath: providerName || undefined
      };
    });
  } catch {
    return [];
  }
}

// =========================================================================
// Linux — read /proc/mounts, statvfs each, check /sys/block for SSD vs HDD
// =========================================================================

// Filesystems and mount-point prefixes that are not real storage. We skip them
// so the welcome screen only shows things you'd actually want to scan.
const PSEUDO_FS = new Set([
  'proc',
  'sysfs',
  'devtmpfs',
  'tmpfs',
  'devpts',
  'cgroup',
  'cgroup2',
  'pstore',
  'autofs',
  'mqueue',
  'debugfs',
  'tracefs',
  'configfs',
  'fusectl',
  'hugetlbfs',
  'bpf',
  'nsfs',
  'binfmt_misc',
  'rpc_pipefs',
  'securityfs',
  'efivarfs',
  'fuse.gvfsd-fuse',
  'fuse.portal',
  'fuse.snapfuse',
  'overlay',
  'overlayfs',
  'squashfs',
  'ramfs',
  'aufs',
  'unionfs',
  // Network / WSL mounts — including these would inflate totals dramatically
  // (e.g. WSL2 surfaces every Windows drive as 9p at /mnt/c, /mnt/d, …)
  '9p',
  'cifs',
  'smbfs',
  'smb3',
  'nfs',
  'nfs4',
  'sshfs',
  'fuse.sshfs'
]);

const PSEUDO_PREFIXES = [
  '/proc',
  '/sys',
  '/dev',
  '/run',
  '/snap',
  '/var/lib/docker',
  '/var/lib/snapd',
  '/var/lib/lxd',
  '/var/lib/containers',
  '/mnt/wsl' // WSL bookkeeping mounts
];

interface MountEntry {
  device: string;
  mountPoint: string;
  fsType: string;
  options: string;
}

async function readMounts(): Promise<MountEntry[]> {
  let content: string;
  try {
    content = await fs.readFile('/proc/mounts', 'utf8');
  } catch {
    return [];
  }
  const out: MountEntry[] = [];
  for (const line of content.split('\n')) {
    const parts = line.split(/\s+/);
    if (parts.length < 4) continue;
    // /proc/mounts uses octal escapes (\040 for space, \011 for tab, etc.)
    const unescape = (s: string): string =>
      s.replace(/\\([0-3][0-7][0-7])/g, (_, oct) =>
        String.fromCharCode(parseInt(oct, 8))
      );
    out.push({
      device: unescape(parts[0]),
      mountPoint: unescape(parts[1]),
      fsType: parts[2],
      options: parts[3]
    });
  }
  return out;
}

/**
 * Resolve a mount's underlying block device to its real /dev/sdX or /dev/nvmeXnY
 * path. Returns null if it isn't a regular block device (network mount, etc.).
 */
async function resolveBlockDevice(device: string): Promise<string | null> {
  if (!device.startsWith('/dev/')) return null;
  try {
    const real = await fs.realpath(device);
    return real;
  } catch {
    return device;
  }
}

/**
 * Look up `/sys/block/<dev>/queue/rotational` to determine HDD (1) vs SSD (0).
 */
async function detectMediaType(
  devicePath: string
): Promise<'ssd' | 'hdd' | 'unknown'> {
  // Strip /dev/ and any trailing partition number to get the base device.
  // /dev/sda5 -> sda, /dev/nvme0n1p2 -> nvme0n1
  const base = devicePath
    .replace(/^\/dev\//, '')
    .replace(/p?\d+$/, '');
  if (!base) return 'unknown';
  try {
    const rot = await fs.readFile(`/sys/block/${base}/queue/rotational`, 'utf8');
    return rot.trim() === '0' ? 'ssd' : 'hdd';
  } catch {
    return 'unknown';
  }
}

/**
 * Convert "/" → "ROOT", "/home" → "HOME", "/mnt/usb-stick" → "USB-STICK".
 * This becomes the short label that goes inside the green "letter" badge.
 */
function shortLabelFromMount(mountPoint: string): string {
  if (mountPoint === '/') return '/';
  const last = mountPoint.split('/').filter(Boolean).pop() || '/';
  // Cap at 4 chars so it fits in the badge — "HOME", "USB", "DATA" etc.
  return last.toUpperCase().slice(0, 4);
}

async function unixList(): Promise<DriveInfo[]> {
  const mounts = await readMounts();
  const result: DriveInfo[] = [];
  const seenMountPoints = new Set<string>();
  const seenDevices = new Set<string>();

  for (const m of mounts) {
    if (seenMountPoints.has(m.mountPoint)) continue;
    if (PSEUDO_FS.has(m.fsType)) continue;
    if (PSEUDO_PREFIXES.some((p) => m.mountPoint.startsWith(p + '/')))
      continue;
    if (PSEUDO_PREFIXES.includes(m.mountPoint) && m.mountPoint !== '/')
      continue;
    if (m.fsType.startsWith('fuse.')) continue;
    seenMountPoints.add(m.mountPoint);

    const realDevice = await resolveBlockDevice(m.device);

    // Dedupe by underlying block device. btrfs subvolumes and bind mounts both
    // point at the same physical device — without this we'd add the device's
    // capacity to the total once per subvolume, exploding the reported size.
    // Keep only the first (shortest path) mount of each device.
    if (realDevice && realDevice.startsWith('/dev/')) {
      if (seenDevices.has(realDevice)) continue;
      seenDevices.add(realDevice);
    }

    // Capacity via statfs (Node 18.15+; falls back to 0 if unsupported).
    let totalBytes = 0;
    let freeBytes = 0;
    try {
      const st = statfsSync(m.mountPoint);
      totalBytes = Number(st.blocks) * Number(st.bsize);
      freeBytes = Number(st.bavail) * Number(st.bsize);
    } catch {
      // statfs unavailable — leave zeros, UI will say "size unavailable"
    }

    // Sanity guard: anything claiming over 200 TB on a single mount is almost
    // certainly a misreporting filesystem (ZFS pool, network share, weird
    // virtual mount). Skip it rather than show a nonsensical number.
    if (totalBytes > 200 * 1024 * 1024 * 1024 * 1024) {
      console.warn(
        `[drives] Skipping ${m.mountPoint} — reported size ${totalBytes} bytes looks wrong`
      );
      continue;
    }

    const mediaType = realDevice
      ? await detectMediaType(realDevice)
      : 'unknown';

    // Removable detection: if the underlying device path is under
    // /dev/sd... and `/sys/block/<dev>/removable` is "1", call it removable.
    let driveType: 'fixed' | 'removable' = 'fixed';
    if (realDevice && realDevice.startsWith('/dev/sd')) {
      const base = realDevice.replace(/^\/dev\//, '').replace(/\d+$/, '');
      try {
        const rem = await fs.readFile(
          `/sys/block/${base}/removable`,
          'utf8'
        );
        if (rem.trim() === '1') driveType = 'removable';
      } catch {
        /* ignore */
      }
    }
    // USB mounts under /media or /run/media are removable too.
    if (
      m.mountPoint.startsWith('/media/') ||
      m.mountPoint.startsWith('/run/media/')
    ) {
      driveType = 'removable';
    }

    result.push({
      letter: shortLabelFromMount(m.mountPoint),
      path: m.mountPoint,
      label: m.mountPoint, // full path makes a useful display label on Linux
      totalBytes,
      freeBytes,
      fileSystem: m.fsType,
      driveType,
      mediaType
    });
  }

  // Show root first, then /home, then everything else by mount path
  result.sort((a, b) => {
    if (a.path === '/') return -1;
    if (b.path === '/') return 1;
    if (a.path === '/home') return -1;
    if (b.path === '/home') return 1;
    return a.path.localeCompare(b.path);
  });

  return result;
}

// =========================================================================
// Public entry point
// =========================================================================

export async function listDrives(): Promise<DriveInfo[]> {
  if (isWindows) {
    const rust = await tryRustList();
    if (rust !== null) return rust;
    return powershellList();
  }
  // Linux (and other Unixes that have /proc/mounts)
  return unixList();
}
