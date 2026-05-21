import type {
  FsNode,
  ScanProgress,
  DriveInfo,
  DuplicateScanProgress,
  DuplicateScanResult
} from './types';

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
      findDuplicates: (
        folderPath: string
      ) => Promise<DuplicateScanResult | { cancelled: true }>;
      trashFile: (path: string) => Promise<void>;
      openTrash: () => Promise<void>;
      cancelDuplicateScan: () => Promise<void>;
      onDuplicateProgress: (
        callback: (progress: DuplicateScanProgress) => void
      ) => () => void;
      getLaunchPath: () => Promise<string | null>;
      onScanPath: (callback: (path: string) => void) => () => void;
    };
  }
}

export {};
