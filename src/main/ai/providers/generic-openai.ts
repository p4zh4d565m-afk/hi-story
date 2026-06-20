import type { AIProvider, ChatMessage, ChatOptions, StreamCallbacks, ProviderConfig } from '../provider';
import { AIError } from '../provider';

/**
 * Generic OpenAI-compatible provider.
 * Supports ANY API that follows OpenAI's /v1/chat/completions format:
 *
 * - OpenAI / ChatGPT
 * - DeepSeek (api.deepseek.com)
 * - Doubao/豆包 (ark.cn-beijing.volces.com)
 * - Groq, Together AI, Perplexity, Mistral, etc.
 * - Any self-hosted vLLM / Ollama / llama.cpp server
 */
export class GenericOpenAIProvider implements AIProvider {
  readonly name: string;
  private apiKey: string;
  private defaultModel: string;
  private baseUrl: string;
  private client: any;

  constructor(config: ProviderConfig) {
    this.name = config.name;
    this.apiKey = config.apiKey;
    this.defaultModel = config.model || 'gpt-4o';
    this.baseUrl = config.baseUrl || 'https://api.openai.com/v1';
    this.client = null;
  }

  private getClient(): any {
    if (!this.client) {
      const { default: OpenAI } = require('openai');
      this.client = new OpenAI({
        apiKey: this.apiKey,
        baseURL: this.baseUrl,
      });
    }
    return this.client;
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<string> {
    const client = this.getClient();
    try {
      const response = await client.chat.completions.create({
        model: options?.model || this.defaultModel,
        max_tokens: options?.maxTokens || 4096,
        temperature: options?.temperature ?? 0.7,
        messages: messages.map(m => ({
          role: m.role as 'system' | 'user' | 'assistant',
          content: m.content,
        })),
      });
      return response.choices[0]?.message?.content || '';
    } catch (err: any) {
      throw new AIError(err.message || `${this.name} API error`, this.name, err.status);
    }
  }

  async chatStream(
    messages: ChatMessage[],
    callbacks: StreamCallbacks,
    options?: ChatOptions,
  ): Promise<void> {
    const client = this.getClient();
    try {
      const stream = await client.chat.completions.create({
        model: options?.model || this.defaultModel,
        max_tokens: options?.maxTokens || 4096,
        temperature: options?.temperature ?? 0.7,
        messages: messages.map(m => ({
          role: m.role as 'system' | 'user' | 'assistant',
          content: m.content,
        })),
        stream: true,
      });

      let fullText = '';
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          fullText += delta;
          callbacks.onToken(delta);
        }
      }
      callbacks.onComplete(fullText);
    } catch (err: any) {
      callbacks.onError(new AIError(err.message || `${this.name} stream error`, this.name));
    }
  }

  async validateApiKey(): Promise<boolean> {
    try {
      const client = this.getClient();
      await client.chat.completions.create({
        model: this.defaultModel,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'Hi' }],
      });
      return true;
    } catch {
      return false;
    }
  }

  getModels(): string[] {
    // Common models for each provider
    const modelMap: Record<string, string[]> = {
      'openai': ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o4-mini', 'o3-mini'],
      'deepseek': ['deepseek-chat', 'deepseek-reasoner'],
      'doubao': ['doubao-pro-32k', 'doubao-lite-32k', 'doubao-pro-128k'],
      'qwen': ['qwen-turbo', 'qwen-plus', 'qwen-max'],
      'zhipu': ['glm-4-flash', 'glm-4', 'glm-4-plus'],
      'moonshot': ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
    };
    return modelMap[this.name] || [this.defaultModel];
  }
}
