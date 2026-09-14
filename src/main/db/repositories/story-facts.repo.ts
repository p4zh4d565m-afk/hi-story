import Database from 'better-sqlite3';
import type { IpcResult, StoryFact, CharacterKnowledge } from '../../../renderer/types';
import { deriveStateKey, type Transition } from '../../ai/narrative-state-reducer';
import { NarrativeTransitionRepo, makeSnapshot } from './narrative-transition.repo';

// ============================================================
// 叙事事实层 — 数据访问层
// 解决长篇 AI "忘事/乱编"问题：
// - story_facts：每章自动抽取的原子事实（状态机管理）
// - character_knowledge：角色信息边界（支撑审稿信息越界检测）
// ============================================================

// ── StoryFact 输入/输出类型 ──

export interface CreateStoryFactInput {
  projectId: string;
  chapterId?: string | null;
  factType: string;
  subject: string;
  predicate: string;
  object: string;
  description: string;
}

export interface BatchUpsertFactsInput {
  projectId: string;
  chapterId: string;
  /** 新事实列表（全量替换该章节已有事实） */
  facts: CreateStoryFactInput[];
}

export interface SupersedeFactInput {
  id: string;
  supersededById: string;
}

// ── CharacterKnowledge 输入类型 ──

export interface CreateKnowledgeInput {
  projectId: string;
  characterId?: string | null;
  characterName: string;
  factDescription: string;
  source: string;
  learnedAtChapterId?: string | null;
}

export interface BatchUpsertKnowledgeInput {
  projectId: string;
  chapterId: string;
  knowledge: CreateKnowledgeInput[];
}

export class StoryFactsRepo {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  // ============================================================
  // Story Facts
  // ============================================================

