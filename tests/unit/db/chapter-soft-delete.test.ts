import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../../src/main/db/migrations';
import { ChapterRepo, ChapterHistoryRepo } from '../../../src/main/db/repositories/chapter.repo';

function seedProject(db: Database.Database, id = 'p1') {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO projects (id, name, type_tags, style, summary, created_at, updated_at) VALUES (?,?, '[]','','',?,?)`,
  ).run(id, id, now, now);
}

describe('ChapterRepo.create（A1）', () => {
  let db: Database.Database;
  let repo: ChapterRepo;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    seedProject(db);
    repo = new ChapterRepo(db);
  });

  afterEach(() => db.close());

  it('create 带 content 时写入 word_count', () => {
    const html = '<p>第一章正文</p><p>第二段</p>';
    const res = repo.create({ projectId: 'p1', title: '第一章', content: html });
    expect(res.success).toBe(true);
    expect(res.data?.wordCount).toBe(8);
    expect(res.data?.content).toBe(html);
  });

  it('create 空 content 时 word_count 为 0', () => {
    const res = repo.create({ projectId: 'p1', title: '空章' });
    expect(res.success).toBe(true);
    expect(res.data?.wordCount).toBe(0);
  });
});

describe('ChapterRepo 软删 / 恢复', () => {
  let db: Database.Database;
  let repo: ChapterRepo;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    seedProject(db);
    repo = new ChapterRepo(db);
  });

  afterEach(() => db.close());

  function createThree() {
    const a = repo.create({ projectId: 'p1', title: 'c0', content: '<p>甲</p>' }).data!;
    const b = repo.create({ projectId: 'p1', title: 'c1', content: '<p>乙</p>' }).data!;
    const c = repo.create({ projectId: 'p1', title: 'c2', content: '<p>丙</p>' }).data!;
    return { a, b, c };
  }

  it('中间章软删后活跃序连续，历史与叙事锚保留', () => {
    const { a, b, c } = createThree();
    ChapterHistoryRepo.addSnapshot(db, b.id, b.content, b.wordCount);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO story_facts (id, project_id, chapter_id, fact_type, subject, predicate, object, description, status, created_at)
       VALUES ('f1','p1',?,'event','s','p','o','d','active',?)`,
    ).run(b.id, now);

    expect(repo.remove(b.id).success).toBe(true);
    expect(repo.findById(b.id).success).toBe(false);
    const listed = repo.findByProject('p1').data!;
    expect(listed.map((x) => x.id)).toEqual([a.id, c.id]);
    expect(listed.map((x) => x.sortOrder)).toEqual([0, 1]);

    const tomb = repo.findByIdIncludingDeleted(b.id).data!;
    expect(tomb.deletedAt).toBeTruthy();
    expect(tomb.deletedSortOrder).toBe(1);

    const hist = ChapterHistoryRepo.getSnapshots(db, b.id);
    expect(hist.data!.length).toBe(1);
    const fact = db.prepare(`SELECT chapter_id FROM story_facts WHERE id = 'f1'`).get() as {
      chapter_id: string;
    };
    expect(fact.chapter_id).toBe(b.id);
  });

  it('恢复插回 min(deletedSortOrder, activeCount)', () => {
    const { a, b, c } = createThree();
    repo.remove(b.id);
    const restored = repo.restore({ ...b, sortOrder: 1 });
    expect(restored.success).toBe(true);
    const listed = repo.findByProject('p1').data!;
    expect(listed.map((x) => x.id)).toEqual([a.id, b.id, c.id]);
    expect(listed.map((x) => x.sortOrder)).toEqual([0, 1, 2]);
  });

  it('连续删除与恢复位置冲突（同 deleted_sort_order）', () => {
    const { a, b, c } = createThree();
    repo.remove(b.id); // deleted_sort_order=1
    repo.remove(c.id); // 活跃只剩 a；c 的 deleted_sort_order 为删时位置 1
    const r1 = repo.restore(b);
    expect(r1.success).toBe(true);
    const r2 = repo.restore(c);
    expect(r2.success).toBe(true);
    const listed = repo.findByProject('p1').data!;
    expect(listed).toHaveLength(3);
    expect(listed.map((x) => x.sortOrder).sort()).toEqual([0, 1, 2]);
    expect(new Set(listed.map((x) => x.id))).toEqual(new Set([a.id, b.id, c.id]));
  });

  it('跨项目 reorder 拒绝；活跃覆盖校验', () => {
    seedProject(db, 'p2');
    const { a, b, c } = createThree();
    const other = repo.create({ projectId: 'p2', title: 'x' }).data!;
    expect(repo.reorder({ projectId: 'p1', chapterIds: [a.id, other.id] }).success).toBe(false);
    expect(repo.reorder({ projectId: 'p1', chapterIds: [b.id] }).success).toBe(false);
    expect(repo.reorder({ projectId: 'p1', chapterIds: [b.id, a.id, c.id] }).success).toBe(true);
    expect(repo.findByProject('p1').data!.map((x) => x.id)).toEqual([b.id, a.id, c.id]);
  });

  it('字数与计数只统计活跃章', () => {
    const { b } = createThree();
    const before = repo.totalWordsByProject('p1');
    const countBefore = repo.countByProject('p1');
    repo.remove(b.id);
    expect(repo.countByProject('p1')).toBe(countBefore - 1);
    expect(repo.totalWordsByProject('p1')).toBeLessThan(before);
  });
});
