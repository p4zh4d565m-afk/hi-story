import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../../src/main/db/migrations';
import { CreativeDecisionRepo } from '../../../src/main/db/repositories/creative-decision.repo';
import { StoryFactsRepo } from '../../../src/main/db/repositories/story-facts.repo';
import type { CreativeDecisionDraft } from '../../../src/renderer/types';

function count(db: Database.Database, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
}

const fourDrafts: CreativeDecisionDraft[] = [
  {
    type: 'story_fact',
    title: '主角得到钥匙',
    rationale: '后续开门需要保持一致',
    payload: {
      factType: 'possession', subject: '林岚', predicate: '持有', object: '铜钥匙',
      description: '林岚持有旧车站铜钥匙', chapterId: 'chapter-a',
    },
  },
  {
    type: 'character_knowledge',
    title: '林岚知道暗门位置',
    rationale: '避免后续重复发现',
    payload: {
      characterId: 'character-a', characterName: '林岚',
      factDescription: '旧车站候车室后有暗门', source: '亲眼发现',
      learnedAtChapterId: 'chapter-a',
    },
  },
  {
    type: 'narrative_hook',
    title: '带血车票',
    rationale: '后续需要回收失踪者线索',
    payload: {
      hookType: 'foreshadowing', description: '旧车站留下带血车票', intensity: 4,
      chapterId: 'chapter-a', dueChapterId: 'chapter-b',
    },
  },
  {
    type: 'narrative_debt',
    title: '揭晓站长身份',
    rationale: '已经向读者作出承诺',
    payload: {
      debtType: 'reveal', description: '揭晓旧站长的真实身份',
      chapterId: 'chapter-a', promisedByChapter: 8,
    },
  },
];

