import { describe, expect, it } from 'vitest';
import { createAiRuntimeContextLoader } from '../../../src/renderer/services/ai-runtime-context-loader';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(onResolve => { resolve = onResolve; });
  return { promise, resolve };
}

describe('AI 运行时上下文加载器', () => {
  it('原子加载 as-of 截面、事实与人物知识', async () => {
    const channels: string[] = [];
    const applied: unknown[] = [];
    const loader = createAiRuntimeContextLoader({
      invoke: async (channel) => {
        channels.push(channel);
        if (channel === 'db:narrative:buildAsOfContext') {
          return { success: true, data: { mode: 'project_latest', textBlock: '确认截面', historyWarningCount: 0 } };
        }
        if (channel === 'db:storyFacts:findRecentActive') return { success: true, data: [{ id: 'fact-1' }] };
        return { success: true, data: [{ id: 'knowledge-1' }] };
      },
      onApply: snapshot => applied.push(snapshot),
    });

    await expect(loader.load('project-a')).resolves.toBe('applied');

    expect(channels).toEqual([
      'db:narrative:buildAsOfContext',
      'db:storyFacts:findRecentActive',
      'db:storyFacts:findAllKnowledgeByProject',
    ]);
    expect(applied).toEqual([{
      projectId: 'project-a',
      narrativeAsOfText: '确认截面',
      narrativeAsOfMode: 'project_latest',
      narrativeContext: '确认截面',
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
    // 第二轮：asOf / facts / knowledge
    requests.slice(3, 6).forEach((request, index) => request.resolve({
      success: true,
      data: index === 0
        ? { mode: 'project_latest', textBlock: '最新确认状态', historyWarningCount: 0 }
        : [],
    }));
    await expect(second).resolves.toBe('applied');
    requests.slice(0, 3).forEach((request, index) => request.resolve({
      success: true,
      data: index === 0
        ? { mode: 'project_latest', textBlock: '旧状态', historyWarningCount: 0 }
        : [],
    }));
    await expect(first).resolves.toBe('stale');

    expect(applied).toEqual(['最新确认状态']);
  });

  it('任一数据源失败时不提交残缺快照', async () => {
    const applied: unknown[] = [];
    const loader = createAiRuntimeContextLoader({
      invoke: async channel => channel === 'db:storyFacts:findRecentActive'
        ? { success: false, error: '事实读取失败' }
        : channel === 'db:narrative:buildAsOfContext'
          ? { success: true, data: { mode: 'project_latest', textBlock: '截面', historyWarningCount: 0 } }
          : { success: true, data: [] },
      onApply: snapshot => applied.push(snapshot),
    });

    await expect(loader.load('project-a')).resolves.toBe('failed');
    expect(applied).toEqual([]);
  });
});
