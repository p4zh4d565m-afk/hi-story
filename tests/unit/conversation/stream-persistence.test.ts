import { describe, expect, it } from 'vitest';
import { consumeAndPersistAssistantStream, runPersistedConversationTurn } from '../../../src/renderer/services/conversation-persistence';
import type { ConversationMessage } from '../../../src/renderer/types';

const assistantMessage: ConversationMessage = {
  id: 'assistant-1',
  threadId: 'thread-1',
  role: 'assistant',
  content: '完整回答',
  providerId: 'openai',
  contextType: 'chat',
  sortOrder: 1,
  createdAt: '2026-09-09T00:00:00.000Z',
  updatedAt: '2026-09-09T00:00:00.000Z',
};

describe('AI 流式消息持久化边界', () => {
  it('正常完成时显示临时内容并只保存一次最终全文', async () => {
    async function* stream() {
      yield '部分';
      yield '完整回答';
    }
    const progress: string[] = [];
    const persisted: string[] = [];

    const result = await consumeAndPersistAssistantStream({
      stream: stream(),
      onProgress: text => progress.push(text),
      persist: async content => {
        persisted.push(content);
        return assistantMessage;
      },
    });

    expect(progress).toEqual(['部分', '完整回答']);
    expect(persisted).toEqual(['完整回答']);
    expect(result).toBe(assistantMessage);
  });

  it('流中途失败时保留临时显示但不保存完整 AI 消息', async () => {
    async function* stream() {
      yield '临时内容';
      throw new Error('流失败');
    }
    const progress: string[] = [];
    const persisted: string[] = [];

    await expect(consumeAndPersistAssistantStream({
      stream: stream(),
      onProgress: text => progress.push(text),
      persist: async content => {
        persisted.push(content);
        return assistantMessage;
      },
    })).rejects.toThrow('流失败');

    expect(progress).toEqual(['临时内容']);
    expect(persisted).toEqual([]);
  });

  it('空回复不能保存为成功消息', async () => {
    async function* stream() {
      yield '';
    }
    let persistCalls = 0;

    await expect(consumeAndPersistAssistantStream({
      stream: stream(),
      onProgress: () => {},
      persist: async () => {
        persistCalls += 1;
        return assistantMessage;
      },
    })).rejects.toThrow('AI 未返回可保存内容');

    expect(persistCalls).toBe(0);
  });

  it('对话轮次先保存用户消息，流失败后不追加 AI 消息', async () => {
    const userMessage: ConversationMessage = {
      ...assistantMessage,
      id: 'user-1',
      role: 'user',
      content: '用户问题',
      providerId: null,
      sortOrder: 0,
    };
    const persistedRoles: string[] = [];
    async function* stream() {
      yield '半截回答';
      throw new Error('连接中断');
    }

    await expect(runPersistedConversationTurn({
      persistUser: async () => {
        persistedRoles.push('user');
        return userMessage;
      },
      createStream: () => stream(),
      onUserPersisted: () => {},
      onProgress: () => {},
      persistAssistant: async () => {
        persistedRoles.push('assistant');
        return assistantMessage;
      },
    })).rejects.toThrow('连接中断');

    expect(persistedRoles).toEqual(['user']);
  });
});