describe('CreativeDecisionRepo', () => {
  let db: Database.Database;
  let repo: CreativeDecisionRepo;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    const insertProject = db.prepare(`
      INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)
    `);
    insertProject.run('project-a', '项目 A', '2026-09-09T00:00:00.000Z', '2026-09-09T00:00:00.000Z');
    insertProject.run('project-b', '项目 B', '2026-09-09T00:00:00.000Z', '2026-09-09T00:00:00.000Z');

    const insertChapter = db.prepare(`
      INSERT INTO chapters (id, project_id, title, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    insertChapter.run('chapter-a', 'project-a', '第一章', 1, '2026-09-09T00:00:00.000Z', '2026-09-09T00:00:00.000Z');
    insertChapter.run('chapter-b', 'project-a', '第二章', 2, '2026-09-09T00:00:00.000Z', '2026-09-09T00:00:00.000Z');
    insertChapter.run('chapter-other', 'project-b', '别的项目', 1, '2026-09-09T00:00:00.000Z', '2026-09-09T00:00:00.000Z');
    db.prepare(`
      INSERT INTO characters (id, project_id, name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('character-a', 'project-a', '林岚', '2026-09-09T00:00:00.000Z', '2026-09-09T00:00:00.000Z');

    const insertThread = db.prepare(`
      INSERT INTO conversation_threads (
        id, project_id, title, category, created_at, updated_at
      ) VALUES (?, ?, ?, 'general', ?, ?)
    `);
    insertThread.run('thread-a', 'project-a', 'A 对话', '2026-09-09T00:00:00.000Z', '2026-09-09T00:00:00.000Z');
    insertThread.run('thread-b', 'project-b', 'B 对话', '2026-09-09T00:00:00.000Z', '2026-09-09T00:00:00.000Z');
    const insertMessage = db.prepare(`
      INSERT INTO conversation_messages (
        id, thread_id, role, content, timestamp, updated_at, sort_order, context_type
      ) VALUES (?, ?, ?, ?, ?, ?, 0, 'chat')
    `);
    insertMessage.run('assistant-a', 'thread-a', 'assistant', 'A 项目回复', '2026-09-09T00:01:00.000Z', '2026-09-09T00:01:00.000Z');
    insertMessage.run('user-a', 'thread-a', 'user', 'A 项目问题', '2026-09-09T00:00:30.000Z', '2026-09-09T00:00:30.000Z');
    insertMessage.run('assistant-b', 'thread-b', 'assistant', 'B 项目回复', '2026-09-09T00:01:00.000Z', '2026-09-09T00:01:00.000Z');

    repo = new CreativeDecisionRepo(db);
  });

  afterEach(() => db.close());

  function createProposals(drafts: CreativeDecisionDraft[] = fourDrafts) {
    return repo.createProposals({
      projectId: 'project-a',
      sourceThreadId: 'thread-a',
      sourceMessageId: 'assistant-a',
      drafts,
    });
  }

  it('一次事务确认四类提议并写入对应目标表和效果表', () => {
    const proposals = createProposals();
    expect(proposals.success).toBe(true);

    const result = repo.confirmMany({
      projectId: 'project-a',
      decisionIds: proposals.data!.map(item => item.id),
    });

    expect(result).toMatchObject({ success: true });
    expect(result.data?.effects).toHaveLength(4);
    expect(count(db, 'creative_decision_effects')).toBe(4);
    expect(count(db, 'story_facts')).toBe(1);
    expect(count(db, 'character_knowledge')).toBe(1);
    expect(count(db, 'narrative_hooks')).toBe(1);
    expect(count(db, 'narrative_debts')).toBe(1);
    expect(count(db, 'foreshadowings')).toBe(0);
    expect(db.prepare('SELECT DISTINCT source_kind FROM story_facts').all())
      .toEqual([{ source_kind: 'author_decision' }]);
  });

  it('只接受同项目会话中的 assistant 消息作为提议来源', () => {
    const wrongProject = repo.createProposals({
      projectId: 'project-a', sourceThreadId: 'thread-b', sourceMessageId: 'assistant-b',
      drafts: [fourDrafts[0]],
    });
    const userSource = repo.createProposals({
      projectId: 'project-a', sourceThreadId: 'thread-a', sourceMessageId: 'user-a',
      drafts: [fourDrafts[0]],
    });

    expect(wrongProject).toMatchObject({ success: false });
    expect(userSource).toMatchObject({ success: false });
    expect(count(db, 'creative_decisions')).toBe(0);
  });

  it('拒绝提议不会写入任何目标表且不能再次确认', () => {
    const decision = createProposals([fourDrafts[0]]).data![0];

    expect(repo.reject('project-a', decision.id).data?.status).toBe('rejected');
    expect(repo.confirmMany({ projectId: 'project-a', decisionIds: [decision.id] }).success).toBe(false);
    expect(count(db, 'story_facts')).toBe(0);
    expect(count(db, 'creative_decision_effects')).toBe(0);
  });

  it('批量确认中任一载荷失效时全部回滚', () => {
    const proposals = createProposals([fourDrafts[0], fourDrafts[2]]).data!;
    db.prepare('UPDATE creative_decisions SET payload_json = ? WHERE id = ?')
      .run(JSON.stringify({ hookType: 'foreshadowing', description: '非法强度', intensity: 9 }), proposals[1].id);

    const result = repo.confirmMany({
      projectId: 'project-a', decisionIds: proposals.map(item => item.id),
    });

    expect(result.success).toBe(false);
    expect(count(db, 'story_facts')).toBe(0);
    expect(count(db, 'narrative_hooks')).toBe(0);
    expect(count(db, 'creative_decision_effects')).toBe(0);
    expect(db.prepare('SELECT DISTINCT status FROM creative_decisions').all())
      .toEqual([{ status: 'proposed' }]);
  });

  it('重复确认返回原效果且不重复投影', () => {
    const decision = createProposals([fourDrafts[0]]).data![0];
    const first = repo.confirmMany({ projectId: 'project-a', decisionIds: [decision.id] });
    const second = repo.confirmMany({ projectId: 'project-a', decisionIds: [decision.id] });

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(second.data?.effects.map(item => item.id)).toEqual(first.data?.effects.map(item => item.id));
    expect(count(db, 'story_facts')).toBe(1);
    expect(count(db, 'creative_decision_effects')).toBe(1);
  });

  it('只允许编辑同项目的 proposed 提议并重新校验完整载荷', () => {
    const decision = createProposals([fourDrafts[2]]).data![0];
    const updated = repo.updateProposal({
      projectId: 'project-a', decisionId: decision.id,
      draft: {
        ...fourDrafts[2],
        title: '更新后的钩子',
        payload: { ...fourDrafts[2].payload, intensity: 5 },
      } as CreativeDecisionDraft,
    });
    const invalid = repo.updateProposal({
      projectId: 'project-a', decisionId: decision.id,
      draft: {
        ...fourDrafts[2],
        payload: { ...fourDrafts[2].payload, intensity: 0 },
      } as CreativeDecisionDraft,
    });

    expect(updated.data).toMatchObject({ title: '更新后的钩子', payload: { intensity: 5 } });
    expect(invalid.success).toBe(false);
    repo.confirmMany({ projectId: 'project-a', decisionIds: [decision.id] });
    expect(repo.updateProposal({
      projectId: 'project-a', decisionId: decision.id, draft: fourDrafts[2],
    }).success).toBe(false);
  });

  it('事实修订写入新事实并取代旧事实', () => {
    const parent = createProposals([fourDrafts[0]]).data![0];
    repo.confirmMany({ projectId: 'project-a', decisionIds: [parent.id] });
    const oldFact = db.prepare('SELECT id FROM story_facts').get() as { id: string };
    const revision = repo.createRevision({
      projectId: 'project-a', parentDecisionId: parent.id,
      draft: {
        type: 'story_fact', title: '钥匙已经交出', rationale: '事件推进改变持有关系',
        payload: {
          factType: 'possession', subject: '林岚', predicate: '不再持有', object: '铜钥匙',
          description: '林岚把铜钥匙交给站长', chapterId: 'chapter-b',
        },
      },
    }).data!;

    expect(repo.confirmMany({ projectId: 'project-a', decisionIds: [revision.id] }).success).toBe(true);
    expect(db.prepare('SELECT status FROM story_facts WHERE id = ?').get(oldFact.id))
      .toMatchObject({ status: 'superseded' });
    expect(db.prepare("SELECT COUNT(*) AS count FROM story_facts WHERE status = 'active'").get())
      .toEqual({ count: 1 });
    expect(repo.findByProject('project-a').data?.find(item => item.id === parent.id)?.status)
      .toBe('superseded');
  });

  it('人物知识修订后旧知识不再进入活跃查询', () => {
    const parent = createProposals([fourDrafts[1]]).data![0];
    repo.confirmMany({ projectId: 'project-a', decisionIds: [parent.id] });
    const revision = repo.createRevision({
      projectId: 'project-a', parentDecisionId: parent.id,
      draft: {
        type: 'character_knowledge', title: '林岚得知站长身份', rationale: '新证据纠正旧认知',
        payload: {
          characterId: 'character-a', characterName: '林岚',
          factDescription: '旧站长是失踪案知情人', source: '第二章录音',
          learnedAtChapterId: 'chapter-b',
        },
      },
    }).data!;

    repo.confirmMany({ projectId: 'project-a', decisionIds: [revision.id] });

    const active = new StoryFactsRepo(db).findAllKnowledgeByProject('project-a').data!;
    expect(active.map(item => item.factDescription)).toEqual(['旧站长是失踪案知情人']);
    expect(count(db, 'character_knowledge')).toBe(2);
  });

  it('钩子和债务修订更新原目标并保存前后快照', () => {
    const parents = createProposals([fourDrafts[2], fourDrafts[3]]).data!;
    repo.confirmMany({ projectId: 'project-a', decisionIds: parents.map(item => item.id) });
    const hookRevision = repo.createRevision({
      projectId: 'project-a', parentDecisionId: parents[0].id,
      draft: {
        type: 'narrative_hook', title: '车票指向站长', rationale: '线索已推进',
        payload: {
          hookType: 'mystery', description: '带血车票背面写着旧站长姓名', intensity: 5,
          chapterId: 'chapter-b', dueChapterId: 'chapter-b',
        },
      },
    }).data!;
    const debtRevision = repo.createRevision({
      projectId: 'project-a', parentDecisionId: parents[1].id,
      draft: {
        type: 'narrative_debt', title: '提前揭晓站长身份', rationale: '节奏加快',
        payload: {
          debtType: 'mystery_answer', description: '下一章揭晓旧站长身份',
          chapterId: 'chapter-b', promisedByChapter: 3,
        },
      },
    }).data!;

    const result = repo.confirmMany({
      projectId: 'project-a', decisionIds: [hookRevision.id, debtRevision.id],
    });

    expect(result.success).toBe(true);
    expect(count(db, 'narrative_hooks')).toBe(1);
    expect(count(db, 'narrative_debts')).toBe(1);
    expect(result.data?.effects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        operation: 'update',
        before: expect.objectContaining({ description: '旧车站留下带血车票' }),
        after: expect.objectContaining({ description: '带血车票背面写着旧站长姓名' }),
      }),
      expect.objectContaining({
        operation: 'update',
        before: expect.objectContaining({ description: '揭晓旧站长的真实身份' }),
        after: expect.objectContaining({ description: '下一章揭晓旧站长身份' }),
      }),
    ]));
  });

  it('同一父决策只能存在一个待确认修订', () => {
    const parent = createProposals([fourDrafts[2]]).data![0];
    repo.confirmMany({ projectId: 'project-a', decisionIds: [parent.id] });
    const revisionDraft: CreativeDecisionDraft = {
      type: 'narrative_hook', title: '车票线索推进', rationale: '第一版修订',
      payload: {
        hookType: 'mystery', description: '车票背面出现站长姓名', intensity: 5,
        chapterId: 'chapter-b', dueChapterId: 'chapter-b',
      },
    };

    const first = repo.createRevision({
      projectId: 'project-a', parentDecisionId: parent.id, draft: revisionDraft,
    });
    const second = repo.createRevision({
      projectId: 'project-a', parentDecisionId: parent.id,
      draft: { ...revisionDraft, title: '另一个修订版本' },
    });

    expect(first.success).toBe(true);
    expect(second).toMatchObject({ success: false, error: '该决策已有待确认修订' });
    expect(db.prepare(`
      SELECT COUNT(*) AS count FROM creative_decisions
      WHERE parent_decision_id = ? AND status = 'proposed'
    `).get(parent.id)).toEqual({ count: 1 });
  });

  it('批量确认兄弟修订时整体拒绝且不覆盖目标', () => {
    const parent = createProposals([fourDrafts[2]]).data![0];
    repo.confirmMany({ projectId: 'project-a', decisionIds: [parent.id] });
    const revision = repo.createRevision({
      projectId: 'project-a', parentDecisionId: parent.id,
      draft: {
        type: 'narrative_hook', title: '第一版修订', rationale: '推进线索',
        payload: {
          hookType: 'mystery', description: '车票背面出现站长姓名', intensity: 5,
          chapterId: 'chapter-b', dueChapterId: 'chapter-b',
        },
      },
    }).data!;
    db.prepare(`
      INSERT INTO creative_decisions (
        id, project_id, source_thread_id, source_message_id, parent_decision_id,
        decision_type, title, rationale, payload_json, status, created_at
      )
      SELECT ?, project_id, source_thread_id, source_message_id, parent_decision_id,
        decision_type, ?, rationale, payload_json, status, created_at
      FROM creative_decisions WHERE id = ?
    `).run('sibling-revision', '第二版修订', revision.id);

    const result = repo.confirmMany({
      projectId: 'project-a', decisionIds: [revision.id, 'sibling-revision'],
    });

    expect(result).toMatchObject({ success: false, error: '同一决策不能同时确认多个修订' });
    expect(db.prepare('SELECT description FROM narrative_hooks').get())
      .toEqual({ description: '旧车站留下带血车票' });
    expect(db.prepare(`
      SELECT DISTINCT status FROM creative_decisions WHERE parent_decision_id = ?
    `).all(parent.id)).toEqual([{ status: 'proposed' }]);
  });
});
