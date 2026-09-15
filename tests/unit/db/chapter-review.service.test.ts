import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../../src/main/db/migrations';
import { ChapterReviewRepo } from '../../../src/main/db/repositories/chapter-review.repo';
import {
  parseReviewResponse,
  aggregateReview,
  applyRevision,
} from '../../../src/main/db/repositories/chapter-review.service';

function makeValidDimensions(): Array<Record<string, unknown>> {
  // 15 个维度全 pass，score 85
  return Array.from({ length: 15 }, (_, i) => ({
    id: i + 1, name: `维度${i + 1}`, status: 'pass', score: 85, comment: 'ok', evidence: [],
  }));
}

describe('parseReviewResponse — 三态解析', () => {
  it('15 维度齐全通过', () => {
    const raw = JSON.stringify({
      summary: '整体不错',
      dimensions: makeValidDimensions(),
      issues: [],
    });
    const { dimensions, issues } = parseReviewResponse(raw);
    expect(dimensions).toHaveLength(15);
    expect(issues).toHaveLength(0);
  });

  it('inconclusive 带分数 → 抛错', () => {
    const dims = makeValidDimensions();
    dims[0] = { id: 1, name: '角色OOC', status: 'inconclusive', score: 80, comment: 'x', evidence: [] };
    const raw = JSON.stringify({ summary: 'x', dimensions: dims, issues: [] });
    expect(() => parseReviewResponse(raw)).toThrow(/inconclusive 不得带分数/);
  });

  it('issue 无 evidence → 抛错', () => {
    const dims = makeValidDimensions();
    dims[0] = { id: 1, name: '角色OOC', status: 'issue', score: 40, comment: 'x', evidence: [] };
    const raw = JSON.stringify({ summary: 'x', dimensions: dims, issues: [] });
    expect(() => parseReviewResponse(raw)).toThrow(/issue 必须有 evidence/);
  });

  it('缺失维度 → 抛错（非 15 个）', () => {
    const dims = makeValidDimensions().slice(0, 14);
    const raw = JSON.stringify({ summary: 'x', dimensions: dims, issues: [] });
    expect(() => parseReviewResponse(raw)).toThrow(/维度数量必须是 15 个/);
  });

  it('非法 severity → 抛错', () => {
    const raw = JSON.stringify({
      summary: 'x',
      dimensions: makeValidDimensions(),
      issues: [{ severity: 'fatal', dimensionId: 1, location: '', description: '', suggestion: '' }],
    });
    expect(() => parseReviewResponse(raw)).toThrow(/severity 非法/);
  });
});

describe('aggregateReview — 固定聚合规则', () => {
  function dims(n: number): ReturnType<typeof parseReviewResponse>['dimensions'] {
    const d = makeValidDimensions().map((x) => ({
      id: x.id as number, name: x.name as string, status: x.status as 'pass', score: x.score as number, comment: '', evidence: [] as string[],
    }));
    for (let i = n; i < 15; i++) d[i] = { id: i + 1, name: `维度${i + 1}`, status: 'inconclusive', score: null, comment: '', evidence: [] };
    return d;
  }

  it('15 有效且 85 分 → pass/pass', () => {
    const r = aggregateReview(dims(15), []);
    expect(r.coverage).toBe(1);
    expect(r.qualityScore).toBe(85);
    expect(r.gateStatus).toBe('pass');
    expect(r.deliveryStatus).toBe('pass');
  });

  it('12 有效且 70 分 → pass/pass', () => {
    const d = dims(12);
    for (let i = 0; i < 12; i++) d[i] = { ...d[i], score: 70 };
    const r = aggregateReview(d, []);
    expect(r.gateStatus).toBe('pass');
    expect(r.deliveryStatus).toBe('pass');
  });

  it('12 有效且 69.99 分 → pass/revise', () => {
    const d = dims(12);
    for (let i = 0; i < 12; i++) d[i] = { ...d[i], score: 69.99 };
    const r = aggregateReview(d, []);
    expect(r.gateStatus).toBe('pass');
    expect(r.deliveryStatus).toBe('revise');
  });

  it('11 有效 → inconclusive/inconclusive', () => {
    const r = aggregateReview(dims(11), []);
    expect(r.coverage).toBe(11 / 15);
    expect(r.gateStatus).toBe('inconclusive');
    expect(r.deliveryStatus).toBe('inconclusive');
  });

  it('critical → blocked/blocked', () => {
    const r = aggregateReview(dims(15), [
      { severity: 'critical', dimensionId: 1, location: 'x', description: 'd', suggestion: 's' },
    ]);
    expect(r.gateStatus).toBe('blocked');
    expect(r.deliveryStatus).toBe('blocked');
  });
});

