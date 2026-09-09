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
      SELECT * FROM narrative_debts WHERE project_id = ? AND status = 'unpaid' ORDER BY created_at ASC
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

  /** 生成待回收钩子 + 未偿债务的文字上下文 */
  getHooksAndDebtsContext(projectId: string): string {
    const hooks = this.findOpenHooks(projectId);
    const debts = this.findUnpaidDebts(projectId);

    const parts: string[] = [];

    if (hooks.success && hooks.data && hooks.data.length > 0) {
      parts.push('## 🪝 待回收的叙事钩子');
      parts.push('以下是尚未解决的悬念和伏笔，写新章时请考虑推进或回收：\n');
      const highHooks = hooks.data.filter(h => h.intensity >= 4);
      const normalHooks = hooks.data.filter(h => h.intensity < 4);
      if (highHooks.length > 0) {
        parts.push('### 🔴 高强度钩子（优先回收）');
        for (const h of highHooks.slice(0, 5)) {
          parts.push(`- [${HOOK_TYPE_LABELS[h.hookType] || h.hookType}] ${h.description}`);
        }
      }
      if (normalHooks.length > 0) {
        parts.push('### 🟡 一般钩子');
        for (const h of normalHooks.slice(0, 8)) {
          parts.push(`- [${HOOK_TYPE_LABELS[h.hookType] || h.hookType}] ${h.description}`);
        }
        if (normalHooks.length > 8) {
          parts.push(`  *(还有 ${normalHooks.length - 8} 个钩子，已省略)*`);
        }
      }
      parts.push('');
    }

    if (debts.success && debts.data && debts.data.length > 0) {
      parts.push('## ⚠️ 未偿还的叙事债务');
      parts.push('以下是对读者的承诺尚未兑现，请在新章节中考虑回收：\n');
      for (const d of debts.data.slice(0, 8)) {
        const promised = d.promisedByChapter ? `（承诺在第 ${d.promisedByChapter} 章前）` : '';
        parts.push(`- [${DEBT_TYPE_LABELS[d.debtType] || d.debtType}] ${d.description} ${promised}`);
      }
      if (debts.data.length > 8) {
        parts.push(`  *(还有 ${debts.data.length - 8} 笔债务，已省略)*`);
      }
      parts.push('');
    }

    return parts.join('\n');
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
