import type { AIProvider, ChatMessage, ChatOptions, StreamCallbacks, ProviderConfig } from '../provider';
import { AIError } from '../provider';

export class OpenAIProvider implements AIProvider {
  readonly name = 'openai';
  private apiKey: string;
  private defaultModel: string;
  private baseUrl: string;
  private client: any;

  constructor(config: ProviderConfig) {
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
      // OpenAI uses 'developer' role instead of 'system' for newer models
      const formattedMessages = messages.map(m => ({
        role: m.role === 'system' ? 'system' : m.role,
        content: m.content,
      }));

      const response = await client.chat.completions.create({
        model: options?.model || this.defaultModel,
        max_tokens: options?.maxTokens || 4096,
        temperature: options?.temperature ?? 0.7,
        messages: formattedMessages,
      });

      return response.choices[0]?.message?.content || '';
    } catch (err: any) {
      throw new AIError(
        err.message || 'OpenAI API error',
        this.name,
        err.status,
      );
    }
  }

  async chatStream(
    messages: ChatMessage[],
    callbacks: StreamCallbacks,
    options?: ChatOptions,
  ): Promise<void> {
    const client = this.getClient();
    try {
      const formattedMessages = messages.map(m => ({
        role: m.role === 'system' ? 'system' : m.role,
        content: m.content,
      }));

      const stream = await client.chat.completions.create({
        model: options?.model || this.defaultModel,
        max_tokens: options?.maxTokens || 4096,
        temperature: options?.temperature ?? 0.7,
        messages: formattedMessages,
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
      callbacks.onError(new AIError(err.message || 'OpenAI stream error', this.name));
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

  async embed(inputs: string[], options?: import('../provider').EmbedOptions): Promise<number[][]> {
    const client = this.getClient();
    try {
      const response = await client.embeddings.create({
        model: options?.model || 'text-embedding-3-small',
        input: inputs,
        dimensions: options?.dimensions,
      });
      return response.data.map((d: any) => d.embedding);
    } catch (err: any) {
      throw new AIError(err.message || 'OpenAI Embedding error', this.name, err.status);
    }
  }

  getModels(): string[] {
    return [
      'gpt-4o',
      'gpt-4o-mini',
      'gpt-4-turbo',
      'o3-mini',
      'o4-mini',
    ];
  }
}
