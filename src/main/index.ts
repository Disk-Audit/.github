process.env.UV_THREADPOOL_SIZE = '64';

import { app, BrowserWindow, ipcMain, Menu } from 'electron';
import { join } from 'path';
import { scan } from './scanner';
import { listDrives } from './drives';
import { tryMftScan } from './mftScanner';

Menu.setApplicationMenu(null);

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 500,
    title: 'Disk Analyzer',
    backgroundColor: '#1a202c',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.once('ready-to-show', () => win.show());

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return win;
}

app.whenReady().then(() => {
  const win = createWindow();

  ipcMain.handle('list-drives', async () => {
    return await listDrives();
  });

  ipcMain.handle('scan', async (_event, folderPath: string) => {
    const sendProgress = (progress: {
      bytes: number;
      files: number;
      currentPath: string;
    }): void => {
      if (!win.isDestroyed()) {
        win.webContents.send('scan-progress', progress);
      }
    };

    // For whole-drive scans on Windows, try the fast Rust MFT path first.
    // Pattern matches "C:\" or "C:" — anything else falls through to Node.
    if (process.platform === 'win32' && /^[A-Za-z]:[\\\/]?$/.test(folderPath)) {
      console.log('[scan] attempting MFT scan for', folderPath);
      const start = Date.now();
      const result = await tryMftScan(folderPath, sendProgress);
      if (result) {
        console.log(
          `[scan] MFT scan succeeded in ${((Date.now() - start) / 1000).toFixed(1)}s`
        );
        return result;
      }
      console.log('[scan] MFT scan unavailable or failed — falling back to Node scanner');
    }

    return await scan(folderPath, sendProgress);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
