// Bump libuv thread pool early — must run before any fs operation
process.env.UV_THREADPOOL_SIZE = '64';

import { app, BrowserWindow, ipcMain, dialog, shell, Menu } from 'electron';
import { join } from 'path';
import { scan } from './scanner';
import { listDrives } from './drives';
import { tryRustWalk } from './rustWalker';
import {
  findDuplicates,
  isPathSafeToTrash,
  type DuplicateScanProgress
} from './duplicates';

// No File / Edit / View menu bar — this is a focused single-purpose app.
Menu.setApplicationMenu(null);

/**
 * Pull a folder path off argv if the app was launched with one — that's how
 * the OS context menu integration works on both Windows ("Scan with…" passes
 * `%V` as the last argument) and Linux (.desktop Actions pass `%f`).
 *
 * In dev mode the first user argv entry is often something like `.` or a
 * vite URL — we only accept absolute paths to avoid that case.
 */
function getLaunchPathFromArgv(): string | null {
  const args = process.argv.slice(app.isPackaged ? 1 : 2);
  for (const a of args) {
    if (!a || a.startsWith('-')) continue;
    if (/^[A-Za-z]:[\\/]/.test(a) || a.startsWith('/')) {
      return a;
    }
  }
  return null;
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 500,
    title: 'Disk Analyzer',
    backgroundColor: '#131720',
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

  // Duplicate file scanner — streams progress via 'duplicate-progress' events
  ipcMain.handle('find-duplicates', async (_event, folderPath: string) => {
    const send = (p: DuplicateScanProgress): void => {
      if (!win.isDestroyed()) win.webContents.send('duplicate-progress', p);
    };
    return await findDuplicates(folderPath, send);
  });

  // Send to Recycle Bin / Trash. Refuses paths inside system folders even
  // though the renderer should never offer them in the first place.
  ipcMain.handle('trash-file', async (_event, targetPath: string) => {
    if (!isPathSafeToTrash(targetPath)) {
      throw new Error(
        'Refusing to trash file in a system-protected folder: ' + targetPath
      );
    }
    await shell.trashItem(targetPath);
  });

  // Open the system Recycle Bin / Trash so the user can restore deletions.
  ipcMain.handle('open-trash', async () => {
    if (process.platform === 'win32') {
      // Special shell folder for the Recycle Bin
      await shell.openPath('shell:RecycleBinFolder');
    } else if (process.platform === 'darwin') {
      await shell.openPath(
        require('path').join(require('os').homedir(), '.Trash')
      );
    } else {
      // Linux — GNOME/KDE/Cinnamon all use the XDG trash spec
      const trashPath = require('path').join(
        require('os').homedir(),
        '.local/share/Trash/files'
      );
      await shell.openPath(trashPath);
    }
  });

  // Returns the path the app was launched with, if any (from context menu).
  // The renderer calls this once on startup and auto-scans if it gets one.
  ipcMain.handle('get-launch-path', () => getLaunchPathFromArgv());

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// On Windows, only allow one instance of the app at a time. If a second
// instance launches (e.g. from a context-menu invocation), pass its arguments
// to the first instance and focus that window.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const wins = BrowserWindow.getAllWindows();
    if (wins.length > 0) {
      const win = wins[0];
      if (win.isMinimized()) win.restore();
      win.focus();
      // Find a path in the new argv and tell the renderer to scan it
      const args = argv.slice(app.isPackaged ? 1 : 2);
      for (const a of args) {
        if (!a || a.startsWith('-')) continue;
        if (/^[A-Za-z]:[\\/]/.test(a) || a.startsWith('/')) {
          win.webContents.send('scan-path', a);
          break;
        }
      }
    }
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
