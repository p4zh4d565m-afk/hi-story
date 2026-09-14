import Database from 'better-sqlite3';
import { findDecisionRelatedItems } from './decision-related-items';
import { NarrativeTransitionRepo, makeSnapshot, rowToNarrativeInput, type TransitionKind } from './narrative-transition.repo';
import { deriveStateKey } from '../../ai/narrative-state-reducer';
import type {
  ConfirmCreativeDecisionsInput,
  CreateCreativeDecisionProposalsInput,
  CreateCreativeDecisionRevisionInput,
  CreativeDecision,
  CreativeDecisionDraft,
  CreativeDecisionEffect,
  CreativeDecisionRelatedItems,
  IpcResult,
  UpdateCreativeDecisionProposalInput,
} from '../../../renderer/types';

type DecisionType = CreativeDecisionDraft['type'];
type TargetTable = CreativeDecisionEffect['targetTable'];
type RawRow = Record<string, unknown>;

const DECISION_TYPES = new Set<DecisionType>([
  'story_fact', 'character_knowledge', 'narrative_hook', 'narrative_debt',
]);
const FACT_TYPES = new Set(['location', 'possession', 'relationship', 'knowledge', 'event', 'emotional_state']);
const HOOK_TYPES = new Set(['cliffhanger', 'foreshadowing', 'promise', 'mystery', 'emotional_hook']);
const DEBT_TYPES = new Set(['reveal', 'payoff', 'character_return', 'mystery_answer', 'power_up']);

const TARGET_TABLE_BY_TYPE: Record<DecisionType, TargetTable> = {
  story_fact: 'story_facts',
  character_knowledge: 'character_knowledge',
  narrative_hook: 'narrative_hooks',
  narrative_debt: 'narrative_debts',
};

// 状态型事实的类型集合：与 StoryFactsRepo.batchUpsert 一致，需写 state_key 供 as-of 按状态身份折叠
const STATE_FACT_TYPES = new Set(['location', 'possession', 'relationship', 'emotional_state']);

/** 状态型事实计算 state_key（含 version）；非状态型返回 null。 */
function computeStateKey(payload: {
  factType: string;
  subject: string;
  predicate: string;
  object: string;
}): { key: string; version: number } | null {
  if (!STATE_FACT_TYPES.has(payload.factType)) return null;
  return deriveStateKey({
    factType: payload.factType as 'location' | 'possession' | 'relationship' | 'emotional_state',
    subject: payload.subject,
    predicate: payload.predicate,
    object: payload.object,
    ...(payload.factType === 'relationship' ? { directed: true } : {}),
  } as Parameters<typeof deriveStateKey>[0]);
}

export class CreativeDecisionRepo {
  constructor(private db: Database.Database) {}

  findRelatedItems(input: { projectId: string; decisionId: string }): IpcResult<CreativeDecisionRelatedItems> {
    try {
      const decision = this.requireDecision(input.projectId, input.decisionId);
      if (decision.status !== 'proposed') throw new Error('只有待确认决策可以查询疑似相关项');
      return { success: true, data: findDecisionRelatedItems(this.db, decision) };
    } catch (error) { return failure(error); }
  }

  prepareRevision(projectId: string, decisionId: string): IpcResult<CreativeDecisionDraft> {
    try {
      const parent = this.requireDecision(projectId, decisionId);
      if (parent.status !== 'confirmed') throw new Error('只有已确认决策可以修订');
      const targetId = this.findProjectionTarget(parent);
      this.requireOptionalTarget(projectId, TARGET_TABLE_BY_TYPE[parent.type], targetId);
      return { success: true, data: withTargetId(toDraft(parent), targetId) };
    } catch (error) { return failure(error); }
  }

  createProposals(input: CreateCreativeDecisionProposalsInput): IpcResult<CreativeDecision[]> {
    try {
      if (!Array.isArray(input.drafts) || input.drafts.length === 0) {
        throw new Error('没有可保存的决策提议');
      }
      this.requireAssistantSource(input.projectId, input.sourceThreadId, input.sourceMessageId);
      input.drafts.forEach(draft => this.validateDraft(input.projectId, draft));
      return { success: true, data: this.insertProposals(input.projectId, input.sourceThreadId, input.sourceMessageId, input.drafts) };
    } catch (error) {
      return failure(error);
    }
  }

