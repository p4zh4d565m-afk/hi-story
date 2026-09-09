import Database from 'better-sqlite3';
import type { IpcResult, NarrativeHook, NarrativeDebt } from '../../../renderer/types';

// ============================================================
// 叙事钩子 + 叙事债务 — 数据访问层（P1 — 网文追读力）
// ============================================================

export interface CreateHookInput {
  projectId: string;
  chapterId?: string | null;
  hookType: string;
  description: string;
  intensity?: number;
}

export interface UpdateHookInput {
  hookType?: string;
  description?: string;
  intensity?: number;
  status?: string;
  resolvedInChapterId?: string | null;
  dueChapterId?: string | null;
}

export interface CreateDebtInput {
  projectId: string;
  chapterId?: string | null;
  description: string;
  debtType: string;
  promisedByChapter?: number;
}

export interface UpdateDebtInput {
  description?: string;
  debtType?: string;
  promisedByChapter?: number | null;
  status?: string;
  paidInChapterId?: string | null;
}

const HOOK_TYPE_LABELS: Record<string, string> = {
  cliffhanger: '断章钩子',
  foreshadowing: '伏笔',
  promise: '读者承诺',
  mystery: '悬念',
  emotional_hook: '情感钩子',
};

const DEBT_TYPE_LABELS: Record<string, string> = {
  reveal: '真相揭示',
  payoff: '伏笔回收',
  character_return: '角色回归',
  mystery_answer: '谜底揭晓',
  power_up: '能力升级',
};

export class NarrativeHooksRepo {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  // ── Hooks ──

