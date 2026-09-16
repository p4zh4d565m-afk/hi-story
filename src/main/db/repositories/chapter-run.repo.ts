import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import type { ChapterRun, ChapterRunStatus, IpcResult } from '../../../renderer/types';

type RawRow = Record<string, unknown>;

/**
 * 写章运行记录数据层（三期 / v24）。
 * 只管 SQL 读写；状态迁移、commit 幂等、启动恢复放在 chapter-run.service.ts。
 */
export class ChapterRunRepo {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  insert(input: {
    projectId: string;
    requestedTitle: string;
    providerName: string;
    modelName: string;
    inputSummary: string;
    sourceOutlineNodeId?: string | null;
    retryOfRunId?: string | null;
  }): string {
    const id = uuidv4();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO chapter_runs (
        id, project_id, retry_of_run_id, source_outline_node_id, requested_title,
        status, provider_name, model_name, input_summary, created_at, updated_at
      ) VALUES (?,?,?,?,?, 'running', ?,?,?,?,?)
    `).run(
      id,
      input.projectId,
      input.retryOfRunId ?? null,
      input.sourceOutlineNodeId ?? null,
      input.requestedTitle,
      input.providerName,
      input.modelName,
      input.inputSummary,
      now,
      now,
    );
    return id;
  }

  findById(id: string): ChapterRun | null {
    const row = this.db.prepare(`SELECT * FROM chapter_runs WHERE id = ?`).get(id) as RawRow | undefined;
    return row ? this.rowToRun(row) : null;
  }

  findByProject(projectId: string): IpcResult<ChapterRun[]> {
    try {
      const rows = this.db.prepare(
        `SELECT * FROM chapter_runs WHERE project_id = ? ORDER BY updated_at DESC`,
      ).all(projectId) as RawRow[];
      return { success: true, data: rows.map((r) => this.rowToRun(r)) };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  /** 某项目下所有仍为 running 的 run（启动恢复用） */
  findRunningByProject(projectId: string): ChapterRun[] {
    const rows = this.db.prepare(
      `SELECT * FROM chapter_runs WHERE project_id = ? AND status = 'running'`,
    ).all(projectId) as RawRow[];
    return rows.map((r) => this.rowToRun(r));
  }

  /** 全局所有仍为 running 的 run（启动恢复用，跨项目） */
  findAllRunning(): ChapterRun[] {
    const rows = this.db.prepare(`SELECT * FROM chapter_runs WHERE status = 'running'`).all() as RawRow[];
    return rows.map((r) => this.rowToRun(r));
  }

  /** 把 run 标为 drafted 并写入草稿 */
  markDrafted(id: string, draftContent: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE chapter_runs SET status = 'drafted', draft_content = ?, updated_at = ?, completed_at = ?
      WHERE id = ?
    `).run(draftContent, now, now, id);
  }

  /** 把 run 标为 cancelled */
  markCancelled(id: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE chapter_runs SET status = 'cancelled', cancel_requested = 1, updated_at = ?, completed_at = ?
      WHERE id = ?
    `).run(now, now, id);
  }

  /** 把 run 标为 failed（含错误码/信息） */
  markFailed(id: string, errorCode: string, errorMessage: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE chapter_runs SET status = 'failed', error_code = ?, error_message = ?, updated_at = ?, completed_at = ?
      WHERE id = ?
    `).run(errorCode, errorMessage, now, now, id);
  }

  /** 把 run 标为 committed 并绑定章节 id */
  markCommitted(id: string, targetChapterId: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE chapter_runs SET status = 'committed', target_chapter_id = ?, updated_at = ?, completed_at = ?
      WHERE id = ?
    `).run(targetChapterId, now, now, id);
  }

  /** 更新抽取状态 */
  setExtractStatus(id: string, extractStatus: ChapterRun['extractStatus']): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE chapter_runs SET extract_status = ?, updated_at = ? WHERE id = ?
    `).run(extractStatus, now, id);
  }

  /** 写 cancel_requested 标记（停止时先标，再 abort） */
  setCancelRequested(id: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE chapter_runs SET cancel_requested = 1, updated_at = ? WHERE id = ?
    `).run(now, id);
  }

  private rowToRun(row: RawRow): ChapterRun {
    return {
      id: row.id as string,
      projectId: row.project_id as string,
      retryOfRunId: (row.retry_of_run_id as string | null) ?? null,
      sourceOutlineNodeId: (row.source_outline_node_id as string | null) ?? null,
      targetChapterId: (row.target_chapter_id as string | null) ?? null,
      requestedTitle: row.requested_title as string,
      status: row.status as ChapterRunStatus,
      cancelRequested: (row.cancel_requested as number) === 1 ? 1 : 0,
      providerName: row.provider_name as string,
      modelName: row.model_name as string,
      inputSummary: row.input_summary as string,
      draftContent: (row.draft_content as string | null) ?? null,
      extractStatus: row.extract_status as ChapterRun['extractStatus'],
      errorCode: (row.error_code as string | null) ?? null,
      errorMessage: (row.error_message as string | null) ?? null,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
      completedAt: (row.completed_at as string | null) ?? null,
    };
  }
}