  /**
   * 章节抽取产生的钩子/债务提议（A5 钩子单轨）。
   * 来源不是对话里的 assistant 消息，sourceThreadId/sourceMessageId 恒为 null，
   * 故不走 requireAssistantSource；但仍走 validateDraft 与 requireNoPendingTarget。
   */
  createChapterExtractionProposals(input: { projectId: string; drafts: CreativeDecisionDraft[] }): IpcResult<CreativeDecision[]> {
    try {
      if (!Array.isArray(input.drafts) || input.drafts.length === 0) {
        throw new Error('没有可保存的决策提议');
      }
      input.drafts.forEach(draft => this.validateDraft(input.projectId, draft));
      return { success: true, data: this.insertProposals(input.projectId, null, null, input.drafts) };
    } catch (error) {
      return failure(error);
    }
  }

  /** 单事务批量插入 proposed 提议（createProposals 与 createChapterExtractionProposals 共用） */
  private insertProposals(projectId: string, sourceThreadId: string | null, sourceMessageId: string | null, drafts: CreativeDecisionDraft[]): CreativeDecision[] {
    const create = this.db.transaction(() => drafts.map(draft => {
      this.requireNoPendingTarget(projectId, draft);
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      this.db.prepare(`
        INSERT INTO creative_decisions (
          id, project_id, source_thread_id, source_message_id, parent_decision_id,
          decision_type, title, rationale, payload_json, status, created_at
        ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, 'proposed', ?)
      `).run(
        id, projectId, sourceThreadId, sourceMessageId,
        draft.type, draft.title.trim(), draft.rationale.trim(), JSON.stringify(draft.payload), now,
      );
      return this.requireDecision(projectId, id);
    }));
    return create.immediate();
  }

  findByProject(projectId: string): IpcResult<CreativeDecision[]> {
    try {
      const rows = this.db.prepare(`
        SELECT * FROM creative_decisions
        WHERE project_id = ?
        ORDER BY created_at DESC, id DESC
      `).all(projectId) as RawRow[];
      return { success: true, data: rows.map(rowToDecision) };
    } catch (error) {
      return failure(error);
    }
  }

  updateProposal(input: UpdateCreativeDecisionProposalInput): IpcResult<CreativeDecision> {
    try {
      const update = this.db.transaction(() => {
      this.validateDraft(input.projectId, input.draft);
      const decision = this.requireDecision(input.projectId, input.decisionId);
      if (decision.status !== 'proposed') throw new Error('只有待确认决策可以编辑');
      this.requireParentInvariant(decision, input.draft);
      this.requireNoPendingTarget(input.projectId, input.draft, decision.id);

      this.db.prepare(`
        UPDATE creative_decisions
        SET decision_type = ?, title = ?, rationale = ?, payload_json = ?
        WHERE id = ? AND project_id = ? AND status = 'proposed'
      `).run(
        input.draft.type, input.draft.title.trim(), input.draft.rationale.trim(),
        JSON.stringify(input.draft.payload), input.decisionId, input.projectId,
      );
      return this.requireDecision(input.projectId, input.decisionId);
      });
      return { success: true, data: update.immediate() };
    } catch (error) {
      return failure(error);
    }
  }

  reject(projectId: string, decisionId: string): IpcResult<CreativeDecision> {
    try {
      const decision = this.requireDecision(projectId, decisionId);
      if (decision.status !== 'proposed') throw new Error('只有待确认决策可以拒绝');
      this.db.prepare(`
        UPDATE creative_decisions
        SET status = 'rejected', rejected_at = ?
        WHERE id = ? AND project_id = ? AND status = 'proposed'
      `).run(new Date().toISOString(), decisionId, projectId);
      return { success: true, data: this.requireDecision(projectId, decisionId) };
    } catch (error) {
      return failure(error);
    }
  }

