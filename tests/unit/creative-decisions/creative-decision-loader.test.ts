import { describe, expect, it, vi } from 'vitest';
import { createCreativeDecisionLoader } from '../../../src/renderer/services/creative-decision-loader';
import type { CreativeDecision, IpcResult } from '../../../src/renderer/types';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(onResolve => { resolve = onResolve; });
  return { promise, resolve };
}

function decision(projectId: string): CreativeDecision {
  return {
    id: `${projectId}-decision`,
    projectId,
    sourceThreadId: `${projectId}-thread`,
    sourceMessageId: `${projectId}-message`,
    parentDecisionId: null,
    type: 'story_fact',
    title: `${projectId} 的事实`,
    rationale: '保持故事一致',
    payload: {
      factType: 'event', subject: '主角', predicate: '抵达', object: '车站',
      description: '主角抵达旧车站',
    },
    status: 'proposed',
    createdAt: '2026-09-09T00:00:00.000Z',
    confirmedAt: null,
    rejectedAt: null,
  };
}

describe('创作决策项目加载器', () => {
  it('项目 A 晚于项目 B 返回时只应用项目 B', async () => {
    const requests = new Map<string, ReturnType<typeof deferred<IpcResult<CreativeDecision[]>>>>();
    let currentProjectId = 'project-a';
    const onApply = vi.fn();
    const loader = createCreativeDecisionLoader({
      getCurrentProjectId: () => currentProjectId,
      invoke: async (_channel, projectId) => {
        const request = deferred<IpcResult<CreativeDecision[]>>();
        requests.set(String(projectId), request);
        return request.promise;
      },
      onApply,
    });

    const loadingA = loader.load('project-a');
    await Promise.resolve();
    currentProjectId = 'project-b';
    const loadingB = loader.load('project-b');
    await Promise.resolve();
    const projectBDecisions = [decision('project-b')];
    requests.get('project-b')!.resolve({ success: true, data: projectBDecisions });
    await expect(loadingB).resolves.toBe('applied');
    requests.get('project-a')!.resolve({ success: true, data: [decision('project-a')] });
    await expect(loadingA).resolves.toBe('stale');

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith('project-b', projectBDecisions);
  });

  it('旧项目请求迟到失败时不会清空新项目账本或显示旧错误', async () => {
    const requestA = deferred<IpcResult<CreativeDecision[]>>();
    let currentProjectId = 'project-a';
    const onApply = vi.fn();
    const onError = vi.fn();
    const loader = createCreativeDecisionLoader({
      getCurrentProjectId: () => currentProjectId,
      invoke: async (_channel, projectId) => projectId === 'project-a'
        ? requestA.promise
        : { success: true, data: [decision('project-b')] },
      onApply,
      onError,
    });

    const loadingA = loader.load('project-a');
    await Promise.resolve();
    currentProjectId = 'project-b';
    await expect(loader.load('project-b')).resolves.toBe('applied');
    requestA.resolve({ success: false, error: '旧项目读取失败' });
    await expect(loadingA).resolves.toBe('stale');

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith('project-b', [decision('project-b')]);
    expect(onError).not.toHaveBeenCalled();
  });

  it('当前项目读取失败时保留已有快照并报告错误', async () => {
    const onApply = vi.fn();
    const onError = vi.fn();
    const loader = createCreativeDecisionLoader({
      getCurrentProjectId: () => 'project-a',
      invoke: async () => ({ success: false, error: '账本读取失败' }),
      onApply,
      onError,
    });

    await expect(loader.load('project-a')).resolves.toBe('failed');
    expect(onApply).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith('project-a', expect.objectContaining({
      message: '账本读取失败',
    }));
  });
});
