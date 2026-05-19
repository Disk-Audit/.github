import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface DriveInfo {
  letter: string;
  label: string;
  totalBytes: number;
  freeBytes: number;
  fileSystem: string;
  driveType: 'fixed' | 'removable';
}

// DriveType 2 = removable, 3 = local fixed. Skip network drives and CDs.
const PS_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$result = @(Get-CimInstance -ClassName Win32_LogicalDisk |
    Where-Object { $_.DriveType -in 2,3 } |
    Select-Object DeviceID, VolumeName, Size, FreeSpace, FileSystem, DriveType)
$result | ConvertTo-Json -Compress
`;

export async function listDrives(): Promise<DriveInfo[]> {
  if (process.platform !== 'win32') return [];
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
      driveType: d.DriveType === 2 ? ('removable' as const) : ('fixed' as const)
    }));
  } catch {
    return [];
  }
}
