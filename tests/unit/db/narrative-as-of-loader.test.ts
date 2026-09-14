import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../../src/main/db/migrations';
import { ChapterRepo } from '../../../src/main/db/repositories/chapter.repo';
import { StoryFactsRepo } from '../../../src/main/db/repositories/story-facts.repo';
import { loadNarrativeAsOfFromDb } from '../../../src/main/ai/narrative-as-of-loader';

function seedProject(db: Database.Database) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO projects (id, name, type_tags, style, summary, created_at, updated_at) VALUES ('p1','t','[]','','',?,?)`,
  ).run(now, now);
}

describe('loadNarrativeAsOfFromDb', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    seedProject(db);
  });

  afterEach(() => db.close());

  it('写章 before_target 能还原已被 supersede 的旧状态内容', () => {
    const chapters = new ChapterRepo(db);
    const c1 = chapters.create({ projectId: 'p1', title: '一', content: '<p>1</p>' }).data!;
    const c2 = chapters.create({ projectId: 'p1', title: '二', content: '<p>2</p>' }).data!;
    const now = new Date().toISOString();
    const stateKey = 'location|林岚|位于';
    db.prepare(`
      INSERT INTO story_facts (
        id, project_id, chapter_id, fact_type, subject, predicate, object, description,
        status, source_kind, state_key, state_key_version, archived, created_at
      ) VALUES
        ('f-old','p1',?,'location','林岚','位于','废站','林岚还在废站','superseded','chapter_extraction',?,1,0,?),
        ('f-new','p1',?,'location','林岚','位于','客栈','林岚在客栈','active','chapter_extraction',?,1,0,?)
    `).run(c1.id, stateKey, now, c2.id, stateKey, now);

    const ctx = loadNarrativeAsOfFromDb(db, {
      projectId: 'p1',
      taskType: 'write',
      targetChapterId: c2.id,
      hasActiveChapter: true,
    });
    expect(ctx.mode).toBe('before_target');
    expect(ctx.textBlock).toContain('林岚还在废站');
    expect(ctx.textBlock).not.toContain('林岚在客栈');
  });

  it('对话截面注入事实描述而非 UUID', () => {
    const chapters = new ChapterRepo(db);
    const facts = new StoryFactsRepo(db);
    const ch = chapters.create({ projectId: 'p1', title: '一', content: '<p>1</p>' }).data!;
    facts.batchUpsert({
      projectId: 'p1',
      chapterId: ch.id,
      facts: [{
        projectId: 'p1', chapterId: ch.id, factType: 'event',
        subject: '林岚', predicate: '发现', object: '铜钥', description: '林岚在废站捡到铜钥',
      }],
    });
    const ctx = loadNarrativeAsOfFromDb(db, {
      projectId: 'p1',
      taskType: 'chat',
      targetChapterId: ch.id,
      hasActiveChapter: true,
    });
    expect(ctx.textBlock).toContain('林岚在废站捡到铜钥');
  });

  it('审稿 before_target 与策划 planning_only 截面可用', () => {
    const chapters = new ChapterRepo(db);
    const facts = new StoryFactsRepo(db);
    const c1 = chapters.create({ projectId: 'p1', title: '一', content: '<p>1</p>' }).data!;
    const c2 = chapters.create({ projectId: 'p1', title: '二', content: '<p>2</p>' }).data!;
    facts.batchUpsert({
      projectId: 'p1',
      chapterId: c1.id,
      facts: [{
        projectId: 'p1', chapterId: c1.id, factType: 'event',
        subject: '林岚', predicate: '发现', object: '铜钥', description: '林岚在废站捡到铜钥',
      }],
    });
    const review = loadNarrativeAsOfFromDb(db, {
      projectId: 'p1',
      taskType: 'review',
      targetChapterId: c2.id,
      hasActiveChapter: true,
    });
    expect(review.mode).toBe('before_target');
    expect(review.textBlock).toContain('林岚在废站捡到铜钥');

    const planning = loadNarrativeAsOfFromDb(db, {
      projectId: 'p1',
      taskType: 'planning',
      hasActiveChapter: false,
    });
    expect(planning.mode).toBe('planning_only');
    expect(planning.textBlock).toContain('不注入运行时事实');
  });
});
