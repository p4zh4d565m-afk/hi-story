import type { AIProvider, ChatMessage, ChatOptions, StreamCallbacks, ProviderConfig } from '../provider';
import { AIError, AI_STREAM_CANCELLED } from '../provider';
import { mergeSystemPrompt } from '../merge-system-prompt';

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
      const merged = mergeSystemPrompt(messages, options?.systemPrompt);
      const systemMessages = merged.filter(m => m.role === 'system').map(m => m.content);
      const userAssistantMessages = merged.filter(m => m.role !== 'system').map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

      const systemPrompt = systemMessages.join('\n\n');

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
    let stream: any = null;
    try {
      const client = this.getClient();
      const merged = mergeSystemPrompt(messages, options?.systemPrompt);
      const systemMessages = merged.filter(m => m.role === 'system').map(m => m.content);
      const userAssistantMessages = merged.filter(m => m.role !== 'system').map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

      const systemPrompt = systemMessages.join('\n\n');

      stream = await client.messages.stream({
        model: options?.model || this.defaultModel,
        max_tokens: options?.maxTokens || 4096,
        temperature: options?.temperature ?? 0.7,
        system: systemPrompt || undefined,
        messages: userAssistantMessages,
      }, options?.signal ? { signal: options.signal } : undefined);

      let fullText = '';

      // 用户取消：主动 abort 底层流，让其走 error 分支（下面归一为 AI_STREAM_CANCELLED）
      const onUserAbort = () => {
        try {
          stream?.abort();
        } catch { /* abort 失败则静默，等流自然结束 */ }
      };
      options?.signal?.addEventListener('abort', onUserAbort, { once: true });

      // Attach event listeners BEFORE the stream can start emitting
      stream.on('text', (text: string, delta: string) => {
        if (delta) {
          callbacks.onToken(delta);
        }
        fullText = text;
      });

      stream.on('end', () => {
        options?.signal?.removeEventListener('abort', onUserAbort);
        callbacks.onComplete(fullText);
      });

      stream.on('error', (err: any) => {
        options?.signal?.removeEventListener('abort', onUserAbort);
        const isCancelled = options?.signal?.aborted;
        callbacks.onError(
          isCancelled
            ? new AIError('已停止生成', this.name)
            : new AIError(err?.message || 'Claude stream error', this.name),
        );
      });
    } catch (err: any) {
      if (options?.signal?.aborted) {
        callbacks.onError(new AIError(AI_STREAM_CANCELLED, this.name));
      } else {
        callbacks.onError(new AIError(err.message || 'Claude stream error', this.name));
      }
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

  /** Claude 不支持 Embedding API，调用此方法会抛出错误 */
  async embed(_inputs: string[], _options?: import('../provider').EmbedOptions): Promise<number[][]> {
    throw new AIError('Claude provider 不支持 Embedding API，请使用 OpenAI 兼容 provider（如通义千问）', this.name);
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
