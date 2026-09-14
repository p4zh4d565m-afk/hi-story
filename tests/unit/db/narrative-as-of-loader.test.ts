import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../../src/main/db/migrations';
import { ChapterRepo } from '../../../src/main/db/repositories/chapter.repo';
import { StoryFactsRepo } from '../../../src/main/db/repositories/story-facts.repo';
import { NarrativeTransitionRepo, makeSnapshot } from '../../../src/main/db/repositories/narrative-transition.repo';
import { CreativeDecisionRepo } from '../../../src/main/db/repositories/creative-decision.repo';
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

  it('P1-1 墓碑来源章的 hook 即使后续有 resolved 转换也不进入 as-of', () => {
    const chapters = new ChapterRepo(db);
    const tomb = chapters.create({ projectId: 'p1', title: '墓碑章', content: '<p>旧</p>' }).data!;
    const later = chapters.create({ projectId: 'p1', title: '后章', content: '<p>后</p>' }).data!;
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO narrative_hooks (
        id, project_id, chapter_id, hook_type, description, intensity, status,
        resolved_in_chapter_id, created_at, updated_at, subject
      ) VALUES ('h-tomb','p1',?,'mystery','应被排除',4,'resolved',?,?,?,'车票')
    `).run(tomb.id, later.id, now, now);
    const transitions = new NarrativeTransitionRepo(db);
    db.transaction(() => {
      const created = transitions.append({
        projectId: 'p1',
        targetTable: 'narrative_hooks',
        targetId: 'h-tomb',
        kind: 'created',
        atChapterId: tomb.id,
        afterSnapshot: makeSnapshot({ status: 'open', chapterId: tomb.id, description: '应被排除' }),
      });
      if (!created.success) throw new Error(created.error);
      const resolved = transitions.append({
        projectId: 'p1',
        targetTable: 'narrative_hooks',
        targetId: 'h-tomb',
        kind: 'resolved',
        atChapterId: later.id,
        afterSnapshot: makeSnapshot({
          status: 'resolved',
          chapterId: tomb.id,
          description: '应被排除',
          resolvedInChapterId: later.id,
        }),
      });
      if (!resolved.success) throw new Error(resolved.error);
    })();
    expect(chapters.remove(tomb.id).success).toBe(true);

    const ctx = loadNarrativeAsOfFromDb(db, {
      projectId: 'p1',
      taskType: 'chat',
      targetChapterId: later.id,
      hasActiveChapter: true,
    });
    expect(ctx.mode).toBe('through_target');
    expect(ctx.hooks.map((h) => h.id)).not.toContain('h-tomb');
    expect(ctx.textBlock).not.toContain('应被排除');
  });

  it('P1-2 快照漏字段时 as-of 不得泄漏当前投影的未来描述', () => {
    const chapters = new ChapterRepo(db);
    const c1 = chapters.create({ projectId: 'p1', title: '五十', content: '<p>1</p>' }).data!;
    const c2 = chapters.create({ projectId: 'p1', title: '八十', content: '<p>2</p>' }).data!;
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO narrative_hooks (
        id, project_id, chapter_id, hook_type, description, intensity, status,
        created_at, updated_at, subject
      ) VALUES ('h1','p1',?,'mystery','未来描述',4,'resolved',?,?,'车票')
    `).run(c1.id, now, now);
    const transitions = new NarrativeTransitionRepo(db);
    db.transaction(() => {
      const created = transitions.append({
        projectId: 'p1',
        targetTable: 'narrative_hooks',
        targetId: 'h1',
        kind: 'created',
        atChapterId: c1.id,
        afterSnapshot: makeSnapshot({ status: 'open', chapterId: c1.id }),
      });
      if (!created.success) throw new Error(created.error);
      const resolved = transitions.append({
        projectId: 'p1',
        targetTable: 'narrative_hooks',
        targetId: 'h1',
        kind: 'resolved',
        atChapterId: c2.id,
        afterSnapshot: makeSnapshot({ status: 'resolved', description: '未来描述', chapterId: c1.id }),
      });
      if (!resolved.success) throw new Error(resolved.error);
    })();

    const ctx = loadNarrativeAsOfFromDb(db, {
      projectId: 'p1',
      taskType: 'chat',
      targetChapterId: c1.id,
      hasActiveChapter: true,
    });
    expect(ctx.mode).toBe('through_target');
    expect(ctx.hooks).toHaveLength(1);
    expect(ctx.hooks[0]!.status).toBe('open');
    expect(ctx.hooks[0]!.description).toBeUndefined();
    expect(ctx.textBlock).not.toContain('未来描述');
  });

  it('P1-3 project_latest 无转换时仍显示旧 hook 投影', () => {
    const chapters = new ChapterRepo(db);
    const ch = chapters.create({ projectId: 'p1', title: '一', content: '<p>1</p>' }).data!;
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO narrative_hooks (
        id, project_id, chapter_id, hook_type, description, intensity, status,
        created_at, updated_at, subject
      ) VALUES ('h-legacy','p1',?,'mystery','旧投影',4,'open',?,?,'车票')
    `).run(ch.id, now, now);

    const ctx = loadNarrativeAsOfFromDb(db, {
      projectId: 'p1',
      taskType: 'chat',
      targetChapterId: null,
      hasActiveChapter: false,
    });
    expect(ctx.mode).toBe('project_latest');
    expect(ctx.hooks.map((h) => h.id)).toEqual(['h-legacy']);
    expect(ctx.textBlock).toContain('旧投影');
  });

  it('P1-4 写章/对话对缺失或墓碑目标章显式抛错', () => {
    const chapters = new ChapterRepo(db);
    const live = chapters.create({ projectId: 'p1', title: '活章', content: '<p>1</p>' }).data!;
    const tomb = chapters.create({ projectId: 'p1', title: '墓碑', content: '<p>2</p>' }).data!;
    expect(chapters.remove(tomb.id).success).toBe(true);

    expect(() => loadNarrativeAsOfFromDb(db, {
      projectId: 'p1',
      taskType: 'write',
      targetChapterId: 'missing',
      hasActiveChapter: true,
    })).toThrow();
    expect(() => loadNarrativeAsOfFromDb(db, {
      projectId: 'p1',
      taskType: 'chat',
      targetChapterId: tomb.id,
      hasActiveChapter: true,
    })).toThrow();
    expect(() => loadNarrativeAsOfFromDb(db, {
      projectId: 'p1',
      taskType: 'write',
      targetChapterId: live.id,
      hasActiveChapter: true,
    })).not.toThrow();
  });

  it('as-of 越过期限章后把 unpaid 债务派生为 overdue', () => {
    const chapters = new ChapterRepo(db);
    const c1 = chapters.create({ projectId: 'p1', title: '一', content: '<p>1</p>' }).data!;
    const c2 = chapters.create({ projectId: 'p1', title: '二', content: '<p>2</p>' }).data!;
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO narrative_debts (
        id, project_id, chapter_id, description, debt_type, status,
        created_at, updated_at, subject
      ) VALUES ('d-due','p1',?,'揭晓站长身份','reveal','unpaid',?,?,'站长')
    `).run(c1.id, now, now);
    const transitions = new NarrativeTransitionRepo(db);
    db.transaction(() => {
      const created = transitions.append({
        projectId: 'p1',
        targetTable: 'narrative_debts',
        targetId: 'd-due',
        kind: 'created',
        atChapterId: c1.id,
        afterSnapshot: makeSnapshot({
          status: 'unpaid',
          chapterId: c1.id,
          description: '揭晓站长身份',
          dueChapterId: c1.id,
        }),
      });
      if (!created.success) throw new Error(created.error);
    })();

    const ctx = loadNarrativeAsOfFromDb(db, {
      projectId: 'p1',
      taskType: 'chat',
      targetChapterId: c2.id,
      hasActiveChapter: true,
    });
    expect(ctx.debts).toHaveLength(1);
    expect(ctx.debts[0]!.status).toBe('overdue');
    expect(ctx.textBlock).toContain('overdue');
    expect(ctx.textBlock).toContain('揭晓站长身份');
  });

  it('回归 confirmMany 确认状态事实写 state_key，as-of 按状态身份折叠而非当成无锚旧数据', () => {
    const chapters = new ChapterRepo(db);
    const c1 = chapters.create({ projectId: 'p1', title: '一', content: '<p>1</p>' }).data!;
    const c2 = chapters.create({ projectId: 'p1', title: '二', content: '<p>2</p>' }).data!;
    const decisions = new CreativeDecisionRepo(db);

    // 作者在 c1 确认「林岚位于废站」（新增路径 applyNewDecision）
    const p1 = decisions.createChapterExtractionProposals({
      projectId: 'p1',
      drafts: [{
        type: 'story_fact',
        title: '林岚位置',
        rationale: '测试',
        payload: {
          factType: 'location',
          subject: '林岚',
          predicate: '位于',
          object: '废站',
          description: '林岚还在废站',
          chapterId: c1.id,
        },
      }],
    });
    expect(p1.success).toBe(true);
    expect(decisions.confirmMany({ projectId: 'p1', decisionIds: [p1.data![0].id] }).success).toBe(true);

    // 作者修订为「林岚位于客栈」（修订路径 applyRevision，同 state_key）
    const rev = decisions.createRevision({
      projectId: 'p1',
      parentDecisionId: p1.data![0].id,
      draft: {
        type: 'story_fact',
        title: '林岚位置修正',
        rationale: '测试',
        payload: {
          factType: 'location',
          subject: '林岚',
          predicate: '位于',
          object: '客栈',
          description: '林岚在客栈',
          chapterId: c2.id,
        },
      },
    });
    expect(rev.success).toBe(true);
    expect(decisions.confirmMany({ projectId: 'p1', decisionIds: [rev.data!.id] }).success).toBe(true);

    // 确认后 DB 里 location 事实应带 state_key（非 NULL）
    const factRows = db.prepare(
      `SELECT state_key, status FROM story_facts WHERE fact_type = 'location' ORDER BY created_at ASC`,
    ).all() as Array<{ state_key: string | null; status: string }>;
    expect(factRows.length).toBe(2);
    expect(factRows.every((r) => r.state_key != null)).toBe(true);

    // 写章 c2（before_target，不含 c2 章）：c2 之前的正确状态是「废站」。
    // 若 state_key 缺失，「废站」会被当成无锚旧数据在历史截面排除（这正是要堵的 bug）。
    const writeCtx = loadNarrativeAsOfFromDb(db, {
      projectId: 'p1',
      taskType: 'write',
      targetChapterId: c2.id,
      hasActiveChapter: true,
    });
    expect(writeCtx.textBlock).toContain('废站');
    expect(writeCtx.textBlock).not.toContain('客栈');

    // 对话 c2（through_target，含 c2 章）：修订生效，按 state_key 折叠为「客栈」
    const chatCtx = loadNarrativeAsOfFromDb(db, {
      projectId: 'p1',
      taskType: 'chat',
      targetChapterId: c2.id,
      hasActiveChapter: true,
    });
    expect(chatCtx.textBlock).toContain('客栈');
    expect(chatCtx.textBlock).not.toContain('废站');
    expect(chatCtx.facts.filter((f) => f.factType === 'location')).toHaveLength(1);
  });
});
