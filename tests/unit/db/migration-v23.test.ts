import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations, getLatestMigrationVersion } from '../../../src/main/db/migrations';

describe('Migration v23（审稿版本账本）', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
  });

  afterEach(() => {
    db.close();
  });

  it('最新版本 ≥ 23，且 chapters 有 content_generation 列', () => {
    expect(getLatestMigrationVersion()).toBeGreaterThanOrEqual(23);
    const cols = db.prepare(`PRAGMA table_info(chapters)`).all() as Array<{ name: string }>;
    expect(new Set(cols.map((c) => c.name)).has('content_generation')).toBe(true);
  });

  it('创建 chapter_reviews 与 chapter_revision_proposals 及唯一索引', () => {
    const tables = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('chapter_reviews','chapter_revision_proposals')`,
    ).all() as Array<{ name: string }>;
    expect(tables.map((t) => t.name).sort()).toEqual(['chapter_reviews', 'chapter_revision_proposals']);

    const indexes = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='index' AND name IN ('idx_chapter_reviews_chapter_created','idx_chapter_revision_one_pending')`,
    ).all() as Array<{ name: string }>;
    expect(indexes.map((i) => i.name).sort()).toEqual([
      'idx_chapter_reviews_chapter_created',
      'idx_chapter_revision_one_pending',
    ]);
  });

  it('旧章节行迁移后 content_generation 为 1', () => {
    const db2 = new Database(':memory:');
    db2.pragma('foreign_keys = ON');
    runMigrations(db2, 22);

    const now = new Date().toISOString();
    db2.prepare(
      `INSERT INTO projects (id, name, type_tags, style, summary, created_at, updated_at) VALUES ('p1','t','[]','','',?,?)`,
    ).run(now, now);
    db2.prepare(
      `INSERT INTO chapters (id, project_id, title, content, status, word_count, sort_order, summary, planning_outline, created_at, updated_at)
       VALUES ('c1','p1','第一章','<p>正文</p>','draft',2,0,'','',?,?)`,
    ).run(now, now);

    // v22 尚无该列
    const v22cols = new Set(
      (db2.prepare(`PRAGMA table_info(chapters)`).all() as Array<{ name: string }>).map((c) => c.name),
    );
    expect(v22cols.has('content_generation')).toBe(false);

    runMigrations(db2, 23);

    const row = db2.prepare(`SELECT content_generation FROM chapters WHERE id = 'c1'`).get() as {
      content_generation: number;
    };
    expect(row.content_generation).toBe(1);
    expect(db2.pragma('foreign_key_check')).toEqual([]);
    db2.close();
  });

  it('迁移失败时版本不登记、表不残留', () => {
    const db2 = new Database(':memory:');
    db2.pragma('foreign_keys = ON');
    runMigrations(db2, 22);

    // 预建一个缺 chapter_id 列的 chapter_reviews，使 v23 的 CREATE TABLE IF NOT EXISTS 跳过、
    // 但其后的 CREATE INDEX ... ON chapter_reviews(chapter_id) 失败 → 触发原子回滚
    db2.exec(`
      CREATE TABLE chapter_reviews (id TEXT PRIMARY KEY);
    `);

    expect(() => runMigrations(db2)).toThrow();

    const v = db2.prepare('SELECT MAX(version) as v FROM _migrations').get() as { v: number };
    expect(v.v).toBe(22);
    // 回滚后 chapters 不应有 content_generation 列
    const cols = new Set(
      (db2.prepare(`PRAGMA table_info(chapters)`).all() as Array<{ name: string }>).map((c) => c.name),
    );
    expect(cols.has('content_generation')).toBe(false);
    // chapter_revision_proposals 不应残留
    const tables = db2.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name = 'chapter_revision_proposals'`,
    ).all();
    expect(tables).toEqual([]);
    db2.close();
  });
});
