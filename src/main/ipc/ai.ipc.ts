import { ipcMain } from 'electron';
import { ProviderFactory } from '../ai/provider-factory';
import type { ChatMessage, ChatOptions, ProviderConfig } from '../ai/provider';
import { streamRegistry } from '../ai/stream-registry';

// Provider caching is handled by ProviderFactory internally.
// Always use ProviderFactory.create() for singleton, invalidate via ProviderFactory.invalidateCache().

const destroyedHookedSenders = new Set<number>();

export function registerAIIpc(): void {
  // Send chat message (non-streaming)
  ipcMain.handle('ai:chat', async (_event, config: ProviderConfig, messages: ChatMessage[], options?: ChatOptions) => {
    try {
      const provider = ProviderFactory.create(config);
      const response = await provider.chat(messages, options);
      return { success: true, data: response };
    } catch (err: any) {
      // Catch permission / 403 errors
      const msg = err.message || err.statusText || '';
      if (msg.includes('403') || msg.includes('forbidden') || msg.includes('Forbidden')) {
        return { success: false, error: 'API 拒绝访问 (403 Forbidden)。请检查：\n1. API Key 是否正确\n2. 账户是否有余额/额度\n3. API Key 是否有该模型的权限' };
      }
      if (msg.includes('401') || msg.includes('Unauthorized') || msg.includes('unauthorized')) {
        return { success: false, error: 'API Key 无效 (401 Unauthorized)。请在 ⚙️ 中检查 API Key 是否正确' };
      }
      if (msg.includes('429') || msg.includes('rate') || msg.includes('Rate')) {
        return { success: false, error: 'API 请求频率过高 (429)。请稍等片刻再试' };
      }
      return { success: false, error: err.message || 'AI 请求失败' };
    }
  });

  // Send streaming chat message
  // Returns a stream ID, tokens are sent via webContents events.
  // 一期起 chatStream 必须带 projectId，用于流注册表与取消校验。
  ipcMain.handle('ai:chatStream', async (event, config: ProviderConfig, messages: ChatMessage[], options?: ChatOptions, projectId?: string) => {
    try {
      if (!projectId) {
        return { success: false, error: '缺少 projectId，无法启动可取消的 AI 流' };
      }
      const provider = ProviderFactory.create(config);
      const sender = event.sender;
      const streamId = `stream_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const controller = new AbortController();
      const opts: ChatOptions = { ...(options || {}), signal: controller.signal };

      // 登记到流注册表：取消时先标 terminal 再 abort；回调前查 terminal/sender 存活
      streamRegistry.register(streamId, {
        controller,
        senderId: sender.id,
        projectId,
        terminal: false,
      });

      // 每个窗口只挂一次销毁钩子，避免每条流叠一个 listener
      if (!destroyedHookedSenders.has(sender.id)) {
        destroyedHookedSenders.add(sender.id);
        sender.once('destroyed', () => {
          destroyedHookedSenders.delete(sender.id);
          streamRegistry.abortAllForSender(sender.id);
        });
      }

      const isAlive = (): boolean => {
        const entry = streamRegistry.get(streamId);
        if (!entry || entry.terminal) return false;
        return !sender.isDestroyed();
      };

      const finish = (): void => {
        streamRegistry.remove(streamId);
      };

      // Send stream events back to renderer（每个回调前都做 terminal/sender 门禁）
      const callbacks = {
        onToken: (token: string) => {
          if (!isAlive()) return;
          sender.send('ai:streamToken', streamId, token);
        },
        onComplete: (fullText: string) => {
          try {
            if (isAlive()) sender.send('ai:streamComplete', streamId, fullText);
          } finally {
            finish();
          }
        },
        onError: (error: Error) => {
          try {
            if (isAlive()) sender.send('ai:streamError', streamId, error.message);
          } finally {
            finish();
          }
        },
      };

      // Start streaming (don't await — run in background, catch rejections)
      provider.chatStream(messages, callbacks, opts).catch((err) => {
        console.error('chatStream background error:', err);
        try {
          if (isAlive()) {
            sender.send('ai:streamError', streamId, err?.message || 'AI 请求失败');
          }
        } finally {
          finish();
        }
      });

      return { success: true, data: { streamId } };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Cancel an in-flight stream. Requires both streamId and projectId to match.
  ipcMain.handle('ai:cancelStream', async (_event, streamId: string, projectId: string) => {
    const cancelled = streamRegistry.cancel(streamId, projectId);
    return { success: cancelled, data: { cancelled } };
  });

  // Validate API key
  ipcMain.handle('ai:validateKey', async (_event, config: ProviderConfig) => {
    try {
      const provider = ProviderFactory.create(config);
      const valid = await provider.validateApiKey();
      return { success: true, data: valid };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Get available models for a provider
  ipcMain.handle('ai:getModels', async (_event, providerName: string) => {
    try {
      // Create a dummy config just to get models list
      const dummyConfig: ProviderConfig = { name: providerName, apiKey: '', model: '' };
      const provider = ProviderFactory.create(dummyConfig);
      return { success: true, data: provider.getModels() };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });
}
