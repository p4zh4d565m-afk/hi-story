import { app, BrowserWindow, dialog } from 'electron';
import path from 'path';
import { getDb, attachLiteraryDb, closeDb } from './db/connection';
import { runMigrations } from './db/migrations';
import { registerAllIpc } from './ipc';
import { createAppMenu } from './menu';

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    title: 'hi story',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173').catch((err) => {
      console.error('Failed to load dev server:', err.message);
      // Fallback: try built files if dev server not running
      const rendererPath = path.join(__dirname, '../../renderer/index.html');
      console.log('Falling back to:', rendererPath);
      mainWindow?.loadFile(rendererPath).catch((e) => {
        console.error('Failed to load renderer:', e.message);
      });
    });
  } else {
    const rendererPath = path.join(__dirname, '../../renderer/index.html');
    console.log('Loading renderer from:', rendererPath);
    mainWindow.loadFile(rendererPath).catch((err) => {
      console.error('Failed to load renderer:', err.message);
    });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── Global error handlers — prevent silent crashes ──
process.on('uncaughtException', (error) => {
  console.error('UNCAUGHT EXCEPTION:', error);
  // Show a dialog if we have a window
  if (mainWindow && !mainWindow.isDestroyed()) {
    dialog.showErrorBox('应用错误', `发生未捕获的错误:\n${error.message}\n\n应用将继续运行，但建议重启。`);
  }
});

process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION:', reason);
  const msg = reason instanceof Error ? reason.message : String(reason);
  if (mainWindow && !mainWindow.isDestroyed()) {
    dialog.showErrorBox('应用错误', `未处理的异步错误:\n${msg}\n\n应用将继续运行，但建议重启。`);
  }
});

app.whenReady().then(() => {
  try {
    const db = getDb();
    runMigrations(db);
    attachLiteraryDb();
  } catch (err: any) {
    console.error('Failed to initialize database:', err);
    dialog.showErrorBox('数据库错误', `无法初始化数据库:\n${err.message}\n\n请检查磁盘空间和文件权限。`);
    app.quit();
    return;
  }

  registerAllIpc();
  createWindow();

  const win = mainWindow;
  if (win) {
    createAppMenu(win);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  closeDb();
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
