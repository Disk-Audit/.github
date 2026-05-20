import { app } from 'electron';
import { exec } from 'child_process';
import { promisify } from 'util';
import { promises as fs } from 'fs';
import path from 'path';

const execAsync = promisify(exec);

export interface DriveInfo {
  letter: string;
  label: string;
  totalBytes: number;
  freeBytes: number;
  fileSystem: string;
  driveType: 'fixed' | 'removable';
  mediaType: 'ssd' | 'hdd' | 'unknown';
}

function rustBinaryPath(): string {
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

// Fast path: ask the Rust binary. Win32 calls directly, no PowerShell, no UAC.
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
    return JSON.parse(stdout) as DriveInfo[];
  } catch (e) {
    console.warn('[drives] Rust listing failed, falling back to PowerShell:', e);
    return null;
  }
}

// Slow fallback if the Rust binary is missing. PowerShell can't tell SSD
// from HDD reliably without a separate Get-PhysicalDisk call, so we return
// "unknown" for mediaType here.
const PS_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$result = @(Get-CimInstance -ClassName Win32_LogicalDisk |
    Where-Object { $_.DriveType -in 2,3 } |
    Select-Object DeviceID, VolumeName, Size, FreeSpace, FileSystem, DriveType)
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
    return arr.filter(Boolean).map((d: any) => ({
      letter: d.DeviceID || '',
      label: (d.VolumeName || '').trim(),
      totalBytes: Number(d.Size) || 0,
      freeBytes: Number(d.FreeSpace) || 0,
      fileSystem: (d.FileSystem || '').trim(),
      driveType: d.DriveType === 2 ? ('removable' as const) : ('fixed' as const),
      mediaType: 'unknown' as const
    }));
  } catch {
    return [];
  }
}

export async function listDrives(): Promise<DriveInfo[]> {
  if (process.platform !== 'win32') return [];
  const rust = await tryRustList();
  if (rust !== null) return rust;
  return powershellList();
}
