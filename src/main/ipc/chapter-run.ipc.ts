import { ipcMain } from 'electron';
import { ProviderFactory } from '../ai/provider-factory';
import type { ChatMessage, ProviderConfig } from '../ai/provider';
import { streamRegistry } from '../ai/stream-registry';
import { normalizeStreamProjectId } from '../ai/stream-project-id';
import { getDb } from '../db/connection';
import { ChapterRunRepo } from '../db/repositories/chapter-run.repo';
import { ChapterRunService, ERR_RUN_ALREADY_COMMITTED } from '../db/repositories/chapter-run.service';
import type { IpcResult, ChapterRunStartResult, ChapterOutline } from '../../renderer/types';

function getRepo(): ChapterRunRepo {
  return new ChapterRunRepo(getDb());
}

function getService(): ChapterRunService {
  return new ChapterRunService(getDb());
}

export function registerChapterRunIpc(): void {
  // ===== 启动写章运行（await 到终态；可取消） =====
  ipcMain.handle(
    'workflow:chapterRun:start',
    async (event, input: {
      projectId: string;
      requestedTitle: string;
      messages: ChatMessage[];
      providerConfig: ProviderConfig;
      inputSummary: string;
      sourceOutlineNodeId?: string | null;
    }): Promise<IpcResult<ChapterRunStartResult>> => {
      const pid = normalizeStreamProjectId(input.projectId);
      const repo = getRepo();
      const providerName = input.providerConfig.name;
      const modelName = input.providerConfig.model;

      const runId = repo.insert({
        projectId: pid,
        requestedTitle: input.requestedTitle,
        providerName,
        modelName,
        inputSummary: input.inputSummary,
        sourceOutlineNodeId: input.sourceOutlineNodeId ?? null,
      });

      const controller = new AbortController();
      const streamId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const sender = event.sender;

      streamRegistry.register(streamId, {
        controller,
        senderId: sender.id,
        projectId: pid,
        runId, // 三期：写章运行必填 runId
        terminal: false,
      });

      if (!sender.isDestroyed()) {
        sender.send('workflow:chapterRun:started', { streamId, projectId: pid, runId });
      }

      try {
        const provider = ProviderFactory.create(input.providerConfig);
        const raw = await provider.chat(input.messages, {
          signal: controller.signal,
          temperature: 0.7,
          maxTokens: 4096,
        });

        // 空草稿不能进入 drafted
        if (!raw || raw.trim().length === 0) {
          repo.markFailed(runId, 'EMPTY_DRAFT', 'AI 未返回有效正文');
          return { success: true, data: { runId, executionStatus: 'failed', draftContent: null } };
        }

        repo.markDrafted(runId, raw);
        return { success: true, data: { runId, executionStatus: 'drafted', draftContent: raw } };
      } catch (err) {
        const message = (err as Error).message;
        if (message === 'AI_STREAM_CANCELLED' || controller.signal.aborted) {
          repo.markCancelled(runId);
          return { success: true, data: { runId, executionStatus: 'cancelled', draftContent: null } };
        }
        repo.markFailed(runId, 'AI_REQUEST_FAILED', message);
        return { success: true, data: { runId, executionStatus: 'failed', draftContent: null } };
      } finally {
        streamRegistry.remove(streamId);
      }
    },
  );

  // ===== 取消写章运行（绑定 projectId + runId） =====
  ipcMain.handle('workflow:chapterRun:cancel', async (_event, runId: string, projectId: string): Promise<IpcResult<void>> => {
    const repo = getRepo();
    const run = repo.findById(runId);
    if (!run) return { success: false, error: 'RUN_NOT_FOUND' };
    if (run.projectId !== projectId) return { success: false, error: 'RUN_PROJECT_MISMATCH' };
    repo.setCancelRequested(runId);
    // 通过 runId 找到对应流并 abort（start 已把 runId 登记进 stream-registry）
    streamRegistry.cancelByRunId(runId, projectId);
    return { success: true };
  });

  // ===== 提交草稿为章节（幂等） =====
  ipcMain.handle(
    'workflow:chapterRun:commit',
    (_event, runId: string, projectId: string, planningOutline: ChapterOutline | null): IpcResult<unknown> => {
      return getService().commit(runId, projectId, planningOutline);
    },
  );

  // ===== 查询单个运行 =====
  ipcMain.handle('workflow:chapterRun:get', (_event, runId: string): IpcResult<unknown> => {
    const run = getRepo().findById(runId);
    if (!run) return { success: false, error: 'RUN_NOT_FOUND' };
    return { success: true, data: run };
  });

  // ===== 列出项目下运行 =====
  ipcMain.handle('workflow:chapterRun:list', (_event, projectId: string): IpcResult<unknown> => {
    return getRepo().findByProject(projectId);
  });
}
