import React, { useState, useRef, useEffect } from 'react';
import type { ChatMessage } from '../../main/ai/provider';
import { aiService, type ChatOptions } from '../services/ai.service';

interface AIChatPanelProps {
  /** 当前上下文消息 (system messages with project/chapter/character info) */
  contextMessages?: ChatMessage[];
  provider?: string;
  apiKey?: string;
  model?: string;
  onSaveMessage?: (role: 'user' | 'assistant', content: string) => void;
}

interface ChatEntry {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

const AIChatPanel: React.FC<AIChatPanelProps> = ({
  contextMessages = [],
  provider: initialProvider = 'claude',
  apiKey: initialApiKey = '',
  model: initialModel = 'claude-sonnet-4-6',
  onSaveMessage,
}) => {
  // ===== Settings state =====
  const [provider, setProvider] = useState(initialProvider);
  const [apiKey, setApiKey] = useState(initialApiKey);
  const [model, setModel] = useState(initialModel);
  const [showSettings, setShowSettings] = useState(false);

  // ===== Chat state =====
  const [messages, setMessages] = useState<ChatEntry[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText]);

  // Sync config to aiService when settings change
  useEffect(() => {
    aiService.configure(provider, apiKey, model);
  }, [provider, apiKey, model]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || isStreaming) return;

    setInput('');
    setError(null);

    if (!apiKey) {
      setError('请先设置 API Key（点击右上角 ⚙️ 配置）');
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

    // Build full message list
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
      const generator = aiService.chatStream(chatMessages, { model });

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
      {/* Header with settings */}
      <div className="px-4 py-3 border-b border-gray-700 bg-gray-800 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-300">AI 对话</h3>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">
            {provider} · {model}
          </span>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="text-gray-400 hover:text-white transition-colors text-sm"
            title="设置"
          >
            ⚙️
          </button>
        </div>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div className="px-4 py-3 border-b border-gray-700 bg-gray-800/50 space-y-3">
          <div>
            <label className="block text-[10px] text-gray-500 mb-0.5">AI 服务</label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="w-full px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-white text-xs
                         focus:outline-none focus:border-accent"
            >
              <option value="claude">Claude (Anthropic)</option>
              <option value="openai">OpenAI</option>
            </select>
          </div>

          <div>
            <label className="block text-[10px] text-gray-500 mb-0.5">
              API Key
              <a
                href={provider === 'claude'
                  ? 'https://console.anthropic.com/settings/keys'
                  : 'https://platform.openai.com/api-keys'}
                target="_blank"
                className="ml-1 text-accent hover:underline"
                rel="noreferrer"
              >
                (获取 Key ↗)
              </a>
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={provider === 'claude' ? 'sk-ant-...' : 'sk-...'}
              className="w-full px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-white text-xs
                         focus:outline-none focus:border-accent placeholder-gray-500"
            />
          </div>

          <div>
            <label className="block text-[10px] text-gray-500 mb-0.5">模型</label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-white text-xs
                         focus:outline-none focus:border-accent"
            >
              {provider === 'claude' ? (
                <>
                  <option value="claude-sonnet-4-6">Claude Sonnet 4.6 (推荐)</option>
                  <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5 (快速)</option>
                  <option value="claude-opus-4-8">Claude Opus 4.8 (最强)</option>
                  <option value="claude-fable-5">Claude Fable 5</option>
                </>
              ) : (
                <>
                  <option value="gpt-4o">GPT-4o (推荐)</option>
                  <option value="gpt-4o-mini">GPT-4o Mini (快速)</option>
                  <option value="gpt-4-turbo">GPT-4 Turbo</option>
                  <option value="o4-mini">o4 Mini</option>
                </>
              )}
            </select>
          </div>

          <button
            onClick={() => setShowSettings(false)}
            className="w-full py-1.5 text-xs bg-accent text-white rounded hover:bg-purple-600 transition-colors"
          >
            保存设置
          </button>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && !isStreaming && (
          <div className="text-center text-gray-600 text-sm mt-8">
            <p className="text-2xl mb-2">💬</p>
            <p>开始与 AI 对话</p>
            <p className="text-xs mt-1">讨论角色、情节、世界观...</p>
            {!apiKey && (
              <p className="text-xs mt-2 text-accent">⚠️ 请先点击 ⚙️ 配置 API Key</p>
            )}
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`
                max-w-[80%] rounded-lg px-4 py-2.5 text-sm
                ${msg.role === 'user'
                  ? 'bg-accent text-white'
                  : 'bg-gray-800 text-gray-200 border border-gray-700'
                }
              `}
            >
              <div className="whitespace-pre-wrap">{msg.content}</div>
              <div className={`text-[10px] mt-1 ${msg.role === 'user' ? 'text-white/60' : 'text-gray-600'}`}>
                {new Date(msg.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          </div>
        ))}

        {/* Streaming response */}
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

      {/* Input area */}
      <div className="p-3 border-t border-gray-700 bg-gray-800">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={apiKey ? 'Say anything...' : '请先点击 ⚙️ 配置 API Key...'}
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