  confirmMany(input: ConfirmCreativeDecisionsInput): IpcResult<{
    decisions: CreativeDecision[];
    effects: CreativeDecisionEffect[];
  }> {
    try {
      const confirm = this.db.transaction(() => {
        const decisionIds = [...new Set(input.decisionIds)];
        if (decisionIds.length === 0) throw new Error('请选择要确认的决策');
        const decisions = decisionIds.map(id => this.requireDecision(input.projectId, id));
        const selectedTargets = new Set<string>();

        for (const decision of decisions) {
          if (decision.status !== 'proposed' || !getTargetId(decision)) continue;
          const key = JSON.stringify([TARGET_TABLE_BY_TYPE[decision.type], getTargetId(decision)]);
          if (selectedTargets.has(key)) {
            throw new Error('同一目标不能同时确认多个修订');
          }
          selectedTargets.add(key);
        }

        for (const decision of decisions) {
          if (decision.status !== 'proposed' && decision.status !== 'confirmed') {
            throw new Error('决策已拒绝或已被取代，不能确认');
          }
          if (decision.status === 'proposed') {
            this.validateDraft(input.projectId, toDraft(decision));
            this.requireParentInvariant(decision, toDraft(decision));
            this.requireNoPendingTarget(input.projectId, decision, decision.id);
          }
        }

        const effects: CreativeDecisionEffect[] = [];
        for (const decision of decisions) {
          if (decision.status === 'confirmed') {
            const existingEffects = this.findEffects(decision.id);
            if (existingEffects.length === 0) throw new Error('已确认决策缺少写入效果');
            effects.push(...existingEffects);
            continue;
          }

          const applied = getTargetId(decision)
            ? this.applyRevision(decision)
            : this.applyNewDecision(decision);
          effects.push(...applied);
          this.appendTransitionsForEffects(decision, applied);
          const now = new Date().toISOString();
          this.db.prepare(`
            UPDATE creative_decisions
            SET status = 'confirmed', confirmed_at = ?, rejected_at = NULL
            WHERE id = ? AND project_id = ? AND status = 'proposed'
          `).run(now, decision.id, input.projectId);
          if (decision.parentDecisionId) {
            this.db.prepare(`
              UPDATE creative_decisions SET status = 'superseded'
              WHERE id = ? AND project_id = ? AND status = 'confirmed'
            `).run(decision.parentDecisionId, input.projectId);
          }
        }

        return {
          decisions: decisionIds.map(id => this.requireDecision(input.projectId, id)),
          effects,
        };
      });

      return { success: true, data: confirm.immediate() };
    } catch (error) {
      return failure(error);
    }
  }

  createRevision(input: CreateCreativeDecisionRevisionInput): IpcResult<CreativeDecision> {
    try {
      const create = this.db.transaction(() => {
        const parent = this.requireDecision(input.projectId, input.parentDecisionId);
        if (parent.status !== 'confirmed') throw new Error('只有已确认决策可以修订');
        if (parent.type !== input.draft.type) throw new Error('修订类型必须与原决策一致');
        const targetId = this.findProjectionTarget(parent);
        const suppliedTargetId = getTargetId(input.draft);
        if (suppliedTargetId && suppliedTargetId !== targetId) throw new Error('修订目标与原决策不一致');
        const draft = withTargetId(input.draft, targetId);
        this.validateDraft(input.projectId, draft);
        this.requireNoPendingTarget(input.projectId, draft);

        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        this.db.prepare(`
          INSERT INTO creative_decisions (
            id, project_id, source_thread_id, source_message_id, parent_decision_id,
            decision_type, title, rationale, payload_json, status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'proposed', ?)
        `).run(
          id, input.projectId, parent.sourceThreadId, parent.sourceMessageId, parent.id,
          draft.type, draft.title.trim(), draft.rationale.trim(), JSON.stringify(draft.payload), now,
        );
        return this.requireDecision(input.projectId, id);
      });
      return { success: true, data: create.immediate() };
    } catch (error) {
      return failure(error);
    }
  }

