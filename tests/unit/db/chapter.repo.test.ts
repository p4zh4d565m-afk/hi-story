import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../../src/main/db/migrations';
import { ChapterRepo } from '../../../src/main/db/repositories/chapter.repo';

describe('ChapterRepo.create（A1：同步写入 content 与 word_count）', () => {
  let db: Database.Database;
  let repo: ChapterRepo;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO projects (id, name, type_tags, style, summary, created_at, updated_at) VALUES ('p1','t','[]','','',?,?)`,
    ).run(now, now);
    repo = new ChapterRepo(db);
  });

  afterEach(() => {
    db.close();
  });

  it('create 带 content 时写入 word_count（与渲染端 handleSaveChapter 同口径）', () => {
    const html = '<p>第一章正文</p><p>第二段</p>';
    const res = repo.create({ projectId: 'p1', title: '第一章', content: html });
    expect(res.success).toBe(true);
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
