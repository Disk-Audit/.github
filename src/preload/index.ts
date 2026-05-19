import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

interface ScanProgress {
  bytes: number;
  files: number;
  currentPath: string;
}

const api = {
  listDrives: () => ipcRenderer.invoke('list-drives'),
  scan: (folderPath: string) => ipcRenderer.invoke('scan', folderPath),
  onScanProgress: (callback: (progress: ScanProgress) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, progress: ScanProgress): void =>
      callback(progress);
    ipcRenderer.on('scan-progress', listener);
    return () => {
      ipcRenderer.off('scan-progress', listener);
    };
  }
};

contextBridge.exposeInMainWorld('api', api);
