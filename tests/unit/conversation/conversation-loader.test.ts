import { describe, expect, it } from 'vitest';
import { createConversationLoader } from '../../../src/renderer/services/conversation-persistence';
import type { ConversationSnapshot, IpcResult, LegacyMigrationResult } from '../../../src/renderer/types';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function snapshot(projectId: string): ConversationSnapshot {
  const threadId = `${projectId}-thread`;
  return {
    threads: [{
      id: threadId, projectId, title: `${projectId} 对话`, category: 'general',
      createdAt: '2026-09-09T00:00:00.000Z', updatedAt: '2026-09-09T00:00:00.000Z',
    }],
    messages: { [threadId]: [] },
  };
}

const migrationSuccess: IpcResult<LegacyMigrationResult> = {
  success: true,
  data: { status: 'no_data', threadCount: 0, messageCount: 0 },
};

describe('AI 会话项目加载器', () => {
  it('项目 A 晚于项目 B 返回时只应用项目 B', async () => {
    const pending = new Map<string, ReturnType<typeof deferred<IpcResult<ConversationSnapshot>>>>();
    let currentProjectId = 'A';
    let appliedProjectId = '';
    const loader = createConversationLoader({
      storage: { getItem: () => null },
      isProjectCurrent: projectId => projectId === currentProjectId,
      invoke: async (channel, ...args) => {
        if (channel === 'db:conversation:migrateLegacy') return migrationSuccess;
        const projectId = String(args[0]);
        const request = deferred<IpcResult<ConversationSnapshot>>();
        pending.set(projectId, request);
        return request.promise;
      },
      onApply: projectId => { appliedProjectId = projectId; },
    });

    const loadingA = loader.load('A');
    await Promise.resolve();
    currentProjectId = 'B';
    const loadingB = loader.load('B');
    await Promise.resolve();
    pending.get('B')!.resolve({ success: true, data: snapshot('B') });
    await expect(loadingB).resolves.toBe('applied');
    pending.get('A')!.resolve({ success: true, data: snapshot('A') });
    await expect(loadingA).resolves.toBe('stale');

    expect(appliedProjectId).toBe('B');
  });

  it('旧项目请求迟到失败时不污染当前项目的会话和错误状态', async () => {
    const pendingA = deferred<IpcResult<ConversationSnapshot>>();
    let currentProjectId = 'A';
    const applied: string[] = [];
    const errors: string[] = [];
    const loader = createConversationLoader({
      storage: { getItem: () => null },
      isProjectCurrent: projectId => projectId === currentProjectId,
      invoke: async (channel, ...args) => {
        if (channel === 'db:conversation:migrateLegacy') return migrationSuccess;
        const projectId = String(args[0]);
        return projectId === 'A' ? pendingA.promise : { success: true, data: snapshot('B') };
      },
      onApply: projectId => applied.push(projectId),
      onError: (projectId, error) => errors.push(`${projectId}:${String(error)}`),
    });

    const loadingA = loader.load('A');
    await Promise.resolve();
    currentProjectId = 'B';
    await expect(loader.load('B')).resolves.toBe('applied');
    pendingA.resolve({ success: false, error: '旧项目数据库失败' });
    await expect(loadingA).resolves.toBe('stale');

    expect(applied).toEqual(['B']);
    expect(errors).toEqual([]);
  });

  it('读取旧 localStorage 数据用于迁移但不删除原键', async () => {
    const raw = JSON.stringify({
      threads: [{ id: 'old-thread', name: '旧对话', category: 'general', createdAt: '2026-01-01T00:00:00.000Z' }],
      messages: { 'old-thread': [] },
    });
    let migratedPayload: unknown;
    let removeCalls = 0;
    const loader = createConversationLoader({
      storage: { getItem: () => raw, removeItem: () => { removeCalls += 1; } },
      invoke: async (channel, ...args) => {
        if (channel === 'db:conversation:migrateLegacy') {
          migratedPayload = args[1];
          return { success: true, data: { status: 'imported', threadCount: 1, messageCount: 0 } };
        }
        return { success: true, data: snapshot('A') };
      },
      onApply: () => {},
    });

    await expect(loader.load('A')).resolves.toBe('applied');

    expect(migratedPayload).toMatchObject({ threads: [{ id: 'old-thread' }] });
    expect(removeCalls).toBe(0);
  });

  it('导入失败时保留旧数据且不提交空快照', async () => {
    const raw = JSON.stringify({ threads: [], messages: {} });
    const storage = new Map([['hi-story-threads-A', raw]]);
    const errors: string[] = [];
    let applyCount = 0;
    const loader = createConversationLoader({
      storage: { getItem: key => storage.get(key) ?? null },
      invoke: async () => ({ success: false, error: '导入失败' }),
      onApply: () => { applyCount += 1; },
      onError: (_projectId, error) => errors.push((error as Error).message),
    });

    await expect(loader.load('A')).resolves.toBe('failed');

    expect(storage.get('hi-story-threads-A')).toBe(raw);
    expect(applyCount).toBe(0);
    expect(errors).toEqual(['导入失败']);
  });

  it('SQLite 读取失败时不会用空数据覆盖已有会话', async () => {
    let applyCount = 0;
    const loader = createConversationLoader({
      storage: { getItem: () => null },
      invoke: async channel => channel === 'db:conversation:migrateLegacy'
        ? migrationSuccess
        : { success: false, error: '数据库读取失败' },
      onApply: () => { applyCount += 1; },
    });

    await expect(loader.load('A')).resolves.toBe('failed');
    expect(applyCount).toBe(0);
  });

  it('项目没有会话时创建默认对话并一次性提交快照', async () => {
    const createdThread = snapshot('A').threads[0];
    let applied: ConversationSnapshot | null = null;
    const calls: string[] = [];
    const loader = createConversationLoader({
      storage: { getItem: () => null },
      invoke: async channel => {
        calls.push(channel);
        if (channel === 'db:conversation:migrateLegacy') return migrationSuccess;
        if (channel === 'db:conversation:findByProject') return { success: true, data: { threads: [], messages: {} } };
        return { success: true, data: createdThread };
      },
      onApply: (_projectId, value) => { applied = value; },
    });

    await expect(loader.load('A')).resolves.toBe('applied');

    expect(calls).toContain('db:conversation:createThread');
    expect(applied?.threads).toEqual([createdThread]);
    expect(applied?.messages[createdThread.id]).toEqual([]);
  });
});
