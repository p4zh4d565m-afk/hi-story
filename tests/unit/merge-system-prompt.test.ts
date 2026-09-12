import { describe, it, expect } from 'vitest';
import { mergeSystemPrompt } from '../../src/main/ai/merge-system-prompt';
import type { ChatMessage } from '../../src/main/ai/provider';

describe('mergeSystemPrompt', () => {
  it('无 extra 时原样返回 messages（不改动顺序与内容）', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: '系统指令' },
      { role: 'user', content: '你好' },
    ];
    expect(mergeSystemPrompt(messages, undefined)).toBe(messages);
    expect(mergeSystemPrompt(messages, '')).toBe(messages);
  });

  it('有 extra 且已有 system 时，extra 前缀到 system 前，system 合并为一条', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'A' },
      { role: 'system', content: 'B' },
      { role: 'user', content: '问题' },
      { role: 'assistant', content: '回答' },
    ];
    const merged = mergeSystemPrompt(messages, '额外指令');
    expect(merged).toHaveLength(3); // system 合并为 1 + user + assistant
    expect(merged[0]).toEqual({ role: 'system', content: '额外指令\n\nA\n\nB' });
    expect(merged[1]).toEqual({ role: 'user', content: '问题' });
    expect(merged[2]).toEqual({ role: 'assistant', content: '回答' });
  });

  it('有 extra 无 system 时，插入一条 system 在最前', () => {
    const messages: ChatMessage[] = [{ role: 'user', content: '问题' }];
    const merged = mergeSystemPrompt(messages, '额外指令');
    expect(merged).toEqual([
      { role: 'system', content: '额外指令' },
      { role: 'user', content: '问题' },
    ]);
  });
});
