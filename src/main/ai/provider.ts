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

  /** 检查 API Key 是否有效 */
  validateApiKey(): Promise<boolean>;

  /** 获取可用模型列表 */
  getModels(): string[];
}

export interface ChatOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  /** 系统角色提示（会作为 system 消息前置） */
  systemPrompt?: string;
}

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
