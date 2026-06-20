import React, { useState, useRef, useEffect } from 'react';
import type { ChatMessage } from '../../main/ai/provider';
import { aiService, type ChatOptions } from '../services/ai.service';

// Provider preset definitions (mirrors main process but available in renderer)
interface ProviderPreset {
  id: string;
  name: string;
  displayName: string;
  baseUrl: string;
  type: 'claude' | 'openai-compatible';
  defaultModel: string;
  models: string[];
}

interface SavedConfig {
  id: string;
  providerId: string;
  apiKey: string;
  model: string;
  label: string;
}

interface AIChatPanelProps {
  contextMessages?: ChatMessage[];
  onSaveMessage?: (role: 'user' | 'assistant', content: string) => void;
}

interface ChatEntry {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

// Build-in provider list for the UI
const PROVIDERS: ProviderPreset[] = [
  { id: 'claude', name: 'claude', displayName: 'Claude (Anthropic)', baseUrl: 'https://api.anthropic.com', type: 'claude', defaultModel: 'claude-sonnet-4-6', models: ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001', 'claude-opus-4-8', 'claude-fable-5'] },
  { id: 'openai', name: 'openai', displayName: 'OpenAI / ChatGPT', baseUrl: 'https://api.openai.com/v1', type: 'openai-compatible', defaultModel: 'gpt-4o', models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o4-mini', 'o3-mini'] },
  { id: 'deepseek', name: 'deepseek', displayName: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', type: 'openai-compatible', defaultModel: 'deepseek-chat', models: ['deepseek-chat', 'deepseek-reasoner'] },
  { id: 'doubao', name: 'doubao', displayName: '豆包 (字节)', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', type: 'openai-compatible', defaultModel: 'doubao-pro-32k', models: ['doubao-pro-32k', 'doubao-lite-32k', 'doubao-pro-128k'] },
  { id: 'qwen', name: 'qwen', displayName: '通义千问 (阿里)', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', type: 'openai-compatible', defaultModel: 'qwen-plus', models: ['qwen-turbo', 'qwen-plus', 'qwen-max'] },
  { id: 'zhipu', name: 'zhipu', displayName: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', type: 'openai-compatible', defaultModel: 'glm-4-flash', models: ['glm-4-flash', 'glm-4', 'glm-4-plus'] },
  { id: 'moonshot', name: 'moonshot', displayName: 'Moonshot (Kimi)', baseUrl: 'https://api.moonshot.cn/v1', type: 'openai-compatible', defaultModel: 'moonshot-v1-8k', models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'] },
];

const STORAGE_KEY = 'hi-story-ai-configs';

function loadConfigs(): SavedConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveConfigs(configs: SavedConfig[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(configs));
}

const AIChatPanel: React.FC<AIChatPanelProps> = ({
  contextMessages = [],
  onSaveMessage,
}) => {
  // ===== Config management =====
  const [savedConfigs, setSavedConfigs] = useState<SavedConfig[]>(loadConfigs);
  const [activeConfigId, setActiveConfigId] = useState<string | null>(savedConfigs[0]?.id ?? null);
  const [showSettings, setShowSettings] = useState(false);

  // New config form
  const [editingProviderId, setEditingProviderId] = useState('claude');
  const [editingApiKey, setEditingApiKey] = useState('');
  const [editingModel, setEditingModel] = useState('claude-sonnet-4-6');
  const [editingLabel, setEditingLabel] = useState('');

  // ===== Chat state =====
  const [messages, setMessages] = useState<ChatEntry[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Derived: active config
  const activeConfig = savedConfigs.find(c => c.id === activeConfigId) ?? null;
  const activeProvider = PROVIDERS.find(p => p.id === activeConfig?.providerId);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText]);

  // Sync to aiService when active config changes
  useEffect(() => {
    if (activeConfig && activeProvider) {
      aiService.configure(
        activeProvider.name,
        activeConfig.apiKey,
        activeConfig.model,
        activeProvider.baseUrl,
      );
    }
  }, [activeConfigId, activeConfig?.apiKey, activeConfig?.model]);

  const handleAddConfig = () => {
    if (!editingApiKey.trim()) return;
    const provider = PROVIDERS.find(p => p.id === editingProviderId)!;
    const model = editingModel || provider.defaultModel;
    const label = editingLabel || `${provider.displayName} #${savedConfigs.length + 1}`;

    const newConfig: SavedConfig = {
      id: crypto.randomUUID(),
      providerId: editingProviderId,
      apiKey: editingApiKey.trim(),
      model,
      label,
    };

    const updated = [...savedConfigs, newConfig];
    setSavedConfigs(updated);
    saveConfigs(updated);
    setActiveConfigId(newConfig.id);
    setShowSettings(false);

    // Reset form
    setEditingApiKey('');
    setEditingLabel('');
  };

  const handleDeleteConfig = (id: string) => {
    const updated = savedConfigs.filter(c => c.id !== id);
    setSavedConfigs(updated);
    saveConfigs(updated);
    if (activeConfigId === id) {
      setActiveConfigId(updated[0]?.id ?? null);
    }
  };

  const handleSwitchConfig = (id: string) => {
    setActiveConfigId(id);
  };

  // Merge all provider models into one list for the dropdown
  const currentProviderModels = PROVIDERS.find(p => p.id === editingProviderId)?.models || [];

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || isStreaming) return;

    setInput('');
    setError(null);

    if (!activeConfig) {
      setError('请先添加一个 AI 配置（点击 ⚙️ → 选择服务 → 输入 API Key）');
      return;
    }

    const userMsg: ChatEntry = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    };

    setMessages(prev => [...prev, userMsg]);
    onSaveMessage?.('user', text);

    const chatMessages: ChatMessage[] = [
      ...contextMessages,
      ...[...messages, userMsg].map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    ];

    setIsStreaming(true);
    setStreamingText('');

    try {
      let fullResponse = '';
      const generator = aiService.chatStream(chatMessages, { model: activeConfig.model });

      for await (const token of generator) {
        fullResponse = token;
        setStreamingText(fullResponse);
      }

      const assistantMsg: ChatEntry = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: fullResponse,
        timestamp: new Date().toISOString(),
      };

      setMessages(prev => [...prev, assistantMsg]);
      onSaveMessage?.('assistant', fullResponse);
    } catch (err: any) {
      setError(err.message || 'AI 请求失败');
    } finally {
      setIsStreaming(false);
      setStreamingText('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="h-full flex flex-col bg-gray-900">
      {/* === Header with provider switcher === */}
      <div className="px-4 py-3 border-b border-gray-700 bg-gray-800 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-300 flex-shrink-0">AI 对话</h3>

        {/* Active config display + quick switch */}
        <div className="flex items-center gap-1.5 min-w-0">
          {savedConfigs.length > 0 && (
            <select
              value={activeConfigId ?? ''}
              onChange={(e) => handleSwitchConfig(e.target.value)}
              className="text-xs bg-gray-700 border border-gray-600 rounded px-2 py-1 text-gray-300
                         focus:outline-none focus:border-accent max-w-[120px] truncate"
            >
              {savedConfigs.map(c => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          )}
          {activeProvider && (
            <span className="text-[10px] text-gray-500 hidden sm:inline truncate">
              {activeConfig?.model}
            </span>
          )}
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="text-gray-400 hover:text-white transition-colors text-sm flex-shrink-0"
            title="管理 AI 配置"
          >
            ⚙️
          </button>
        </div>
      </div>

      {/* === Settings panel === */}
      {showSettings && (
        <div className="px-4 py-3 border-b border-gray-700 bg-gray-800/50 space-y-4 max-h-[350px] overflow-y-auto">
          {/* Existing configs list */}
          {savedConfigs.length > 0 && (
            <div>
              <label className="block text-[10px] text-gray-500 mb-1.5 uppercase">已保存的配置</label>
              <div className="space-y-1">
                {savedConfigs.map(c => {
                  const p = PROVIDERS.find(p => p.id === c.providerId);
                  return (
                    <div key={c.id}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs cursor-pointer transition-colors
                        ${c.id === activeConfigId ? 'bg-accent/20 border border-accent/30' : 'bg-gray-700/50 border border-gray-700 hover:bg-gray-700'}`}
                      onClick={() => handleSwitchConfig(c.id)}
                    >
                      <span className="text-[10px]">{c.id === activeConfigId ? '✅' : '○'}</span>
                      <span className="flex-1 text-gray-300 truncate">{c.label}</span>
                      <span className="text-gray-500 text-[10px]">{p?.displayName} · {c.model}</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteConfig(c.id); }}
                        className="text-gray-600 hover:text-red-400 text-xs"
                      >🗑</button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Add new config */}
          <div>
            <label className="block text-[10px] text-gray-500 mb-1.5 uppercase">添加新配置</label>
            <div className="space-y-2">
              <div>
                <label className="text-[10px] text-gray-500">标签名</label>
                <input
                  type="text"
                  value={editingLabel}
                  onChange={(e) => setEditingLabel(e.target.value)}
                  placeholder="如: 我的豆包 / 公司DeepSeek..."
                  className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-xs
                             focus:outline-none focus:border-accent placeholder-gray-500"
                />
              </div>
              <div>
                <label className="text-[10px] text-gray-500">AI 服务</label>
                <select
                  value={editingProviderId}
                  onChange={(e) => {
                    setEditingProviderId(e.target.value);
                    const p = PROVIDERS.find(p => p.id === e.target.value);
                    if (p) setEditingModel(p.defaultModel);
                  }}
                  className="w-full px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-white text-xs
                             focus:outline-none focus:border-accent"
                >
                  {PROVIDERS.map(p => (
                    <option key={p.id} value={p.id}>{p.displayName}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] text-gray-500">
                  API Key
                  {editingProviderId === 'claude' && (
                    <a href="https://console.anthropic.com/settings/keys" target="_blank" className="ml-1 text-accent hover:underline" rel="noreferrer">(获取 ↗)</a>
                  )}
                  {editingProviderId === 'deepseek' && (
                    <a href="https://platform.deepseek.com/api_keys" target="_blank" className="ml-1 text-accent hover:underline" rel="noreferrer">(获取 ↗)</a>
                  )}
                  {editingProviderId === 'doubao' && (
                    <a href="https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey" target="_blank" className="ml-1 text-accent hover:underline" rel="noreferrer">(获取 ↗)</a>
                  )}
                </label>
                <input
                  type="password"
                  value={editingApiKey}
                  onChange={(e) => setEditingApiKey(e.target.value)}
                  placeholder="sk-..."
                  className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-xs
                             focus:outline-none focus:border-accent placeholder-gray-500 font-mono"
                />
              </div>
              <div>
                <label className="text-[10px] text-gray-500">模型</label>
                <select
                  value={editingModel}
                  onChange={(e) => setEditingModel(e.target.value)}
                  className="w-full px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-white text-xs
                             focus:outline-none focus:border-accent"
                >
                  {currentProviderModels.map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                  {/* Allow custom model name */}
                  {!currentProviderModels.includes(editingModel) && editingModel && (
                    <option value={editingModel}>{editingModel} (自定义)</option>
                  )}
                </select>
                {/* Custom model input */}
                <input
                  type="text"
                  value={editingModel}
                  onChange={(e) => setEditingModel(e.target.value)}
                  placeholder="或输入自定义模型名..."
                  className="w-full mt-1 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-xs
                             focus:outline-none focus:border-accent placeholder-gray-500"
                />
              </div>
              <button
                onClick={handleAddConfig}
                disabled={!editingApiKey.trim()}
                className="w-full py-1.5 text-xs bg-accent text-white rounded hover:bg-purple-600
                           disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                添加配置
              </button>
            </div>
          </div>
        </div>
      )}

      {/* === Messages === */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && !isStreaming && (
          <div className="text-center text-gray-600 text-sm mt-8">
            <p className="text-2xl mb-2">💬</p>
            <p>开始与 AI 对话</p>
            <p className="text-xs mt-1">讨论角色、情节、世界观...</p>
            {savedConfigs.length === 0 ? (
              <p className="text-xs mt-2 text-accent">⚠️ 请先点击 ⚙️ 添加 AI 配置</p>
            ) : (
              <p className="text-xs mt-2 text-gray-500">当前: {activeConfig?.label} ({activeConfig?.model})</p>
            )}
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-lg px-4 py-2.5 text-sm
              ${msg.role === 'user' ? 'bg-accent text-white' : 'bg-gray-800 text-gray-200 border border-gray-700'}`}>
              <div className="whitespace-pre-wrap">{msg.content}</div>
              <div className={`text-[10px] mt-1 ${msg.role === 'user' ? 'text-white/60' : 'text-gray-600'}`}>
                {new Date(msg.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          </div>
        ))}

        {isStreaming && streamingText && (
          <div className="flex justify-start">
            <div className="max-w-[80%] rounded-lg px-4 py-2.5 text-sm bg-gray-800 text-gray-200 border border-gray-700">
              <div className="whitespace-pre-wrap">{streamingText}</div>
              <span className="inline-block w-2 h-4 bg-accent animate-pulse ml-0.5 align-text-bottom" />
            </div>
          </div>
        )}

        {isStreaming && !streamingText && (
          <div className="flex justify-start">
            <div className="rounded-lg px-4 py-2.5 bg-gray-800 border border-gray-700">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="text-center text-red-400 text-xs py-2">
            ⚠ {error}
            <button onClick={() => setError(null)} className="ml-2 text-gray-500 hover:text-white">关闭</button>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* === Input === */}
      <div className="p-3 border-t border-gray-700 bg-gray-800">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={savedConfigs.length > 0 ? 'Say anything...' : '请先点击 ⚙️ 添加 AI 配置...'}
            rows={2}
            className="flex-1 resize-none rounded bg-gray-900 border border-gray-700 px-3 py-2 text-sm text-white
                       focus:outline-none focus:border-accent placeholder-gray-600"
            disabled={isStreaming}
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || isStreaming}
            className="px-4 py-2 bg-accent text-white text-sm rounded hover:bg-purple-600
                       disabled:opacity-50 disabled:cursor-not-allowed transition-colors self-end"
          >
            {isStreaming ? '...' : '发送'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AIChatPanel;
