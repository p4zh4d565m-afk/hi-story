import type { AIProvider, ChatMessage, ChatOptions, StreamCallbacks, ProviderConfig } from '../provider';
import { AIError } from '../provider';

export class ClaudeProvider implements AIProvider {
  readonly name = 'claude';
  private apiKey: string;
  private defaultModel: string;
  private baseUrl: string;
  private client: any; // Anthropic client (lazy init)

  constructor(config: ProviderConfig) {
    this.apiKey = config.apiKey;
    this.defaultModel = config.model || 'claude-sonnet-4-6';
    this.baseUrl = config.baseUrl || 'https://api.anthropic.com';
    this.client = null;
  }

  private getClient(): any {
    if (!this.client) {
      // Dynamic import to avoid bundling Anthropic SDK in main process
      const { default: Anthropic } = require('@anthropic-ai/sdk');
      this.client = new Anthropic({
        apiKey: this.apiKey,
        baseURL: this.baseUrl,
      });
    }
    return this.client;
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<string> {
    const client = this.getClient();
    try {
      const systemMessages = messages.filter(m => m.role === 'system').map(m => m.content);
      const userAssistantMessages = messages.filter(m => m.role !== 'system').map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

      let systemPrompt = systemMessages.join('\n\n');
      if (options?.systemPrompt) {
        systemPrompt = options.systemPrompt + '\n\n' + systemPrompt;
      }

      const response = await client.messages.create({
        model: options?.model || this.defaultModel,
        max_tokens: options?.maxTokens || 4096,
        temperature: options?.temperature ?? 0.7,
        system: systemPrompt || undefined,
        messages: userAssistantMessages,
      });

      // Extract text from content blocks
      const textBlocks = response.content.filter((block: any) => block.type === 'text');
      return textBlocks.map((block: any) => block.text).join('\n');
    } catch (err: any) {
      throw new AIError(
        err.message || 'Claude API error',
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
      const systemMessages = messages.filter(m => m.role === 'system').map(m => m.content);
      const userAssistantMessages = messages.filter(m => m.role !== 'system').map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

      let systemPrompt = systemMessages.join('\n\n');
      if (options?.systemPrompt) {
        systemPrompt = options.systemPrompt + '\n\n' + systemPrompt;
      }

      const stream = await client.messages.stream({
        model: options?.model || this.defaultModel,
        max_tokens: options?.maxTokens || 4096,
        temperature: options?.temperature ?? 0.7,
        system: systemPrompt || undefined,
        messages: userAssistantMessages,
      });

      let fullText = '';

      stream.on('text', (text: string, delta: string) => {
        if (delta) {
          callbacks.onToken(delta);
        }
        fullText = text;
      });

      stream.on('end', () => {
        callbacks.onComplete(fullText);
      });

      stream.on('error', (err: any) => {
        callbacks.onError(new AIError(err.message, this.name));
      });
    } catch (err: any) {
      callbacks.onError(new AIError(err.message || 'Claude stream error', this.name));
    }
  }

  async validateApiKey(): Promise<boolean> {
    try {
      // Simple validation: try to list models
      const client = this.getClient();
      await client.messages.create({
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
    return [
      'claude-opus-4-8',
      'claude-sonnet-4-6',
      'claude-haiku-4-5-20251001',
      'claude-fable-5',
    ];
  }
}
