import { ipcMain } from 'electron';
import { getDb } from '../db/connection';
import { ProviderFactory } from '../ai/provider-factory';
import type { AIProvider, StreamCallbacks, ChatMessage, ChatOptions, ProviderConfig } from '../ai/provider';

// Store active provider instances
const providerCache = new Map<string, AIProvider>();

function getProvider(config: ProviderConfig): AIProvider {
  const key = `${config.name}:${config.model}`;
  if (!providerCache.has(key)) {
    const provider = ProviderFactory.create(config);
    providerCache.set(key, provider);
  }
  return providerCache.get(key)!;
}

export function registerAIIpc(): void {
  // Send chat message (non-streaming)
  ipcMain.handle('ai:chat', async (_event, config: ProviderConfig, messages: ChatMessage[], options?: ChatOptions) => {
    try {
      const provider = getProvider(config);
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
  // Returns a stream ID, tokens are sent via webContents events
  ipcMain.handle('ai:chatStream', async (event, config: ProviderConfig, messages: ChatMessage[], options?: ChatOptions) => {
    try {
      const provider = getProvider(config);
      const sender = event.sender;
      const streamId = `stream_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      // Send stream events back to renderer
      const callbacks: StreamCallbacks = {
        onToken: (token: string) => {
          sender.send('ai:streamToken', streamId, token);
        },
        onComplete: (fullText: string) => {
          sender.send('ai:streamComplete', streamId, fullText);
        },
        onError: (error: Error) => {
          sender.send('ai:streamError', streamId, error.message);
        },
      };

      // Start streaming (don't await — run in background)
      provider.chatStream(messages, callbacks, options);

      return { success: true, data: { streamId } };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Validate API key
  ipcMain.handle('ai:validateKey', async (_event, config: ProviderConfig) => {
    try {
      const provider = getProvider(config);
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
