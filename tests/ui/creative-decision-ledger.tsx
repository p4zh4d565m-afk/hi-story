import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import AIChatPanel from '../../src/renderer/components/AIChatPanel';
import CreativeDecisionPanel from '../../src/renderer/components/CreativeDecisionPanel';
import type {
  CreativeDecision,
  CreativeDecisionDraft,
  CreativeDecisionEffect,
  IpcResult,
} from '../../src/renderer/types';

interface FixtureState {
  decisions: CreativeDecision[];
  targetRecords: CreativeDecisionEffect[];
  confirmFailuresRemaining: number;
  confirmAttempts: number;
  updateDelay: number;
  confirmDelay: number;
  runtimeRefreshDelay: number;
  committedEffects: CreativeDecisionEffect[];
  related: boolean;
  revisionsCreated: number;
  updateFailuresRemaining: number;
  relatedDelay: number;
}

const extractedDraft: CreativeDecisionDraft = {
  type: 'narrative_hook',
  title: '失踪者线索',
  rationale: '后续需要回收',
  payload: {
    subject: '旧车站', hookType: 'foreshadowing',
    description: '旧车站留下带血车票',
    intensity: 4,
  },
};

function makeDecision(draft: CreativeDecisionDraft, id = 'decision-1'): CreativeDecision {
  return {
    ...draft,
    id,
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
      if (channel === 'db:creativeDecisions:findRelatedItems') {
        if (state.relatedDelay) await new Promise(resolve => setTimeout(resolve, state.relatedDelay));
        return { success: true, data: { matches: state.related ? [{ id: 'existing-hook', targetTable: 'narrative_hooks', subject: '旧车站', description: '相关旧钩子', status: 'open' }] : [], knowledge: [], missingSubject: state.related ? [{ id: 'empty-hook', targetTable: 'narrative_hooks', subject: '', description: '缺主体旧钩子', status: 'open' }] : [] } };
      }
      if (channel === 'db:creativeDecisions:prepareRevision') {
        return { success: true, data: { ...extractedDraft, payload: { ...extractedDraft.payload, subject: '', targetId: 'existing-hook' } } };
      }
      if (channel === 'db:creativeDecisions:createRevision') {
        const input = args[0] as { draft: CreativeDecisionDraft; parentDecisionId: string };
        state.revisionsCreated++;
        const decision = { ...makeDecision(input.draft, 'revision-1'), parentDecisionId: input.parentDecisionId };
        state.decisions.push(decision);
        return { success: true, data: decision };
      }
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
        return {
          success: true,
          data: state.decisions.filter(item => item.projectId === String(args[0])),
        };
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
        state.decisions = input.drafts.map(draft => makeDecision(draft));
        return { success: true, data: state.decisions };
      }
      if (channel === 'db:creativeDecisions:updateProposal') {
        const input = args[0] as { decisionId: string; draft: CreativeDecisionDraft };
        if (state.updateFailuresRemaining > 0) {
          state.updateFailuresRemaining--;
          return { success: false, error: '模拟选择保存失败' };
        }
        if (state.updateDelay > 0) {
          await new Promise(resolve => setTimeout(resolve, state.updateDelay));
        }
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
        if (state.confirmDelay > 0) {
          await new Promise(resolve => setTimeout(resolve, state.confirmDelay));
        }
        if (state.confirmFailuresRemaining > 0) {
          state.confirmFailuresRemaining -= 1;
          return { success: false, error: '模拟事务写入失败' };
        }
        const input = args[0] as { decisionIds: string[] };
        for (const decisionId of input.decisionIds) {
          if (!state.targetRecords.some(item => item.decisionId === decisionId)) {
            state.targetRecords.push({
              id: `effect-${decisionId}`,
              decisionId,
              targetTable: 'narrative_hooks',
              targetId: `hook-${decisionId}`,
              operation: 'insert',
              before: null,
              after: { description: '旧车站留下带血车票' },
              createdAt: '2026-09-09T00:03:00.000Z',
            });
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

async function mount(options: {
  confirmFailuresRemaining?: number;
  initialDecisions?: CreativeDecision[];
  updateDelay?: number;
  confirmDelay?: number;
  runtimeRefreshDelay?: number;
  related?: boolean;
  updateFailuresRemaining?: number;
  relatedDelay?: number;
} = {}): Promise<{
  root: Root;
  container: HTMLDivElement;
  state: FixtureState;
  renderProject: (projectId: string) => void;
}> {
  localStorage.clear();
  localStorage.setItem('hi-story-ai-configs', JSON.stringify([{
    id: 'config-a', providerId: 'openai', apiKey: 'test-key', model: 'test-model', label: '测试配置',
  }]));
  const state: FixtureState = {
    decisions: options.initialDecisions ?? [], targetRecords: [],
    confirmFailuresRemaining: options.confirmFailuresRemaining ?? 0,
    confirmAttempts: 0, updateDelay: options.updateDelay ?? 0,
    confirmDelay: options.confirmDelay ?? 0,
    runtimeRefreshDelay: options.runtimeRefreshDelay ?? 0, committedEffects: [],
    related: options.related ?? false, revisionsCreated: 0,
    updateFailuresRemaining: options.updateFailuresRemaining ?? 0, relatedDelay: options.relatedDelay ?? 0,
  };
  window.electronAPI = createElectronApi(state) as typeof window.electronAPI;
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const renderProject = (projectId: string) => flushSync(() => root.render(
    <AIChatPanel projectId={projectId} onCreativeDecisionsCommitted={async effects => {
      if (state.runtimeRefreshDelay > 0) {
        await new Promise(resolve => setTimeout(resolve, state.runtimeRefreshDelay));
      }
      state.committedEffects = effects;
    }} />,
  ));
  renderProject('project-a');
  await until(
    () => Boolean(button('整理为决策')) && document.body.textContent?.includes('test-model') === true,
    '持久化 assistant 消息没有显示整理入口或 AI 配置未完成加载',
  );
  return { root, container, state, renderProject };
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
  ['确认回执返回前不能关闭面板，确保刷新运行时状态', async () => {
    const fixture = await mount({ initialDecisions: [makeDecision(extractedDraft)], confirmDelay: 120 });
    try {
      click('决策(1)'); await tick(); click('确认此项');
      await until(() => fixture.state.confirmAttempts === 1);
      const close = document.querySelector<HTMLButtonElement>('[aria-label="关闭决策面板"]')!;
      assert(close.disabled, '事务进行中仍能关闭并丢弃成功回执');
      flushSync(() => close.click());
      await until(() => fixture.state.committedEffects.length === 1);
      await until(() => document.body.textContent?.includes('写入成功') === true);
      assert(!close.disabled, '确认完成后无法关闭');
    } finally { flushSync(() => fixture.root.unmount()); fixture.container.remove(); }
  }],
  ['批量选择保存失败不调用确认并保留所选草稿', async () => {
    const fixture = await mount({ initialDecisions: [makeDecision(extractedDraft), makeDecision(extractedDraft, 'decision-2')], related: true, updateFailuresRemaining: 1 });
    try {
      click('决策(2)'); await tick(); click('全部确认');
      await until(() => Boolean(button('修订此项'))); click('修订此项');
      await until(() => document.body.textContent?.includes('模拟选择保存失败') === true);
      assert(fixture.state.confirmAttempts === 0 && fixture.state.targetRecords.length === 0, '保存失败仍然进行了运行时写入');
      assert(document.body.textContent?.includes('existing-hook'), '保存失败丢失所选目标');
      assert(document.body.textContent?.includes('有未保存修改'), '丢失待保存标记');
      click('清除未保存的修订目标');
      assert(!document.body.textContent?.includes('existing-hook'), '失败选择不能恢复为独立提议');
      click('保存修改');
      await until(() => fixture.state.decisions[0].payload.targetId === null);
    } finally { flushSync(() => fixture.root.unmount()); fixture.container.remove(); }
  }],
  ['延迟相关项查询跨项目往返后不重开旧弹窗', async () => {
    const fixture = await mount({ initialDecisions: [makeDecision(extractedDraft)], related: true, relatedDelay: 180 });
    try {
      click('决策(1)'); await tick(); click('确认此项');
      fixture.renderProject('project-b'); await tick(); fixture.renderProject('project-a');
      await new Promise(resolve => setTimeout(resolve, 220));
      assert(!document.querySelector('[aria-label="疑似相关项提示"]'), '旧代次相关项重新打开');
      assert(fixture.state.confirmAttempts === 0, '旧查询导致确认');
    } finally { flushSync(() => fixture.root.unmount()); fixture.container.remove(); }
  }],
  ['真实SQLite与界面四类无父修订、交错互斥和失败重试', async () => {
    const backend = (window as any).decisionTestDb as { invoke: (channel: string, ...args: any[]) => Promise<any> };
    const drafts: CreativeDecisionDraft[] = [
      { type: 'story_fact', title: '位置', rationale: '保持一致', payload: { factType: 'location', subject: '主角', predicate: '位于', object: '车站', description: '主角在车站' } },
      { type: 'character_knowledge', title: '知识', rationale: '保持一致', payload: { characterName: '主角', factDescription: '知道车站有密道', source: '亲眼所见' } },
      extractedDraft,
      { type: 'narrative_debt', title: '揭晓', rationale: '兑现承诺', payload: { subject: '车站', debtType: 'reveal', description: '揭晓密道秘密' } },
    ];
    for (const draft of drafts) {
      await backend.invoke('reset');
      const create = async () => (await backend.invoke('db:creativeDecisions:createProposals', { projectId: 'project-a', sourceThreadId: 'thread-a', sourceMessageId: 'assistant-message', drafts: [draft] })).data[0] as CreativeDecision;
      const original = await create();
      const effects = (await backend.invoke('db:creativeDecisions:confirmMany', { projectId: 'project-a', decisionIds: [original.id] })).data.effects;
      const proposal = await create();
      window.electronAPI = { invoke: backend.invoke, on: () => () => {} } as typeof window.electronAPI;
      const container = document.createElement('div'); document.body.append(container);
      const root = createRoot(container);
      const render = async () => {
        const decisions = (await backend.invoke('db:creativeDecisions:findByProject', 'project-a')).data;
        flushSync(() => root.render(<CreativeDecisionPanel projectId="project-a" decisions={decisions} onClose={() => {}} onChanged={render} onCommitted={() => {}} />));
      };
      try {
        await render(); await tick(); click('确认此项');
        await until(() => Boolean(button('修订此项')));
        if (draft.type === 'character_knowledge') assert(document.body.textContent?.includes('相关已有条目'), '人物知识措辞错误');
        const before = await backend.invoke('snapshot');
        await backend.invoke('failure', true); click('修订此项');
        await until(() => document.body.textContent?.includes('写入失败，可重试') === true);
        const failed = await backend.invoke('snapshot');
        assert(JSON.stringify(before[effects[0].targetTable]) === JSON.stringify(failed[effects[0].targetTable]), '失败留下部分目标写入');
        assert(before.creative_decision_effects.length === failed.creative_decision_effects.length, '失败留下effect');
        await backend.invoke('failure', false); click('确认此项');
        await until(() => document.body.textContent?.includes('写入成功') === true);
        const after = await backend.invoke('snapshot');
        const projected = after.creative_decision_effects.filter((x: any) => x.decision_id === proposal.id);
        assert(projected.some((x: any) => x.operation === (['story_fact', 'character_knowledge'].includes(draft.type) ? 'supersede' : 'update')), '四类无父修订走错路径');
        const revisionInput = { projectId: 'project-a', parentDecisionId: proposal.id, draft };
        const concurrent = await Promise.all([backend.invoke('db:creativeDecisions:createRevision', revisionInput), backend.invoke('db:creativeDecisions:createRevision', revisionInput)]);
        assert(concurrent.filter(x => x.success).length === 1, '交错创建留下多个pending');
      } finally { flushSync(() => root.unmount()); container.remove(); }
    }
  }],
  ['疑似相关项与空主体兜底可以选修订', async () => {
    const fixture = await mount({ initialDecisions: [makeDecision(extractedDraft)], related: true });
    try {
      click('决策(1)'); click('确认此项');
      await until(() => document.body.textContent?.includes('同类活跃项（缺少主体，无法自动配对）') === true);
      assert(document.body.textContent?.includes('疑似相关项提示'), '缺少规则提示标题');
      const choices = [...document.querySelectorAll<HTMLButtonElement>('button')].filter(b => b.textContent === '修订此项');
      flushSync(() => choices[1].click());
      await until(() => fixture.state.confirmAttempts === 1);
      assert(fixture.state.decisions[0].payload.targetId === 'empty-hook', '未保存所选兜底目标');
    } finally { flushSync(() => fixture.root.unmount()); fixture.container.remove(); }
  }],
  ['取消确认保持待确认，独立选择清空目标', async () => {
    const fixture = await mount({ initialDecisions: [makeDecision(extractedDraft)], related: true });
    try {
      click('决策(1)'); click('确认此项');
      await until(() => Boolean(button('取消确认'))); click('取消确认'); await tick();
      assert(fixture.state.confirmAttempts === 0, '取消仍发送了确认');
      click('确认此项'); await until(() => Boolean(button('作为独立项确认'))); click('作为独立项确认');
      await until(() => fixture.state.confirmAttempts === 1);
      assert(fixture.state.decisions[0].payload.targetId === null, '独立项没有明确空目标');
    } finally { flushSync(() => fixture.root.unmount()); fixture.container.remove(); }
  }],
  ['已确认历史预填修订且旧主体必须补填，重复点击只创建一次', async () => {
    const fixture = await mount({ initialDecisions: [{ ...makeDecision(extractedDraft), status: 'confirmed' }] });
    try {
      click('决策'); await until(() => Boolean(button('创建修订'))); click('创建修订');
      await until(() => Boolean(button('保存修订提议')));
      assert(button('保存修订提议')!.disabled, '缺少主体仍允许创建');
      const subject = document.querySelector<HTMLInputElement>('[aria-label="主体"]')!;
      assert(subject && subject.value === '', '旧主体没有预填为空');
      setInput(subject, '车票'); await tick();
      const submit = button('保存修订提议')!;
      flushSync(() => { submit.click(); submit.click(); });
      await until(() => fixture.state.revisionsCreated === 1);
      assert(fixture.state.decisions.find(d => d.id === 'revision-1')?.status === 'proposed', '修订被提前确认');
    } finally { flushSync(() => fixture.root.unmount()); fixture.container.remove(); }
  }],
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
      assert(fixture.state.committedEffects.length === 1, '确认效果没有通知上层刷新上下文');
      await until(() => document.body.textContent?.includes('写入成功') === true);
      assert(document.body.textContent?.includes('叙事钩子'), '确认结果没有显示目标表');
      assert(document.body.textContent?.includes('已确认'), '账本没有保留已确认历史');
    } finally {
      flushSync(() => fixture.root.unmount());
      fixture.container.remove();
    }
  }],
  ['确认失败后保留候选并允许重试', async () => {
    const fixture = await mount({ confirmFailuresRemaining: 1 });
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
  ['保存一个候选不会覆盖另一个候选的未保存编辑', async () => {
    const secondDraft: CreativeDecisionDraft = {
      ...extractedDraft,
      title: '站长身份',
      payload: { ...extractedDraft.payload, description: '站长身份仍然成谜' },
    };
    const fixture = await mount({
      initialDecisions: [makeDecision(extractedDraft), makeDecision(secondDraft, 'decision-2')],
    });
    try {
      click('决策(2)');
      await until(() => document.querySelectorAll('[aria-label="决策标题"]').length === 2);
      const inputs = [...document.querySelectorAll<HTMLInputElement>('[aria-label="决策标题"]')];
      setInput(inputs[0], '已保存的第一项');
      setInput(inputs[1], '尚未保存的第二项');
      const saveButtons = [...document.querySelectorAll<HTMLButtonElement>('button')]
        .filter(item => item.textContent?.trim() === '保存修改');
      flushSync(() => saveButtons[0].click());
      await until(() => fixture.state.decisions[0]?.title === '已保存的第一项');
      await tick();
      const refreshedInputs = [...document.querySelectorAll<HTMLInputElement>('[aria-label="决策标题"]')];
      assert(refreshedInputs[1]?.value === '尚未保存的第二项', '刷新覆盖了其他候选的未保存编辑');
    } finally {
      flushSync(() => fixture.root.unmount());
      fixture.container.remove();
    }
  }],
  ['保存期间禁用对应候选的输入控件', async () => {
    const fixture = await mount({
      initialDecisions: [makeDecision(extractedDraft)],
      updateDelay: 120,
    });
    try {
      click('决策(1)');
      await until(() => Boolean(document.querySelector('[aria-label="决策标题"]')));
      const titleInput = document.querySelector<HTMLInputElement>('[aria-label="决策标题"]')!;
      setInput(titleInput, '保存中的标题');
      click('保存修改');
      assert(titleInput.disabled, '保存期间标题仍可继续编辑');
      await until(() => fixture.state.decisions[0]?.title === '保存中的标题');
    } finally {
      flushSync(() => fixture.root.unmount());
      fixture.container.remove();
    }
  }],
  ['项目切换后忽略旧项目的延迟确认回执', async () => {
    const fixture = await mount({
      initialDecisions: [makeDecision(extractedDraft)],
      confirmDelay: 120,
    });
    try {
      click('决策(1)');
      await until(() => Boolean(document.querySelector('[aria-label="决策标题"]')));
      click('确认此项');
      await until(() => fixture.state.confirmAttempts === 1);
      fixture.renderProject('project-b');
      await until(() => fixture.state.targetRecords.length === 1);
      await tick();
      assert(fixture.state.committedEffects.length === 0, '旧项目确认回执触发了当前项目刷新');
      assert(!document.body.textContent?.includes('写入成功'), '旧项目写入结果显示在当前项目面板');
    } finally {
      flushSync(() => fixture.root.unmount());
      fixture.container.remove();
    }
  }],
  ['运行时上下文刷新完成前不显示成功且禁用普通对话发送', async () => {
    const fixture = await mount({
      initialDecisions: [makeDecision(extractedDraft)],
      runtimeRefreshDelay: 120,
    });
    try {
      click('决策(1)');
      await until(() => Boolean(document.querySelector('[aria-label="决策标题"]')));
      click('确认此项');
      await until(() => fixture.state.targetRecords.length === 1);
      const chatInput = document.querySelector<HTMLTextAreaElement>('textarea[placeholder*="和 AI 讨论"]');
      await until(() => chatInput?.disabled === true, '上下文刷新期间普通对话仍可发送');
      assert(!document.body.textContent?.includes('写入成功'), '上下文刷新前过早显示写入成功');
      await until(() => fixture.state.committedEffects.length === 1);
      await until(() => document.body.textContent?.includes('写入成功') === true);
      assert(!chatInput.disabled, '上下文刷新完成后普通对话仍被禁用');
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