  private requireAssistantSource(projectId: string, threadId: string, messageId: string): void {
    const row = this.db.prepare(`
      SELECT message.id
      FROM conversation_messages message
      JOIN conversation_threads thread ON thread.id = message.thread_id
      WHERE message.id = ? AND message.thread_id = ?
        AND thread.id = ? AND thread.project_id = ? AND message.role = 'assistant'
    `).get(messageId, threadId, threadId, projectId);
    if (!row) throw new Error('提议来源必须是当前项目中已保存的 AI 回复');
  }

  private requireParentInvariant(decision: CreativeDecision, draft: CreativeDecisionDraft): void {
    if (!decision.parentDecisionId) return;
    const parent = this.requireDecision(decision.projectId, decision.parentDecisionId);
    if (parent.status !== 'confirmed') throw new Error('原决策已不可修订');
    if (parent.type !== draft.type) throw new Error('修订类型必须与原决策一致');
    if (!getTargetId(draft) || getTargetId(draft) !== this.findProjectionTarget(parent)) {
      throw new Error('有父修订目标不能为空且必须与原决策一致');
    }
  }

  private requireNoPendingTarget(projectId: string, draft: CreativeDecisionDraft, excludeId?: string): void {
    const targetId = getTargetId(draft);
    if (!targetId) return;
    const pending = this.db.prepare(`SELECT * FROM creative_decisions WHERE project_id = ? AND status = 'proposed'`)
      .all(projectId) as RawRow[];
    if (pending.some(row => {
      if (row.id === excludeId) return false;
      const other = rowToDecision(row);
      return TARGET_TABLE_BY_TYPE[other.type] === TARGET_TABLE_BY_TYPE[draft.type]
        && getTargetId(other) === targetId;
    })) throw new Error('该目标已有待确认修订');
  }

  private requireDecision(projectId: string, decisionId: string): CreativeDecision {
    const row = this.db.prepare(`
      SELECT * FROM creative_decisions WHERE id = ? AND project_id = ?
    `).get(decisionId, projectId) as RawRow | undefined;
    if (!row) throw new Error('决策不存在或不属于当前项目');
    return rowToDecision(row);
  }

  private validateDraft(projectId: string, draft: CreativeDecisionDraft): void {
    if (!draft || typeof draft !== 'object' || !DECISION_TYPES.has(draft.type)) {
      throw new Error('不支持的决策类型');
    }
    assertOnlyKeys(draft as unknown as RawRow, ['type', 'title', 'rationale', 'payload'], '决策');
    requireText(draft.title, '决策标题');
    requireText(draft.rationale, '决策理由');
    if (!draft.payload || typeof draft.payload !== 'object' || Array.isArray(draft.payload)) {
      throw new Error('决策载荷无效');
    }

    switch (draft.type) {
      case 'story_fact': {
        const payload = draft.payload;
        assertOnlyKeys(payload as unknown as RawRow, [
          'factType', 'subject', 'predicate', 'object', 'description', 'chapterId', 'targetId',
        ], '事实载荷');
        requireEnum(payload.factType, FACT_TYPES, '事实类型');
        requireText(payload.subject, '事实主体');
        requireText(payload.predicate, '事实关系');
        requireText(payload.object, '事实对象');
        requireText(payload.description, '事实描述');
        this.requireOptionalChapter(projectId, payload.chapterId);
        this.requireOptionalTarget(projectId, 'story_facts', payload.targetId);
        return;
      }
      case 'character_knowledge': {
        const payload = draft.payload;
        assertOnlyKeys(payload as unknown as RawRow, [
          'characterId', 'characterName', 'factDescription', 'source',
          'learnedAtChapterId', 'targetId',
        ], '人物知识载荷');
        requireText(payload.characterName, '人物姓名');
        requireText(payload.factDescription, '人物知识');
        requireText(payload.source, '知识来源');
        this.requireOptionalCharacter(projectId, payload.characterId);
        this.requireOptionalChapter(projectId, payload.learnedAtChapterId);
        this.requireOptionalTarget(projectId, 'character_knowledge', payload.targetId);
        return;
      }
      case 'narrative_hook': {
        const payload = draft.payload;
        assertOnlyKeys(payload as unknown as RawRow, [
          'hookType', 'subject', 'description', 'intensity', 'chapterId', 'dueChapterId', 'targetId',
        ], '叙事钩子载荷');
        requireEnum(payload.hookType, HOOK_TYPES, '钩子类型');
        requireText(payload.description, '钩子描述');
        requireText(payload.subject, '钩子主体');
        if (!Number.isInteger(payload.intensity) || payload.intensity < 1 || payload.intensity > 5) {
          throw new Error('钩子强度必须是 1 到 5 的整数');
        }
        this.requireOptionalChapter(projectId, payload.chapterId);
        this.requireOptionalChapter(projectId, payload.dueChapterId);
        this.requireOptionalTarget(projectId, 'narrative_hooks', payload.targetId);
        return;
      }
      case 'narrative_debt': {
        const payload = draft.payload;
        assertOnlyKeys(payload as unknown as RawRow, [
          'debtType', 'subject', 'description', 'chapterId', 'promisedByChapter', 'targetId',
        ], '叙事债务载荷');
        requireEnum(payload.debtType, DEBT_TYPES, '债务类型');
        requireText(payload.description, '债务描述');
        requireText(payload.subject, '债务主体');
        if (payload.promisedByChapter != null
          && (!Number.isInteger(payload.promisedByChapter) || payload.promisedByChapter < 1)) {
          throw new Error('承诺章节必须是正整数');
        }
        this.requireOptionalChapter(projectId, payload.chapterId);
        this.requireOptionalTarget(projectId, 'narrative_debts', payload.targetId);
      }
    }
  }