describe('applyRevision — 修订应用事务', () => {
  let db: Database.Database;
  let repo: ChapterReviewRepo;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO projects (id, name, type_tags, style, summary, created_at, updated_at) VALUES ('p1','t','[]','','',?,?)`,
    ).run(now, now);
    repo = new ChapterReviewRepo(db);
  });

  afterEach(() => {
    db.close();
  });

  function seedChapter(content: string): string {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO chapters (id, project_id, title, content, status, word_count, sort_order, summary, planning_outline, content_generation, created_at, updated_at)
       VALUES ('c1','p1','章',?,'draft',0,0,'','',1,?,?)`,
    ).run(content, now, now);
    return 'c1';
  }

  function seedProposal(sourceGeneration: number, proposedContent: string): string {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO chapter_reviews (id, project_id, chapter_id, source_generation, prompt_version, execution_status, coverage, gate_status, delivery_status, created_at)
       VALUES ('r1','p1','c1',1,'review-v2','completed',1,'pass','pass',?)`,
    ).run(now);
    db.prepare(
      `INSERT INTO chapter_revision_proposals (id, project_id, chapter_id, review_id, source_generation, proposed_content, status, created_at, updated_at)
       VALUES ('pr1','p1','c1','r1',?,?,'proposed',?,?)`,
    ).run(sourceGeneration, proposedContent, now, now);
    return 'pr1';
  }

  it('世代匹配 → 应用成功 + 写历史 + 世代 +1', () => {
    seedChapter('<p>甲</p>');
    seedProposal(1, '<p>乙</p>');
    const res = applyRevision(db, repo, 'pr1', 'p1');
    expect(res.success).toBe(true);
    expect(res.data?.content).toBe('<p>乙</p>');
    expect(res.data?.contentGeneration).toBe(2);
    // 历史快照写入
    const hist = db.prepare(`SELECT content FROM chapter_history WHERE chapter_id = 'c1'`).get() as { content: string };
    expect(hist.content).toBe('<p>甲</p>');
    // 提案 applied
    const pr = db.prepare(`SELECT status FROM chapter_revision_proposals WHERE id = 'pr1'`).get() as { status: string };
    expect(pr.status).toBe('applied');
  });

  it('世代变化 → 提案 stale + 正文不动', () => {
    seedChapter('<p>甲</p>');
    seedProposal(1, '<p>乙</p>');
    // 作者先改字，使世代变 2
    db.prepare(`UPDATE chapters SET content = '<p>丙</p>', content_generation = 2 WHERE id = 'c1'`).run();

    const res = applyRevision(db, repo, 'pr1', 'p1');
    expect(res.success).toBe(false);
    expect(res.error).toBe('REVISION_SOURCE_STALE');
    const pr = db.prepare(`SELECT status FROM chapter_revision_proposals WHERE id = 'pr1'`).get() as { status: string };
    expect(pr.status).toBe('stale');
    const ch = db.prepare(`SELECT content, content_generation FROM chapters WHERE id = 'c1'`).get() as { content: string; content_generation: number };
    expect(ch.content).toBe('<p>丙</p>');
    expect(ch.content_generation).toBe(2);
  });

  it('世代 +0 极端（修订稿与当前纯文本相同）→ 不递增但仍 applied', () => {
    seedChapter('<p>甲</p>');
    seedProposal(1, '<p>甲</p><p></p>'); // 等价 HTML
    const res = applyRevision(db, repo, 'pr1', 'p1');
    expect(res.success).toBe(true);
    expect(res.data?.contentGeneration).toBe(1); // 不 +1
    const pr = db.prepare(`SELECT status FROM chapter_revision_proposals WHERE id = 'pr1'`).get() as { status: string };
    expect(pr.status).toBe('applied');
  });

  it('hasAppliedRevisionAtGeneration 只匹配应用到指定世代的修订', () => {
    seedChapter('<p>甲</p>');
    seedProposal(1, '<p>乙</p>');
    // 应用到世代 2
    const res = applyRevision(db, repo, 'pr1', 'p1');
    expect(res.success).toBe(true);
    expect(res.data?.contentGeneration).toBe(2);
    // 应用到世代 2 → 匹配
    expect(repo.hasAppliedRevisionAtGeneration('c1', 2)).toBe(true);
    // 世代 1 不再匹配（应用后世代已 +1）
    expect(repo.hasAppliedRevisionAtGeneration('c1', 1)).toBe(false);
  });
});
