import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContextBuilder } from '../../../src/main/ai/context-builder';
import { runMigrations } from '../../../src/main/db/migrations';
import { NarrativeHooksRepo } from '../../../src/main/db/repositories/narrative-hooks.repo';

describe('确认钩子和债务的有界 AI 上下文', () => {
  let db: Database.Database;
  let repo: NarrativeHooksRepo;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    const project = db.prepare(`
      INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)
    `);
    project.run('project-a', '项目 A', '2026-09-09T00:00:00.000Z', '2026-09-09T00:00:00.000Z');
    project.run('project-b', '项目 B', '2026-09-09T00:00:00.000Z', '2026-09-09T00:00:00.000Z');
    const chapter = db.prepare(`
      INSERT INTO chapters (id, project_id, title, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    chapter.run('chapter-1', 'project-a', '第一章', 1, '2026-09-09T00:00:00.000Z', '2026-09-09T00:00:00.000Z');
    chapter.run('chapter-3', 'project-a', '第三章', 3, '2026-09-09T00:00:00.000Z', '2026-09-09T00:00:00.000Z');
    db.prepare(`
      INSERT INTO creative_decisions (
        id, project_id, decision_type, title, rationale, payload_json,
        status, created_at, confirmed_at
      ) VALUES (?, 'project-a', 'narrative_hook', '确认来源', '作者已确认', '{}', ?, ?, ?)
    `).run(
      'decision-confirmed', 'confirmed', '2026-09-09T00:00:00.000Z',
      '2026-09-09T00:00:00.000Z',
    );
    db.prepare(`
      INSERT INTO creative_decisions (
        id, project_id, decision_type, title, rationale, payload_json, status, created_at
      ) VALUES (?, 'project-a', 'narrative_hook', '待确认', '不能进入上下文', ?, 'proposed', ?)
    `).run(
      'decision-proposed',
      JSON.stringify({ description: '不应进入上下文的待确认提议' }),
      '2026-09-09T00:01:00.000Z',
    );
    repo = new NarrativeHooksRepo(db);
  });

  afterEach(() => db.close());

  function insertHook(
    id: string,
    description: string,
    intensity: number,
    status: string,
    dueChapterId: string | null = null,
    projectId = 'project-a',
  ) {
    db.prepare(`
      INSERT INTO narrative_hooks (
        id, project_id, chapter_id, hook_type, description, intensity, status,
        due_chapter_id, source_decision_id, created_at, updated_at
      ) VALUES (?, ?, 'chapter-1', 'foreshadowing', ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, projectId, description, intensity, status, dueChapterId,
      projectId === 'project-a' ? 'decision-confirmed' : null,
      '2026-09-09T00:00:00.000Z', '2026-09-09T00:00:00.000Z',
    );
  }

  function insertDebt(id: string, description: string, status: string, promisedBy: number | null = null) {
    db.prepare(`
      INSERT INTO narrative_debts (
        id, project_id, chapter_id, description, debt_type, promised_by_chapter,
        status, source_decision_id, created_at, updated_at
      ) VALUES (?, 'project-a', 'chapter-1', ?, 'payoff', ?, ?, 'decision-confirmed', ?, ?)
    `).run(
      id, description, promisedBy, status,
      '2026-09-09T00:00:00.000Z', '2026-09-09T00:00:00.000Z',
    );
  }

  it('只读取当前项目目标表中的未解决钩子和未偿债务', () => {
    insertHook('hook-open', '高强度确认钩子', 5, 'open');
    insertHook('hook-partial', '部分解决仍需回收', 3, 'partially_resolved');
    insertHook('hook-resolved', '已经解决不应出现', 5, 'resolved');
    insertHook('hook-other', '其他项目不应出现', 5, 'open', null, 'project-b');
    insertDebt('debt-unpaid', '尚未兑现的承诺', 'unpaid');
    insertDebt('debt-overdue', '已经逾期的承诺', 'overdue', 2);
    insertDebt('debt-paid', '已经偿还不应出现', 'paid');

    const context = repo.getHooksAndDebtsContext('project-a', 800);

    expect(context).toContain('高强度确认钩子');
    expect(context).toContain('部分解决仍需回收');
    expect(context).toContain('尚未兑现的承诺');
    expect(context).toContain('已经逾期的承诺');
    expect(context).not.toContain('已经解决不应出现');
    expect(context).not.toContain('其他项目不应出现');
    expect(context).not.toContain('已经偿还不应出现');
    expect(context).not.toContain('不应进入上下文的待确认提议');
  });

  it('不超过独立 token 预算并按逾期债务、高强度钩子、临近到期顺序保留', () => {
    insertDebt('debt-overdue', `逾期债务优先标记${'必须尽快兑现。'.repeat(15)}`, 'overdue', 2);
    insertHook('hook-high', `高强度钩子优先标记${'危险迫近。'.repeat(15)}`, 5, 'open');
    insertHook('hook-due', `临近到期钩子标记${'线索正在逼近。'.repeat(15)}`, 2, 'open', 'chapter-3');
    for (let index = 0; index < 30; index += 1) {
      insertHook(
        `hook-low-${index}`,
        `普通低优先级-${index}-${'不会全部进入预算。'.repeat(30)}`,
        1,
        'open',
      );
    }

    const context = repo.getHooksAndDebtsContext('project-a', 800);

    expect(ContextBuilder.estimateTokens(context)).toBeLessThanOrEqual(800);
    expect(context).toContain('逾期债务优先标记');
    expect(context).toContain('高强度钩子优先标记');
    expect(context).toContain('临近到期钩子标记');
    expect(context.indexOf('逾期债务优先标记')).toBeLessThan(context.indexOf('高强度钩子优先标记'));
    expect(context.indexOf('高强度钩子优先标记')).toBeLessThan(context.indexOf('临近到期钩子标记'));
  });
});
