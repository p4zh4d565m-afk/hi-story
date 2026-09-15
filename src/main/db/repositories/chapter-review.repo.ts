import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import type {
  ChapterReviewRecord,
  ChapterRevisionProposal,
  IpcResult,
  ReviewDimension,
  ReviewIssue,
  ReviewExecutionStatus,
  ReviewGateStatus,
  ReviewDeliveryStatus,
} from '../../../renderer/types';

type RawRow = Record<string, unknown>;

/**
 * 审稿版本账本数据层（二期 / v23）。
 * 只管 SQL 读写；解析、聚合、世代判断、修订事务放在 chapter-review.service.ts。
 */
export class ChapterReviewRepo {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  // ── 世代读取 ──

  getContentGeneration(chapterId: string): number | null {
    const row = this.db.prepare(
      `SELECT content_generation as g FROM chapters WHERE id = ? AND deleted_at IS NULL`,
    ).get(chapterId) as { g: number } | undefined;
    return row ? row.g : null;
  }

  // ── 审稿行 ──

  insertReview(input: {
    projectId: string;
    chapterId: string;
    runId: string | null;
    sourceGeneration: number;
    promptVersion: string;
    providerName: string;
    modelName: string;
    executionStatus: ReviewExecutionStatus;
    qualityScore: number | null;
    coverage: number;
    gateStatus: ReviewGateStatus;
    deliveryStatus: ReviewDeliveryStatus;
    summary: string;
    dimensions: ReviewDimension[];
    issues: ReviewIssue[];
  }): string {
    const id = uuidv4();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO chapter_reviews (
        id, project_id, chapter_id, run_id, source_generation, prompt_version,
        provider_name, model_name, execution_status, quality_score, coverage,
        gate_status, delivery_status, summary, dimensions_json, issues_json, created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      id,
      input.projectId,
      input.chapterId,
      input.runId ?? null,
      input.sourceGeneration,
      input.promptVersion,
      input.providerName,
      input.modelName,
      input.executionStatus,
      input.qualityScore,
      input.coverage,
      input.gateStatus,
      input.deliveryStatus,
      input.summary,
      JSON.stringify(input.dimensions),
      JSON.stringify(input.issues),
      now,
    );
    return id;
  }

