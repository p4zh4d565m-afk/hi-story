import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ProviderConfig } from '../../src/main/ai/provider';
import { AI_STOPPED_MESSAGE, AI_IGNORED_MESSAGE } from '../../src/renderer/services/ai.service';

let aiService: typeof import('../../src/renderer/services/ai.service')['aiService'];

type Listener = (...args: any[]) => void;
// 真实 electronAPI.on 支持同 channel 多个监听器，mock 需用数组，否则两流互覆盖
const listeners = new Map<string, Listener[]>();

const cfg = (): ProviderConfig => ({ name: 'openai', apiKey: 'test-key', model: 'gpt-4o' });

function makeWindow() {
  let streamSequence = 0;
  const invoke = vi.fn(async (channel: string, ...args: any[]) => {
    if (channel === 'ai:chatStream') {
      // args: config, messages, options, projectId；channel 不在 args 内
      const projectId = args[3] ?? '';
      streamSequence += 1;
      return { success: true, data: { streamId: `stream-${projectId}-${streamSequence}` } };
    }
    if (channel === 'ai:cancelStream') {
      return { success: true, data: { cancelled: true } };
    }
    if (channel === 'ai:chat') {
      return { success: true, data: 'ok' };
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
  });

  it('正常流式：token 按序 yield，complete 后含完整文本', async () => {
    const gen = aiService.chatStream(cfg(), [{ role: 'user', content: 'hi' }], undefined, 'p1');
    const p = collect(gen);
    await new Promise(r => setTimeout(r, 10));
    emit('ai:streamToken', 'stream-p1-1', '你');
    emit('ai:streamToken', 'stream-p1-1', '好');
    emit('ai:streamComplete', 'stream-p1-1', '你好');
    const result = await p;
    expect(result.join('')).toContain('你好');
  });

  it('切项目作废后立即结束 generator，不等 complete', async () => {
    const gen = aiService.chatStream(cfg(), [{ role: 'user', content: 'hi' }], undefined, 'p1');
    const p = collect(gen);
    await new Promise(r => setTimeout(r, 10));
    aiService.ignoreProjectStreams('p1');
    await expect(p).rejects.toThrow(AI_IGNORED_MESSAGE);
  });

  it('切项目作废后，旧项目 token 与 complete 末次 yield 都不进入结果', async () => {
    const gen = aiService.chatStream(cfg(), [{ role: 'user', content: 'hi' }], undefined, 'p1');
    const p = collect(gen);
    await new Promise(r => setTimeout(r, 10));
    emit('ai:streamToken', 'stream-p1-1', '作废前');
    await new Promise(r => setTimeout(r, 40));
    aiService.ignoreProjectStreams('p1');
    emit('ai:streamToken', 'stream-p1-1', '旧项目迟到文字');
    emit('ai:streamComplete', 'stream-p1-1', '作废前旧项目迟到文字');
    await expect(p).rejects.toThrow(AI_IGNORED_MESSAGE);
  });

  it('cancelActiveStreams 后 generator 抛「已停止」，不保存', async () => {
    const gen = aiService.chatStream(cfg(), [{ role: 'user', content: 'hi' }], undefined, 'p1');
    const p = collect(gen);
    await new Promise(r => setTimeout(r, 10));
    await aiService.cancelActiveStreams('p1');
    await expect(p).rejects.toThrow(AI_STOPPED_MESSAGE);
  });

  it('不同项目互不干扰：作废 p1 不影响 p2 的流', async () => {
    const gen1 = aiService.chatStream(cfg(), [{ role: 'user', content: 'a' }], undefined, 'p1');
    const gen2 = aiService.chatStream(cfg(), [{ role: 'user', content: 'b' }], undefined, 'p2');
    const p1 = collect(gen1);
    const p2 = collect(gen2);
    await new Promise(r => setTimeout(r, 10));
    aiService.ignoreProjectStreams('p1');
    emit('ai:streamToken', 'stream-p1-1', 'p1旧');
    emit('ai:streamComplete', 'stream-p1-1', 'p1旧');
    emit('ai:streamToken', 'stream-p2-2', 'p2好');
    emit('ai:streamComplete', 'stream-p2-2', 'p2好');
    await expect(p1).rejects.toThrow(AI_IGNORED_MESSAGE);
    const r2 = await p2;
    expect(r2.join('')).toContain('p2好');
  });

  it('缺 projectId 在调用瞬间抛错，不发 IPC', async () => {
    expect(() => aiService.chatStream(cfg(), [{ role: 'user', content: 'hi' }], undefined, '  ')).toThrow('chatStream 需要 projectId');
    expect((window as any).electronAPI.invoke).not.toHaveBeenCalled();
  });

  it('两路重叠流使用各自快照，互不串 model', async () => {
    const a = { name: 'openai', apiKey: 'ka', model: 'model-a' };
    const b = { name: 'openai', apiKey: 'kb', model: 'model-b' };
    const g1 = aiService.chatStream(a, [{ role: 'user', content: 'a' }], undefined, 'p1');
    const g2 = aiService.chatStream(b, [{ role: 'user', content: 'b' }], undefined, 'p1');
    const p1 = collect(g1);
    const p2 = collect(g2);
    await new Promise(r => setTimeout(r, 10));
    const invoke = (window as any).electronAPI.invoke as ReturnType<typeof vi.fn>;
    const streamCalls = invoke.mock.calls.filter((c: unknown[]) => c[0] === 'ai:chatStream');
    expect(streamCalls[0][1].model).toBe('model-a');
    expect(streamCalls[1][1].model).toBe('model-b');
    emit('ai:streamToken', 'stream-p1-1', 'A');
    emit('ai:streamComplete', 'stream-p1-1', 'A');
    emit('ai:streamToken', 'stream-p1-2', 'B');
    emit('ai:streamComplete', 'stream-p1-2', 'B');
    expect((await p1).join('')).toContain('A');
    expect((await p2).join('')).toContain('B');
  });

  it('取得 generator 后改原 config，IPC 仍是调用瞬间快照', async () => {
    const input = { name: 'openai', apiKey: 'test-key', model: 'gpt-4o' };
    const gen = aiService.chatStream(input, [{ role: 'user', content: 'hi' }], undefined, 'p1');
    input.model = 'mutated-after-call';
    input.apiKey = 'mutated-key';
    const p = collect(gen);
    await new Promise(r => setTimeout(r, 10));
    const invoke = (window as any).electronAPI.invoke as ReturnType<typeof vi.fn>;
    const streamCall = invoke.mock.calls.find((c: unknown[]) => c[0] === 'ai:chatStream');
    expect(streamCall[1].model).toBe('gpt-4o');
    expect(streamCall[1].apiKey).toBe('test-key');
    emit('ai:streamToken', 'stream-p1-1', 'ok');
    emit('ai:streamComplete', 'stream-p1-1', 'ok');
    await p;
  });

  it('同项目两路重叠流取消时都必须结束', async () => {
    const g1 = aiService.chatStream(cfg(), [{ role: 'user', content: 'a' }], undefined, 'p1');
    const g2 = aiService.chatStream(cfg(), [{ role: 'user', content: 'b' }], undefined, 'p1');
    const p1 = collect(g1);
    const p2 = collect(g2);
    await new Promise(r => setTimeout(r, 10));
    await aiService.cancelActiveStreams('p1');
    await expect(p1).rejects.toThrow(AI_STOPPED_MESSAGE);
    await expect(p2).rejects.toThrow(AI_STOPPED_MESSAGE);
  });

  it('chat 使用调用瞬间快照，options 不含 model', async () => {
    const input = { name: 'openai', apiKey: 'test-key', model: 'gpt-4o' };
    const pending = aiService.chat(input, [{ role: 'user', content: 'hi' }], { maxTokens: 100, temperature: 0.5 });
    input.model = 'mutated';
    input.apiKey = 'mutated-key';
    await pending;
    const invoke = (window as any).electronAPI.invoke as ReturnType<typeof vi.fn>;
    expect(invoke.mock.calls[0][0]).toBe('ai:chat');
    expect(invoke.mock.calls[0][1].model).toBe('gpt-4o');
    expect(invoke.mock.calls[0][1].apiKey).toBe('test-key');
    expect(invoke.mock.calls[0][2]).toEqual([{ role: 'user', content: 'hi' }]);
    expect(invoke.mock.calls[0][3]).toEqual({ maxTokens: 100, temperature: 0.5 });
    expect(invoke.mock.calls[0][3]).not.toHaveProperty('model');
  });
});
