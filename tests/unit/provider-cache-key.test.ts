import { describe, it, expect } from 'vitest';
import { providerCacheKey } from '../../src/main/ai/provider-factory';
import type { ProviderConfig } from '../../src/main/ai/provider';

describe('providerCacheKey', () => {
  const base: ProviderConfig = {
    name: 'openai',
    model: 'gpt-4o',
    apiKey: 'sk-abcdefgh',
    baseUrl: 'https://api.openai.com/v1',
  };

  it('同 name+model 但 baseUrl 不同 → 键不同', () => {
    const a = providerCacheKey(base);
    const b = providerCacheKey({ ...base, baseUrl: 'https://custom.example.com/v1' });
    expect(a).not.toBe(b);
  });

  it('两把 Key 前 8 位相同但后续不同 → 键不同（不再截断前 8 位）', () => {
    const a = providerCacheKey({ ...base, apiKey: 'sk-12345678-AAAA' });
    const b = providerCacheKey({ ...base, apiKey: 'sk-12345678-BBBB' });
    expect(a).not.toBe(b);
  });

  it('baseUrl 缺省时键稳定（空串占位）', () => {
    const a = providerCacheKey({ ...base, baseUrl: undefined });
    const b = providerCacheKey({ ...base, baseUrl: '' });
    expect(a).toBe(b);
  });
});
