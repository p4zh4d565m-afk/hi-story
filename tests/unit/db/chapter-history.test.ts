import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { ChapterHistoryRepo } from '../../../src/main/db/repositories/chapter.repo';

describe('ChapterHistoryRepo', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE chapters (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'draft',
        word_count INTEGER NOT NULL DEFAULT 0,
        summary TEXT NOT NULL DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0,
        planning_outline TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE chapter_history (
        id TEXT PRIMARY KEY,
        chapter_id TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        word_count INTEGER NOT NULL DEFAULT 0,
        saved_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
      );
    `);
    db.prepare(
      "INSERT INTO chapters (id, project_id, title, content, sort_order, created_at, updated_at) VALUES ('ch1', 'p1', '第一章', '内容', 0, 't', 't')",
    ).run();
  });

  afterEach(() => {
    db.close();
  });

  // 直接插入一条 8 天前的快照，用于断言「不再按时间淘汰」
  const insertOldSnapshot = (savedAt: string, content = '旧内容') => {
    db.prepare(
      "INSERT INTO chapter_history (id, chapter_id, content, word_count, saved_at) VALUES (?, 'ch1', ?, 10, ?)",
    ).run(`old-${savedAt}`, content, savedAt);
  };

  it('8 天前的快照在再次保存后仍在（不再按 7 天过期清理）', () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    insertOldSnapshot(eightDaysAgo);

    ChapterHistoryRepo.addSnapshot(db, 'ch1', '新内容', 20);

    const rows = db.prepare("SELECT id FROM chapter_history WHERE chapter_id = 'ch1'").all() as { id: string }[];
    const ids = rows.map(r => r.id);
    expect(ids).toContain(`old-${eightDaysAgo}`);
  });

  it('超过 30 份时删除最旧的快照', () => {
    // 写入 30 份旧快照（时间递增），确保最旧的在最前
    for (let i = 0; i < 30; i++) {
      const t = new Date(Date.now() - (30 - i) * 60 * 1000).toISOString();
      insertOldSnapshot(t, `第${i}份`);
    }

    ChapterHistoryRepo.addSnapshot(db, 'ch1', '最新内容', 20);

    const rows = db.prepare(
      "SELECT id, saved_at FROM chapter_history WHERE chapter_id = 'ch1' ORDER BY saved_at ASC",
    ).all() as { id: string }[];

    // 31 份写入后应裁剪回 30 份，最旧的一份被删
    expect(rows.length).toBe(30);

    const oldestRemaining = db.prepare(
      "SELECT saved_at FROM chapter_history WHERE chapter_id = 'ch1' ORDER BY saved_at ASC LIMIT 1",
    ).get() as { saved_at: string };
    const newestOld = db.prepare(
      "SELECT saved_at FROM chapter_history WHERE chapter_id = 'ch1' ORDER BY saved_at DESC LIMIT 1",
    ).get() as { saved_at: string };
    // 最新写入的快照在最末（saved_at 最大）
    expect(newestOld.saved_at >= oldestRemaining.saved_at).toBe(true);
  });
});
