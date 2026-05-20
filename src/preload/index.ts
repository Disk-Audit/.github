import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

interface ScanProgress {
  bytes: number;
  files: number;
  currentPath: string;
}

const api = {
  chooseFolder: (): Promise<string | null> => ipcRenderer.invoke('choose-folder'),
  listDrives: () => ipcRenderer.invoke('list-drives'),
  scan: (folderPath: string) => ipcRenderer.invoke('scan', folderPath),
  openInExplorer: (path: string) => ipcRenderer.invoke('open-in-explorer', path),
  onScanProgress: (callback: (progress: ScanProgress) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, progress: ScanProgress): void =>
      callback(progress);
    ipcRenderer.on('scan-progress', listener);
    return () => {
      ipcRenderer.off('scan-progress', listener);
    };
  },
  windowMinimize: () => ipcRenderer.invoke('window-minimize'),
  windowToggleMaximize: () => ipcRenderer.invoke('window-toggle-maximize'),
  windowClose: () => ipcRenderer.invoke('window-close')
};

contextBridge.exposeInMainWorld('api', api);
