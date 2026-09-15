import Database from 'better-sqlite3';
import type {
  IpcResult,
  ReviewDimension,
  ReviewIssue,
  ReviewGateStatus,
  ReviewDeliveryStatus,
  ChapterRevisionProposal,
} from '../../../renderer/types';
import { ChapterReviewRepo } from './chapter-review.repo';
import { ChapterHistoryRepo } from './chapter.repo';
import { shouldBumpContentGeneration } from '../../ai/content-revision';

const TOTAL_DIMENSIONS = 15;
const VALID_DIMENSION_IDS = new Set(Array.from({ length: TOTAL_DIMENSIONS }, (_, i) => i + 1));
const COVERAGE_THRESHOLD = 12; // 有效维度 ≥ 12 才算完整
const QUALITY_THRESHOLD = 70;

export type AggregationResult = {
  qualityScore: number | null;
  coverage: number;
  gateStatus: ReviewGateStatus;
  deliveryStatus: ReviewDeliveryStatus;
};

/**
 * 审稿解析与聚合（纯函数，主进程与测试共用）。
 * 解析失败抛出 Error；调用方据此落 failed 行。
 */
export function parseReviewResponse(raw: string): { summary: string; dimensions: ReviewDimension[]; issues: ReviewIssue[] } {
  let jsonStr = raw.trim();
  if (jsonStr.startsWith('```json')) jsonStr = jsonStr.slice(7);
  if (jsonStr.startsWith('```')) jsonStr = jsonStr.slice(3);
  if (jsonStr.endsWith('```')) jsonStr = jsonStr.slice(0, -3);
  jsonStr = jsonStr.trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error('AI 返回非 JSON');
  }

  const obj = parsed as Record<string, unknown>;
  if (!obj || typeof obj.summary !== 'string' || !Array.isArray(obj.dimensions) || !Array.isArray(obj.issues)) {
    throw new Error('审稿结构不完整（缺 summary/dimensions/issues）');
  }

  const rawDimensions = obj.dimensions as unknown[];
  // 完整性校验：必须恰好 15 个维度，且 id 集合恰好为 1..15（不缺、不重复）
  if (rawDimensions.length !== TOTAL_DIMENSIONS) {
    throw new Error(`维度数量必须是 ${TOTAL_DIMENSIONS} 个，实际 ${rawDimensions.length}`);
  }
  const seenIds = new Set<number>();
  for (const d of rawDimensions) {
    const id = (d as Record<string, unknown>)?.id;
    if (typeof id !== 'number' || !VALID_DIMENSION_IDS.has(id)) {
      throw new Error(`维度 id 非法: ${String(id)}`);
    }
    if (seenIds.has(id)) throw new Error(`维度 id 重复: ${id}`);
    seenIds.add(id);
  }

  const dimensions = rawDimensions.map((d, i) => parseDimension(d, i));
  const issues = (obj.issues as unknown[]).map((iss, i) => parseIssue(iss, i));

  return { summary: obj.summary, dimensions, issues };
}

function parseDimension(d: unknown, index: number): ReviewDimension {
  if (!d || typeof d !== 'object') throw new Error(`维度[${index}]不是对象`);
  const o = d as Record<string, unknown>;
  const id = o.id as number;
  if (typeof id !== 'number' || !VALID_DIMENSION_IDS.has(id)) {
    throw new Error(`维度[${index}] id 非法或重复: ${String(o.id)}`);
  }
  const status = o.status as string;
  if (status !== 'pass' && status !== 'issue' && status !== 'inconclusive') {
    throw new Error(`维度[${index}] status 非法: ${status}`);
  }
  const score = o.score;
  if (status === 'inconclusive') {
    if (score !== null && score !== undefined) throw new Error(`维度[${index}] inconclusive 不得带分数`);
  } else {
    if (typeof score !== 'number') throw new Error(`维度[${index}] pass/issue 必须带数值 score`);
  }
  const evidence = o.evidence;
  if (!Array.isArray(evidence)) throw new Error(`维度[${index}] evidence 必须是数组`);
  if (status === 'issue' && evidence.length === 0) throw new Error(`维度[${index}] issue 必须有 evidence`);

  return {
    id,
    name: String(o.name ?? ''),
    status,
    score: status === 'inconclusive' ? null : (score as number),
    comment: String(o.comment ?? ''),
    evidence: evidence.map(String),
  };
}

function parseIssue(iss: unknown, index: number): ReviewIssue {
  if (!iss || typeof iss !== 'object') throw new Error(`issue[${index}]不是对象`);
  const o = iss as Record<string, unknown>;
  const severity = o.severity as string;
  if (severity !== 'critical' && severity !== 'warning' && severity !== 'info') {
    throw new Error(`issue[${index}] severity 非法: ${severity}`);
  }
  return {
    severity,
    dimensionId: Number(o.dimensionId),
    location: String(o.location ?? ''),
    description: String(o.description ?? ''),
    suggestion: String(o.suggestion ?? ''),
  };
}

