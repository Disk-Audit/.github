import type { FsNode, ScanProgress, DriveInfo } from './types';

declare global {
  interface Window {
    api: {
      listDrives: () => Promise<DriveInfo[]>;
      scan: (folderPath: string) => Promise<FsNode>;
      onScanProgress: (callback: (progress: ScanProgress) => void) => () => void;
    };
  }
}

export {};
