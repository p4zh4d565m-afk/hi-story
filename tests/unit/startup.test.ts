import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ db: null as any, ready: null as any, dbPath: '' as string }));
vi.mock('electron', () => ({
  app: {
    whenReady: () => ({ then: (callback: () => void) => { state.ready = callback; } }),
    on: vi.fn(), quit: vi.fn(),
  },
  BrowserWindow: class {
    loadFile = vi.fn().mockResolvedValue(undefined);
    on = vi.fn();
  },
  dialog: { showErrorBox: vi.fn() },
}));
vi.mock('../../src/main/db/connection', () => ({
  getDb: () => state.db, getDbPath: () => state.dbPath, attachLiteraryDb: vi.fn(), closeDb: vi.fn(),
}));
vi.mock('../../src/main/db/migrations', () => ({ runMigrations: vi.fn() }));
vi.mock('../../src/main/db/backup', () => ({
  backupOnStartup: vi.fn().mockResolvedValue(undefined),
  // isFirstRun 用真实实现（基于 fs.existsSync），使首启门禁真实生效
  isFirstRun: (p: string) => !fs.existsSync(p),
}));
vi.mock('../../src/main/ipc', () => ({ registerAllIpc: vi.fn() }));
vi.mock('../../src/main/menu', () => ({ createAppMenu: vi.fn() }));

const { backupOnStartup } = await import('../../src/main/db/backup');

it('启动仅清理旧的 768 维向量，重复启动保留 1024 维索引和正文', async () => {
  const db = new Database(':memory:');
  state.db = db;
  // getDbPath 返回一个真实存在的临时文件 → 非首启 → 会调用 backupOnStartup
  const tmpFile = path.join(os.tmpdir(), `hi-story-startup-${Date.now()}.db`);
  fs.writeFileSync(tmpFile, '');
  state.dbPath = tmpFile;
  db.exec(`
    CREATE TABLE reference_chunks (id INTEGER PRIMARY KEY, content TEXT, embedding BLOB);
    CREATE TABLE lit_embeddings (lit_rowid INTEGER PRIMARY KEY, embedding BLOB NOT NULL);
    INSERT INTO reference_chunks VALUES (1, '旧素材', zeroblob(3072)), (2, '新素材', zeroblob(4096));
    INSERT INTO lit_embeddings VALUES (1, zeroblob(3072)), (2, zeroblob(4096));
  `);
  const oldException = process.listeners('uncaughtException');
  const oldRejection = process.listeners('unhandledRejection');
  try {
    await import('../../src/main/index');
    state.ready();
    state.ready();
    expect(db.prepare('SELECT content, length(embedding) AS size FROM reference_chunks ORDER BY id').all())
      .toEqual([{ content: '旧素材', size: null }, { content: '新素材', size: 4096 }]);
    expect(db.prepare('SELECT lit_rowid, length(embedding) AS size FROM lit_embeddings').all())
      .toEqual([{ lit_rowid: 2, size: 4096 }]);
    // 非首启路径必须触发备份（本测试调了两次 state.ready，故至少调用过一次）
    expect(backupOnStartup).toHaveBeenCalled();
  } finally {
    for (const listener of process.listeners('uncaughtException')) {
      if (!oldException.includes(listener)) process.removeListener('uncaughtException', listener);
    }
    for (const listener of process.listeners('unhandledRejection')) {
      if (!oldRejection.includes(listener)) process.removeListener('unhandledRejection', listener);
    }
    db.close();
    try { fs.unlinkSync(tmpFile); } catch {}
  }
});