  /** 创建一条事实 */
  create(input: CreateStoryFactInput): IpcResult<StoryFact> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO story_facts (id, project_id, chapter_id, fact_type, subject, predicate, object, description, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
    `).run(id, input.projectId, input.chapterId || null, input.factType, input.subject, input.predicate, input.object, input.description, now);
    return this.findById(id);
  }

  /** 批量覆盖某章的事实：退休旧自动投影 + 转换行 + 插入新投影（同事务） */
  batchUpsert(input: BatchUpsertFactsInput): IpcResult<{ inserted: number }> {
    try {
      const tx = this.db.transaction(() => {
        const transitions = new NarrativeTransitionRepo(this.db);
        const now = new Date().toISOString();
        const pending: Transition[] = [];

        const oldRows = this.db.prepare(`
          SELECT * FROM story_facts
          WHERE chapter_id = ? AND source_decision_id IS NULL AND status = 'active' AND archived = 0
        `).all(input.chapterId) as Record<string, unknown>[];

        for (const old of oldRows) {
          const oldId = old.id as string;
          this.db.prepare(
            `UPDATE story_facts SET status = 'superseded' WHERE id = ?`,
          ).run(oldId);
          const snap = makeSnapshot(this.rowToFact({ ...old, status: 'superseded' }));
          const appended = transitions.append({
            projectId: input.projectId,
            targetTable: 'story_facts',
            targetId: oldId,
            kind: 'superseded',
            atChapterId: input.chapterId,
            afterSnapshot: snap,
            pendingInTx: pending,
          });
          if (!appended.success || !appended.data) throw new Error(appended.error || '转换写入失败');
          pending.push(appended.data);
        }

        if (input.facts.length === 0) return { inserted: 0 };

        const stmt = this.db.prepare(`
          INSERT INTO story_facts (
            id, project_id, chapter_id, fact_type, subject, predicate, object,
            description, status, source_kind, state_key, state_key_version, archived, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', 'chapter_extraction', ?, 1, 0, ?)
        `);

        for (const f of input.facts) {
          if (f.factType === 'hook') continue; // 停止新写 hook 事实
          const id = crypto.randomUUID();
          let stateKey: string | null = null;
          if (
            f.factType === 'location' ||
            f.factType === 'possession' ||
            f.factType === 'emotional_state' ||
            f.factType === 'relationship'
          ) {
            stateKey = deriveStateKey({
              factType: f.factType as 'location' | 'possession' | 'emotional_state' | 'relationship',
              subject: f.subject,
              predicate: f.predicate,
              object: f.object,
              ...(f.factType === 'relationship' ? { directed: true } : {}),
            } as Parameters<typeof deriveStateKey>[0]).key;
          }
          stmt.run(
            id,
            input.projectId,
            input.chapterId,
            f.factType,
            f.subject,
            f.predicate,
            f.object,
            f.description,
            stateKey,
            now,
          );
          const fact = this.findById(id).data!;
          const appended = transitions.append({
            projectId: input.projectId,
            targetTable: 'story_facts',
            targetId: id,
            kind: 'created',
            atChapterId: input.chapterId,
            afterSnapshot: makeSnapshot(fact),
            pendingInTx: pending,
          });
          if (!appended.success || !appended.data) throw new Error(appended.error || '转换写入失败');
          pending.push(appended.data);
        }
        return { inserted: input.facts.filter((f) => f.factType !== 'hook').length };
      });

      return { success: true, data: tx() };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  /** 根据 ID 查找 */
  findById(id: string): IpcResult<StoryFact> {
    const row = this.db.prepare('SELECT * FROM story_facts WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return { success: false, error: '事实不存在' };
    return { success: true, data: this.rowToFact(row) };
  }

  /** 获取项目所有活跃事实 */
  findActiveByProject(projectId: string): IpcResult<StoryFact[]> {
    const rows = this.db.prepare(`
      SELECT * FROM story_facts WHERE project_id = ? AND status = 'active' AND archived = 0 ORDER BY created_at DESC
    `).all(projectId) as Record<string, unknown>[];
    return { success: true, data: rows.map(r => this.rowToFact(r)) };
  }

  /** 获取项目最近 N 条活跃事实（用于注入上下文） */
  findRecentActive(projectId: string, limit: number = 30): IpcResult<StoryFact[]> {
    const rows = this.db.prepare(`
      SELECT * FROM story_facts WHERE project_id = ? AND status = 'active' AND archived = 0 ORDER BY created_at DESC LIMIT ?
    `).all(projectId, limit) as Record<string, unknown>[];
    return { success: true, data: rows.map(r => this.rowToFact(r)) };
  }

  /** 按类型获取活跃事实 */
  findByType(projectId: string, factType: string): IpcResult<StoryFact[]> {
    const rows = this.db.prepare(`
      SELECT * FROM story_facts WHERE project_id = ? AND fact_type = ? AND status = 'active' AND archived = 0 ORDER BY created_at DESC
    `).all(projectId, factType) as Record<string, unknown>[];
    return { success: true, data: rows.map(r => this.rowToFact(r)) };
  }

  /** 将一条事实标记为被取代（旧事实被新事实覆盖） */
  supersede(id: string, supersededById: string): IpcResult<void> {
    const existing = this.findById(id);
    if (!existing.success) return { success: false, error: '事实不存在' };
    this.db.prepare('UPDATE story_facts SET status = ? , superseded_by = ? WHERE id = ?')
      .run('superseded', supersededById, id);
    return { success: true };
  }

  /** 将一条事实标记为已解决（如伏笔回收） */
  resolve(id: string): IpcResult<void> {
    this.db.prepare('UPDATE story_facts SET status = ? WHERE id = ?').run('resolved', id);
    return { success: true };
  }

  /** 删除某章的所有事实 */
  removeByChapter(chapterId: string): IpcResult<void> {
    this.db.prepare('DELETE FROM story_facts WHERE chapter_id = ?').run(chapterId);
    return { success: true };
  }

  /** 获取项目所有活跃事实，按类型分组（用于审稿全量注入） */
  getGroupedFacts(projectId: string): IpcResult<{
    locations: StoryFact[];
    possessions: StoryFact[];
    relationships: StoryFact[];
    knowledge: StoryFact[];
    events: StoryFact[];
    emotionalStates: StoryFact[];
    hooks: StoryFact[];
  }> {
    const all = this.db.prepare(`
      SELECT * FROM story_facts WHERE project_id = ? AND status = 'active' AND archived = 0 ORDER BY created_at DESC
    `).all(projectId) as Record<string, unknown>[];

    const facts = all.map(r => this.rowToFact(r));
    return {
      success: true,
      data: {
        locations: facts.filter(f => f.factType === 'location'),
        possessions: facts.filter(f => f.factType === 'possession'),
        relationships: facts.filter(f => f.factType === 'relationship'),
        knowledge: facts.filter(f => f.factType === 'knowledge'),
        events: facts.filter(f => f.factType === 'event'),
        emotionalStates: facts.filter(f => f.factType === 'emotional_state'),
        hooks: facts.filter(f => f.factType === 'hook'),
      },
    };
  }

  // ============================================================
  // Character Knowledge
  // ============================================================

  /** 创建一条角色知识 */
  createKnowledge(input: CreateKnowledgeInput): IpcResult<CharacterKnowledge> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO character_knowledge (id, project_id, character_id, character_name, fact_description, source, learned_at_chapter_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.projectId, input.characterId || null, input.characterName, input.factDescription, input.source, input.learnedAtChapterId || null, now);
    return this.findKnowledgeById(id);
  }

  /** 批量覆盖某章的角色知识：退休旧自动投影 + 转换行 + 插入新投影（同事务） */
  batchUpsertKnowledge(input: BatchUpsertKnowledgeInput): IpcResult<{ inserted: number }> {
    try {
      const tx = this.db.transaction(() => {
        const transitions = new NarrativeTransitionRepo(this.db);
        const pending: Transition[] = [];
        const now = new Date().toISOString();

        const oldRows = this.db.prepare(`
          SELECT * FROM character_knowledge
          WHERE learned_at_chapter_id = ? AND source_decision_id IS NULL AND status = 'active'
        `).all(input.chapterId) as Record<string, unknown>[];

        for (const old of oldRows) {
          const oldId = old.id as string;
          this.db.prepare(
            `UPDATE character_knowledge SET status = 'superseded' WHERE id = ?`,
          ).run(oldId);
          const snap = makeSnapshot(this.rowToKnowledge({ ...old, status: 'superseded' }));
          const appended = transitions.append({
            projectId: input.projectId,
            targetTable: 'character_knowledge',
            targetId: oldId,
            kind: 'superseded',
            atChapterId: input.chapterId,
            afterSnapshot: snap,
            pendingInTx: pending,
          });
          if (!appended.success || !appended.data) throw new Error(appended.error || '转换写入失败');
          pending.push(appended.data);
        }

        if (input.knowledge.length === 0) return { inserted: 0 };

        const stmt = this.db.prepare(`
          INSERT INTO character_knowledge (
            id, project_id, character_id, character_name, fact_description,
            source, learned_at_chapter_id, source_kind, status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'chapter_extraction', 'active', ?)
        `);

        for (const k of input.knowledge) {
          const id = crypto.randomUUID();
          stmt.run(
            id,
            input.projectId,
            k.characterId || null,
            k.characterName,
            k.factDescription,
            k.source,
            k.learnedAtChapterId || null,
            now,
          );
          const knowledge = this.findKnowledgeById(id).data!;
          const appended = transitions.append({
            projectId: input.projectId,
            targetTable: 'character_knowledge',
            targetId: id,
            kind: 'created',
            atChapterId: input.chapterId,
            afterSnapshot: makeSnapshot(knowledge),
            pendingInTx: pending,
          });
          if (!appended.success || !appended.data) throw new Error(appended.error || '转换写入失败');
          pending.push(appended.data);
        }
        return { inserted: input.knowledge.length };
      });

      return { success: true, data: tx() };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  findKnowledgeById(id: string): IpcResult<CharacterKnowledge> {
    const row = this.db.prepare('SELECT * FROM character_knowledge WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return { success: false, error: '知识条目不存在' };
    return { success: true, data: this.rowToKnowledge(row) };
  }

  /** 获取某角色的已知信息（用于判断是否信息越界） */
  findByCharacter(projectId: string, characterName: string): IpcResult<CharacterKnowledge[]> {
    const rows = this.db.prepare(`
      SELECT * FROM character_knowledge
      WHERE project_id = ? AND character_name = ? AND status = 'active'
      ORDER BY created_at DESC
    `).all(projectId, characterName) as Record<string, unknown>[];
    return { success: true, data: rows.map(r => this.rowToKnowledge(r)) };
  }

  /** 获取项目所有角色知识（用于审稿上下文） */
  findAllKnowledgeByProject(projectId: string): IpcResult<CharacterKnowledge[]> {
    const rows = this.db.prepare(`
      SELECT * FROM character_knowledge
      WHERE project_id = ? AND status = 'active'
      ORDER BY created_at DESC
    `).all(projectId) as Record<string, unknown>[];
    return { success: true, data: rows.map(r => this.rowToKnowledge(r)) };
  }

  // ============================================================
  // 辅助方法
  // ============================================================

  private rowToFact(row: Record<string, unknown>): StoryFact {
    return {
      id: row.id as string,
      projectId: row.project_id as string,
      chapterId: (row.chapter_id ?? null) as string | null,
      factType: row.fact_type as StoryFact['factType'],
      subject: row.subject as string,
      predicate: row.predicate as string,
      object: row.object as string,
      description: row.description as string,
      status: row.status as StoryFact['status'],
      supersededBy: (row.superseded_by ?? null) as string | null,
      sourceDecisionId: (row.source_decision_id ?? null) as string | null,
      sourceKind: (row.source_kind ?? 'legacy') as StoryFact['sourceKind'],
      createdAt: row.created_at as string,
    };
  }

  private rowToKnowledge(row: Record<string, unknown>): CharacterKnowledge {
    return {
      id: row.id as string,
      projectId: row.project_id as string,
      characterId: (row.character_id ?? null) as string | null,
      characterName: row.character_name as string,
      factDescription: row.fact_description as string,
      source: row.source as string,
      learnedAtChapterId: (row.learned_at_chapter_id ?? null) as string | null,
      sourceDecisionId: (row.source_decision_id ?? null) as string | null,
      sourceKind: (row.source_kind ?? 'legacy') as CharacterKnowledge['sourceKind'],
      status: (row.status ?? 'active') as CharacterKnowledge['status'],
      supersededBy: (row.superseded_by ?? null) as string | null,
      createdAt: row.created_at as string,
    };
  }
}
