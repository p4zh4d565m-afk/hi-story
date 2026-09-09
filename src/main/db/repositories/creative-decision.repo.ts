import Database from 'better-sqlite3';
import type {
  ConfirmCreativeDecisionsInput,
  CreateCreativeDecisionProposalsInput,
  CreateCreativeDecisionRevisionInput,
  CreativeDecision,
  CreativeDecisionDraft,
  CreativeDecisionEffect,
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

export class CreativeDecisionRepo {
  constructor(private db: Database.Database) {}

  createProposals(input: CreateCreativeDecisionProposalsInput): IpcResult<CreativeDecision[]> {
    try {
      if (!Array.isArray(input.drafts) || input.drafts.length === 0) {
        throw new Error('没有可保存的决策提议');
      }
      this.requireAssistantSource(input.projectId, input.sourceThreadId, input.sourceMessageId);
      input.drafts.forEach(draft => this.validateDraft(input.projectId, draft));

      const create = this.db.transaction(() => input.drafts.map(draft => {
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        this.db.prepare(`
          INSERT INTO creative_decisions (
            id, project_id, source_thread_id, source_message_id, parent_decision_id,
            decision_type, title, rationale, payload_json, status, created_at
          ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, 'proposed', ?)
        `).run(
          id, input.projectId, input.sourceThreadId, input.sourceMessageId,
          draft.type, draft.title.trim(), draft.rationale.trim(), JSON.stringify(draft.payload), now,
        );
        return this.requireDecision(input.projectId, id);
      }));

      return { success: true, data: create() };
    } catch (error) {
      return failure(error);
    }
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
      this.validateDraft(input.projectId, input.draft);
      const decision = this.requireDecision(input.projectId, input.decisionId);
      if (decision.status !== 'proposed') throw new Error('只有待确认决策可以编辑');

      this.db.prepare(`
        UPDATE creative_decisions
        SET decision_type = ?, title = ?, rationale = ?, payload_json = ?
        WHERE id = ? AND project_id = ? AND status = 'proposed'
      `).run(
        input.draft.type, input.draft.title.trim(), input.draft.rationale.trim(),
        JSON.stringify(input.draft.payload), input.decisionId, input.projectId,
      );
      return { success: true, data: this.requireDecision(input.projectId, input.decisionId) };
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

        for (const decision of decisions) {
          if (decision.status !== 'proposed' && decision.status !== 'confirmed') {
            throw new Error('决策已拒绝或已被取代，不能确认');
          }
          if (decision.status === 'proposed') {
            this.validateDraft(input.projectId, toDraft(decision));
            if (decision.parentDecisionId) {
              const parent = this.requireDecision(input.projectId, decision.parentDecisionId);
              if (parent.status !== 'confirmed') throw new Error('原决策已不可修订');
              if (parent.type !== decision.type) throw new Error('修订类型必须与原决策一致');
            }
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

          const applied = decision.parentDecisionId
            ? this.applyRevision(decision)
            : this.applyNewDecision(decision);
          effects.push(...applied);
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

      return { success: true, data: confirm() };
    } catch (error) {
      return failure(error);
    }
  }

  createRevision(input: CreateCreativeDecisionRevisionInput): IpcResult<CreativeDecision> {
    try {
      const parent = this.requireDecision(input.projectId, input.parentDecisionId);
      if (parent.status !== 'confirmed') throw new Error('只有已确认决策可以修订');
      if (parent.type !== input.draft.type) throw new Error('修订类型必须与原决策一致');

      const targetId = this.findProjectionTarget(parent);
      const suppliedTargetId = getTargetId(input.draft);
      if (suppliedTargetId && suppliedTargetId !== targetId) throw new Error('修订目标与原决策不一致');
      const draft = withTargetId(input.draft, targetId);
      this.validateDraft(input.projectId, draft);

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
      return { success: true, data: this.requireDecision(input.projectId, id) };
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
          'hookType', 'description', 'intensity', 'chapterId', 'dueChapterId', 'targetId',
        ], '叙事钩子载荷');
        requireEnum(payload.hookType, HOOK_TYPES, '钩子类型');
        requireText(payload.description, '钩子描述');
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
          'debtType', 'description', 'chapterId', 'promisedByChapter', 'targetId',
        ], '叙事债务载荷');
        requireEnum(payload.debtType, DEBT_TYPES, '债务类型');
        requireText(payload.description, '债务描述');
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
    const row = this.db.prepare(`SELECT 1 FROM ${table} WHERE id = ? AND project_id = ?`)
      .get(targetId, projectId);
    if (!row) throw new Error('修订目标不存在或不属于当前项目');
  }

  private applyNewDecision(decision: CreativeDecision): CreativeDecisionEffect[] {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    switch (decision.type) {
      case 'story_fact':
        this.db.prepare(`
          INSERT INTO story_facts (
            id, project_id, chapter_id, fact_type, subject, predicate, object,
            description, status, source_decision_id, source_kind, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, 'author_decision', ?)
        `).run(
          id, decision.projectId, decision.payload.chapterId ?? null, decision.payload.factType,
          decision.payload.subject, decision.payload.predicate, decision.payload.object,
          decision.payload.description, decision.id, now,
        );
        break;
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
            due_chapter_id, source_decision_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)
        `).run(
          id, decision.projectId, decision.payload.chapterId ?? null, decision.payload.hookType,
          decision.payload.description, decision.payload.intensity,
          decision.payload.dueChapterId ?? null, decision.id, now, now,
        );
        break;
      case 'narrative_debt':
        this.db.prepare(`
          INSERT INTO narrative_debts (
            id, project_id, chapter_id, description, debt_type, promised_by_chapter,
            status, source_decision_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'unpaid', ?, ?, ?)
        `).run(
          id, decision.projectId, decision.payload.chapterId ?? null,
          decision.payload.description, decision.payload.debtType,
          decision.payload.promisedByChapter ?? null, decision.id, now, now,
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
      this.db.prepare(`
        INSERT INTO story_facts (
          id, project_id, chapter_id, fact_type, subject, predicate, object,
          description, status, source_decision_id, source_kind, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, 'author_decision', ?)
      `).run(
        newId, decision.projectId, decision.payload.chapterId ?? null, decision.payload.factType,
        decision.payload.subject, decision.payload.predicate, decision.payload.object,
        decision.payload.description, decision.id, now,
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
          due_chapter_id = ?, source_decision_id = ?, updated_at = ?
        WHERE id = ? AND project_id = ?
      `).run(
        decision.payload.chapterId ?? null, decision.payload.hookType,
        decision.payload.description, decision.payload.intensity,
        decision.payload.dueChapterId ?? null, decision.id, now, targetId, decision.projectId,
      );
    } else {
      this.db.prepare(`
        UPDATE narrative_debts
        SET chapter_id = ?, description = ?, debt_type = ?, promised_by_chapter = ?,
          source_decision_id = ?, updated_at = ?
        WHERE id = ? AND project_id = ?
      `).run(
        decision.payload.chapterId ?? null, decision.payload.description,
        decision.payload.debtType, decision.payload.promisedByChapter ?? null,
        decision.id, now, targetId, decision.projectId,
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
