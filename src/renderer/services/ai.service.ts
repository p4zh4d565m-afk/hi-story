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

class AIServiceImpl implements AIService {
  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<string> {
    // Will be wired to AI IPC handlers
    const result = await window.electronAPI.invoke('ai:chat', null, messages, options) as any;
    if (result.success) {
      return result.data as string;
    }
    throw new Error(result.error || 'AI chat failed');
  }

  async *chatStream(messages: ChatMessage[], options?: ChatOptions): AsyncGenerator<string> {
    // Streaming requires special handling via event listeners
    // This is a placeholder — full streaming UI in Task 12
    const result = await window.electronAPI.invoke('ai:chat', null, messages, options) as any;
    if (result.success) {
      yield result.data as string;
    } else {
      throw new Error(result.error || 'AI stream failed');
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
