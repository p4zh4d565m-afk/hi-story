import type { AIProvider, ChatMessage, ChatOptions, StreamCallbacks, ProviderConfig, EmbedOptions } from '../provider';
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
 *
 * 流式使用原生 fetch + SSE 手动解析，不依赖 OpenAI SDK 的 stream 模式，
 * 避免不同提供商 SSE 格式差异导致的兼容性问题（如豆包流式卡住）。
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

  /**
   * 使用原生 fetch + SSE 手动解析，替代 OpenAI SDK 的 for-await stream。
   *
   * 原因：不同提供商的 SSE 实现细节不同（如豆包/火山方舟），
   * OpenAI SDK 的 stream 解析可能静默失败导致流卡住不结束。
   * 原生 fetch 让我们完全掌控 SSE 解析，不依赖 SDK 的兼容性。
   */
  async chatStream(
    messages: ChatMessage[],
    callbacks: StreamCallbacks,
    options?: ChatOptions,
  ): Promise<void> {
    const model = options?.model || this.defaultModel;
    const maxTokens = options?.maxTokens || 2048;  // 降低默认 max_tokens 加速响应
    const temperature = options?.temperature ?? 0.7;
    const url = `${this.baseUrl}/chat/completions`;

    // 构建 AbortController 用于超时保护
    const abortController = new AbortController();
    const timeoutMs = 120_000; // 2 分钟超时
    const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          temperature,
          messages: messages.map(m => ({
            role: m.role as 'system' | 'user' | 'assistant',
            content: m.content,
          })),
          stream: true,
        }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        let errorMsg = `${this.name} API error: ${response.status}`;
        if (errorText) {
          try {
            const errJson = JSON.parse(errorText);
            errorMsg = errJson.error?.message || errJson.message || errorText;
          } catch {
            errorMsg = errorText.slice(0, 200);
          }
        }
        throw new AIError(errorMsg, this.name, response.status);
      }

      if (!response.body) {
        throw new AIError('Response body is null', this.name);
      }

      // 手动解析 SSE 流
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        // 保留最后一个可能不完整的行
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) continue; // 跳过注释和空行

          if (trimmed === 'data: [DONE]') {
            // 流结束标志
            callbacks.onComplete(fullText);
            clearTimeout(timeoutId);
            return;
          }

          if (trimmed.startsWith('data: ')) {
            const jsonStr = trimmed.slice(6);
            try {
              const parsed = JSON.parse(jsonStr);
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) {
                fullText += delta;
                callbacks.onToken(delta);
              }
            } catch {
              // 忽略无法解析的 JSON 行（某些提供商可能发送空 data）
            }
          }
        }
      }

      // 流自然结束（没有收到 [DONE] 但 reader 已经 done）
      callbacks.onComplete(fullText);
    } catch (err: any) {
      if (err.name === 'AbortError') {
        callbacks.onError(new AIError('请求超时（2分钟），请重试', this.name));
      } else if (err instanceof AIError) {
        callbacks.onError(err);
      } else {
        callbacks.onError(new AIError(err.message || `${this.name} stream error`, this.name));
      }
    } finally {
      clearTimeout(timeoutId);
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

  /**
   * 调用 OpenAI 兼容的 /v1/embeddings 端点
   * 支持：OpenAI、通义千问、豆包、以及任何实现了 OpenAI Embedding API 的服务
   */
  async embed(inputs: string[], options?: EmbedOptions): Promise<number[][]> {
    const url = `${this.baseUrl}/embeddings`;
    const model = options?.model || 'text-embedding-v3';
    const body: Record<string, unknown> = {
      model,
      input: inputs,
    };
    if (options?.dimensions) {
      body.dimensions = options.dimensions;
    }

    const controller = new AbortController();
    const timeoutMs = 30_000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new AIError(
          `Embedding API error ${response.status}: ${errText.slice(0, 200)}`,
          this.name, response.status,
        );
      }

      const json = await response.json() as any;
      // OpenAI 兼容格式: { data: [{ embedding: [...] }, ...] }
      const data = json.data as Array<{ embedding: number[] }>;
      if (!data || !Array.isArray(data)) {
        throw new AIError(`Embedding 返回格式异常`, this.name);
      }
      return data.map(d => d.embedding);
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new AIError('Embedding 请求超时（30s）', this.name);
      }
      if (err instanceof AIError) throw err;
      throw new AIError(err.message || 'Embedding 请求失败', this.name);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  getModels(): string[] {
    // Common models for each provider
    const modelMap: Record<string, string[]> = {
      'openai': ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o4-mini', 'o3-mini'],
      'deepseek': ['deepseek-chat', 'deepseek-reasoner'],
      'doubao': ['doubao-seed-evolving', 'doubao-seed-2-1-pro', 'doubao-seed-2-0-pro', 'doubao-seed-2-0-lite', 'doubao-seed-1-8', 'doubao-seed-1-6', 'doubao-seed-1-6-flash'],
      'volcengine': ['doubao-seed-evolving', 'doubao-seed-2-1-pro', 'doubao-seed-2-0-pro', 'doubao-seed-2-0-lite', 'deepseek-v4-pro', 'deepseek-v4-flash', 'kimi-k2.6', 'glm-5.2'],
      'qwen': ['qwen-turbo', 'qwen-plus', 'qwen-max'],
      'zhipu': ['glm-4-flash', 'glm-4', 'glm-4-plus'],
      'moonshot': ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
    };
    return modelMap[this.name] || [this.defaultModel];
  }
}
