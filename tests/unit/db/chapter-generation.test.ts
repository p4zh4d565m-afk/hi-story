import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../../src/main/db/migrations';
import { ChapterRepo } from '../../../src/main/db/repositories/chapter.repo';

describe('ChapterRepo 世代递增（v23）', () => {
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

  function createChapter(content: string) {
    const res = repo.create({ projectId: 'p1', title: '章', content });
    expect(res.success).toBe(true);
    return res.data!.id;
  }

  function gen(id: string): number {
    const row = db.prepare(`SELECT content_generation as g FROM chapters WHERE id = ?`).get(id) as { g: number };
    return row.g;
  }

  it('create 初始世代为 1', () => {
    const id = createChapter('<p>正文</p>');
    expect(gen(id)).toBe(1);
  });

  it('改一个汉字递增世代', () => {
    const id = createChapter('<p>甲</p>');
    const res = repo.update({ id, content: '<p>乙</p>' });
    expect(res.success).toBe(true);
    expect(gen(id)).toBe(2);
    expect(res.data?.contentGeneration).toBe(2);
  });

  it('等价 HTML（仅段落/空白差异）不递增世代', () => {
    const id = createChapter('<p>甲</p><p>乙</p>');
    const res = repo.update({ id, content: '<p>甲</p>\n<p>乙</p>' });
    expect(res.success).toBe(true);
    expect(gen(id)).toBe(1);
  });

  it('只改标题不递增世代', () => {
    const id = createChapter('<p>正文</p>');
    const res = repo.update({ id, title: '新标题' });
    expect(res.success).toBe(true);
    expect(gen(id)).toBe(1);
  });

  it('正文真变时同章 proposed 修订作废', () => {
    const id = createChapter('<p>甲</p>');
    const now = new Date().toISOString();
    // 先造一条 proposed 修订（需要一张有效 review 行作为外键）
    db.prepare(
      `INSERT INTO chapter_reviews (id, project_id, chapter_id, source_generation, prompt_version, execution_status, coverage, gate_status, delivery_status, created_at)
       VALUES ('r1','p1','${id}',1,'review-v2', 'completed', 1, 'pass', 'pass', '${now}')`,
    ).run();
    db.prepare(
      `INSERT INTO chapter_revision_proposals (id, project_id, chapter_id, review_id, source_generation, proposed_content, status, created_at, updated_at)
       VALUES ('pr1','p1','${id}','r1',1,'<p>乙</p>','proposed','${now}','${now}')`,
    ).run();

    repo.update({ id, content: '<p>乙</p>' });

    const pr = db.prepare(`SELECT status FROM chapter_revision_proposals WHERE id = 'pr1'`).get() as { status: string };
    expect(pr.status).toBe('stale');
  });

  it('等价 HTML 保存不作废 proposed', () => {
    const id = createChapter('<p>甲</p>');
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO chapter_reviews (id, project_id, chapter_id, source_generation, prompt_version, execution_status, coverage, gate_status, delivery_status, created_at)
       VALUES ('r1','p1','${id}',1,'review-v2', 'completed', 1, 'pass', 'pass', '${now}')`,
    ).run();
    db.prepare(
      `INSERT INTO chapter_revision_proposals (id, project_id, chapter_id, review_id, source_generation, proposed_content, status, created_at, updated_at)
       VALUES ('pr1','p1','${id}','r1',1,'<p>乙</p>','proposed','${now}','${now}')`,
    ).run();

    // 等价 HTML（加个空段落）→ normalize 相同 → 不递增、不作废
    repo.update({ id, content: '<p>甲</p><p></p>' });

    const pr = db.prepare(`SELECT status FROM chapter_revision_proposals WHERE id = 'pr1'`).get() as { status: string };
    expect(pr.status).toBe('proposed');
    expect(gen(id)).toBe(1);
  });
});
