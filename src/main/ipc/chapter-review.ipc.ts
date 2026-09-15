import { ipcMain } from 'electron';
import { ProviderFactory } from '../ai/provider-factory';
import type { ChatMessage, ProviderConfig } from '../ai/provider';
import { streamRegistry } from '../ai/stream-registry';
import { normalizeStreamProjectId } from '../ai/stream-project-id';
import { getDb } from '../db/connection';
import { ChapterReviewRepo } from '../db/repositories/chapter-review.repo';
import {
  parseReviewResponse,
  aggregateReview,
  applyRevision,
} from '../db/repositories/chapter-review.service';
import type { IpcResult, ChapterReviewRunResult } from '../../renderer/types';

/** 同章进行中的 run 互斥（进程内；process 重启自动清空） */
const runningByChapter = new Map<string, string>(); // chapterId -> streamId

function getRepo(): ChapterReviewRepo {
  return new ChapterReviewRepo(getDb());
}

export function registerChapterReviewIpc(): void {
  // ===== 运行审稿（await 到终态；可取消） =====
  ipcMain.handle(
    'workflow:chapterReview:run',
    async (event, input: {
      projectId: string;
      chapterId: string;
      messages: ChatMessage[];
      providerConfig: ProviderConfig;
      sourceGeneration: number;
      promptVersion: string;
    }): Promise<IpcResult<ChapterReviewRunResult>> => {
      const pid = normalizeStreamProjectId(input.projectId);
      const repo = getRepo();
      const providerName = input.providerConfig.name;
      const modelName = input.providerConfig.model;

      // ① 开请求前：同章已有进行中的 run → stale（归 REVIEW_SOURCE_STALE）
      if (runningByChapter.has(input.chapterId)) {
        return { success: true, data: { reviewId: null, executionStatus: 'stale' } };
      }

      // ② 开请求前：世代校验
      const gen = repo.getContentGeneration(input.chapterId);
      if (gen === null) return { success: false, error: '章节不存在' };
      if (gen !== input.sourceGeneration) {
        return { success: true, data: { reviewId: null, executionStatus: 'stale' } };
      }

      const controller = new AbortController();
      const streamId = `review_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const sender = event.sender;

      streamRegistry.register(streamId, {
        controller,
        senderId: sender.id,
        projectId: pid,
        runId: undefined,
        terminal: false,
      });
      runningByChapter.set(input.chapterId, streamId);

      // 先发 started，供渲染端拿 streamId 另开 cancelStream
      if (!sender.isDestroyed()) {
        sender.send('workflow:chapterReview:started', { streamId, projectId: pid, chapterId: input.chapterId });
      }

      const finish = (): void => {
        streamRegistry.remove(streamId);
        if (runningByChapter.get(input.chapterId) === streamId) {
          runningByChapter.delete(input.chapterId);
        }
      };

      try {
        const provider = ProviderFactory.create(input.providerConfig);
        const raw = await provider.chat(input.messages, {
          signal: controller.signal,
          temperature: 0.3,
          maxTokens: 4096,
        });

        // ③ 落 completed 前再校验世代（请求期间正文可能被改）
        const genAfter = repo.getContentGeneration(input.chapterId);
        if (genAfter === null || genAfter !== input.sourceGeneration) {
          return { success: true, data: { reviewId: null, executionStatus: 'stale' } };
        }

        const parsed = parseReviewResponse(raw);
        const agg = aggregateReview(parsed.dimensions, parsed.issues);

        const reviewId = repo.insertReview({
          projectId: pid,
          chapterId: input.chapterId,
          runId: null,
          sourceGeneration: input.sourceGeneration,
          promptVersion: input.promptVersion,
          providerName,
          modelName,
          executionStatus: 'completed',
          qualityScore: agg.qualityScore,
          coverage: agg.coverage,
          gateStatus: agg.gateStatus,
          deliveryStatus: agg.deliveryStatus,
          summary: parsed.summary,
          dimensions: parsed.dimensions,
          issues: parsed.issues,
        });

        return { success: true, data: { reviewId, executionStatus: 'completed' } };
      } catch (err) {
        const message = (err as Error).message;
        // 用户取消 → 落 cancelled 行（非空 reviewId）
        if (message === 'AI_STREAM_CANCELLED' || controller.signal.aborted) {
          const reviewId = repo.insertReview({
            projectId: pid,
            chapterId: input.chapterId,
            runId: null,
            sourceGeneration: input.sourceGeneration,
            promptVersion: input.promptVersion,
            providerName,
            modelName,
            executionStatus: 'cancelled',
            qualityScore: null,
            coverage: 0,
            gateStatus: 'inconclusive',
            deliveryStatus: 'inconclusive',
            summary: '已取消',
            dimensions: [],
            issues: [],
          });
          return { success: true, data: { reviewId, executionStatus: 'cancelled' } };
        }
        // 请求失败或解析失败 → 落 failed 行（非空 reviewId）
        const reviewId = repo.insertReview({
          projectId: pid,
          chapterId: input.chapterId,
          runId: null,
          sourceGeneration: input.sourceGeneration,
          promptVersion: input.promptVersion,
          providerName,
          modelName,
          executionStatus: 'failed',
          qualityScore: null,
          coverage: 0,
          gateStatus: 'inconclusive',
          deliveryStatus: 'inconclusive',
          summary: message,
          dimensions: [],
          issues: [],
        });
        return { success: true, data: { reviewId, executionStatus: 'failed' } };
      } finally {
        finish();
      }
    },
  );

  // ===== 列出某章审稿（含动态新鲜度 / 待复评） =====
  ipcMain.handle('workflow:chapterReview:list', (_event, chapterId: string): IpcResult<unknown> => {
    const repo = getRepo();
    const res = repo.findByChapter(chapterId);
    if (!res.success) return res;
    const records = res.data!;
    // 待复评：存在 applied 修订，且当前世代尚无 fresh + pass + completed 的审稿
    const currentGen = repo.getContentGeneration(chapterId);
    const hasFreshPassing = records.some(
      (r) => r.freshnessStatus === 'fresh' && r.executionStatus === 'completed' && r.deliveryStatus === 'pass',
    );
    const hasAppliedRevision = ((): boolean => {
      const row = getDb().prepare(
        `SELECT 1 FROM chapter_revision_proposals WHERE chapter_id = ? AND status = 'applied' LIMIT 1`,
      ).get(chapterId);
      return Boolean(row);
    })();
    const pendingReReview = currentGen !== null && hasAppliedRevision && !hasFreshPassing;
    return { success: true, data: { records, pendingReReview, currentGeneration: currentGen } };
  });

  // ===== 生成修订提案（可取消；取消不落 proposed） =====
  ipcMain.handle(
    'workflow:chapterReview:createRevision',
    async (event, input: {
      projectId: string;
      chapterId: string;
      reviewId: string;
      messages: ChatMessage[];
      providerConfig: ProviderConfig;
      sourceGeneration: number;
    }): Promise<IpcResult<{ proposalId: string | null; proposedContent: string | null; executionStatus: 'completed' | 'cancelled' | 'failed' | 'stale' }>> => {
      const pid = normalizeStreamProjectId(input.projectId);
      const repo = getRepo();

      // 只能基于当前世代 + fresh + completed 的审稿
      const review = repo.findById(input.reviewId);
      if (!review) return { success: false, error: 'REVIEW_SOURCE_STALE' };
      if (review.chapterId !== input.chapterId || review.executionStatus !== 'completed') {
        return { success: false, error: 'REVIEW_SOURCE_STALE' };
      }
      const gen = repo.getContentGeneration(input.chapterId);
      if (gen === null || gen !== input.sourceGeneration || gen !== review.sourceGeneration) {
        return { success: false, error: 'REVIEW_SOURCE_STALE' };
      }

      const controller = new AbortController();
      const streamId = `rev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const sender = event.sender;
      streamRegistry.register(streamId, {
        controller,
        senderId: sender.id,
        projectId: pid,
        runId: undefined,
        terminal: false,
      });
      if (!sender.isDestroyed()) {
        sender.send('workflow:chapterReview:started', { streamId, projectId: pid, chapterId: input.chapterId });
      }

      try {
        const provider = ProviderFactory.create(input.providerConfig);
        const raw = await provider.chat(input.messages, { signal: controller.signal, temperature: 0.3, maxTokens: 4096 });
        // 生成期间世代再校验
        if (repo.getContentGeneration(input.chapterId) !== input.sourceGeneration) {
          return { success: true, data: { proposalId: null, proposedContent: null, executionStatus: 'stale' } };
        }
        const insert = repo.insertProposal({
          projectId: pid,
          chapterId: input.chapterId,
          reviewId: input.reviewId,
          sourceGeneration: input.sourceGeneration,
          proposedContent: raw,
        });
        if (!insert.success) return { success: false, error: insert.error };
        return { success: true, data: { proposalId: insert.data!.id, proposedContent: raw, executionStatus: 'completed' } };
      } catch (err) {
        const message = (err as Error).message;
        if (message === 'AI_STREAM_CANCELLED' || controller.signal.aborted) {
          return { success: true, data: { proposalId: null, proposedContent: null, executionStatus: 'cancelled' } };
        }
        return { success: false, error: message };
      } finally {
        streamRegistry.remove(streamId);
      }
    },
  );

  // ===== 应用修订（世代校验 + 事务） =====
  ipcMain.handle(
    'workflow:chapterReview:applyRevision',
    (_event, proposalId: string, projectId: string): IpcResult<{ chapterId: string; content: string; wordCount: number; contentGeneration: number }> => {
      const repo = getRepo();
      return applyRevision(getDb(), repo, proposalId, normalizeStreamProjectId(projectId));
    },
  );

  // ===== 拒绝修订 =====
  ipcMain.handle('workflow:chapterReview:rejectRevision', (_event, proposalId: string): IpcResult<void> => {
    const repo = getRepo();
    return repo.rejectProposal(proposalId);
  });
}
