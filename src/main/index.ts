import { app, BrowserWindow, dialog } from 'electron';
import path from 'path';
import { getDb, attachLiteraryDb, closeDb } from './db/connection';
import { runMigrations } from './db/migrations';
import { registerAllIpc } from './ipc';
import { createAppMenu } from './menu';
import { ReferenceRepo } from './db/repositories/reference.repo';
import { buildIndex, pingPython, getPythonProcess } from './ai/semantic-reranker';

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

    // 清空旧 768 维向量（避免与新 1024 维 API Embedding 维度冲突导致余弦相似度全 0）
    let clearedUser = 0, clearedLit = 0;
    try {
      clearedUser = db.prepare('UPDATE reference_chunks SET embedding = NULL WHERE embedding IS NOT NULL').run().changes;
      clearedLit = db.prepare('DELETE FROM lit_embeddings').run().changes;
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

// ═══════════════════════════════════════════════════
// 离线向量索引构建
// ═══════════════════════════════════════════════════

async function buildIndexOnStartup(): Promise<void> {
  try {
    // 先确保 Python 进程启动
    const pyReady = await pingPython();
    if (!pyReady) {
      console.log('[IndexBuild] Python 进程未就绪，跳过向量索引构建');
      return;
    }

    const repo = new ReferenceRepo(getDb());
    const db = getDb();

    // 1. 检查文学库是否需要建索引
    const litCount = db.prepare('SELECT COUNT(*) as c FROM lit_embeddings').get() as { c: number };
    if (litCount.c === 0) {
      console.log('[IndexBuild] 文学库未索引，开始编码...');
      const litDb = require('./db/connection').getLiteraryDb();
      if (litDb) {
        const litRows = litDb.prepare('SELECT rowid, content FROM materials').all() as Array<{ rowid: number; content: string }>;
        console.log(`[IndexBuild] 文学库共 ${litRows.length} 条`);

        // 分批编码（每批 50 条）
        const BATCH = 50;
        for (let i = 0; i < litRows.length; i += BATCH) {
          const batch = litRows.slice(i, i + BATCH);
          const { encodeAndIndex } = require('./ai/semantic-reranker');
          const chunkIds = batch.map(r => `lit_placeholder_${r.rowid}`);
          const blobs = await encodeAndIndex(batch.map(r => r.content), chunkIds);
          if (blobs) {
            const upsert = db.prepare('INSERT OR REPLACE INTO lit_embeddings (lit_rowid, embedding) VALUES (?, ?)');
            const tx = db.transaction(() => {
              for (let j = 0; j < batch.length; j++) {
                upsert.run(batch[j].rowid, Buffer.from(blobs[j], 'base64'));
              }
            });
            tx();
          }
          console.log(`[IndexBuild] 文学库进度: ${Math.min(i + BATCH, litRows.length)}/${litRows.length}`);
        }
      }
    }

    // 2. 检查用户 chunk 是否有未索引的
    const unindexed = repo.getUnindexedChunks();
    if (unindexed.success && unindexed.data && unindexed.data.length > 0) {
      const chunks = unindexed.data;
      console.log(`[IndexBuild] 用户分块未索引: ${chunks.length} 条`);
      const BATCH = 30;
      for (let i = 0; i < chunks.length; i += BATCH) {
        const batch = chunks.slice(i, i + BATCH);
        const { encodeAndIndex } = require('./ai/semantic-reranker');
        const blobs = await encodeAndIndex(
          batch.map(c => c.content),
          batch.map(c => c.id),
        );
        if (blobs) {
          const update = db.prepare('UPDATE reference_chunks SET embedding = ? WHERE id = ?');
          const tx = db.transaction(() => {
            for (let j = 0; j < batch.length; j++) {
              update.run(Buffer.from(blobs[j], 'base64'), batch[j].id);
            }
          });
          tx();
        }
        console.log(`[IndexBuild] 用户分块进度: ${Math.min(i + BATCH, chunks.length)}/${chunks.length}`);
      }
    }

    // 3. 加载全量向量到 Python 内存索引
    console.log('[IndexBuild] 加载全量向量到 Python 内存...');
    const allUserEmb = repo.getAllEmbeddings();
    const allLitEmb = repo.getLitEmbeddings();

    const userChunkIds: string[] = [];
    const userBlobs: string[] = [];
    if (allUserEmb.success && allUserEmb.data) {
      for (const r of allUserEmb.data) {
        userChunkIds.push(r.chunkId);
        userBlobs.push(r.embedding.toString('base64'));
      }
    }

    const litRowIds: number[] = [];
    const litBlobs: string[] = [];
    if (allLitEmb.success && allLitEmb.data) {
      for (const r of allLitEmb.data) {
        litRowIds.push(r.litRowid);
        litBlobs.push(r.embedding.toString('base64'));
      }
    }

    const indexSize = await buildIndex(userChunkIds, userBlobs, litRowIds, litBlobs);
    if (indexSize) {
      console.log(`[IndexBuild] 向量索引就绪: user=${indexSize.userCount}, lit=${indexSize.litCount}`);
    }
  } catch (err) {
    console.error('[IndexBuild] 建索引失败:', err);
  }
}
