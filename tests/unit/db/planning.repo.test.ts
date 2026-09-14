import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../../src/main/db/migrations';
import { PlanningRepo } from '../../../src/main/db/repositories/planning.repo';
import type { MasterOutline, VolumeOutline } from '../../../src/renderer/types';

describe('PlanningRepo（v20 唯一约束 + 坏 JSON 可见 + save 合并）', () => {
  let db: Database.Database;
  let repo: PlanningRepo;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    db.prepare("INSERT INTO projects (id, name, created_at, updated_at) VALUES ('p1', '测试', 't', 't')").run();
    repo = new PlanningRepo(db);
  });

  afterEach(() => {
    db.close();
  });

  const master = (): MasterOutline => ({
    premise: '前提', ending: '结局', protagonistArc: '弧', centralConflict: '冲突',
    structureModel: '结构', phases: [], subplots: [], storyPromises: [],
  });

  it('同项目第二行 INSERT 被唯一索引拒绝', () => {
    db.prepare(`
      INSERT INTO planning_ideas (id, project_id, idea, generated_options, master_outline, outline_status, volume_outlines, volume_status, chapter_outlines, chapter_outline_status, created_at, updated_at)
      VALUES ('a','p1','','[]','','empty','[]','empty','[]','empty','t','t')
    `).run();
    expect(() => db.prepare(`
      INSERT INTO planning_ideas (id, project_id, idea, generated_options, master_outline, outline_status, volume_outlines, volume_status, chapter_outlines, chapter_outline_status, created_at, updated_at)
      VALUES ('b','p1','','[]','','empty','[]','empty','[]','empty','t','t')
    `).run()).toThrow();
  });

  it('坏 JSON 返回 success:false，不冒充空纲', () => {
    db.prepare(`
      INSERT INTO planning_ideas (id, project_id, idea, generated_options, master_outline, outline_status, volume_outlines, volume_status, chapter_outlines, chapter_outline_status, created_at, updated_at)
      VALUES ('a','p1','','[]','{坏 JSON','empty','[]','empty','[]','empty','t','t')
    `).run();
    const res = repo.findByProject('p1');
    expect(res.success).toBe(false);
    expect(res.error).toContain('损坏');
  });

  it('save 省略 volumeOutlines 时旧值仍在（未传 ≠ 清空）', () => {
    const vol: VolumeOutline = {
      title: '卷一', chapterRange: '第 1-10 章', volumeGoal: '目标', openingState: '起态',
      mainProgression: '', characterProgression: '', keyEvents: [], climax: '', endingState: '',
      promisesOpened: [], promisesPaid: [],
    };
    repo.save({ projectId: 'p1', idea: '想法', volumeOutlines: [vol], volumeStatus: 'generated' });
    // 第二次 save 不传 volumeOutlines / volumeStatus，旧值应保留
    repo.save({ projectId: 'p1', idea: '想法改' });
    const res = repo.findByProject('p1');
    expect(res.success).toBe(true);
    expect(res.data?.volumeOutlines).toHaveLength(1);
    expect(res.data?.volumeOutlines[0].title).toBe('卷一');
  });

  it('save 显式传 [] 清空分卷、null 清空总纲', () => {
    repo.save({ projectId: 'p1', idea: '想法', masterOutline: master(), outlineStatus: 'generated', volumeOutlines: [{ title: '卷一', chapterRange: '第 1-10 章', volumeGoal: '', openingState: '', mainProgression: '', characterProgression: '', keyEvents: [], climax: '', endingState: '', promisesOpened: [], promisesPaid: [] }], volumeStatus: 'generated' });
    repo.save({ projectId: 'p1', idea: '想法', masterOutline: null, volumeOutlines: [] });
    const res = repo.findByProject('p1');
    expect(res.success).toBe(true);
    expect(res.data?.masterOutline).toBeNull();
    expect(res.data?.volumeOutlines).toEqual([]);
  });

  it('迁移 v20 对重复行去重并保留最新一行', () => {
    // 直接造两条，跑迁移验证去重逻辑（用新内存库避免 beforeEach 已跑迁移）
    db.close();
    const db2 = new Database(':memory:');
    db2.pragma('foreign_keys = ON');
    // 只跑到 v11 需要的表结构，简化：直接手动建 planning_ideas 并标记迁移到 19，再跑 v20
    db2.exec(`
      CREATE TABLE _migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', created_at TEXT, updated_at TEXT);
      CREATE TABLE planning_ideas (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, idea TEXT NOT NULL DEFAULT '',
        requirements TEXT NOT NULL DEFAULT '', generated_options TEXT NOT NULL DEFAULT '[]',
        selected_option INTEGER, status TEXT NOT NULL DEFAULT 'draft',
        master_outline TEXT NOT NULL DEFAULT '', outline_status TEXT NOT NULL DEFAULT 'empty',
        volume_outlines TEXT NOT NULL DEFAULT '[]', volume_status TEXT NOT NULL DEFAULT 'empty',
        chapter_outlines TEXT NOT NULL DEFAULT '[]', chapter_outline_status TEXT NOT NULL DEFAULT 'empty',
        created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_planning_ideas_project ON planning_ideas(project_id);
    `);
    const mark = db2.prepare('INSERT INTO _migrations (version) VALUES (?)');
    for (let v = 1; v <= 19; v++) mark.run(v);
    db2.prepare("INSERT INTO projects (id, name, created_at, updated_at) VALUES ('p1','测试','t','t')").run();
    db2.prepare("INSERT INTO planning_ideas (id, project_id, idea, updated_at) VALUES ('old','p1','旧','2026-01-01T00:00:00Z')").run();
    db2.prepare("INSERT INTO planning_ideas (id, project_id, idea, updated_at) VALUES ('new','p1','新','2026-09-01T00:00:00Z')").run();

    runMigrations(db2);

    const rows = db2.prepare('SELECT id, idea FROM planning_ideas WHERE project_id = ?').all('p1') as { id: string; idea: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('new');
    expect(rows[0].idea).toBe('新');
    db2.close();
  });

  it('save 为缺 id 的章纲补稳定身份并保留已有 id', () => {
    const chapter = {
      volumeIndex: 0, chapterNumber: 1, title: '入局', pov: '主角', chapterGoal: 'g',
      openingSituation: 'o', centralConflict: 'c', keyBeats: ['a', 'b', 'd'],
      reveal: 'r', characterChange: 'ch', emotionalBeat: 'e', payoff: 'p', endingHook: 'h',
    };
    const saved = repo.save({
      projectId: 'p1',
      idea: '创意',
      chapterOutlines: [
        chapter,
        { ...chapter, chapterNumber: 2, id: 'keep-me' },
      ],
    });
    expect(saved.success).toBe(true);
    const outlines = saved.data!.chapterOutlines;
    expect(outlines[0]!.id).toBeTruthy();
    expect(outlines[0]!.id).not.toBe('keep-me');
    expect(outlines[1]!.id).toBe('keep-me');
  });
});
