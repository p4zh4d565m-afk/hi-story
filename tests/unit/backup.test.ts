import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { expect, it, vi, beforeEach, afterEach } from 'vitest';

// backup.ts 依赖 electron 的 app.getPath 与 connection.getDb，这里用真实临时目录 + 真实 sqlite 验证。
const state = vi.hoisted(() => ({ db: null as any, userDataDir: '' }));

vi.mock('electron', () => ({
  app: { getPath: () => state.userDataDir },
}));
vi.mock('../../src/main/db/connection', () => ({
  getDb: () => state.db,
}));

const { backupOnStartup, isFirstRun } = await import('../../src/main/db/backup');

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hi-story-backup-test-'));
  state.userDataDir = path.join(tmpRoot, 'userData');
  fs.mkdirSync(state.userDataDir, { recursive: true });
});

afterEach(() => {
  if (state.db) { try { state.db.close(); } catch {} state.db = null; }
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
});

function makeDbWithRow(): Database.Database {
  const dbPath = path.join(state.userDataDir, 'hi-story.db');
  const db = new Database(dbPath);
  db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO t VALUES (1, '备份我');");
  state.db = db;
  return db;
}

it('真备份：生成一份可读且数据一致的 .db 文件', async () => {
  makeDbWithRow();

  await backupOnStartup();

  const backupsDir = path.join(state.userDataDir, 'backups');
  const files = fs.readdirSync(backupsDir).filter((f) => f.endsWith('.db'));
  expect(files).toHaveLength(1);

  const backup = new Database(path.join(backupsDir, files[0]), { readonly: true });
  const row = backup.prepare('SELECT name FROM t WHERE id = 1').get() as { name: string };
  expect(row.name).toBe('备份我');
  backup.close();
});

it('保留最近 5 份：超出后删最旧的', async () => {
  makeDbWithRow();
  const backupsDir = path.join(state.userDataDir, 'backups');
  fs.mkdirSync(backupsDir, { recursive: true });
  // 预置 6 份旧备份，文件名时间戳递增
  for (let i = 1; i <= 6; i++) {
    fs.writeFileSync(path.join(backupsDir, `hi-story-backup-2026-09-1${i}-00-00-00.db`), 'x');
  }

  await backupOnStartup();

  const files = fs.readdirSync(backupsDir).filter((f) => f.startsWith('hi-story-backup-') && f.endsWith('.db')).sort();
  expect(files).toHaveLength(5);
  // 最旧的（编号 1）应被删掉
  expect(files[0]).not.toContain('2026-09-11');
});

it('失败不阻断：getDb 异常时 backupOnStartup 静默 resolve', async () => {
  // state.db 为 null，getDb() 返回 null → .backup 会抛错；函数必须吞掉、不向外抛
  state.db = null;

  await expect(backupOnStartup()).resolves.toBeUndefined();
});

describe('isFirstRun — 首启门禁纯函数', () => {
  it('库文件不存在 → 首启', () => {
    const p = path.join(tmpRoot, '不存在.db');
    expect(isFirstRun(p)).toBe(true);
  });

  it('库文件已存在 → 非首启', () => {
    const p = path.join(tmpRoot, '存在.db');
    fs.writeFileSync(p, '');
    expect(isFirstRun(p)).toBe(false);
  });
});