  private requireOptionalChapter(projectId: string, chapterId?: string | null): void {
    if (chapterId == null) return;
    if (typeof chapterId !== 'string' || !chapterId.trim()) throw new Error('章节 ID 无效');
    const row = this.db.prepare('SELECT 1 FROM chapters WHERE id = ? AND project_id = ?')
      .get(chapterId, projectId);
    if (!row) throw new Error('章节不存在或不属于当前项目');
  }

  private requireOptionalCharacter(projectId: string, characterId?: string | null): void {
    if (characterId == null) return;
    if (typeof characterId !== 'string' || !characterId.trim()) throw new Error('人物 ID 无效');
    const row = this.db.prepare('SELECT 1 FROM characters WHERE id = ? AND project_id = ?')
      .get(characterId, projectId);
    if (!row) throw new Error('人物不存在或不属于当前项目');
  }

  private requireOptionalTarget(projectId: string, table: TargetTable, targetId?: string | null): void {
    if (targetId == null) return;
    if (typeof targetId !== 'string' || !targetId.trim()) throw new Error('修订目标 ID 无效');
    const row = this.db.prepare(`SELECT status FROM ${table} WHERE id = ? AND project_id = ?`)
      .get(targetId, projectId) as { status: string } | undefined;
    if (!row) throw new Error('修订目标不存在或不属于当前项目');
    const active = table === 'narrative_hooks' ? ['open', 'partially_resolved']
      : table === 'narrative_debts' ? ['unpaid', 'overdue'] : ['active'];
    if (!active.includes(row.status)) throw new Error('只能修订活跃目标');
  }

