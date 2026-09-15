import type { ChatMessage, ProviderConfig } from '../../main/ai/provider';
import { snapshotAIRequestConfig } from './ai/request-config';

export interface AIService {
  chat: (config: ProviderConfig, messages: ChatMessage[], options?: ChatCallOptions) => Promise<string>;
  /** 流式对话。projectId 必填，用于取消校验与切项目拒收。 */
  chatStream: (config: ProviderConfig, messages: ChatMessage[], options: ChatCallOptions | undefined, projectId: string) => AsyncGenerator<string>;
  /** 停止：真正 abort 该项目下所有活跃流，对应 generator 抛「已停止」，不会保存。 */
  cancelActiveStreams: (projectId: string) => Promise<void>;
  /** 作废某项目下所有活跃流：结束对应 generator（抛 AI_IGNORED_MESSAGE），后续 token 不再 yield。切项目用，不 abort 主进程请求。 */
  ignoreProjectStreams: (projectId: string) => void;
  validateKey: (provider: string, apiKey: string, model: string, baseUrl?: string) => Promise<boolean>;
  getModels: (provider: string) => Promise<string[]>;
}

export interface ChatCallOptions {
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}

/** streamId → 桥接状态。cancelStream / ignoreProjectStreams 靠它唤醒或作废对应 generator。 */
interface StreamBridge {
  projectId: string;
  ignored: boolean;
  cancelled: boolean;
  wake: (() => void) | null;
}

export const AI_STOPPED_MESSAGE = '已停止生成，不会保存';
/** 切项目作废映射：结束 for-await，不把迟到结果写进当前界面。主进程流按 Spec 不自动 abort。 */
export const AI_IGNORED_MESSAGE = '已切换项目，迟到结果不会写入当前界面';

export function isSilentAiStreamEnd(message: string): boolean {
  return message === AI_STOPPED_MESSAGE || message === AI_IGNORED_MESSAGE;
}

/** 把内部/供应商英文错误翻译成友好中文提示，不暴露底层英文串。 */
export function humanizeAiError(message: string): string {
  const m = (message || '').trim();
  if (!m) return 'AI 请求失败，请稍后重试';
  if (isSilentAiStreamEnd(m)) return m;
  // 已经是中文的业务错误（如「AI 返回格式解析失败」）直接透传，保留有用信息
  if (/[一-龥]/.test(m)) return m;
  if (/401|Unauthorized|invalid.*api.?key|api.?key.*invalid/i.test(m)) {
    return 'API Key 无效（401）。请在 ⚙️ 中检查 API Key 是否正确';
  }
  if (/403|Forbidden|forbidden|permission/i.test(m)) {
    return 'API 拒绝访问（403）。请检查 API Key 权限与账户额度';
  }
  if (/429|rate.?limit|too many requests/i.test(m)) {
    return '请求过于频繁（429），请稍等片刻再试';
  }
  if (/timeout|timed out|ETIMEDOUT|ECONNABORTED/i.test(m)) {
    return '请求超时，请检查网络后重试';
  }
  if (/network|fetch failed|failed to fetch|ENOTFOUND|ECONNREFUSED|ECONNRESET|getaddrinfo/i.test(m)) {
    return '网络连接失败，请检查网络或 API 地址';
  }
  if (/insufficient|balance|quota|billing|额度|余额/i.test(m)) {
    return '账户额度或余额不足，请充值后重试';
  }
  if (/abort/i.test(m)) {
    return '请求已中止';
  }
  // 其余一律给通用提示，不把原始错误串透给用户
  return 'AI 请求失败，请稍后重试';
}

/**
 * 流异常结束时的展示决策（供面板 catch 使用）：
 * - 切项目（AI_IGNORED_MESSAGE）→ null，静默，不打扰用户
 * - 用户主动停止（AI_STOPPED_MESSAGE）→ 明确提示已停止
 * - 其他真实失败 → `prefix + 友好中文错误`
 */
export function streamEndDisplay(message: string, prefix: string): string | null {
  const m = (message || '').trim();
  if (m === AI_IGNORED_MESSAGE) return null;
  if (m === AI_STOPPED_MESSAGE) return '已停止生成，不会保存';
  return `${prefix}${humanizeAiError(m)}`;
}

class AIServiceImpl implements AIService {
  private streamBridges = new Map<string, StreamBridge>();

  async chat(inputConfig: ProviderConfig, messages: ChatMessage[], options?: ChatCallOptions): Promise<string> {
    const config = snapshotAIRequestConfig(inputConfig);
    if (!config.apiKey) {
      throw new Error('请先添加 AI 配置（点击 ⚙️ → 选择服务 → 输入 API Key）');
    }

    const result = await window.electronAPI.invoke('ai:chat', config, messages, options) as any;
    if (result.success) return result.data as string;
    throw new Error(result.error || 'AI 请求失败');
  }

