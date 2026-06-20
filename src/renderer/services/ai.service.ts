import type { ChatMessage } from '../../main/ai/provider';

export interface AIService {
  chat: (messages: ChatMessage[], options?: ChatOptions) => Promise<string>;
  chatStream: (messages: ChatMessage[], options?: ChatOptions) => AsyncGenerator<string>;
  validateKey: (provider: string, apiKey: string, model: string, baseUrl?: string) => Promise<boolean>;
  getModels: (provider: string) => Promise<string[]>;
  configure: (provider: string, apiKey: string, model?: string, baseUrl?: string) => void;
}

export interface ChatOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}

class AIServiceImpl implements AIService {
  private currentProvider: string = 'claude';
  private currentApiKey: string = '';
  private currentModel: string = 'claude-sonnet-4-6';
  private currentBaseUrl: string = '';

  configure(provider: string, apiKey: string, model?: string, baseUrl?: string) {
    this.currentProvider = provider;
    this.currentApiKey = apiKey;
    if (model) this.currentModel = model;
    if (baseUrl) this.currentBaseUrl = baseUrl;
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<string> {
    const config: any = {
      name: this.currentProvider,
      apiKey: this.currentApiKey,
      model: options?.model || this.currentModel,
    };
    if (this.currentBaseUrl) config.baseUrl = this.currentBaseUrl;

    if (!config.apiKey) {
      throw new Error('请先添加 AI 配置（点击 ⚙️ → 选择服务 → 输入 API Key）');
    }

    const result = await window.electronAPI.invoke('ai:chat', config, messages, options) as any;
    if (result.success) return result.data as string;
    throw new Error(result.error || 'AI 请求失败');
  }

  async *chatStream(messages: ChatMessage[], options?: ChatOptions): AsyncGenerator<string> {
    const config: any = {
      name: this.currentProvider,
      apiKey: this.currentApiKey,
      model: options?.model || this.currentModel,
    };
    if (this.currentBaseUrl) config.baseUrl = this.currentBaseUrl;

    if (!config.apiKey) {
      throw new Error('请先添加 AI 配置（点击 ⚙️ → 选择服务 → 输入 API Key）');
    }

    const result = await window.electronAPI.invoke('ai:chat', config, messages, options) as any;
    if (result.success) {
      const text = result.data as string;
      const chars = text.split('');
      let buffer = '';
      for (let i = 0; i < chars.length; i += 5) {
        buffer += chars.slice(i, i + 5).join('');
        yield buffer;
        await new Promise(r => setTimeout(r, 10));
      }
      if (buffer !== text) yield text;
    } else {
      throw new Error(result.error || 'AI 请求失败');
    }
  }

  async validateKey(provider: string, apiKey: string, model: string, baseUrl?: string): Promise<boolean> {
    const config: any = { name: provider, apiKey, model };
    if (baseUrl) config.baseUrl = baseUrl;
    const result = await window.electronAPI.invoke('ai:validateKey', config) as any;
    return result.success && result.data === true;
  }

  async getModels(provider: string): Promise<string[]> {
    const result = await window.electronAPI.invoke('ai:getModels', provider) as any;
    return result.success ? (result.data as string[]) : [];
  }
}

export const aiService: AIService = new AIServiceImpl();
