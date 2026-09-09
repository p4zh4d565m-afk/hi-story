import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import AIChatPanel from '../../src/renderer/components/AIChatPanel';
import type {
  CreativeDecision,
  CreativeDecisionDraft,
  IpcResult,
} from '../../src/renderer/types';

interface FixtureState {
  decisions: CreativeDecision[];
  targetRecords: Array<{ decisionId: string }>;
  confirmFailuresRemaining: number;
  confirmAttempts: number;
}

const extractedDraft: CreativeDecisionDraft = {
  type: 'narrative_hook',
  title: '失踪者线索',
  rationale: '后续需要回收',
  payload: {
    hookType: 'foreshadowing',
    description: '旧车站留下带血车票',
    intensity: 4,
  },
};

function makeDecision(draft: CreativeDecisionDraft): CreativeDecision {
  return {
    ...draft,
    id: 'decision-1',
    projectId: 'project-a',
    sourceThreadId: 'thread-a',
    sourceMessageId: 'assistant-message',
    parentDecisionId: null,
    status: 'proposed',
    createdAt: '2026-09-09T00:02:00.000Z',
    confirmedAt: null,
    rejectedAt: null,
  };
}

function createElectronApi(state: FixtureState) {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const emit = (channel: string, ...args: unknown[]) => {
    listeners.get(channel)?.forEach(listener => listener(...args));
  };
  return {
    on(channel: string, callback: (...args: unknown[]) => void) {
      const entries = listeners.get(channel) ?? new Set();
      entries.add(callback);
      listeners.set(channel, entries);
      return () => entries.delete(callback);
    },
    async invoke(channel: string, ...args: unknown[]): Promise<unknown> {
      if (channel === 'db:conversation:migrateLegacy') {
        return { success: true, data: { status: 'no_data', threadCount: 0, messageCount: 0 } };
      }
      if (channel === 'db:conversation:findByProject') {
        return {
          success: true,
          data: {
            threads: [{
              id: 'thread-a', projectId: 'project-a', title: '默认对话', category: 'general',
              createdAt: '2026-09-09T00:00:00.000Z', updatedAt: '2026-09-09T00:01:00.000Z',
            }],
            messages: {
              'thread-a': [{
                id: 'assistant-message', threadId: 'thread-a', role: 'assistant',
                content: '可以让旧车站留下一张带血车票，后续揭示失踪者去向。',
                providerId: 'openai', contextType: 'chat', sortOrder: 0,
                createdAt: '2026-09-09T00:01:00.000Z', updatedAt: '2026-09-09T00:01:00.000Z',
              }],
            },
          },
        };
      }
      if (channel === 'db:creativeDecisions:findByProject') {
        return { success: true, data: state.decisions };
      }
      if (channel === 'ai:chatStream') {
        setTimeout(() => {
          const text = JSON.stringify([extractedDraft]);
          emit('ai:streamToken', 'decision-stream', text);
          setTimeout(() => emit('ai:streamComplete', 'decision-stream', text), 40);
        }, 20);
        return { success: true, data: { streamId: 'decision-stream' } };
      }
      if (channel === 'db:creativeDecisions:createProposals') {
        const input = args[0] as { drafts: CreativeDecisionDraft[] };
        state.decisions = input.drafts.map(makeDecision);
        return { success: true, data: state.decisions };
      }
      if (channel === 'db:creativeDecisions:updateProposal') {
        const input = args[0] as { decisionId: string; draft: CreativeDecisionDraft };
        state.decisions = state.decisions.map(item => item.id === input.decisionId
          ? { ...item, ...input.draft } as CreativeDecision
          : item);
        return { success: true, data: state.decisions.find(item => item.id === input.decisionId) };
      }
      if (channel === 'db:creativeDecisions:reject') {
        const decisionId = String(args[1]);
        state.decisions = state.decisions.map(item => item.id === decisionId
          ? { ...item, status: 'rejected' }
          : item);
        return { success: true, data: state.decisions.find(item => item.id === decisionId) };
      }
      if (channel === 'db:creativeDecisions:confirmMany') {
        state.confirmAttempts += 1;
        if (state.confirmFailuresRemaining > 0) {
          state.confirmFailuresRemaining -= 1;
          return { success: false, error: '模拟事务写入失败' };
        }
        const input = args[0] as { decisionIds: string[] };
        for (const decisionId of input.decisionIds) {
          if (!state.targetRecords.some(item => item.decisionId === decisionId)) {
            state.targetRecords.push({ decisionId });
          }
        }
        state.decisions = state.decisions.map(item => input.decisionIds.includes(item.id)
          ? { ...item, status: 'confirmed' }
          : item);
        return {
          success: true,
          data: { decisions: state.decisions, effects: state.targetRecords },
        };
      }
      throw new Error(`未处理的测试 IPC：${channel}`);
    },
  };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function until(predicate: () => boolean, message = '等待界面状态超时') {
  const deadline = Date.now() + 2500;
  while (!predicate()) {
    assert(Date.now() < deadline, message);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

const tick = () => new Promise(resolve => setTimeout(resolve, 30));

function button(label: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>('button')]
    .find(item => item.textContent?.trim() === label);
}

function click(label: string): void {
  const target = button(label);
  assert(target, `没有找到按钮：${label}`);
  flushSync(() => target.click());
}

function setInput(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype = input instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function mount(confirmFailuresRemaining = 0): Promise<{
  root: Root;
  container: HTMLDivElement;
  state: FixtureState;
}> {
  localStorage.clear();
  localStorage.setItem('hi-story-ai-configs', JSON.stringify([{
    id: 'config-a', providerId: 'openai', apiKey: 'test-key', model: 'test-model', label: '测试配置',
  }]));
  const state: FixtureState = {
    decisions: [], targetRecords: [], confirmFailuresRemaining, confirmAttempts: 0,
  };
  window.electronAPI = createElectronApi(state) as typeof window.electronAPI;
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  flushSync(() => root.render(<AIChatPanel projectId="project-a" />));
  await until(
    () => Boolean(button('整理为决策')) && document.body.textContent?.includes('test-model') === true,
    '持久化 assistant 消息没有显示整理入口或 AI 配置未完成加载',
  );
  return { root, container, state };
}

async function extract(): Promise<void> {
  click('整理为决策');
  try {
    await until(() => Boolean(document.querySelector('[aria-label="决策标题"]')), '候选确认面板没有打开');
  } catch {
    throw new Error(`候选确认面板没有打开；当前界面：${document.body.textContent?.replace(/\s+/g, ' ').trim()}`);
  }
}

const cases: Array<[string, () => Promise<void>]> = [
  ['只有已落库 assistant 消息显示整理入口', async () => {
    const fixture = await mount();
    try {
      assert(button('整理为决策'), 'assistant 消息缺少整理入口');
      assert(document.querySelectorAll('button').length > 0, '聊天界面没有完成渲染');
    } finally {
      flushSync(() => fixture.root.unmount());
      fixture.container.remove();
    }
  }],
  ['提取后的候选可以编辑并保存', async () => {
    const fixture = await mount();
    try {
      await extract();
      const titleInput = document.querySelector<HTMLInputElement>('[aria-label="决策标题"]');
      assert(titleInput, '没有找到决策标题输入框');
      setInput(titleInput, '更新后的失踪者线索');
      click('保存修改');
      await until(() => fixture.state.decisions[0]?.title === '更新后的失踪者线索');
    } finally {
      flushSync(() => fixture.root.unmount());
      fixture.container.remove();
    }
  }],
  ['拒绝候选不会生成目标记录', async () => {
    const fixture = await mount();
    try {
      await extract();
      click('拒绝');
      await until(() => fixture.state.decisions[0]?.status === 'rejected');
      assert(fixture.state.targetRecords.length === 0, '拒绝候选仍生成了目标记录');
    } finally {
      flushSync(() => fixture.root.unmount());
      fixture.container.remove();
    }
  }],
  ['确认候选通过单一确认命令生成目标记录', async () => {
    const fixture = await mount();
    try {
      await extract();
      click('确认此项');
      await until(() => fixture.state.targetRecords.length === 1);
      assert(fixture.state.confirmAttempts === 1, '确认不应发送多次请求');
    } finally {
      flushSync(() => fixture.root.unmount());
      fixture.container.remove();
    }
  }],
  ['确认失败后保留候选并允许重试', async () => {
    const fixture = await mount(1);
    try {
      await extract();
      click('确认此项');
      await until(() => document.body.textContent?.includes('写入失败，可重试') === true);
      assert(document.querySelector('[aria-label="决策标题"]'), '确认失败后候选被清空');
      click('确认此项');
      await until(() => fixture.state.targetRecords.length === 1);
      assert(fixture.state.confirmAttempts === 2, '失败重试次数不正确');
    } finally {
      flushSync(() => fixture.root.unmount());
      fixture.container.remove();
    }
  }],
];

(window as unknown as { runCreativeDecisionRegression: () => Promise<unknown> })
  .runCreativeDecisionRegression = async () => {
    const results: Array<{ name: string; error?: string }> = [];
    for (const [name, run] of cases) {
      try {
        await run();
        results.push({ name });
      } catch (error) {
        results.push({ name, error: String(error) });
        document.body.replaceChildren();
        await tick();
      }
    }
    return results;
  };
