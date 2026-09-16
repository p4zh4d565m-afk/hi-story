import { app, BrowserWindow, dialog } from 'electron';
import path from 'path';
import { getDb, getDbPath, attachLiteraryDb, closeDb } from './db/connection';
import { runMigrations } from './db/migrations';
import { backupOnStartup, isFirstRun } from './db/backup';
import { ChapterRunService } from './db/repositories/chapter-run.service';
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

app.whenReady().then(async () => {
  try {
    // 首次启动：库文件尚不存在（getDb() 会当场建库），跳过备份避免留一份空库。
    // 注意必须先于 getDb() 判断，否则到备份时库已被建出、existsSync 永远为真。
    const isFirst = isFirstRun(getDbPath());

    const db = getDb();

    // 迁移前备份原始库：迁移是唯一的自动结构变更，是最大的数据丢失风险点。
    // 若迁移中途失败，此备份是唯一可完整恢复的原始数据，故必须先同步备份完再迁移。
    if (!isFirst) {
      await backupOnStartup().catch((err) => {
        console.error('[Backup] 自动备份异常（不阻断启动）:', err);
      });
    }

    runMigrations(db);
    attachLiteraryDb();

    // 三期启动恢复：把遗留 running 的写章运行标为 failed/PROCESS_INTERRUPTED，不自动重放付费请求
    try {
      const interrupted = new ChapterRunService(db).recoverInterruptedAll();
      if (interrupted > 0) {
        console.log(`[Init] 恢复 ${interrupted} 条中断的写章运行 → failed/PROCESS_INTERRUPTED`);
      }
    } catch (err) {
      console.error('[Init] 写章运行恢复失败（不阻断启动）:', err);
    }

    // 清空旧 768 维向量（避免与新 1024 维 API Embedding 维度冲突导致余弦相似度全 0）
    let clearedUser = 0, clearedLit = 0;
    try {
      // Float32 每维占 4 字节，仅清理旧的 768 维向量，保留已重建的索引。
      clearedUser = db.prepare('UPDATE reference_chunks SET embedding = NULL WHERE length(embedding) = 3072').run().changes;
      clearedLit = db.prepare('DELETE FROM lit_embeddings WHERE length(embedding) = 3072').run().changes;
    } catch {}
    if (clearedUser > 0 || clearedLit > 0) {
      console.log(`[Init] 清空旧向量: user=${clearedUser}, lit=${clearedLit}（请用 build_embeddings.py 重建）`);
    }
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

  // ═══ 后台异步建语义索引 ═══
  // 已停用 Python text2vec（768 维），改用通义千问 API（1024 维）离线构建
  // 运行: python build_embeddings.py --api-key YOUR_QWEN_KEY
  // 如需恢复自动构建: 取消下面注释
  // buildIndexOnStartup();
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
