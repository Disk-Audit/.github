import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

interface ScanProgress {
  bytes: number;
  files: number;
  currentPath: string;
}

interface DuplicateProgress {
  phase: 'sizing' | 'hashing' | 'done';
  filesSeen: number;
  candidatesHashed: number;
  candidatesTotal: number;
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
  windowClose: () => ipcRenderer.invoke('window-close'),

  // Duplicate file finder + delete-to-trash
  findDuplicates: (folderPath: string) =>
    ipcRenderer.invoke('find-duplicates', folderPath),
  trashFile: (path: string): Promise<void> =>
    ipcRenderer.invoke('trash-file', path),
  openTrash: (): Promise<void> => ipcRenderer.invoke('open-trash'),
  cancelDuplicateScan: (): Promise<void> =>
    ipcRenderer.invoke('cancel-duplicate-scan'),
  onDuplicateProgress: (
    callback: (progress: DuplicateProgress) => void
  ): (() => void) => {
    const listener = (
      _event: IpcRendererEvent,
      progress: DuplicateProgress
    ): void => callback(progress);
    ipcRenderer.on('duplicate-progress', listener);
    return () => {
      ipcRenderer.off('duplicate-progress', listener);
    };
  },

  // Context menu integration: the renderer asks for any launch path on startup
  getLaunchPath: (): Promise<string | null> =>
    ipcRenderer.invoke('get-launch-path'),
  // And listens for paths arriving via a second-instance invocation while
  // the app is already running.
  onScanPath: (callback: (path: string) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, p: string): void => callback(p);
    ipcRenderer.on('scan-path', listener);
    return () => {
      ipcRenderer.off('scan-path', listener);
    };
  }
};

contextBridge.exposeInMainWorld('api', api);
