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

  /**
   * 真正的 SSE 流式对话
   * 使用主进程的 ai:chatStream IPC + webContents 事件，
   * 每个 token 到达时立即 yield，用户能看到逐字输出的效果。
   *
   * 之前是"假流式"：等完整回复返回后再用循环模拟打字。
   * 现在改为真正的 token-by-token 流式，大幅降低首字延迟。
   */
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

    // 调用主进程真正的流式 IPC（会立即返回 streamId）
    const result = await window.electronAPI.invoke('ai:chatStream', config, messages, options) as any;
    if (!result.success) {
      throw new Error(result.error || 'AI 请求失败');
    }

    const { streamId } = result.data as { streamId: string };

    // 用 Promise 驱动的队列桥接 IPC 事件和 async generator
    const pendingTokens: string[] = [];
    let pendingResolve: (() => void) | null = null;
    let finished = false;
    let streamError: Error | null = null;

    const onToken = (sid: string, token: string) => {
      if (sid !== streamId) return;
      pendingTokens.push(token);
      pendingResolve?.();
    };

    const onComplete = (sid: string, _text: string) => {
      if (sid !== streamId) return;
      finished = true;
      cleanup();
      pendingResolve?.();
    };

    const onError = (sid: string, errorMsg: string) => {
      if (sid !== streamId) return;
      streamError = new Error(errorMsg);
      finished = true;
      cleanup();
      pendingResolve?.();
    };

    const unsubscribeToken = window.electronAPI.on('ai:streamToken', onToken);
    const unsubscribeComplete = window.electronAPI.on('ai:streamComplete', onComplete);
    const unsubscribeError = window.electronAPI.on('ai:streamError', onError);
    const cleanup = () => {
      unsubscribeToken();
      unsubscribeComplete();
      unsubscribeError();
    };

    try {
      let fullText = '';
      let lastYieldTime = 0;
      while (!finished) {
        if (pendingTokens.length > 0) {
          // 合并所有积攒的 token
          fullText += pendingTokens.join('');
          pendingTokens.length = 0;
          // 每 ~30ms yield 一次，保证流畅渲染且不造成过多 re-render
          const now = Date.now();
          if (now - lastYieldTime > 30) {
            yield fullText;
            lastYieldTime = now;
          }
        } else {
          // 如果之前有积累文本但还没 yield，现在 yield
          if (Date.now() - lastYieldTime > 30 && fullText) {
            yield fullText;
            lastYieldTime = Date.now();
          }
          // 等待下一个事件
          await new Promise<void>((resolve) => { pendingResolve = resolve; });
          if (streamError) throw streamError;
        }
      }
      // 确保最后一次 yield 包含完整文本
      if (fullText) {
        yield fullText;
      }
    } finally {
      cleanup();
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
