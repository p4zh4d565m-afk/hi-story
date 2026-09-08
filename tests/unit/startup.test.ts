import Database from 'better-sqlite3';
import { expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ db: null as any, ready: null as any }));
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
  getDb: () => state.db, attachLiteraryDb: vi.fn(), closeDb: vi.fn(),
}));
vi.mock('../../src/main/db/migrations', () => ({ runMigrations: vi.fn() }));
vi.mock('../../src/main/ipc', () => ({ registerAllIpc: vi.fn() }));
vi.mock('../../src/main/menu', () => ({ createAppMenu: vi.fn() }));

it('启动仅清理旧的 768 维向量，重复启动保留 1024 维索引和正文', async () => {
  const db = new Database(':memory:');
  state.db = db;
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
  } finally {
    for (const listener of process.listeners('uncaughtException')) {
      if (!oldException.includes(listener)) process.removeListener('uncaughtException', listener);
    }
    for (const listener of process.listeners('unhandledRejection')) {
      if (!oldRejection.includes(listener)) process.removeListener('unhandledRejection', listener);
    }
    db.close();
  }
});
