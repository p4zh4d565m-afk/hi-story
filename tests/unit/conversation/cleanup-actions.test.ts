import { describe, expect, it, vi } from 'vitest';
import { createCleanupLock } from '../../../src/renderer/services/conversation-cleanup-lock';
import {
  CLEANUP_UNDO_MS,
  createConversationCleanupActions,
  type PendingUndo,
} from '../../../src/renderer/services/conversation-cleanup-actions';
import type { ConversationCleanupResult, ConversationMessage, ConversationSnapshot } from '../../../src/renderer/types';

function okCleanup(partial: Partial<ConversationCleanupResult> & Pick<ConversationCleanupResult, 'threadId'>): ConversationCleanupResult {
  return {
    batchId: 'batch-1',
    deletedMessageIds: ['u1', 'a1'],
    deletedAt: '2026-09-15T00:00:00.000Z',
    noop: false,
    ...partial,
  };
}

describe('conversation-cleanup-actions（面板清理路径）', () => {
  it('按轮删成功：返回删除 id 与 pendingUndo', async () => {
    const invoke = vi.fn(async () => ({
      success: true,
      data: okCleanup({ threadId: 't1', deletedMessageIds: ['u1', 'a1'] }),
    }));
    const actions = createConversationCleanupActions({
      invoke,
      lock: createCleanupLock(),
      getCurrentProjectId: () => 'p1',
      isStreaming: () => false,
      now: () => 1_000_000,
    });

    const result = await actions.deleteTurn({
      projectId: 'p1',
      threadId: 't1',
      loadedProjectId: 'p1',
      userMessageId: 'u1',
    });

    expect(result).toEqual({
      status: 'ok',
      threadId: 't1',
      deletedMessageIds: ['u1', 'a1'],
      pendingUndo: {
        batchId: 'batch-1',
        threadId: 't1',
        projectId: 'p1',
        expiresAt: 1_000_000 + CLEANUP_UNDO_MS,
      },
    });
    expect(invoke).toHaveBeenCalledWith('db:conversation:deleteTurn', {
      projectId: 'p1',
      threadId: 't1',
      userMessageId: 'u1',
    });
  });

  it('清空成功：挂新撤销条', async () => {
    const invoke = vi.fn(async () => ({
      success: true,
      data: okCleanup({ threadId: 't1', deletedMessageIds: ['u1'], batchId: 'batch-clear' }),
    }));
    const actions = createConversationCleanupActions({
      invoke,
      lock: createCleanupLock(),
      getCurrentProjectId: () => 'p1',
      isStreaming: () => false,
      now: () => 50,
    });

    const result = await actions.clearThread({
      projectId: 'p1',
      threadId: 't1',
      loadedProjectId: 'p1',
    });

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.pendingUndo.batchId).toBe('batch-clear');
    }
  });

  it('空清空 noop：提示已无消息且不要求清掉已有撤销条', async () => {
    const invoke = vi.fn(async () => ({
      success: true,
      data: okCleanup({
        threadId: 't1',
        batchId: null,
        deletedMessageIds: [],
        deletedAt: null,
        noop: true,
      }),
    }));
    const actions = createConversationCleanupActions({
      invoke,
      lock: createCleanupLock(),
      getCurrentProjectId: () => 'p1',
      isStreaming: () => false,
    });

    const result = await actions.clearThread({
      projectId: 'p1',
      threadId: 't1',
      loadedProjectId: 'p1',
    });

    expect(result).toEqual({ status: 'noop', tip: '已无消息' });
  });

  it('撤销成功：restoreBatch 后 findByProject 刷新消息', async () => {
    const restored: ConversationMessage = {
      id: 'u1',
      threadId: 't1',
      role: 'user',
      content: 'Q',
      providerId: null,
      contextType: 'chat',
      sortOrder: 0,
      createdAt: 't',
      updatedAt: 't',
    };
    const snapshot: ConversationSnapshot = {
      threads: [],
      messages: { t1: [restored] },
    };
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'db:conversation:restoreBatch') {
        return { success: true, data: { batchId: 'batch-1', threadId: 't1', restoredMessageIds: ['u1'] } };
      }
      if (channel === 'db:conversation:findByProject') {
        return { success: true, data: snapshot };
      }
      throw new Error(`unexpected ${channel}`);
    });
    const undo: NonNullable<PendingUndo> = {
      batchId: 'batch-1',
      threadId: 't1',
      projectId: 'p1',
      expiresAt: Date.now() + 10_000,
    };
    const actions = createConversationCleanupActions({
      invoke,
      lock: createCleanupLock(),
      getCurrentProjectId: () => 'p1',
      isStreaming: () => false,
    });

    const result = await actions.restoreBatch({ undo });
    expect(result).toEqual({ status: 'ok', threadId: 't1', messages: [restored] });
    expect(invoke).toHaveBeenNthCalledWith(1, 'db:conversation:restoreBatch', {
      projectId: 'p1',
      threadId: 't1',
      batchId: 'batch-1',
    });
    expect(invoke).toHaveBeenNthCalledWith(2, 'db:conversation:findByProject', 'p1');
  });

  it('流式中：早退且不 invoke', async () => {
    const invoke = vi.fn();
    const actions = createConversationCleanupActions({
      invoke,
      lock: createCleanupLock(),
      getCurrentProjectId: () => 'p1',
      isStreaming: () => true,
    });

    await expect(actions.deleteTurn({
      projectId: 'p1', threadId: 't1', loadedProjectId: 'p1', userMessageId: 'u1',
    })).resolves.toEqual({ status: 'streaming' });
    await expect(actions.clearThread({
      projectId: 'p1', threadId: 't1', loadedProjectId: 'p1',
    })).resolves.toEqual({ status: 'streaming' });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('token 单飞：在飞第二次点击 busy 且不发起第二趟 IPC', async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });
    let calls = 0;
    const invoke = vi.fn(async () => {
      calls += 1;
      await firstGate;
      return { success: true, data: okCleanup({ threadId: 't1' }) };
    });
    const lock = createCleanupLock();
    const actions = createConversationCleanupActions({
      invoke,
      lock,
      getCurrentProjectId: () => 'p1',
      isStreaming: () => false,
    });

    const first = actions.deleteTurn({
      projectId: 'p1', threadId: 't1', loadedProjectId: 'p1', userMessageId: 'u1',
    });
    // 等第一趟已拿到锁并进入 invoke
    await vi.waitFor(() => expect(calls).toBe(1));

    const second = await actions.clearThread({
      projectId: 'p1', threadId: 't1', loadedProjectId: 'p1',
    });
    expect(second).toEqual({ status: 'busy' });
    expect(calls).toBe(1);

    releaseFirst();
    await first;
    expect(lock.isHeld()).toBe(false);
  });

  it('切项目迟到回执：不返回可应用的 ok（stale-project）', async () => {
    let currentProject: string | null = 'p1';
    const invoke = vi.fn(async () => {
      currentProject = 'p2'; // 模拟 IPC 返回前已切项目
      return { success: true, data: okCleanup({ threadId: 't1' }) };
    });
    const actions = createConversationCleanupActions({
      invoke,
      lock: createCleanupLock(),
      getCurrentProjectId: () => currentProject,
      isStreaming: () => false,
    });

    const result = await actions.deleteTurn({
      projectId: 'p1',
      threadId: 't1',
      loadedProjectId: 'p1',
      userMessageId: 'u1',
    });
    expect(result).toEqual({ status: 'stale-project' });
  });

  it('切项目不释放在飞锁：旧 finally 后新项目才能再清', async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });
    const lock = createCleanupLock();
    let currentProject: string | null = 'p1';
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'db:conversation:deleteTurn') {
        await firstGate;
        return { success: true, data: okCleanup({ threadId: 't1' }) };
      }
      return { success: true, data: okCleanup({ threadId: 't2', batchId: 'batch-2' }) };
    });
    const actions = createConversationCleanupActions({
      invoke,
      lock,
      getCurrentProjectId: () => currentProject,
      isStreaming: () => false,
    });

    const first = actions.deleteTurn({
      projectId: 'p1', threadId: 't1', loadedProjectId: 'p1', userMessageId: 'u1',
    });
    await vi.waitFor(() => expect(lock.isHeld()).toBe(true));

    // 切项目：UI 侧清条但不 release（本模块也不自动 release）
    currentProject = 'p2';
    const duringSwitch = await actions.clearThread({
      projectId: 'p2', threadId: 't2', loadedProjectId: 'p2',
    });
    expect(duringSwitch).toEqual({ status: 'busy' });

    releaseFirst();
    await first; // stale-project，但 finally 已解锁
    expect(lock.isHeld()).toBe(false);

    const after = await actions.clearThread({
      projectId: 'p2', threadId: 't2', loadedProjectId: 'p2',
    });
    expect(after.status).toBe('ok');
  });
});
