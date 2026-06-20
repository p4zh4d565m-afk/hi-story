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
  // ===== 豆包 (ByteDance) =====
  {
    id: 'doubao',
    name: 'doubao',
    displayName: '豆包 (字节跳动)',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    type: 'openai-compatible',
    defaultModel: 'doubao-pro-32k',
    models: ['doubao-pro-32k', 'doubao-lite-32k', 'doubao-pro-128k'],
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

  /** Create an AI provider from a config */
  static create(config: ProviderConfig): AIProvider {
    const name = config.name.toLowerCase();

    // Claude uses its own native API
    if (name === 'claude') {
      return new ClaudeProvider(config);
    }

    // Everything else uses OpenAI-compatible protocol
    return new GenericOpenAIProvider(config);
  }

  static getAvailableProviders(): string[] {
    return this.getAllPresets().map(p => p.id);
  }
}