  private appendTransitionsForEffects(
    decision: CreativeDecision,
    effects: CreativeDecisionEffect[],
  ): void {
    const transitions = new NarrativeTransitionRepo(this.db);
    const pending: import('../../ai/narrative-state-reducer').Transition[] = [];
    for (const effect of effects) {
      const payload = decision.payload as {
        chapterId?: string | null;
        learnedAtChapterId?: string | null;
      };
      const atChapterId = payload.chapterId ?? payload.learnedAtChapterId ?? null;
      if (!atChapterId) continue;
      let kind: TransitionKind = 'created';
      if (effect.operation === 'supersede') kind = 'superseded';
      else if (effect.operation === 'insert') kind = 'created';
      else if (effect.operation === 'update') {
        const after = effect.after as { status?: string } | null;
        if (after?.status === 'resolved') kind = 'resolved';
        else if (after?.status === 'paid') kind = 'paid';
        else if (after?.status === 'partially_resolved') kind = 'partially_resolved';
        else if (after?.status === 'abandoned') kind = 'abandoned';
        else if (after?.status === 'waived') kind = 'waived';
        else kind = 'created'; // 字段修订仍记一条完整快照
      }
      const afterRow = effect.after ?? this.requireTargetRow(effect.targetTable, decision.projectId, effect.targetId);
      const appended = transitions.append({
        projectId: decision.projectId,
        targetTable: effect.targetTable as 'story_facts' | 'character_knowledge' | 'narrative_hooks' | 'narrative_debts',
        targetId: effect.targetId,
        kind,
        atChapterId,
        afterSnapshot: makeSnapshot(rowToNarrativeInput(
          effect.targetTable as 'story_facts' | 'character_knowledge' | 'narrative_hooks' | 'narrative_debts',
          afterRow,
        )),
        decisionId: decision.id,
        pendingInTx: pending,
      });
      if (!appended.success || !appended.data) throw new Error(appended.error || '转换写入失败');
      pending.push(appended.data);
    }
  }

  private applyNewDecision(decision: CreativeDecision): CreativeDecisionEffect[] {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    switch (decision.type) {
      case 'story_fact': {
        const stateKey = computeStateKey(decision.payload);
        this.db.prepare(`
          INSERT INTO story_facts (
            id, project_id, chapter_id, fact_type, subject, predicate, object,
            description, status, source_decision_id, source_kind, state_key, state_key_version, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, 'author_decision', ?, ?, ?)
        `).run(
          id, decision.projectId, decision.payload.chapterId ?? null, decision.payload.factType,
          decision.payload.subject, decision.payload.predicate, decision.payload.object,
          decision.payload.description, decision.id, stateKey?.key ?? null, stateKey?.version ?? 1, now,
        );
        break;
      }
      case 'character_knowledge':
        this.db.prepare(`
          INSERT INTO character_knowledge (
            id, project_id, character_id, character_name, fact_description, source,
            learned_at_chapter_id, source_decision_id, source_kind, status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'author_decision', 'active', ?)
        `).run(
          id, decision.projectId, decision.payload.characterId ?? null,
          decision.payload.characterName, decision.payload.factDescription, decision.payload.source,
          decision.payload.learnedAtChapterId ?? null, decision.id, now,
        );
        break;
      case 'narrative_hook':
        this.db.prepare(`
          INSERT INTO narrative_hooks (
            id, project_id, chapter_id, hook_type, description, intensity, status,
            due_chapter_id, source_decision_id, created_at, updated_at, subject
          ) VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)
        `).run(
          id, decision.projectId, decision.payload.chapterId ?? null, decision.payload.hookType,
          decision.payload.description, decision.payload.intensity,
          decision.payload.dueChapterId ?? null, decision.id, now, now, decision.payload.subject,
        );
        break;
      case 'narrative_debt':
        this.db.prepare(`
          INSERT INTO narrative_debts (
            id, project_id, chapter_id, description, debt_type, promised_by_chapter,
            status, source_decision_id, created_at, updated_at, subject
          ) VALUES (?, ?, ?, ?, ?, ?, 'unpaid', ?, ?, ?, ?)
        `).run(
          id, decision.projectId, decision.payload.chapterId ?? null,
          decision.payload.description, decision.payload.debtType,
          decision.payload.promisedByChapter ?? null, decision.id, now, now, decision.payload.subject,
        );
    }
    return [this.insertEffect(
      decision.id, TARGET_TABLE_BY_TYPE[decision.type], id, 'insert', null,
      this.requireTargetRow(TARGET_TABLE_BY_TYPE[decision.type], decision.projectId, id),
    )];
  }

