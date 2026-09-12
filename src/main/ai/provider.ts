// AI Provider 抽象接口
// 所有 AI 服务（Claude、GPT 等）都实现此接口

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface StreamCallbacks {
  onToken: (token: string) => void;
  onComplete: (fullText: string) => void;
  onError: (error: Error) => void;
}

export interface CompletionCallbacks {
  onComplete: (text: string) => void;
  onError: (error: Error) => void;
}

export interface AIProvider {
  /** Provider 标识 */
  readonly name: string;

  /** 发送消息并获取完整响应 */
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<string>;

  /** 发送消息并获取流式响应 */
  chatStream(messages: ChatMessage[], callbacks: StreamCallbacks, options?: ChatOptions): Promise<void>;

  /** 文本向量化（Embedding），返回每个输入文本对应的向量数组 */
  embed(inputs: string[], options?: EmbedOptions): Promise<number[][]>;

  /** 检查 API Key 是否有效 */
  validateApiKey(): Promise<boolean>;

  /** 获取可用模型列表 */
  getModels(): string[];
}

export interface EmbedOptions {
  model?: string;
  dimensions?: number; // 向量维度（部分模型支持调低维度）
}

export interface ChatOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  /** 系统角色提示（会作为 system 消息前置） */
  systemPrompt?: string;
  /** 取消信号。用户点停止或切走项目后，Provider 应据此中止底层请求。 */
  signal?: AbortSignal;
}

/** 用户主动取消 AI 流时归一出的错误码（不能显示为普通网络失败）。 */
export const AI_STREAM_CANCELLED = 'AI_STREAM_CANCELLED';

export interface ProviderConfig {
  name: string;
  apiKey: string;
  model: string;
  baseUrl?: string;
}

export class AIError extends Error {
  constructor(
    message: string,
    public provider: string,
    public statusCode?: number,
  ) {
    super(message);
    this.name = 'AIError';
  }
}