  findByChapter(chapterId: string): IpcResult<ChapterReviewRecord[]> {
    try {
      const rows = this.db.prepare(
        `SELECT * FROM chapter_reviews WHERE chapter_id = ? ORDER BY created_at DESC`,
      ).all(chapterId) as RawRow[];
      const currentGen = this.getContentGeneration(chapterId);
      return {
        success: true,
        data: rows.map((r) => this.rowToReview(r, currentGen)),
      };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  findById(reviewId: string): ChapterReviewRecord | null {
    const row = this.db.prepare(`SELECT * FROM chapter_reviews WHERE id = ?`).get(reviewId) as RawRow | undefined;
    if (!row) return null;
    return this.rowToReview(row, this.getContentGeneration(row.chapter_id as string));
  }

  private rowToReview(row: RawRow, currentGeneration: number | null): ChapterReviewRecord {
    const sourceGeneration = row.source_generation as number;
    const freshnessStatus = (currentGeneration !== null && sourceGeneration === currentGeneration)
      ? 'fresh' : 'stale';
    const deliveryStatus = row.delivery_status as ReviewDeliveryStatus;
    return {
      id: row.id as string,
      projectId: row.project_id as string,
      chapterId: row.chapter_id as string,
      runId: (row.run_id as string | null) ?? null,
      sourceGeneration,
      promptVersion: row.prompt_version as string,
      providerName: row.provider_name as string,
      modelName: row.model_name as string,
      executionStatus: row.execution_status as ReviewExecutionStatus,
      qualityScore: (row.quality_score as number | null) ?? null,
      coverage: row.coverage as number,
      gateStatus: row.gate_status as ReviewGateStatus,
      deliveryStatus,
      summary: row.summary as string,
      dimensions: this.parseJson(row.dimensions_json as string),
      issues: this.parseJson(row.issues_json as string),
      createdAt: row.created_at as string,
      freshnessStatus,
      effectiveDeliveryStatus: freshnessStatus === 'stale' ? 'stale' : deliveryStatus,
    };
  }

  private parseJson(s: string): any[] {
    try {
      const v = JSON.parse(s || '[]');
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }

  // ── 修订提案 ──

  insertProposal(input: {
    projectId: string;
    chapterId: string;
    reviewId: string;
    sourceGeneration: number;
    proposedContent: string;
  }): IpcResult<ChapterRevisionProposal> {
    const id = uuidv4();
    const now = new Date().toISOString();
    try {
      this.db.prepare(`
        INSERT INTO chapter_revision_proposals (
          id, project_id, chapter_id, review_id, source_generation, proposed_content,
          status, created_at, updated_at
        ) VALUES (?,?,?,?,?,?, 'proposed', ?, ?)
      `).run(
        id, input.projectId, input.chapterId, input.reviewId,
        input.sourceGeneration, input.proposedContent, now, now,
      );
      return this.findProposalById(id);
    } catch (err) {
      // 唯一索引冲突 → 同章已有 proposed
      return { success: false, error: `同章已存在待处理修订: ${(err as Error).message}` };
    }
  }

  findProposalById(id: string): IpcResult<ChapterRevisionProposal> {
    const row = this.db.prepare(
      `SELECT * FROM chapter_revision_proposals WHERE id = ?`,
    ).get(id) as RawRow | undefined;
    if (!row) return { success: false, error: '修订提案不存在' };
    return { success: true, data: this.rowToProposal(row) };
  }

  /** 同章唯一待处理修订（若有） */
  findPendingProposal(chapterId: string): ChapterRevisionProposal | null {
    const row = this.db.prepare(
      `SELECT * FROM chapter_revision_proposals WHERE chapter_id = ? AND status = 'proposed'`,
    ).get(chapterId) as RawRow | undefined;
    return row ? this.rowToProposal(row) : null;
  }

  /** 应用成功后把提案标 applied（写事务内调用，不做归属校验） */
  markProposalApplied(id: string, appliedGeneration: number): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE chapter_revision_proposals
      SET status = 'applied', applied_generation = ?, applied_at = ?, updated_at = ?
      WHERE id = ?
    `).run(appliedGeneration, now, now, id);
  }

  /** 应用时世代冲突：标 stale */
  markProposalStale(id: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE chapter_revision_proposals SET status = 'stale', updated_at = ? WHERE id = ?
    `).run(now, id);
  }

  /** 拒绝 */
  rejectProposal(id: string): IpcResult<void> {
    const now = new Date().toISOString();
    const res = this.db.prepare(`
      UPDATE chapter_revision_proposals SET status = 'rejected', updated_at = ? WHERE id = ? AND status = 'proposed'
    `).run(now, id);
    if (res.changes === 0) return { success: false, error: '修订提案不存在或已处理' };
    return { success: true };
  }

  /** 正文真变时作废同章所有 proposed（写事务内调用） */
  stalePendingProposals(chapterId: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE chapter_revision_proposals SET status = 'stale', updated_at = ?
      WHERE chapter_id = ? AND status = 'proposed'
    `).run(now, chapterId);
  }

  /** 是否存在「应用时确曾 +1」的修订：applied_generation === 当前世代 且 > source_generation */
  hasBumpedAppliedRevision(chapterId: string, generation: number): boolean {
    const row = this.db.prepare(
      `SELECT 1 FROM chapter_revision_proposals
       WHERE chapter_id = ? AND status = 'applied'
         AND applied_generation = ? AND applied_generation > source_generation
       LIMIT 1`,
    ).get(chapterId, generation);
    return Boolean(row);
  }

  private rowToProposal(row: RawRow): ChapterRevisionProposal {
    return {
      id: row.id as string,
      projectId: row.project_id as string,
      chapterId: row.chapter_id as string,
      reviewId: row.review_id as string,
      sourceGeneration: row.source_generation as number,
      proposedContent: row.proposed_content as string,
      status: row.status as ChapterRevisionProposal['status'],
      appliedGeneration: (row.applied_generation as number | null) ?? null,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
      appliedAt: (row.applied_at as string | null) ?? null,
    };
  }
}
