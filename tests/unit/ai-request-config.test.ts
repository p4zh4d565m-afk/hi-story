import { describe, it, expect } from 'vitest';
import { snapshotAIRequestConfig } from '../../src/renderer/services/ai/request-config';

describe('snapshotAIRequestConfig', () => {
  it('拷贝字段，后续改入参不影响快照', () => {
    const input = { name: 'claude', apiKey: 'sk-live', model: 'claude-sonnet-4-6', baseUrl: 'https://api.anthropic.com' };
    const snap = snapshotAIRequestConfig(input);
    input.apiKey = 'sk-mutated';
    input.model = 'other';
    input.name = 'openai';
    expect(snap.apiKey).toBe('sk-live');
    expect(snap.model).toBe('claude-sonnet-4-6');
    expect(snap.name).toBe('claude');
    expect(snap.baseUrl).toBe('https://api.anthropic.com');
  });

  it('name 取供应商标识，不接受空白', () => {
    const snap = snapshotAIRequestConfig({ name: ' deepseek ', apiKey: 'k', model: 'deepseek-chat' });
    expect(snap.name).toBe('deepseek');
    expect(() => snapshotAIRequestConfig({ name: '   ', apiKey: 'k', model: 'm' }))
      .toThrow('Provider name 不能为空');
  });

  it('modelOverride 非空则覆盖 model；空串或空白则用默认 model', () => {
    const base = { name: 'deepseek', apiKey: 'k', model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com/v1' };
    expect(snapshotAIRequestConfig(base, 'deepseek-reasoner').model).toBe('deepseek-reasoner');
    expect(snapshotAIRequestConfig(base, '').model).toBe('deepseek-chat');
    expect(snapshotAIRequestConfig(base, '  ').model).toBe('deepseek-chat');
    expect(snapshotAIRequestConfig(base).model).toBe('deepseek-chat');
  });

  it('apiKey 与 model 做 trim', () => {
    const snap = snapshotAIRequestConfig({ name: 'openai', apiKey: '  sk  ', model: ' gpt-4o ' });
    expect(snap.apiKey).toBe('sk');
    expect(snap.model).toBe('gpt-4o');
  });

  it('baseUrl 缺省时字段为 undefined', () => {
    const snap = snapshotAIRequestConfig({ name: 'openai', apiKey: 'k', model: 'gpt-4o' });
    expect(snap.baseUrl).toBeUndefined();
  });

  it('baseUrl 空白视为缺省，不写字段', () => {
    const snap = snapshotAIRequestConfig({ name: 'openai', apiKey: 'k', model: 'gpt-4o', baseUrl: '  ' });
    expect(snap.baseUrl).toBeUndefined();
  });
});
