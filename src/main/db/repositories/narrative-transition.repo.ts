/**
 * 叙事转换日志仓储：追加不可变转换行（完整 after_snapshot）。
 */
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { IpcResult } from '../../../renderer/types';
import {
  type Snapshot,
  type Transition,
  defaultOrdinalForAppend,
} from '../../ai/narrative-state-reducer';
import type { ChapterAlias } from '../../ai/narrative-time-order';

export type TransitionTargetTable =
  | 'story_facts'
  | 'character_knowledge'
  | 'narrative_hooks'
  | 'narrative_debts';

export type TransitionKind = Transition['kind'];

export interface AppendTransitionInput {
  projectId: string;
  targetTable: TransitionTargetTable;
  targetId: string;
  kind: TransitionKind;
  atChapterId: string;
  atChapterOrdinal?: number;
  afterSnapshot: Snapshot;
  decisionId?: string | null;
  /** 同事务内已追加、尚未可见于 DB 的转换（用于 ordinal/seq） */
  pendingInTx?: Transition[];
}

const SNAPSHOT_SCHEMA_VERSION = 1;
const TABLES = new Set<TransitionTargetTable>([
  'story_facts', 'character_knowledge', 'narrative_hooks', 'narrative_debts',
]);

export function makeSnapshot(data: unknown, schemaVersion = SNAPSHOT_SCHEMA_VERSION): Snapshot {
  return { schemaVersion, data };
}

export class NarrativeTransitionRepo {
  constructor(private db: Database.Database) {}

  /** 读取某目标的全部转换（故事比较由调用方完成） */
  listByTarget(
    projectId: string,
    targetTable: TransitionTargetTable,
    targetId: string,
  ): Transition[] {
    const rows = this.db.prepare(`
      SELECT * FROM narrative_transitions
      WHERE project_id = ? AND target_table = ? AND target_id = ?
      ORDER BY at_chapter_ordinal ASC, transition_seq ASC
    `).all(projectId, targetTable, targetId) as Record<string, unknown>[];
    return rows.map((r) => this.rowToTransition(r));
  }

  listByProject(projectId: string): Transition[] {
    const rows = this.db.prepare(`
      SELECT * FROM narrative_transitions WHERE project_id = ?
    `).all(projectId) as Record<string, unknown>[];
    return rows.map((r) => this.rowToTransition(r));
  }

  listAliases(_projectId: string): ChapterAlias[] {
    // 本轮 alias 表保持为空；预留按项目过滤（当前无 project_id 列）
    const rows = this.db.prepare(`SELECT from_chapter_id, to_chapter_id, ordinal_offset FROM chapter_alias`).all() as Array<{
      from_chapter_id: string;
      to_chapter_id: string;
      ordinal_offset: number;
    }>;
    return rows.map((r) => ({
      from: r.from_chapter_id,
      to: r.to_chapter_id,
      ordinalOffset: r.ordinal_offset,
    }));
  }