  private applyRevision(decision: CreativeDecision): CreativeDecisionEffect[] {
    const targetId = getTargetId(decision);
    if (!targetId) throw new Error('修订缺少目标记录');
    const table = TARGET_TABLE_BY_TYPE[decision.type];
    const before = this.requireTargetRow(table, decision.projectId, targetId);
    const now = new Date().toISOString();

    if (decision.type === 'story_fact') {
      if (before.status !== 'active') throw new Error('只能修订活跃事实');
      const newId = crypto.randomUUID();
      const stateKey = computeStateKey(decision.payload);
      this.db.prepare(`
        INSERT INTO story_facts (
          id, project_id, chapter_id, fact_type, subject, predicate, object,
          description, status, source_decision_id, source_kind, state_key, state_key_version, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, 'author_decision', ?, ?, ?)
      `).run(
        newId, decision.projectId, decision.payload.chapterId ?? null, decision.payload.factType,
        decision.payload.subject, decision.payload.predicate, decision.payload.object,
        decision.payload.description, decision.id, stateKey?.key ?? null, stateKey?.version ?? 1, now,
      );
      this.db.prepare(`
        UPDATE story_facts SET status = 'superseded', superseded_by = ?
        WHERE id = ? AND project_id = ? AND status = 'active'
      `).run(newId, targetId, decision.projectId);
      return [
        this.insertEffect(decision.id, table, newId, 'insert', null,
          this.requireTargetRow(table, decision.projectId, newId)),
        this.insertEffect(decision.id, table, targetId, 'supersede', before,
          this.requireTargetRow(table, decision.projectId, targetId)),
      ];
    }

    if (decision.type === 'character_knowledge') {
      if (before.status !== 'active') throw new Error('只能修订活跃人物知识');
      const newId = crypto.randomUUID();
      this.db.prepare(`
        INSERT INTO character_knowledge (
          id, project_id, character_id, character_name, fact_description, source,
          learned_at_chapter_id, source_decision_id, source_kind, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'author_decision', 'active', ?)
      `).run(
        newId, decision.projectId, decision.payload.characterId ?? null,
        decision.payload.characterName, decision.payload.factDescription, decision.payload.source,
        decision.payload.learnedAtChapterId ?? null, decision.id, now,
      );
      this.db.prepare(`
        UPDATE character_knowledge SET status = 'superseded', superseded_by = ?
        WHERE id = ? AND project_id = ? AND status = 'active'
      `).run(newId, targetId, decision.projectId);
      return [
        this.insertEffect(decision.id, table, newId, 'insert', null,
          this.requireTargetRow(table, decision.projectId, newId)),
        this.insertEffect(decision.id, table, targetId, 'supersede', before,
          this.requireTargetRow(table, decision.projectId, targetId)),
      ];
    }

    if (decision.type === 'narrative_hook') {
      this.db.prepare(`
        UPDATE narrative_hooks
        SET chapter_id = ?, hook_type = ?, description = ?, intensity = ?,
          due_chapter_id = ?, source_decision_id = ?, updated_at = ?, subject = ?
        WHERE id = ? AND project_id = ?
      `).run(
        decision.payload.chapterId ?? null, decision.payload.hookType,
        decision.payload.description, decision.payload.intensity,
        decision.payload.dueChapterId ?? null, decision.id, now, decision.payload.subject, targetId, decision.projectId,
      );
    } else {
      this.db.prepare(`
        UPDATE narrative_debts
        SET chapter_id = ?, description = ?, debt_type = ?, promised_by_chapter = ?,
          source_decision_id = ?, updated_at = ?, subject = ?
        WHERE id = ? AND project_id = ?
      `).run(
        decision.payload.chapterId ?? null, decision.payload.description,
        decision.payload.debtType, decision.payload.promisedByChapter ?? null,
        decision.id, now, decision.payload.subject, targetId, decision.projectId,
      );
    }

    return [this.insertEffect(
      decision.id, table, targetId, 'update', before,
      this.requireTargetRow(table, decision.projectId, targetId),
    )];
  }

  private findProjectionTarget(parent: CreativeDecision): string {
    const expectedTable = TARGET_TABLE_BY_TYPE[parent.type];
    const effects = this.findEffects(parent.id).filter(effect => effect.targetTable === expectedTable);
    const inserted = effects.find(effect => effect.operation === 'insert');
    const updated = effects.find(effect => effect.operation === 'update');
    const target = inserted ?? updated;
    if (!target) throw new Error('原决策缺少可修订的目标记录');
    return target.targetId;
  }

