/**
 * AI 对话清理写路径编排（面板共用）。
 * 锁住：单飞、流式早退、项目守卫丢弃 UI、空清空保留已有撤销条。
 */
import type { CleanupLock } from './conversation-cleanup-lock';
import type {
  ClearConversationThreadInput,
  ConversationCleanupResult,
  ConversationMessage,
  ConversationRestoreResult,
  ConversationSnapshot,
  DeleteConversationTurnInput,
  IpcResult,
  RestoreConversationBatchInput,
} from '../types';

export const CLEANUP_UNDO_MS = 10_000;

export type PendingUndo = {
  batchId: string;
  threadId: string;
  projectId: string;
  expiresAt: number;
} | null;

export type CleanupInvoke = (channel: string, ...args: unknown[]) => Promise<unknown>;

export type CleanupActionDeps = {
  invoke: CleanupInvoke;
  lock: CleanupLock;
  getCurrentProjectId: () => string | null;
  isStreaming: () => boolean;
  undoMs?: number;
  now?: () => number;
};

export type CleanupSkipReason = 'streaming' | 'busy' | 'guard';

export type DeleteTurnActionResult =
  | { status: CleanupSkipReason }
  | { status: 'stale-project' }
  | { status: 'error'; error: string }
  | { status: 'noop' }
  | {
      status: 'ok';
      threadId: string;
      deletedMessageIds: string[];
      pendingUndo: NonNullable<PendingUndo>;
    };

export type ClearThreadActionResult =
  | { status: CleanupSkipReason }
  | { status: 'stale-project' }
  | { status: 'error'; error: string }
  | { status: 'noop'; tip: string }
  | {
      status: 'ok';
      threadId: string;
      pendingUndo: NonNullable<PendingUndo>;
    };

export type RestoreBatchActionResult =
  | { status: CleanupSkipReason | 'missing-undo' }
  | { status: 'stale-project' }
  | { status: 'error'; error: string }
  | {
      status: 'ok';
      threadId: string;
      messages: ConversationMessage[];
    };

function buildPendingUndo(
  result: ConversationCleanupResult,
  projectId: string,
  now: number,
  undoMs: number,
): NonNullable<PendingUndo> | null {
  if (!result.batchId || result.noop) return null;
  return {
    batchId: result.batchId,
    threadId: result.threadId,
    projectId,
    expiresAt: now + undoMs,
  };
}

export function createConversationCleanupActions(deps: CleanupActionDeps) {
  const undoMs = deps.undoMs ?? CLEANUP_UNDO_MS;
  const now = deps.now ?? (() => Date.now());

  async function withCleanupLock<T>(
    work: () => Promise<T>,
  ): Promise<{ status: 'streaming' | 'busy' } | { status: 'ran'; value: T }> {
    if (deps.isStreaming()) return { status: 'streaming' };
    const token = deps.lock.tryAcquire();
    if (!token) return { status: 'busy' };
    try {
      return { status: 'ran', value: await work() };
    } finally {
      deps.lock.release(token);
    }
  }

  return {
    async deleteTurn(input: {
      projectId: string | null;
      threadId: string | null;
      loadedProjectId: string | null;
      userMessageId: string;
    }): Promise<DeleteTurnActionResult> {
      const { projectId, threadId, loadedProjectId, userMessageId } = input;
      if (!projectId || !threadId || loadedProjectId !== projectId) return { status: 'guard' };

      const gated = await withCleanupLock(async () => {
        const requestProjectId = projectId;
        const payload: DeleteConversationTurnInput = {
          projectId: requestProjectId,
          threadId,
          userMessageId,
        };
        const response = await deps.invoke(
          'db:conversation:deleteTurn',
          payload,
        ) as IpcResult<ConversationCleanupResult>;
        if (deps.getCurrentProjectId() !== requestProjectId) return { status: 'stale-project' as const };
        if (!response.success || !response.data) {
          return { status: 'error' as const, error: response.error || '删除本轮失败' };
        }
        if (response.data.noop) return { status: 'noop' as const };
        const pendingUndo = buildPendingUndo(response.data, requestProjectId, now(), undoMs);
        if (!pendingUndo) return { status: 'noop' as const };
        return {
          status: 'ok' as const,
          threadId,
          deletedMessageIds: response.data.deletedMessageIds,
          pendingUndo,
        };
      });

      if (gated.status !== 'ran') return { status: gated.status };
      return gated.value;
    },

    async clearThread(input: {
      projectId: string | null;
      threadId: string | null;
      loadedProjectId: string | null;
    }): Promise<ClearThreadActionResult> {
      const { projectId, threadId, loadedProjectId } = input;
      if (!projectId || !threadId || loadedProjectId !== projectId) return { status: 'guard' };

      const gated = await withCleanupLock(async () => {
        const requestProjectId = projectId;
        const payload: ClearConversationThreadInput = {
          projectId: requestProjectId,
          threadId,
        };
        const response = await deps.invoke(
          'db:conversation:clearThread',
          payload,
        ) as IpcResult<ConversationCleanupResult>;
        if (deps.getCurrentProjectId() !== requestProjectId) return { status: 'stale-project' as const };
        if (!response.success || !response.data) {
          return { status: 'error' as const, error: response.error || '清空消息失败' };
        }
        if (response.data.noop) {
          // 合同：noop 不得要求调用方清掉已有 pendingUndo
          return { status: 'noop' as const, tip: '已无消息' };
        }
        const pendingUndo = buildPendingUndo(response.data, requestProjectId, now(), undoMs);
        if (!pendingUndo) return { status: 'noop' as const, tip: '已无消息' };
        return {
          status: 'ok' as const,
          threadId,
          pendingUndo,
        };
      });

      if (gated.status !== 'ran') return { status: gated.status };
      return gated.value;
    },

    async restoreBatch(input: {
      undo: PendingUndo;
    }): Promise<RestoreBatchActionResult> {
      const undo = input.undo;
      if (!undo) return { status: 'missing-undo' };

      const gated = await withCleanupLock(async () => {
        const requestProjectId = undo.projectId;
        const payload: RestoreConversationBatchInput = {
          projectId: requestProjectId,
          threadId: undo.threadId,
          batchId: undo.batchId,
        };
        const response = await deps.invoke(
          'db:conversation:restoreBatch',
          payload,
        ) as IpcResult<ConversationRestoreResult>;
        if (deps.getCurrentProjectId() !== requestProjectId) return { status: 'stale-project' as const };
        if (!response.success || !response.data) {
          return { status: 'error' as const, error: response.error || '撤销失败' };
        }
        const snapshot = await deps.invoke(
          'db:conversation:findByProject',
          requestProjectId,
        ) as IpcResult<ConversationSnapshot>;
        if (deps.getCurrentProjectId() !== requestProjectId) return { status: 'stale-project' as const };
        if (!snapshot.success || !snapshot.data) {
          return { status: 'error' as const, error: snapshot.error || '撤销后刷新消息失败' };
        }
        return {
          status: 'ok' as const,
          threadId: undo.threadId,
          messages: snapshot.data.messages[undo.threadId] || [],
        };
      });

      if (gated.status !== 'ran') return { status: gated.status };
      return gated.value;
    },
  };
}

export type ConversationCleanupActions = ReturnType<typeof createConversationCleanupActions>;