  create(input: CreateHookInput): IpcResult<NarrativeHook> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO narrative_hooks (id, project_id, chapter_id, hook_type, description, intensity, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)
    `).run(id, input.projectId, input.chapterId || null, input.hookType, input.description, input.intensity ?? 3, now, now);
    return this.findById(id);
  }

  findById(id: string): IpcResult<NarrativeHook> {
    const row = this.db.prepare('SELECT * FROM narrative_hooks WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return { success: false, error: '钩子不存在' };
    return { success: true, data: this.rowToHook(row) };
  }

  findByProject(projectId: string): IpcResult<NarrativeHook[]> {
    const rows = this.db.prepare(`
      SELECT * FROM narrative_hooks WHERE project_id = ? ORDER BY created_at DESC
    `).all(projectId) as Record<string, unknown>[];
    return { success: true, data: rows.map(r => this.rowToHook(r)) };
  }

  /** 获取所有未解决的钩子（用于上下文注入） */
  findOpenHooks(projectId: string): IpcResult<NarrativeHook[]> {
    const rows = this.db.prepare(`
      SELECT * FROM narrative_hooks WHERE project_id = ? AND status IN ('open','partially_resolved') ORDER BY intensity DESC, created_at DESC
    `).all(projectId) as Record<string, unknown>[];
    return { success: true, data: rows.map(r => this.rowToHook(r)) };
  }

  /** 获取需要回收的钩子（过了 due_chapter_id 还未解决的） */
  findOverdueHooks(projectId: string, currentChapterIndex: number): IpcResult<NarrativeHook[]> {
    // 找 created_at 早于当前章节且仍 open 的钩子，按 intensity 排序
    const rows = this.db.prepare(`
      SELECT nh.* FROM narrative_hooks nh
      LEFT JOIN chapters ch ON nh.chapter_id = ch.id
      WHERE nh.project_id = ? AND nh.status = 'open'
      ORDER BY nh.intensity DESC, nh.created_at ASC
    `).all(projectId) as Record<string, unknown>[];
    return { success: true, data: rows.map(r => this.rowToHook(r)) };
  }

  update(id: string, input: UpdateHookInput): IpcResult<NarrativeHook> {
    const existing = this.findById(id);
    if (!existing.success || !existing.data) return { success: false, error: '钩子不存在' };

    const now = new Date().toISOString();
    const row = existing.data;
    this.db.prepare(`
      UPDATE narrative_hooks
      SET hook_type = ?, description = ?, intensity = ?, status = ?, resolved_in_chapter_id = ?, due_chapter_id = ?, updated_at = ?
      WHERE id = ?
    `).run(
      input.hookType ?? row.hookType,
      input.description ?? row.description,
      input.intensity ?? row.intensity,
      input.status ?? row.status,
      input.resolvedInChapterId !== undefined ? input.resolvedInChapterId : row.resolvedInChapterId,
      input.dueChapterId !== undefined ? input.dueChapterId : row.dueChapterId,
      now,
      id,
    );
    return this.findById(id);
  }

  /** 标记钩子在某章被回收 */
  resolve(id: string, chapterId: string): IpcResult<NarrativeHook> {
    return this.update(id, { status: 'resolved', resolvedInChapterId: chapterId });
  }

  remove(id: string): IpcResult<void> {
    this.db.prepare('DELETE FROM narrative_hooks WHERE id = ?').run(id);
    return { success: true };
  }

  // ── Debts ──

  createDebt(input: CreateDebtInput): IpcResult<NarrativeDebt> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO narrative_debts (id, project_id, chapter_id, description, debt_type, promised_by_chapter, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'unpaid', ?, ?)
    `).run(id, input.projectId, input.chapterId || null, input.description, input.debtType, input.promisedByChapter || null, now, now);
    return this.findDebtById(id);
  }

  findDebtById(id: string): IpcResult<NarrativeDebt> {
    const row = this.db.prepare('SELECT * FROM narrative_debts WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return { success: false, error: '债务不存在' };
    return { success: true, data: this.rowToDebt(row) };
  }

  /** 获取所有未偿还的债务 */
  findUnpaidDebts(projectId: string): IpcResult<NarrativeDebt[]> {
    const rows = this.db.prepare(`
      SELECT * FROM narrative_debts
      WHERE project_id = ? AND status IN ('unpaid','overdue')
      ORDER BY CASE status WHEN 'overdue' THEN 0 ELSE 1 END, created_at ASC
    `).all(projectId) as Record<string, unknown>[];
    return { success: true, data: rows.map(r => this.rowToDebt(r)) };
  }

  /** 更新债务 */
  updateDebt(id: string, input: UpdateDebtInput): IpcResult<NarrativeDebt> {
    const existing = this.findDebtById(id);
    if (!existing.success || !existing.data) return { success: false, error: '债务不存在' };

    const now = new Date().toISOString();
    const row = existing.data;
    this.db.prepare(`
      UPDATE narrative_debts
      SET description = ?, debt_type = ?, promised_by_chapter = ?, status = ?, paid_in_chapter_id = ?, updated_at = ?
      WHERE id = ?
    `).run(
      input.description ?? row.description,
      input.debtType ?? row.debtType,
      input.promisedByChapter !== undefined ? input.promisedByChapter : row.promisedByChapter,
      input.status ?? row.status,
      input.paidInChapterId !== undefined ? input.paidInChapterId : row.paidInChapterId,
      now,
      id,
    );
    return this.findDebtById(id);
  }

  /** 标记债务已偿还 */
  payDebt(id: string, chapterId: string): IpcResult<NarrativeDebt> {
    return this.updateDebt(id, { status: 'paid', paidInChapterId: chapterId });
  }

  removeDebt(id: string): IpcResult<void> {
    this.db.prepare('DELETE FROM narrative_debts WHERE id = ?').run(id);
    return { success: true };
  }

  // ── 上下文构建用 ──

  /** 按独立预算生成待推进钩子与未偿债务上下文。 */
  getHooksAndDebtsContext(projectId: string, maxTokens: number = 800): string {
    const currentChapter = this.db.prepare(`
      SELECT COALESCE(MAX(sort_order), 0) AS sort_order
      FROM chapters WHERE project_id = ?
    `).get(projectId) as { sort_order: number };
    const hookRows = this.db.prepare(`
      SELECT hook.*, due.sort_order AS due_sort_order
      FROM narrative_hooks hook
      LEFT JOIN chapters due ON due.id = hook.due_chapter_id
      WHERE hook.project_id = ? AND hook.status IN ('open','partially_resolved')
    `).all(projectId) as Record<string, unknown>[];
    const debtRows = this.db.prepare(`
      SELECT * FROM narrative_debts
      WHERE project_id = ? AND status IN ('unpaid','overdue')
    `).all(projectId) as Record<string, unknown>[];

    const currentOrder = Number(currentChapter.sort_order || 0);
    const items: NarrativeContextItem[] = [];
    for (const row of debtRows) {
      const promisedBy = row.promised_by_chapter == null ? null : Number(row.promised_by_chapter);
      const isOverdue = row.status === 'overdue'
        || (promisedBy !== null && promisedBy <= currentOrder);
      const isDueSoon = promisedBy !== null && promisedBy <= currentOrder + 2;
      const promised = promisedBy === null ? '' : `（承诺在第 ${promisedBy} 章前）`;
      items.push({
        group: isOverdue ? 0 : isDueSoon ? 2 : 3,
        order: promisedBy ?? Number.MAX_SAFE_INTEGER,
        line: `- [${isOverdue ? '逾期债务' : '叙事债务'}·${DEBT_TYPE_LABELS[String(row.debt_type)] || String(row.debt_type)}] ${String(row.description)}${promised}`,
      });
    }
    for (const row of hookRows) {
      const intensity = Number(row.intensity);
      const dueOrder = row.due_sort_order == null ? null : Number(row.due_sort_order);
      const isDueSoon = dueOrder !== null && dueOrder <= currentOrder + 2;
      const due = dueOrder === null ? '' : `（建议第 ${dueOrder} 章前推进）`;
      items.push({
        group: intensity >= 4 ? 1 : isDueSoon ? 2 : 3,
        order: intensity >= 4 ? -intensity : dueOrder ?? Number.MAX_SAFE_INTEGER,
        line: `- [叙事钩子·${HOOK_TYPE_LABELS[String(row.hook_type)] || String(row.hook_type)}·强度${intensity}] ${String(row.description)}${due}`,
      });
    }

    if (items.length === 0) return '';
    items.sort((left, right) => left.group - right.group || left.order - right.order);
    const budget = Number.isFinite(maxTokens) ? Math.max(0, Math.floor(maxTokens)) : 800;
    const lines = [
      '## 待推进的叙事钩子与债务',
      '以下内容来自当前项目已经提交的运行时状态，请优先推进逾期、高强度或临近到期项：',
    ];
    let context = truncateToTokenBudget(lines.join('\n'), budget);
    if (estimateNarrativeTokens(context) >= budget) return context;

    for (const item of items) {
      const candidate = `${context}\n${item.line}`;
      if (estimateNarrativeTokens(candidate) <= budget) {
        context = candidate;
        continue;
      }
      const prefix = `${context}\n`;
      const remaining = budget - estimateNarrativeTokens(prefix);
      if (remaining > 12) {
        const partial = truncateToTokenBudget(item.line, remaining);
        if (partial) context = `${prefix}${partial}`;
      }
      break;
    }
    return context;
  }

  // ── 私有方法 ──

  private rowToHook(row: Record<string, unknown>): NarrativeHook {
    return {
      id: row.id as string,
      projectId: row.project_id as string,
      chapterId: (row.chapter_id ?? null) as string | null,
      hookType: row.hook_type as NarrativeHook['hookType'],
      description: row.description as string,
      intensity: row.intensity as number,
      status: row.status as NarrativeHook['status'],
      resolvedInChapterId: (row.resolved_in_chapter_id ?? null) as string | null,
      dueChapterId: (row.due_chapter_id ?? null) as string | null,
      sourceDecisionId: (row.source_decision_id ?? null) as string | null,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  private rowToDebt(row: Record<string, unknown>): NarrativeDebt {
    return {
      id: row.id as string,
      projectId: row.project_id as string,
      chapterId: (row.chapter_id ?? null) as string | null,
      description: row.description as string,
      debtType: row.debt_type as NarrativeDebt['debtType'],
      promisedByChapter: (row.promised_by_chapter ?? null) as number | null,
      status: row.status as NarrativeDebt['status'],
      paidInChapterId: (row.paid_in_chapter_id ?? null) as string | null,
      sourceDecisionId: (row.source_decision_id ?? null) as string | null,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }
}

interface NarrativeContextItem {
  group: number;
  order: number;
  line: string;
}

function estimateNarrativeTokens(text: string): number {
  let cjk = 0;
  let other = 0;
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (
      (code >= 0x4E00 && code <= 0x9FFF)
      || (code >= 0x3400 && code <= 0x4DBF)
      || (code >= 0x20000 && code <= 0x2A6DF)
      || (code >= 0xF900 && code <= 0xFAFF)
      || (code >= 0x3040 && code <= 0x309F)
      || (code >= 0x30A0 && code <= 0x30FF)
    ) cjk += 1;
    else other += 1;
  }
  return Math.ceil(cjk / 1.5 + other / 4);
}

function truncateToTokenBudget(text: string, maxTokens: number): string {
  if (maxTokens <= 0) return '';
  if (estimateNarrativeTokens(text) <= maxTokens) return text;
  const characters = [...text];
  let low = 0;
  let high = characters.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (estimateNarrativeTokens(characters.slice(0, middle).join('')) <= maxTokens) low = middle;
    else high = middle - 1;
  }
  return characters.slice(0, low).join('');
}
