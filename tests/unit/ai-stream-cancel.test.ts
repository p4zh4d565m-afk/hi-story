import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AI_STOPPED_MESSAGE, AI_IGNORED_MESSAGE } from '../../src/renderer/services/ai.service';

let aiService: typeof import('../../src/renderer/services/ai.service')['aiService'];

type Listener = (...args: any[]) => void;
// 真实 electronAPI.on 支持同 channel 多个监听器，mock 需用数组，否则两流互覆盖
const listeners = new Map<string, Listener[]>();

function makeWindow() {
  const invoke = vi.fn(async (channel: string, ...args: any[]) => {
    if (channel === 'ai:chatStream') {
      // args: config, messages, options, projectId
      const projectId = args[3] ?? '';
      return { success: true, data: { streamId: 'stream-' + projectId } };
    }
    if (channel === 'ai:cancelStream') {
      return { success: true, data: { cancelled: true } };
    }
    return { success: true, data: null };
  });
  return {
    invoke,
    on: (channel: string, cb: Listener) => {
      if (!listeners.has(channel)) listeners.set(channel, []);
      listeners.get(channel)!.push(cb);
      return () => {
        const arr = listeners.get(channel) ?? [];
        const i = arr.indexOf(cb);
        if (i >= 0) arr.splice(i, 1);
      };
    },
  };
}

function emit(channel: string, ...args: any[]) {
  for (const cb of listeners.get(channel) ?? []) cb(...args);
}

async function collect(generator: AsyncGenerator<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const t of generator) out.push(t);
  return out;
}

describe('ai.service 流取消与切项目拒收（一期）', () => {
  beforeEach(async () => {
    listeners.clear();
    vi.resetModules();
    (globalThis as any).window = { electronAPI: makeWindow() };
    const mod = await import('../../src/renderer/services/ai.service');
    aiService = mod.aiService;
    aiService.configure('openai', 'test-key', 'gpt-4o');
  });

  it('正常流式：token 按序 yield，complete 后含完整文本', async () => {
    const gen = aiService.chatStream([{ role: 'user', content: 'hi' }], { model: 'm' }, 'p1');
    const p = collect(gen);
    // 让 generator 启动并注册监听器
    await new Promise(r => setTimeout(r, 10));
    emit('ai:streamToken', 'stream-p1', '你');
    emit('ai:streamToken', 'stream-p1', '好');
    emit('ai:streamComplete', 'stream-p1', '你好');
    const result = await p;
    expect(result.join('')).toContain('你好');
  });

  it('切项目作废后立即结束 generator，不等 complete', async () => {
    const gen = aiService.chatStream([{ role: 'user', content: 'hi' }], { model: 'm' }, 'p1');
    const p = collect(gen);
    await new Promise(r => setTimeout(r, 10));
    aiService.ignoreProjectStreams('p1');
    await expect(p).rejects.toThrow(AI_IGNORED_MESSAGE);
  });

  it('切项目作废后，旧项目 token 与 complete 末次 yield 都不进入结果', async () => {
    const gen = aiService.chatStream([{ role: 'user', content: 'hi' }], { model: 'm' }, 'p1');
    const p = collect(gen);
    await new Promise(r => setTimeout(r, 10));
    emit('ai:streamToken', 'stream-p1', '作废前');
    await new Promise(r => setTimeout(r, 40));
    aiService.ignoreProjectStreams('p1');
    emit('ai:streamToken', 'stream-p1', '旧项目迟到文字');
    emit('ai:streamComplete', 'stream-p1', '作废前旧项目迟到文字');
    await expect(p).rejects.toThrow(AI_IGNORED_MESSAGE);
  });

  it('cancelActiveStreams 后 generator 抛「已停止」，不保存', async () => {
    const gen = aiService.chatStream([{ role: 'user', content: 'hi' }], { model: 'm' }, 'p1');
    const p = collect(gen);
    await new Promise(r => setTimeout(r, 10));
    await aiService.cancelActiveStreams('p1');
    await expect(p).rejects.toThrow(AI_STOPPED_MESSAGE);
  });

  it('不同项目互不干扰：作废 p1 不影响 p2 的流', async () => {
    const gen1 = aiService.chatStream([{ role: 'user', content: 'a' }], { model: 'm' }, 'p1');
    const gen2 = aiService.chatStream([{ role: 'user', content: 'b' }], { model: 'm' }, 'p2');
    const p1 = collect(gen1);
    const p2 = collect(gen2);
    await new Promise(r => setTimeout(r, 10));
    aiService.ignoreProjectStreams('p1');
    emit('ai:streamToken', 'stream-p1', 'p1旧');
    emit('ai:streamComplete', 'stream-p1', 'p1旧');
    emit('ai:streamToken', 'stream-p2', 'p2好');
    emit('ai:streamComplete', 'stream-p2', 'p2好');
    await expect(p1).rejects.toThrow(AI_IGNORED_MESSAGE);
    const r2 = await p2;
    expect(r2.join('')).toContain('p2好');
  });
});
