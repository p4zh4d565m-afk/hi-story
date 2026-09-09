import { describe, expect, it } from 'vitest';
import { createAiRuntimeContextLoader } from '../../../src/renderer/services/ai-runtime-context-loader';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(onResolve => { resolve = onResolve; });
  return { promise, resolve };
}

describe('AI 运行时上下文加载器', () => {
  it('原子加载钩子债务、事实与人物知识', async () => {
    const channels: string[] = [];
    const applied: unknown[] = [];
    const loader = createAiRuntimeContextLoader({
      invoke: async (channel) => {
        channels.push(channel);
        if (channel === 'db:narrativeHooks:getContext') return { success: true, data: '确认钩子' };
        if (channel === 'db:storyFacts:findRecentActive') return { success: true, data: [{ id: 'fact-1' }] };
        return { success: true, data: [{ id: 'knowledge-1' }] };
      },
      onApply: snapshot => applied.push(snapshot),
    });

    await expect(loader.load('project-a')).resolves.toBe('applied');

    expect(channels).toEqual([
      'db:narrativeHooks:getContext',
      'db:storyFacts:findRecentActive',
      'db:storyFacts:findAllKnowledgeByProject',
    ]);
    expect(applied).toEqual([{
      projectId: 'project-a',
      narrativeContext: '确认钩子',
      storyFacts: [{ id: 'fact-1' }],
      characterKnowledge: [{ id: 'knowledge-1' }],
    }]);
  });

  it('确认后同项目刷新时只应用最新一代结果', async () => {
    const requests: Array<ReturnType<typeof deferred<any>>> = [];
    const applied: string[] = [];
    const loader = createAiRuntimeContextLoader({
      invoke: () => {
        const request = deferred<any>();
        requests.push(request);
        return request.promise;
      },
      onApply: snapshot => applied.push(snapshot.narrativeContext),
    });

    const first = loader.load('project-a');
    const second = loader.load('project-a');
    requests.slice(3, 6).forEach((request, index) => request.resolve({
      success: true, data: index === 0 ? '最新确认状态' : [],
    }));
    await expect(second).resolves.toBe('applied');
    requests.slice(0, 3).forEach((request, index) => request.resolve({
      success: true, data: index === 0 ? '旧状态' : [],
    }));
    await expect(first).resolves.toBe('stale');

    expect(applied).toEqual(['最新确认状态']);
  });

  it('任一数据源失败时不提交残缺快照', async () => {
    const applied: unknown[] = [];
    const loader = createAiRuntimeContextLoader({
      invoke: async channel => channel === 'db:storyFacts:findRecentActive'
        ? { success: false, error: '事实读取失败' }
        : { success: true, data: channel === 'db:narrativeHooks:getContext' ? '钩子' : [] },
      onApply: snapshot => applied.push(snapshot),
    });

    await expect(loader.load('project-a')).resolves.toBe('failed');
    expect(applied).toEqual([]);
  });
});