/**
 * 聚合固定规则。
 * 调用前提：dimensions 已通过 parseReviewResponse 校验（15 个 id 齐全）。
 */
export function aggregateReview(dimensions: ReviewDimension[], issues: ReviewIssue[]): AggregationResult {
  // 完整性兜底：即使上游漏了维度，也按实际数量计算覆盖率，绝不补假维度
  const seen = new Set<number>();
  for (const d of dimensions) seen.add(d.id);
  const valid = dimensions.filter((d) => d.status === 'pass' || d.status === 'issue');
  const coverage = valid.length / TOTAL_DIMENSIONS;
  const scores = valid.map((d) => d.score as number);
  const qualityScore = scores.length > 0
    ? scores.reduce((a, b) => a + b, 0) / scores.length
    : null;

  const hasCritical = issues.some((i) => i.severity === 'critical');

  let gateStatus: ReviewGateStatus;
  let deliveryStatus: ReviewDeliveryStatus;

  if (hasCritical) {
    gateStatus = 'blocked';
    deliveryStatus = 'blocked';
  } else if (valid.length < COVERAGE_THRESHOLD) {
    gateStatus = 'inconclusive';
    deliveryStatus = 'inconclusive';
  } else if (qualityScore !== null && qualityScore >= QUALITY_THRESHOLD) {
    gateStatus = 'pass';
    deliveryStatus = 'pass';
  } else {
    gateStatus = 'pass';
    deliveryStatus = 'revise';
  }

  return { qualityScore, coverage, gateStatus, deliveryStatus };
}

/**
 * 应用修订：单写事务。
 * 世代冲突 → 提案标 stale，返回 REVISION_SOURCE_STALE；成功 → 打快照 + 写正文 + 世代 +1（若真变）+ 标 applied。
 */
export function applyRevision(
  db: Database.Database,
  repo: ChapterReviewRepo,
  proposalId: string,
  expectedProjectId: string,
): IpcResult<{ chapterId: string; content: string; wordCount: number; contentGeneration: number }> {
  // 预检（事务外）：世代冲突 → 标 stale 并返回，标 stale 必须持久化、不能被事务回滚
  const row = db.prepare(
    `SELECT * FROM chapter_revision_proposals WHERE id = ?`,
  ).get(proposalId) as Record<string, unknown> | undefined;
  if (!row) return { success: false, error: '修订提案不存在' };
  if (row.project_id !== expectedProjectId) return { success: false, error: '修订提案不属于当前项目' };
  if (row.status !== 'proposed') return { success: false, error: '修订提案已处理' };

  const chapterId = row.chapter_id as string;
  const sourceGeneration = row.source_generation as number;
  const proposedContent = row.proposed_content as string;

  const currentGen = repo.getContentGeneration(chapterId);
  if (currentGen === null) return { success: false, error: '章节不存在' };
  if (currentGen !== sourceGeneration) {
    repo.markProposalStale(proposalId); // 持久化标 stale（不在事务内，不回滚）
    return { success: false, error: 'REVISION_SOURCE_STALE' };
  }

  const tx = db.transaction((): { chapterId: string; content: string; wordCount: number; contentGeneration: number } => {
    const chapter = db.prepare(
      `SELECT content, word_count, content_generation FROM chapters WHERE id = ? AND deleted_at IS NULL`,
    ).get(chapterId) as { content: string; word_count: number; content_generation: number } | undefined;
    if (!chapter) throw new Error('章节不存在');

    // 打历史快照（可回退）
    ChapterHistoryRepo.addSnapshot(db, chapterId, chapter.content, chapter.word_count);

    const bumped = shouldBumpContentGeneration(chapter.content, proposedContent);
    const wordCount = proposedContent.replace(/<[^>]*>/g, '').replace(/\s+/g, '').length;
    const now = new Date().toISOString();

    if (bumped) {
      db.prepare(`
        UPDATE chapters SET content = ?, word_count = ?, content_generation = content_generation + 1, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL
      `).run(proposedContent, wordCount, now, chapterId);
    } else {
      db.prepare(`
        UPDATE chapters SET content = ?, word_count = ?, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL
      `).run(proposedContent, wordCount, now, chapterId);
    }

    const nextGen = (db.prepare(
      `SELECT content_generation as g FROM chapters WHERE id = ?`,
    ).get(chapterId) as { g: number }).g;

    repo.markProposalApplied(proposalId, nextGen);

    return { chapterId, content: proposedContent, wordCount, contentGeneration: nextGen };
  });

  try {
    const result = tx();
    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}
