import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { ChapterRepo } from '../../../src/main/db/repositories/chapter.repo';

describe('ChapterRepo.create（A1：同步写入 content 与 word_count）', () => {
  let db: Database.Database;
  let repo: ChapterRepo;

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
    `);
    repo = new ChapterRepo(db);
  });

  afterEach(() => {
    db.close();
  });

  it('create 带 content 时写入 word_count（与渲染端 handleSaveChapter 同口径）', () => {
    const html = '<p>第一章正文</p><p>第二段</p>';
    const res = repo.create({ projectId: 'p1', title: '第一章', content: html });
    expect(res.success).toBe(true);
    // 去掉 HTML 标签与空白后的字符数：第一章正文第二段 = 8 个字符
    expect(res.data?.wordCount).toBe(8);
    expect(res.data?.content).toBe(html);
    expect(res.data?.id).toBeTruthy();
  });

  it('create 空 content 时 word_count 为 0', () => {
    const res = repo.create({ projectId: 'p1', title: '空章' });
    expect(res.success).toBe(true);
    expect(res.data?.wordCount).toBe(0);
  });
});