  /**
   * 追加转换。若未传 ordinal，按本章已有（含 pending）有效序号 + 1。
   * 必须在外层写事务内调用。
   */
  append(input: AppendTransitionInput): IpcResult<Transition> {
    try {
      this.assertProjectOwnership(input);
      this.assertSnapshot(input.afterSnapshot);

      const aliases = this.listAliases(input.projectId);
      const existing = [
        ...this.listByTarget(input.projectId, input.targetTable, input.targetId),
        ...(input.pendingInTx ?? []),
      ];
      // 同章全部转换用于 append 序号（不限同一 target）
      const sameChapter = this.db.prepare(`
        SELECT * FROM narrative_transitions WHERE project_id = ? AND at_chapter_id = ?
      `).all(input.projectId, input.atChapterId) as Record<string, unknown>[];
      const chapterTransitions = [
        ...sameChapter.map((r) => this.rowToTransition(r)),
        ...(input.pendingInTx ?? []).filter((t) => t.atChapterId === input.atChapterId),
      ];

      const ordinal =
        input.atChapterOrdinal ??
        defaultOrdinalForAppend(chapterTransitions, input.atChapterId, aliases);

      const maxSeqRow = this.db.prepare(`
        SELECT COALESCE(MAX(transition_seq), -1) as m FROM narrative_transitions
        WHERE project_id = ? AND at_chapter_id = ? AND at_chapter_ordinal = ?
      `).get(input.projectId, input.atChapterId, ordinal) as { m: number };
      const pendingSeq = (input.pendingInTx ?? [])
        .filter((t) => t.atChapterId === input.atChapterId && t.atChapterOrdinal === ordinal)
        .reduce((max, t) => Math.max(max, t.seq), -1);
      const seq = Math.max(maxSeqRow.m, pendingSeq) + 1;

      if (input.afterSnapshot.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
        throw new Error(`未知快照版本: ${input.afterSnapshot.schemaVersion}`);
      }

      const id = randomUUID();
      const now = new Date().toISOString();
      this.db.prepare(`
        INSERT INTO narrative_transitions (
          id, project_id, target_table, target_id, kind,
          at_chapter_id, at_chapter_ordinal, transition_seq,
          after_snapshot, decision_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        input.projectId,
        input.targetTable,
        input.targetId,
        input.kind,
        input.atChapterId,
        ordinal,
        seq,
        JSON.stringify(input.afterSnapshot),
        input.decisionId ?? null,
        now,
      );

      void existing;
      return {
        success: true,
        data: {
          targetId: input.targetId,
          kind: input.kind,
          atChapterId: input.atChapterId,
          atChapterOrdinal: ordinal,
          seq,
          afterSnapshot: input.afterSnapshot,
          decisionId: input.decisionId ?? undefined,
        },
      };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  private assertProjectOwnership(input: AppendTransitionInput): void {
    const project = this.db.prepare(`SELECT id FROM projects WHERE id = ?`).get(input.projectId);
    if (!project) throw new Error('项目不存在');

    const chapter = this.db.prepare(
      `SELECT project_id FROM chapters WHERE id = ?`,
    ).get(input.atChapterId) as { project_id: string } | undefined;
    if (!chapter) throw new Error('锚点章节不存在');
    if (chapter.project_id !== input.projectId) throw new Error('转换锚点跨项目');

    if (!TABLES.has(input.targetTable)) throw new Error('未知目标表');
    const target = this.db.prepare(
      `SELECT project_id FROM ${input.targetTable} WHERE id = ?`,
    ).get(input.targetId) as { project_id: string } | undefined;
    if (!target) throw new Error('目标记录不存在');
    if (target.project_id !== input.projectId) throw new Error('转换目标跨项目');

    if (input.decisionId) {
      const decision = this.db.prepare(
        `SELECT project_id FROM creative_decisions WHERE id = ?`,
      ).get(input.decisionId) as { project_id: string } | undefined;
      if (!decision) throw new Error('决策不存在');
      if (decision.project_id !== input.projectId) throw new Error('决策跨项目');
    }
  }

  private assertSnapshot(snapshot: Snapshot): void {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      throw new Error('转换快照格式无效');
    }
    if (snapshot.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
      throw new Error(`未知快照版本: ${snapshot.schemaVersion}`);
    }
    if (!('data' in snapshot)) throw new Error('转换快照缺少 data');
  }

  private parseSnapshot(raw: unknown): Snapshot {
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(raw));
    } catch {
      throw new Error('转换快照不是合法 JSON');
    }
    this.assertSnapshot(parsed as Snapshot);
    return parsed as Snapshot;
  }

  private rowToTransition(row: Record<string, unknown>): Transition {
    const afterSnapshot = this.parseSnapshot(row.after_snapshot);
    return {
      targetId: row.target_id as string,
      kind: row.kind as TransitionKind,
      atChapterId: row.at_chapter_id as string,
      atChapterOrdinal: row.at_chapter_ordinal as number,
      seq: row.transition_seq as number,
      afterSnapshot,
      decisionId: (row.decision_id as string | null) ?? undefined,
    };
  }
}
