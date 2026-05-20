import type { FsNode, ScanProgress, DriveInfo } from './types';

declare global {
  interface Window {
    api: {
      chooseFolder: () => Promise<string | null>;
      listDrives: () => Promise<DriveInfo[]>;
      scan: (folderPath: string) => Promise<FsNode>;
      openInExplorer: (path: string) => Promise<void>;
      onScanProgress: (callback: (progress: ScanProgress) => void) => () => void;
      windowMinimize: () => Promise<void>;
      windowToggleMaximize: () => Promise<void>;
      windowClose: () => Promise<void>;
    };
  }
}

export {};
