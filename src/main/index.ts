// Bump libuv thread pool early — must run before any fs operation
process.env.UV_THREADPOOL_SIZE = '64';

import { app, BrowserWindow, ipcMain, dialog, shell, Menu } from 'electron';
import { join } from 'path';
import { scan } from './scanner';
import { listDrives } from './drives';
import { tryRustWalk } from './rustWalker';

// No File / Edit / View menu bar — this is a focused single-purpose app.
Menu.setApplicationMenu(null);

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 500,
    title: 'Disk Analyzer',
    backgroundColor: '#f4f0e3',
    show: false,
    autoHideMenuBar: true,
    frame: false,
    titleBarStyle: 'hidden',
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

  ipcMain.handle('choose-folder', async () => {
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: 'Select a folder or drive to scan'
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('list-drives', async () => listDrives());

  ipcMain.handle('scan', async (_event, folderPath: string) => {
    const sendProgress = (progress: {
      bytes: number;
      files: number;
      currentPath: string;
    }): void => {
      if (!win.isDestroyed()) win.webContents.send('scan-progress', progress);
    };

    // Try the Rust walker first on Windows. No UAC. Falls back to Node if
    // the binary is missing or fails.
    if (process.platform === 'win32') {
      console.log('[scan] attempting Rust walker for', folderPath);
      const start = Date.now();
      const result = await tryRustWalk(folderPath, sendProgress);
      if (result) {
        console.log(
          `[scan] Rust walker succeeded in ${((Date.now() - start) / 1000).toFixed(1)}s`
        );
        return result;
      }
      console.log('[scan] falling back to Node scanner');
    }

    return await scan(folderPath, sendProgress);
  });

  ipcMain.handle('open-in-explorer', async (_event, targetPath: string) => {
    // showItemInFolder highlights the item in Explorer; openPath would open
    // a folder *into* itself, which isn't what we want for files.
    shell.showItemInFolder(targetPath);
  });

  // Window controls for the custom (frameless) title bar
  ipcMain.handle('window-minimize', () => {
    win.minimize();
  });
  ipcMain.handle('window-toggle-maximize', () => {
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.handle('window-close', () => {
    win.close();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
