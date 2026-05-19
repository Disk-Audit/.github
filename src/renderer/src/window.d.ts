import type { FsNode, ScanProgress } from './types';

declare global {
  interface Window {
    api: {
      chooseFolder: () => Promise<string | null>;
      scan: (folderPath: string) => Promise<FsNode>;
      onScanProgress: (callback: (progress: ScanProgress) => void) => () => void;
    };
  }
}

export {};