  private requireTargetRow(table: TargetTable, projectId: string, targetId: string): RawRow {
    const row = this.db.prepare(`SELECT * FROM ${table} WHERE id = ? AND project_id = ?`)
      .get(targetId, projectId) as RawRow | undefined;
    if (!row) throw new Error('目标记录不存在或不属于当前项目');
    return row;
  }

  private insertEffect(
    decisionId: string,
    targetTable: TargetTable,
    targetId: string,
    operation: CreativeDecisionEffect['operation'],
    before: RawRow | null,
    after: RawRow,
  ): CreativeDecisionEffect {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO creative_decision_effects (
        id, decision_id, target_table, target_id, operation,
        before_json, after_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, decisionId, targetTable, targetId, operation,
      before ? JSON.stringify(before) : null, JSON.stringify(after), now,
    );
    return {
      id, decisionId, targetTable, targetId, operation,
      before, after, createdAt: now,
    };
  }

  private findEffects(decisionId: string): CreativeDecisionEffect[] {
    const rows = this.db.prepare(`
      SELECT * FROM creative_decision_effects
      WHERE decision_id = ? ORDER BY created_at ASC, id ASC
    `).all(decisionId) as RawRow[];
    return rows.map(rowToEffect);
  }
}

function rowToDecision(row: RawRow): CreativeDecision {
  const type = row.decision_type as DecisionType;
  if (!DECISION_TYPES.has(type)) throw new Error('账本包含不支持的决策类型');
  const payload = JSON.parse(String(row.payload_json)) as CreativeDecisionDraft['payload'];
  if (type === 'narrative_hook' || type === 'narrative_debt') {
    (payload as { subject: string }).subject ??= '';
  }
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    sourceThreadId: row.source_thread_id == null ? null : String(row.source_thread_id),
    sourceMessageId: row.source_message_id == null ? null : String(row.source_message_id),
    parentDecisionId: row.parent_decision_id == null ? null : String(row.parent_decision_id),
    type,
    title: String(row.title),
    rationale: String(row.rationale),
    payload,
    status: row.status as CreativeDecision['status'],
    createdAt: String(row.created_at),
    confirmedAt: row.confirmed_at == null ? null : String(row.confirmed_at),
    rejectedAt: row.rejected_at == null ? null : String(row.rejected_at),
  } as CreativeDecision;
}

function rowToEffect(row: RawRow): CreativeDecisionEffect {
  return {
    id: String(row.id),
    decisionId: String(row.decision_id),
    targetTable: row.target_table as CreativeDecisionEffect['targetTable'],
    targetId: String(row.target_id),
    operation: row.operation as CreativeDecisionEffect['operation'],
    before: row.before_json == null ? null : JSON.parse(String(row.before_json)),
    after: JSON.parse(String(row.after_json)),
    createdAt: String(row.created_at),
  };
}

function toDraft(decision: CreativeDecision): CreativeDecisionDraft {
  return {
    type: decision.type,
    title: decision.title,
    rationale: decision.rationale,
    payload: decision.payload,
  } as CreativeDecisionDraft;
}

function withTargetId(draft: CreativeDecisionDraft, targetId: string): CreativeDecisionDraft {
  return {
    ...draft,
    payload: { ...draft.payload, targetId },
  } as CreativeDecisionDraft;
}

function getTargetId(draft: CreativeDecisionDraft): string | null | undefined {
  return draft.payload.targetId;
}

function requireText(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label}不能为空`);
}

function requireEnum(value: unknown, values: Set<string>, label: string): asserts value is string {
  if (typeof value !== 'string' || !values.has(value)) throw new Error(`${label}无效`);
}

function assertOnlyKeys(value: RawRow, allowed: string[], label: string): void {
  const allowedKeys = new Set(allowed);
  if (Object.keys(value).some(key => !allowedKeys.has(key))) throw new Error(`${label}包含不支持的字段`);
}

function failure<T>(error: unknown): IpcResult<T> {
  return { success: false, error: error instanceof Error ? error.message : String(error) };
}
