import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations, getLatestMigrationVersion } from '../../../src/main/db/migrations';

describe('Migration v24（写章运行记录）', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
  });

  afterEach(() => {
    db.close();
  });

  it('最新版本 ≥ 24，创建 chapter_runs 表及索引', () => {
    expect(getLatestMigrationVersion()).toBeGreaterThanOrEqual(24);
    const tables = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name = 'chapter_runs'`,
    ).all();
    expect(tables).toHaveLength(1);
    const indexes = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='index' AND name = 'idx_chapter_runs_project_updated'`,
    ).all();
    expect(indexes).toHaveLength(1);
  });

  it('v23 库无损升级到 v24', () => {
    const db2 = new Database(':memory:');
    db2.pragma('foreign_keys = ON');
    runMigrations(db2, 23);

    const now = new Date().toISOString();
    db2.prepare(
      `INSERT INTO projects (id, name, type_tags, style, summary, created_at, updated_at) VALUES ('p1','t','[]','','',?,?)`,
    ).run(now, now);
    db2.prepare(
      `INSERT INTO chapters (id, project_id, title, content, status, word_count, sort_order, summary, planning_outline, content_generation, created_at, updated_at)
       VALUES ('c1','p1','章','<p>正文</p>','draft',2,0,'','',1,?,?)`,
    ).run(now, now);

    const v23tables = db2.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name = 'chapter_runs'`,
    ).all();
    expect(v23tables).toEqual([]);

    runMigrations(db2, 24);

    const tables = db2.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name = 'chapter_runs'`,
    ).all();
    expect(tables).toHaveLength(1);
    expect(db2.pragma('foreign_key_check')).toEqual([]);
    db2.close();
  });

  it('迁移失败时版本不登记、表不残留', () => {
    const db2 = new Database(':memory:');
    db2.pragma('foreign_keys = ON');
    runMigrations(db2, 23);

    // 预建缺 project_id 列的 chapter_runs，使 v24 的 CREATE TABLE IF NOT EXISTS 跳过、
    // 但其后的 CREATE INDEX ... ON chapter_runs(project_id) 失败 → 原子回滚
    db2.exec(`CREATE TABLE chapter_runs (id TEXT PRIMARY KEY);`);

    expect(() => runMigrations(db2)).toThrow();

    const v = db2.prepare('SELECT MAX(version) as v FROM _migrations').get() as { v: number };
    expect(v.v).toBe(23);
    db2.close();
  });
});
