import type { AIProvider, ProviderConfig } from './provider';
import { ClaudeProvider } from './providers/claude';
import { GenericOpenAIProvider } from './providers/generic-openai';

/**
 * Pre-defined provider presets.
 * Each has a name, base URL, and is either Claude or OpenAI-compatible.
 */
export interface ProviderPreset {
  id: string;
  name: string;
  displayName: string;
  baseUrl: string;
  type: 'claude' | 'openai-compatible';
  defaultModel: string;
  models: string[];
  hint?: string; // 提示信息（如火山方舟需要 ep- ID）
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  // ===== Claude (Anthropic native API) =====
  {
    id: 'claude',
    name: 'claude',
    displayName: 'Claude (Anthropic)',
    baseUrl: 'https://api.anthropic.com',
    type: 'claude',
    defaultModel: 'claude-sonnet-4-6',
    models: ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001', 'claude-opus-4-8', 'claude-fable-5'],
  },
  // ===== OpenAI =====
  {
    id: 'openai',
    name: 'openai',
    displayName: 'OpenAI / ChatGPT',
    baseUrl: 'https://api.openai.com/v1',
    type: 'openai-compatible',
    defaultModel: 'gpt-4o',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o4-mini', 'o3-mini'],
  },
  // ===== DeepSeek =====
  {
    id: 'deepseek',
    name: 'deepseek',
    displayName: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    type: 'openai-compatible',
    defaultModel: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-reasoner'],
  },
  // ===== 豆包 / 火山方舟 (ByteDance) =====
  {
    id: 'doubao',
    name: 'doubao',
    displayName: '豆包 (火山方舟)',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    type: 'openai-compatible',
    defaultModel: 'doubao-seed-evolving',
    models: ['doubao-seed-evolving', 'doubao-seed-2-1-pro', 'doubao-seed-2-0-pro', 'doubao-seed-2-0-lite', 'doubao-seed-1-8', 'doubao-seed-1-6', 'doubao-seed-1-6-flash'],
    hint: '也可直接填入 ep- 接入点 ID 或任意豆包模型名',
  },
  // ===== 火山方舟（全平台模型）=====
  {
    id: 'volcengine',
    name: 'volcengine',
    displayName: '火山方舟 (全模型)',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    type: 'openai-compatible',
    defaultModel: 'doubao-seed-evolving',
    models: ['doubao-seed-evolving', 'doubao-seed-2-1-pro', 'doubao-seed-2-0-pro', 'doubao-seed-2-0-lite', 'deepseek-v4-pro', 'deepseek-v4-flash', 'kimi-k2.6', 'glm-5.2'],
    hint: '也可直接填入 ep- 接入点 ID 或任意模型名',
  },
  // ===== 通义千问 (Alibaba) =====
  {
    id: 'qwen',
    name: 'qwen',
    displayName: '通义千问 (阿里)',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    type: 'openai-compatible',
    defaultModel: 'qwen-plus',
    models: ['qwen-turbo', 'qwen-plus', 'qwen-max'],
  },
  // ===== 智谱 GLM =====
  {
    id: 'zhipu',
    name: 'zhipu',
    displayName: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    type: 'openai-compatible',
    defaultModel: 'glm-4-flash',
    models: ['glm-4-flash', 'glm-4', 'glm-4-plus'],
  },
  // ===== Moonshot (Kimi) =====
  {
    id: 'moonshot',
    name: 'moonshot',
    displayName: 'Moonshot (Kimi)',
    baseUrl: 'https://api.moonshot.cn/v1',
    type: 'openai-compatible',
    defaultModel: 'moonshot-v1-8k',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
  },
  // ===== Custom (user-defined endpoint) =====
  {
    id: 'custom',
    name: 'custom',
    displayName: '自定义 API',
    baseUrl: '',
    type: 'openai-compatible',
    defaultModel: '',
    models: [],
  },
];

class ProviderCache {
  private cache = new Map<string, AIProvider>();

  key(config: ProviderConfig): string {
    // Include apiKey in the cache key so config changes take effect immediately
    const apiKey = config.apiKey || '';
    return `${config.name}:${config.model}|${apiKey.slice(0, 8)}`;
  }

  get(key: string): AIProvider | undefined {
    return this.cache.get(key);
  }

  set(key: string, provider: AIProvider): void {
    this.cache.set(key, provider);
  }

  /** Clear all cached providers (e.g., on config reset) */
  clear(): void {
    this.cache.clear();
  }
}

const providerCache = new ProviderCache();

export class ProviderFactory {
  private static customPresets: ProviderPreset[] = [];

  /** Add a user-defined provider */
  static addCustomPreset(preset: ProviderPreset): void {
    const idx = this.customPresets.findIndex(p => p.id === preset.id);
    if (idx >= 0) {
      this.customPresets[idx] = preset;
    } else {
      this.customPresets.push(preset);
    }
  }

  /** Get all available presets (built-in + custom) */
  static getAllPresets(): ProviderPreset[] {
    return [...PROVIDER_PRESETS, ...this.customPresets];
  }

  static getPreset(id: string): ProviderPreset | undefined {
    return this.getAllPresets().find(p => p.id === id);
  }

  /** Create an AI provider from a config (cached by key) */
  static create(config: ProviderConfig): AIProvider {
    const cacheKey = providerCache.key(config);
    const cached = providerCache.get(cacheKey);
    if (cached) return cached;

    const name = config.name.toLowerCase();

    let provider: AIProvider;
    // Claude uses its own native API
    if (name === 'claude') {
      provider = new ClaudeProvider(config);
    } else {
      // Everything else uses OpenAI-compatible protocol
      provider = new GenericOpenAIProvider(config);
    }

    providerCache.set(cacheKey, provider);
    return provider;
  }

  /** Invalidate cached providers when config changes */
  static invalidateCache(): void {
    providerCache.clear();
  }

  static getAvailableProviders(): string[] {
    return this.getAllPresets().map(p => p.id);
  }
}