  /**
   * 同步外壳：调用瞬间拷贝快照并校验 projectId，再进入内部 async generator。
   * 不能把快照放到 generator 函数体第一行，否则拿到 generator 后改原 config 会串到 IPC。
   */
  chatStream(
    inputConfig: ProviderConfig,
    messages: ChatMessage[],
    options: ChatCallOptions | undefined,
    projectId: string,
  ): AsyncGenerator<string> {
    const config = snapshotAIRequestConfig(inputConfig);
    const pid = String(projectId ?? '').trim();
    if (!pid) throw new Error('chatStream 需要 projectId');
    if (!config.apiKey) {
      throw new Error('请先添加 AI 配置（点击 ⚙️ → 选择服务 → 输入 API Key）');
    }
    return this.runChatStream(config, messages, options, pid);
  }

  /**
   * 真正的 SSE 流式对话
   * 使用主进程的 ai:chatStream IPC + webContents 事件，
   * 每个 token 到达时立即 yield，用户能看到逐字输出的效果。
   *
   * 一期起：调用时登记 streamId → projectId 映射；收到事件时若映射被作废（切项目）
   * 或已取消，则不 yield。取消由 cancelStream 唤醒并抛错，避免 for-await 永远挂住。
   */
  private async *runChatStream(
    config: ProviderConfig,
    messages: ChatMessage[],
    options: ChatCallOptions | undefined,
    projectId: string,
  ): AsyncGenerator<string> {
    // 调用主进程真正的流式 IPC（会立即返回 streamId）
    const result = await window.electronAPI.invoke('ai:chatStream', config, messages, options, projectId) as any;
    if (!result.success) {
      throw new Error(result.error || 'AI 请求失败');
    }

    const { streamId } = result.data as { streamId: string };

    const bridge: StreamBridge = { projectId, ignored: false, cancelled: false, wake: null };
    this.streamBridges.set(streamId, bridge);

    // 用 Promise 驱动的队列桥接 IPC 事件和 async generator
    const pendingTokens: string[] = [];
    let pendingResolve: (() => void) | null = null;
    let finished = false;
    let streamError: Error | null = null;

    const onToken = (sid: string, token: string) => {
      if (sid !== streamId) return;
      if (bridge.ignored || bridge.cancelled) return;
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
    // 暴露唤醒能力给 cancelStream：取消后主进程不再发事件，必须主动唤醒 generator
    bridge.wake = () => pendingResolve?.();

    const throwIfEnded = (): void => {
      if (bridge.cancelled) throw new Error(AI_STOPPED_MESSAGE);
      if (bridge.ignored) throw new Error(AI_IGNORED_MESSAGE);
    };

    try {
      let fullText = '';
      let lastYieldTime = 0;
      while (true) {
        throwIfEnded();
        // 优先 drain 积攒的 token：即使 finished 已置位（complete 与最后 token 同 tick 到达），也不能丢。
        if (pendingTokens.length > 0) {
          fullText += pendingTokens.join('');
          pendingTokens.length = 0;
          const now = Date.now();
          if (now - lastYieldTime > 30) {
            yield fullText;
            lastYieldTime = now;
          }
          continue;
        }
        if (finished) break;
        // 之前有积累文本但还没 yield，现在补一次
        if (Date.now() - lastYieldTime > 30 && fullText) {
          yield fullText;
          lastYieldTime = Date.now();
        }
        // 等待下一个事件
        await new Promise<void>((resolve) => { pendingResolve = resolve; });
        throwIfEnded();
        if (streamError) throw streamError;
      }
      throwIfEnded();
      // 确保最后一次 yield 包含完整文本
      if (fullText) {
        yield fullText;
      }
    } finally {
      cleanup();
      this.streamBridges.delete(streamId);
    }
  }

  async cancelActiveStreams(projectId: string): Promise<void> {
    // 先复制出所有属于该项目的活跃流，逐个精确取消；作废 + 唤醒对应 generator。
    const targets = [...this.streamBridges.entries()]
      .filter(([, b]) => b.projectId === projectId && !b.ignored)
      .map(([id]) => id);
    for (const streamId of targets) {
      const bridge = this.streamBridges.get(streamId);
      if (bridge) {
        bridge.ignored = true;
        bridge.cancelled = true;
        bridge.wake?.();
      }
      await window.electronAPI.invoke('ai:cancelStream', streamId, projectId);
    }
  }

  ignoreProjectStreams(projectId: string): void {
    for (const bridge of this.streamBridges.values()) {
      if (bridge.projectId === projectId) {
        bridge.ignored = true;
        bridge.wake?.();
      }
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
