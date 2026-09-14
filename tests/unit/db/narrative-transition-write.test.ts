import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../../src/main/db/migrations';
import { ChapterRepo } from '../../../src/main/db/repositories/chapter.repo';
import { StoryFactsRepo } from '../../../src/main/db/repositories/story-facts.repo';
import { NarrativeTransitionRepo } from '../../../src/main/db/repositories/narrative-transition.repo';
import { CreativeDecisionRepo } from '../../../src/main/db/repositories/creative-decision.repo';
import { NarrativeHooksRepo } from '../../../src/main/db/repositories/narrative-hooks.repo';
import { buildNarrativeAsOfContext } from '../../../src/main/ai/narrative-as-of-context';
import type { ChapterPosition } from '../../../src/main/ai/narrative-time-order';
import type { FactInput, Transition } from '../../../src/main/ai/narrative-state-reducer';

function seedProject(db: Database.Database) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO projects (id, name, type_tags, style, summary, created_at, updated_at) VALUES ('p1','t','[]','','',?,?)`,
  ).run(now, now);
}

describe('叙事转换写路径', () => {
  let db: Database.Database;
  let chapters: ChapterRepo;
  let facts: StoryFactsRepo;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    seedProject(db);
    chapters = new ChapterRepo(db);
    facts = new StoryFactsRepo(db);
  });

  afterEach(() => db.close());

  it('batchUpsert 不硬删；旧自动事实 superseded + 转换；作者确认行保留', () => {
    const ch = chapters.create({ projectId: 'p1', title: '一', content: '<p>正文</p>' }).data!;
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO creative_decisions (
        id, project_id, decision_type, title, rationale, payload_json, status, created_at
      ) VALUES ('d1','p1','story_fact','t','r','{}','confirmed',?)
    `).run(now);
    db.prepare(`
      INSERT INTO story_facts (id, project_id, chapter_id, fact_type, subject, predicate, object, description, status, source_kind, source_decision_id, archived, created_at)
      VALUES ('author1','p1',?,'event','s','p','o','作者','active','author_decision','d1',0,?)
    `).run(ch.id, now);
    db.prepare(`
      INSERT INTO story_facts (id, project_id, chapter_id, fact_type, subject, predicate, object, description, status, source_kind, archived, created_at)
      VALUES ('auto1','p1',?,'event','s','p','o','自动','active','chapter_extraction',0,?)
    `).run(ch.id, now);

    const res = facts.batchUpsert({
      projectId: 'p1',
      chapterId: ch.id,
      facts: [{
        projectId: 'p1',
        chapterId: ch.id,
        factType: 'event',
        subject: '新',
        predicate: 'p',
        object: 'o',
        description: '新抽取',
      }],
    });
    expect(res.success).toBe(true);

    const author = db.prepare(`SELECT status FROM story_facts WHERE id = 'author1'`).get() as { status: string };
    expect(author.status).toBe('active');
    const auto = db.prepare(`SELECT status FROM story_facts WHERE id = 'auto1'`).get() as { status: string };
    expect(auto.status).toBe('superseded');

    const rows = db.prepare(`SELECT target_id, kind FROM narrative_transitions WHERE project_id = 'p1'`).all() as Array<{
      target_id: string; kind: string;
    }>;
    expect(rows.some((t) => t.target_id === 'auto1' && t.kind === 'superseded')).toBe(true);
    expect(rows.some((t) => t.kind === 'created')).toBe(true);
    const snaps = new NarrativeTransitionRepo(db).listByProject('p1');
    expect(snaps.every((t) => t.afterSnapshot.schemaVersion === 1)).toBe(true);
  });

  it('batchUpsertKnowledge 不硬删并写转换', () => {
    const ch = chapters.create({ projectId: 'p1', title: '一', content: '<p>x</p>' }).data!;
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO character_knowledge (
        id, project_id, character_name, fact_description, source,
        learned_at_chapter_id, source_kind, status, created_at
      ) VALUES ('k1','p1','甲','旧知','章',?,'chapter_extraction','active',?)
    `).run(ch.id, now);

    const res = facts.batchUpsertKnowledge({
      projectId: 'p1',
      chapterId: ch.id,
      knowledge: [{
        projectId: 'p1',
        characterName: '甲',
        factDescription: '新知',
        source: '章',
        learnedAtChapterId: ch.id,
      }],
    });
    expect(res.success).toBe(true);
    const old = db.prepare(`SELECT status FROM character_knowledge WHERE id = 'k1'`).get() as { status: string };
    expect(old.status).toBe('superseded');
    const rows = db.prepare(
      `SELECT kind FROM narrative_transitions WHERE project_id = 'p1' AND target_table = 'character_knowledge'`,
    ).all() as Array<{ kind: string }>;
    expect(rows.some((t) => t.kind === 'superseded')).toBe(true);
    expect(rows.some((t) => t.kind === 'created')).toBe(true);
  });

  it('confirmMany 同事务追加转换；resolve/payDebt 写 resolved/paid', () => {
    const ch = chapters.create({ projectId: 'p1', title: '一', content: '<p>x</p>' }).data!;
    const decisions = new CreativeDecisionRepo(db);
    const proposed = decisions.createChapterExtractionProposals({
      projectId: 'p1',
      drafts: [{
        type: 'narrative_hook',
        title: '钩',
        rationale: '测试',
        payload: {
          subject: '主体',
          hookType: 'mystery',
          description: '开钩',
          intensity: 3,
          chapterId: ch.id,
        },
      }],
    });
    expect(proposed.success).toBe(true);
    const confirmed = decisions.confirmMany({
      projectId: 'p1',
      decisionIds: [proposed.data![0].id],
    });
    expect(confirmed.success).toBe(true);
    const createdRows = db.prepare(
      `SELECT kind FROM narrative_transitions WHERE project_id = 'p1' AND target_table = 'narrative_hooks'`,
    ).all() as Array<{ kind: string }>;
    expect(createdRows.some((t) => t.kind === 'created')).toBe(true);

    const hookId = confirmed.data!.effects.find((e) => e.targetTable === 'narrative_hooks')!.targetId;
    const hooks = new NarrativeHooksRepo(db);
    const resolved = hooks.resolve(hookId, ch.id);
    expect(resolved.success).toBe(true);
    expect(resolved.data!.status).toBe('resolved');
    expect(
      (db.prepare(`SELECT kind FROM narrative_transitions WHERE kind = 'resolved'`).all() as unknown[]).length,
    ).toBeGreaterThan(0);

    const debt = hooks.createDebt({
      projectId: 'p1',
      chapterId: ch.id,
      description: '债',
      debtType: 'reveal',
      subject: '主体',
    }).data!;
    const paid = hooks.payDebt(debt.id, ch.id);
    expect(paid.success).toBe(true);
    expect(
      (db.prepare(`SELECT kind FROM narrative_transitions WHERE kind = 'paid'`).all() as unknown[]).length,
    ).toBeGreaterThan(0);
  });

  it('as-of 读路径：写章 before_target 不含目标章事件；墓碑源排除', () => {
    const c1 = chapters.create({ projectId: 'p1', title: '一', content: '<p>1</p>' }).data!;
    const c2 = chapters.create({ projectId: 'p1', title: '二', content: '<p>2</p>' }).data!;
    facts.batchUpsert({
      projectId: 'p1',
      chapterId: c1.id,
      facts: [{
        projectId: 'p1', chapterId: c1.id, factType: 'event',
        subject: 'a', predicate: 'p', object: 'o', description: 'e1',
      }],
    });
    facts.batchUpsert({
      projectId: 'p1',
      chapterId: c2.id,
      facts: [{
        projectId: 'p1', chapterId: c2.id, factType: 'event',
        subject: 'b', predicate: 'p', object: 'o', description: 'e2',
      }],
    });

    chapters.remove(c1.id);

    const allRows = db.prepare(
      `SELECT id, project_id, sort_order, deleted_sort_order, deleted_at FROM chapters WHERE project_id = 'p1'`,
    ).all() as Array<{
      id: string; project_id: string; sort_order: number | null;
      deleted_sort_order: number | null; deleted_at: string | null;
    }>;
    const positions: ChapterPosition[] = allRows.map((r) => ({
      id: r.id,
      projectId: r.project_id,
      sortOrder: r.deleted_at ? null : r.sort_order,
      deletedSortOrder: r.deleted_sort_order,
    }));
    const transitions = new NarrativeTransitionRepo(db).listByProject('p1') as Transition[];
    const activeFacts = facts.findActiveByProject('p1').data!;
    const factInputs: FactInput[] = activeFacts
      .filter((f) => f.chapterId)
      .map((f) => ({
        id: f.id,
        factType: f.factType,
        chapterId: f.chapterId!,
        status: f.status,
      }));

    // 目标为活跃章 c2：before_target 不应含 c2，且墓碑章 c1 上的事件应被排除
    const ctx = buildNarrativeAsOfContext({
      taskType: 'write',
      hasActiveChapter: true,
      targetChapterId: c2.id,
      chapters: positions,
      aliases: [],
      transitions,
      facts: factInputs,
      hooks: [],
      debts: [],
      knowledge: [],
    });
    expect(ctx.mode).toBe('before_target');
    expect(ctx.events.every((e) => e.chapterId !== c2.id)).toBe(true);
    expect(ctx.events.every((e) => e.chapterId !== c1.id)).toBe(true);
    expect(ctx.textBlock).toContain('before_target');
  });

  it('拒绝跨项目锚点，损坏快照读取显式失败', () => {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO projects (id, name, type_tags, style, summary, created_at, updated_at) VALUES ('p2','x','[]','','',?,?)`,
    ).run(now, now);
    const ch1 = chapters.create({ projectId: 'p1', title: '一', content: '<p>x</p>' }).data!;
    const ch2 = chapters.create({ projectId: 'p2', title: '二', content: '<p>x</p>' }).data!;
    facts.batchUpsert({
      projectId: 'p1',
      chapterId: ch1.id,
      facts: [{
        projectId: 'p1', chapterId: ch1.id, factType: 'event',
        subject: 'a', predicate: 'p', object: 'o', description: 'e1',
      }],
    });
    const factId = db.prepare(`SELECT id FROM story_facts WHERE project_id = 'p1'`).get() as { id: string };
    const repo = new NarrativeTransitionRepo(db);
    const cross = repo.append({
      projectId: 'p1',
      targetTable: 'story_facts',
      targetId: factId.id,
      kind: 'created',
      atChapterId: ch2.id,
      afterSnapshot: { schemaVersion: 1, data: { id: factId.id } },
    });
    expect(cross.success).toBe(false);
    expect(cross.error).toContain('跨项目');

    db.prepare(`
      INSERT INTO narrative_transitions (
        id, project_id, target_table, target_id, kind,
        at_chapter_id, at_chapter_ordinal, transition_seq, after_snapshot, created_at
      ) VALUES ('bad','p1','story_facts',?,'created',?,0,0,'not-json',?)
    `).run(factId.id, ch1.id, now);
    expect(() => repo.listByProject('p1')).toThrow('转换快照不是合法 JSON');
  });
});
