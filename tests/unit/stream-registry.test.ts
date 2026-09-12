import { describe, it, expect } from 'vitest';
import { streamRegistry } from '../../src/main/ai/stream-registry';

function makeEntry(overrides: Partial<Parameters<typeof streamRegistry.register>[1]> = {}) {
  const controller = new AbortController();
  return {
    controller,
    senderId: 1,
    projectId: 'p1',
    terminal: false,
    ...overrides,
  };
}

describe('streamRegistry（一期真实取消）', () => {
  it('cancel 需同时匹配 streamId 与 projectId，命中才 abort 并标 terminal', () => {
    const entry = makeEntry();
    streamRegistry.register('s1', entry);

    expect(streamRegistry.cancel('s1', 'wrong')).toBe(false);
    expect(entry.terminal).toBe(false);
    expect(entry.controller.signal.aborted).toBe(false);

    expect(streamRegistry.cancel('s1', 'p1')).toBe(true);
    expect(entry.terminal).toBe(true);
    expect(entry.controller.signal.aborted).toBe(true);
  });

  it('不存在的 streamId 取消返回 false', () => {
    expect(streamRegistry.cancel('missing', 'p1')).toBe(false);
  });

  it('已终止的流重复取消返回 false（不可重入）', () => {
    const entry = makeEntry();
    streamRegistry.register('s1', entry);
    streamRegistry.markTerminal('s1');

    expect(streamRegistry.cancel('s1', 'p1')).toBe(false);
  });

  it('markTerminal 只标不删', () => {
    const entry = makeEntry();
    streamRegistry.register('s1', entry);
    streamRegistry.markTerminal('s1');
    expect(streamRegistry.get('s1')?.terminal).toBe(true);
  });

  it('abortAllForSender 中止该窗口全部流并移除，不误伤其它窗口', () => {
    const a = makeEntry({ senderId: 1 });
    const b = makeEntry({ senderId: 1, projectId: 'p2' });
    const c = makeEntry({ senderId: 2 });
    streamRegistry.register('sa', a);
    streamRegistry.register('sb', b);
    streamRegistry.register('sc', c);

    streamRegistry.abortAllForSender(1);

    expect(a.controller.signal.aborted).toBe(true);
    expect(b.controller.signal.aborted).toBe(true);
    expect(c.controller.signal.aborted).toBe(false);
    expect(streamRegistry.get('sa')).toBeUndefined();
    expect(streamRegistry.get('sb')).toBeUndefined();
    expect(streamRegistry.get('sc')).toBeDefined();
  });
});
