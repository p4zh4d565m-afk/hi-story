import type { ChatMessage } from '../../main/ai/provider';

export interface AIService {
  chat: (messages: ChatMessage[], options?: ChatOptions) => Promise<string>;
  chatStream: (messages: ChatMessage[], options?: ChatOptions) => AsyncGenerator<string>;
  validateKey: (provider: string, apiKey: string, model: string) => Promise<boolean>;
  getModels: (provider: string) => Promise<string[]>;
}

export interface ChatOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}

const DEFAULT_CONFIG = {
  claude: {
    apiKey: '', // User must configure this in the UI
    model: 'claude-sonnet-4-6',
  },
  openai: {
    apiKey: '',
    model: 'gpt-4o',
  },
};

class AIServiceImpl implements AIService {
  private currentProvider: string = 'claude';
  private currentApiKey: string = '';
  private currentModel: string = 'claude-sonnet-4-6';

  /** Set the active AI configuration (called from settings UI or env) */
  configure(provider: string, apiKey: string, model?: string) {
    this.currentProvider = provider;
    this.currentApiKey = apiKey;
    if (model) this.currentModel = model;
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<string> {
    const config = {
      name: this.currentProvider,
      apiKey: this.currentApiKey,
      model: options?.model || this.currentModel,
    };

    if (!config.apiKey) {
      throw new Error('请先配置 AI API Key（在设置中填入你的 API Key）');
    }

    const result = await window.electronAPI.invoke('ai:chat', config, messages, options) as any;
    if (result.success) {
      return result.data as string;
    }
    throw new Error(result.error || 'AI 请求失败');
  }

  async *chatStream(messages: ChatMessage[], options?: ChatOptions): AsyncGenerator<string> {
    const config = {
      name: this.currentProvider,
      apiKey: this.currentApiKey,
      model: options?.model || this.currentModel,
    };

    if (!config.apiKey) {
      throw new Error('请先配置 AI API Key（在设置中填入你的 API Key）');
    }

    // Use non-streaming chat for now (simpler, more reliable)
    const result = await window.electronAPI.invoke('ai:chat', config, messages, options) as any;
    if (result.success) {
      // Simulate streaming by yielding in chunks
      const text = result.data as string;
      const words = text.split('');
      let buffer = '';
      for (let i = 0; i < words.length; i += 5) {
        buffer += words.slice(i, i + 5).join('');
        yield buffer;
        await new Promise(r => setTimeout(r, 10));
      }
      if (buffer !== text) {
        yield text;
      }
    } else {
      throw new Error(result.error || 'AI 请求失败');
    }
  }

  async validateKey(provider: string, apiKey: string, model: string): Promise<boolean> {
    const result = await window.electronAPI.invoke('ai:validateKey', {
      name: provider,
      apiKey,
      model,
    }) as any;
    return result.success && result.data === true;
  }

  async getModels(provider: string): Promise<string[]> {
    const result = await window.electronAPI.invoke('ai:getModels', provider) as any;
    return result.success ? (result.data as string[]) : [];
  }
}

export const aiService: AIService = new AIServiceImpl();
