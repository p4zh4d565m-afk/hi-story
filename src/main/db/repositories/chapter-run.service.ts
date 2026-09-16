import Database from 'better-sqlite3';
import type { IpcResult, Chapter, ChapterOutline } from '../../../renderer/types';
import { ChapterRunRepo } from './chapter-run.repo';
import { ChapterRepo } from './chapter.repo';

/**
 * 写章运行服务（三期）。
 * 只管业务编排：commit 幂等、启动恢复（running → failed/PROCESS_INTERRUPTED）。
 * run 的创建/流式生命周期在 IPC 层（chapter-run.ipc.ts），因为它依赖 AbortController/stream-registry。
 */

export const ERR_RUN_NOT_FOUND = 'RUN_NOT_FOUND';
export const ERR_RUN_PROJECT_MISMATCH = 'RUN_PROJECT_MISMATCH';
export const ERR_RUN_ALREADY_COMMITTED = 'RUN_ALREADY_COMMITTED';
export const ERR_EMPTY_DRAFT = 'EMPTY_DRAFT';
export const ERR_PROCESS_INTERRUPTED = 'PROCESS_INTERRUPTED';

export class ChapterRunService {
  private db: Database.Database;
  private runRepo: ChapterRunRepo;
  private chapterRepo: ChapterRepo;

  constructor(db: Database.Database) {
    this.db = db;
    this.runRepo = new ChapterRunRepo(db);
    this.chapterRepo = new ChapterRepo(db);
  }

  /**
   * 提交草稿为章节（幂等）。
   * 仅 drafted 可提交；重复提交返回原章节 id；正文优先，不等待抽取。
   */
  commit(runId: string, projectId: string, planningOutline: ChapterOutline | null): IpcResult<{ chapter: Chapter }> {
    const run = this.runRepo.findById(runId);
    if (!run) return { success: false, error: ERR_RUN_NOT_FOUND };
    if (run.projectId !== projectId) return { success: false, error: ERR_RUN_PROJECT_MISMATCH };
    if (run.status === 'committed' && run.targetChapterId) {
      // 幂等：已提交，返回原章节
      const existing = this.chapterRepo.findById(run.targetChapterId);
      if (existing.success && existing.data) {
        return { success: true, data: { chapter: existing.data } };
      }
    }
    if (run.status !== 'drafted') {
      return { success: false, error: `运行状态为 ${run.status}，不可提交` };
    }
    if (!run.draftContent || run.draftContent.trim().length === 0) {
      return { success: false, error: ERR_EMPTY_DRAFT };
    }

    // 复用 A1 同步链路：create 直接带 content，返回章节
    const title = run.requestedTitle || 'AI 生成章节';
    const createRes = this.chapterRepo.create({
      projectId,
      title,
      content: run.draftContent,
      planningOutline,
    });
    if (!createRes.success || !createRes.data) {
      return { success: false, error: createRes.error || '创建章节失败' };
    }

    this.runRepo.markCommitted(runId, createRes.data.id);
    return { success: true, data: { chapter: createRes.data } };
  }

  /**
   * 启动恢复：把该 run 从 running 标为 failed/PROCESS_INTERRUPTED。
   * 不自动重放付费请求。草稿非空则仍可保存（但正常流式中断不会写草稿，这里为极端场景兜底）。
   */
  markInterrupted(runId: string): void {
    this.runRepo.markFailed(runId, ERR_PROCESS_INTERRUPTED, '应用退出时仍为 running，已按中断处理');
  }

  /** 启动时恢复所有遗留 running */
  recoverInterruptedAll(): number {
    const running = this.runRepo.findAllRunning();
    for (const run of running) {
      this.runRepo.markFailed(run.id, ERR_PROCESS_INTERRUPTED, '应用退出时仍为 running，已按中断处理');
    }
    return running.length;
  }
}
