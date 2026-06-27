import React, { useState, useRef, useEffect } from 'react';
import type { ChatMessage } from '../../main/ai/provider';
import { aiService, type ChatOptions } from '../services/ai.service';
import { encrypt, decrypt } from '../services/crypto';

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
  /** Context messages built from current project - prepended to every request */
  contextMessages?: ChatMessage[];
  /** Called when a message is sent or received */
  onSaveMessage?: (role: 'user' | 'assistant', content: string) => void;
  /** Current project ID - conversations are isolated per project */
  projectId?: string | null;
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

// Rough token pricing per 1M tokens (CNY, approximate 2025-2026 pricing)
const PROVIDER_PRICING: Record<string, { input: number; output: number }> = {
  'claude': { input: 80, output: 160 },
  'openai': { input: 8.7, output: 37 },
  'deepseek': { input: 2, output: 8 },
  'doubao': { input: 0.8, output: 2 },
  'qwen': { input: 3, output: 12 },
  'zhipu': { input: 3, output: 9 },
  'moonshot': { input: 3.5, output: 12 },
};

// Usage tracking
interface TokenUsage {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number; // CNY
  sessionTokens: number;
  sessions: Record<string, { inputTokens: number; outputTokens: number; cost: number }>;
  lastSessionDate: string;
}

function loadUsage(): TokenUsage {
  try {
    const raw = localStorage.getItem('hi-story-ai-usage');
    if (raw) return JSON.parse(raw);
  } catch {}
  return {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCost: 0,
    sessionTokens: 0,
    sessions: {},
    lastSessionDate: new Date().toISOString().slice(0, 10),
  };
}

function saveUsage(usage: TokenUsage): void {
  try { localStorage.setItem('hi-story-ai-usage', JSON.stringify(usage)); } catch {}
}

function estimateTokens(text: string): number {
  // Rough CJK-aware estimation: CJK ~1 token/char, Latin ~4 chars/token
  const cjk = (text.match(/[一-鿿㐀-䶿]/g) || []).length;
  const latin = text.length - cjk;
  return Math.max(1, Math.ceil(cjk * 1.1 + latin / 3.5));
}

function trackUsage(providerId: string, inputText: string, outputText: string): { inputTokens: number; outputTokens: number; cost: number } {
  const inputTokens = estimateTokens(inputText);
  const outputTokens = estimateTokens(outputText);
  const pricing = PROVIDER_PRICING[providerId] || { input: 3, output: 10 };
  const cost = (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;

  const usage = loadUsage();
  const today = new Date().toISOString().slice(0, 10);

  // Rotate session if new day
  if (today !== usage.lastSessionDate) {
    usage.lastSessionDate = today;
    usage.sessionTokens = 0;
  }

  // Track per-provider session
  const sessionKey = `${providerId}-${today}`;
  if (!usage.sessions[sessionKey]) {
    usage.sessions[sessionKey] = { inputTokens: 0, outputTokens: 0, cost: 0 };
  }

  usage.totalInputTokens += inputTokens;
  usage.totalOutputTokens += outputTokens;
  usage.totalCost += cost;
  usage.sessionTokens += inputTokens + outputTokens;
  usage.sessions[sessionKey].inputTokens += inputTokens;
  usage.sessions[sessionKey].outputTokens += outputTokens;
  usage.sessions[sessionKey].cost += cost;

  saveUsage(usage);
  return { inputTokens, outputTokens, cost };
}

const AI_CONFIGS_KEY = 'hi-story-ai-configs';

function loadConfigs(): SavedConfig[] {
  try {
    const raw = localStorage.getItem(AI_CONFIGS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

/**
 * Load configs from localStorage and decrypt API keys.
 * Must be called async since decryption goes through IPC.
 */
async function loadConfigsDecrypted(): Promise<SavedConfig[]> {
  const configs = loadConfigs();
  const decrypted = [];
  for (const c of configs) {
    decrypted.push({
      ...c,
      apiKey: await decrypt(c.apiKey),
    });
  }
  return decrypted;
}

async function saveConfigsEncrypted(configs: SavedConfig[]): Promise<void> {
  const encrypted = [];
  for (const c of configs) {
    encrypted.push({
      ...c,
      apiKey: await encrypt(c.apiKey),
    });
  }
  try { localStorage.setItem(AI_CONFIGS_KEY, JSON.stringify(encrypted)); } catch {}
}

function saveConfigsRaw(configs: SavedConfig[]): void {
  try { localStorage.setItem(AI_CONFIGS_KEY, JSON.stringify(configs)); } catch {}
}

// Generate a UUID v4 without relying on crypto.randomUUID (safer across Electron versions)
function generateId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    // Fallback: manual UUID v4
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }
}

// ===== Thread management (localStorage) =====
interface Thread {
  id: string;
  name: string;
  category: 'character' | 'plot' | 'world' | 'general';
  createdAt: string;
}

interface ThreadData {
  threads: Thread[];
  messages: Record<string, ChatEntry[]>;  // threadId -> messages
}

function loadThreadData(projectId: string): ThreadData {
  try {
    const raw = localStorage.getItem(`hi-story-threads-${projectId}`);
    return raw ? JSON.parse(raw) : { threads: [], messages: {} };
  } catch { return { threads: [], messages: {} }; }
}

function saveThreadData(projectId: string, data: ThreadData): void {
  try {
    const json = JSON.stringify(data);
    // Guard against localStorage quota overflow (5-10MB typical limit)
    if (json.length > 4_000_000) {
      console.warn('Thread data exceeds 4MB, truncating oldest messages to prevent data loss');
      // Truncate: keep only most recent 50 messages per thread
      const truncated: ThreadData = { threads: data.threads, messages: {} };
      for (const [tid, msgs] of Object.entries(data.messages)) {
        truncated.messages[tid] = msgs.slice(-50);
      }
      return saveThreadData(projectId, truncated); // Retry with truncated data
    }
    localStorage.setItem(`hi-story-threads-${projectId}`, json);
  } catch (e) {
    // If still failing after truncation (quota exceeded or privacy mode), log and continue
    console.error('Failed to save chat history — data may be lost on reload:', e);
  }
}

const THREAD_CATEGORY_ICONS: Record<string, string> = {
  character: '👤',
  plot: '📜',
  world: '🌍',
  general: '💬',
};

const THREAD_CATEGORY_LABELS: Record<string, string> = {
  character: '角色讨论',
  plot: '情节构思',
  world: '世界设定',
  general: '日常交流',
};

const AIChatPanel: React.FC<AIChatPanelProps> = ({
  contextMessages = [],
  onSaveMessage,
  projectId,
}) => {
  // ===== Config management =====
  const [savedConfigs, setSavedConfigs] = useState<SavedConfig[]>([]);
  const [activeConfigId, setActiveConfigId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [configsLoaded, setConfigsLoaded] = useState(false);

  // New config form
  const [editingProviderId, setEditingProviderId] = useState('deepseek');
  const [editingApiKey, setEditingApiKey] = useState('');
  const [editingModel, setEditingModel] = useState('deepseek-chat');
  const [editingLabel, setEditingLabel] = useState('');

  // ===== Chat state =====
  const [threadData, setThreadData] = useState<ThreadData>(() => loadThreadData(projectId || ''));
  const [activeThreadId, setActiveThreadId] = useState<string | null>(threadData.threads[0]?.id ?? null);
  const [showNewThread, setShowNewThread] = useState(false);
  const [newThreadName, setNewThreadName] = useState('');
  const [newThreadCategory, setNewThreadCategory] = useState<Thread['category']>('general');
  const [messages, setMessages] = useState<ChatEntry[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // Track previous project to detect switch
  const prevProjectRef = useRef<string | null | undefined>(undefined);
  // Pending AI requests from context menu
  const pendingPolishRef = useRef<string | null>(null);
  const pendingContinueRef = useRef<boolean>(false);
  const prevMessagesLenRef = useRef<number>(0);
  const prevStreamingRef = useRef<boolean>(false);

  // Usage tracking
  const [usage, setUsage] = useState<TokenUsage>(loadUsage);
  const [showUsage, setShowUsage] = useState(false);
  const [lastRequestTokens, setLastRequestTokens] = useState<{ inputTokens: number; outputTokens: number; cost: number } | null>(null);

  // Chat history search
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [chatSearchResults, setChatSearchResults] = useState<{ threadId: string; threadName: string; entries: ChatEntry[] }[]>([]);
  const [showChatSearch, setShowChatSearch] = useState(false);

  // Derived: active config
  const activeConfig = savedConfigs.find(c => c.id === activeConfigId) ?? null;
  const activeProvider = PROVIDERS.find(p => p.id === activeConfig?.providerId);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText]);

  // Load configs async on mount (decrypt keys via IPC)
  useEffect(() => {
    loadConfigsDecrypted().then(configs => {
      setSavedConfigs(configs);
      if (!activeConfigId && configs.length > 0) {
        setActiveConfigId(configs[0].id);
      }
      setConfigsLoaded(true);
    });
  }, []);

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

  // Load messages when active thread changes
  useEffect(() => {
    if (activeThreadId && threadData.messages[activeThreadId]) {
      setMessages(threadData.messages[activeThreadId]);
    } else {
      setMessages([]);
    }
    setError(null);
    setStreamingText('');
  }, [activeThreadId]);

  // Handle polish request
  useEffect(() => {
    const text = localStorage.getItem('hi-story-pending-ai-polish');
    if (text && configsLoaded && !isStreaming) {
      localStorage.removeItem('hi-story-pending-ai-polish');
      setInput(`请帮我润色以下文字，使其更优美流畅，保持原意不变：\n\n${text}`);
    }
  }, [configsLoaded, isStreaming]);

  // Check for pending continue request
  useEffect(() => {
    const continueReq = localStorage.getItem('hi-story-pending-ai-continue');
    if (continueReq && !isStreaming && activeConfig && contextMessages.length > 0) {
      localStorage.removeItem('hi-story-pending-ai-continue');
      const prompt = '请根据当前上下文，继续写接下来的内容。保持风格和情节的连贯性。';
      const userMsg: ChatEntry = {
        id: generateId(),
        role: 'user',
        content: prompt,
        timestamp: new Date().toISOString(),
      };
      setMessages(prev => [...prev, userMsg]);
      if (activeThreadId && projectId) {
        const data = loadThreadData(projectId);
        data.messages[activeThreadId] = [...messages, userMsg];
        saveThreadData(projectId, data);
        setThreadData(data);
      }
      // Wait for state to settle then trigger send
      const chatMessages: ChatMessage[] = [
        ...contextMessages,
        ...[...messages, userMsg].map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      ];
      setIsStreaming(true);
      setStreamingText('');
      (async () => {
        try {
          let fullResponse = '';
          const generator = aiService.chatStream(chatMessages, { model: activeConfig.model });
          for await (const token of generator) {
            fullResponse = token;
            setStreamingText(fullResponse);
          }
          const assistantMsg: ChatEntry = {
            id: generateId(),
            role: 'assistant',
            content: fullResponse,
            timestamp: new Date().toISOString(),
          };
          const data2 = loadThreadData(projectId);
          data2.messages[activeThreadId] = [...(data2.messages[activeThreadId] || []), assistantMsg];
          saveThreadData(projectId, data2);
          setThreadData(data2);
          setMessages(prev => [...prev, assistantMsg]);
        } catch (err: any) {
          setError(err.message || 'AI 请求失败');
        } finally {
          setIsStreaming(false);
          setStreamingText('');
        }
      })();
    }
  }, [contextMessages.length > 0, activeConfig, isStreaming, activeConfigId]);

  // Handle thread creation
  const handleCreateThread = () => {
    if (!newThreadName.trim() || !projectId) return;
    const thread: Thread = {
      id: generateId(),
      name: newThreadName.trim(),
      category: newThreadCategory,
      createdAt: new Date().toISOString(),
    };
    const updated: ThreadData = {
      threads: [...threadData.threads, thread],
      messages: { ...threadData.messages, [thread.id]: [] },
    };
    setThreadData(updated);
    saveThreadData(projectId, updated);
    setActiveThreadId(thread.id);
    setNewThreadName('');
    setShowNewThread(false);
  };

  // Handle thread deletion
  const handleDeleteThread = (threadId: string) => {
    if (!projectId) return;
    const { [threadId]: _, ...remainingMessages } = threadData.messages;
    const updated: ThreadData = {
      threads: threadData.threads.filter(t => t.id !== threadId),
      messages: remainingMessages,
    };
    setThreadData(updated);
    saveThreadData(projectId, updated);
    if (activeThreadId === threadId) {
      setActiveThreadId(updated.threads[0]?.id ?? null);
    }
  };
  useEffect(() => {
    if (prevProjectRef.current !== undefined && prevProjectRef.current !== projectId) {
      if (activeThreadId && prevProjectRef.current) {
        const data = loadThreadData(prevProjectRef.current!);
        const updated: ThreadData = {
          ...data,
          messages: { ...data.messages, [activeThreadId]: messages },
        };
        saveThreadData(prevProjectRef.current!, updated);
      }
      setThreadData(projectId ? loadThreadData(projectId) : { threads: [], messages: {} });
      setActiveThreadId(null);
      setMessages([]);
      setError(null);
      setStreamingText('');
    }
    prevProjectRef.current = projectId;
  }, [projectId]);

  const handleAddConfig = async () => {
    if (!editingApiKey.trim()) return;
    const provider = PROVIDERS.find(p => p.id === editingProviderId)!;
    const model = editingModel || provider.defaultModel;
    const label = editingLabel || `${provider.displayName} #${savedConfigs.length + 1}`;

    const newConfig: SavedConfig = {
      id: generateId(),
      providerId: editingProviderId,
      apiKey: editingApiKey.trim(),
      model,
      label,
    };

    const updated = [...savedConfigs, newConfig];
    setSavedConfigs(updated);
    await saveConfigsEncrypted(updated);
    setActiveConfigId(newConfig.id);
    setShowSettings(false);

    // Reset form
    setEditingApiKey('');
    setEditingLabel('');
  };

  const handleDeleteConfig = async (id: string) => {
    const updated = savedConfigs.filter(c => c.id !== id);
    setSavedConfigs(updated);
    await saveConfigsEncrypted(updated);
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
    setLastRequestTokens(null);

    if (!activeConfig) {
      setError('请先添加一个 AI 配置（点击 ⚙️ → 选择服务 → 输入 API Key）');
      return;
    }

    const userMsg: ChatEntry = {
      id: generateId(),
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    };

    setMessages(prev => [...prev, userMsg]);
    // Save message to active thread
    if (activeThreadId && projectId) {
      const data = loadThreadData(projectId);
      data.messages[activeThreadId] = [...messages, userMsg];
      saveThreadData(projectId, data);
      setThreadData(data);
    }

    // Build messages: context (system prompt with project info) + conversation history + new user message
    const chatMessages: ChatMessage[] = [
      ...contextMessages,                     // System context (project, characters, world, etc.)
      ...[...messages, userMsg].map(m => ({   // Conversation history
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
        id: generateId(),
        role: 'assistant',
        content: fullResponse,
        timestamp: new Date().toISOString(),
      };

      // Track token usage
      const stats = trackUsage(activeConfig.providerId, text, fullResponse);
      setLastRequestTokens(stats);
      setUsage(loadUsage());

      setMessages(prev => [...prev, assistantMsg]);
      if (activeThreadId && projectId) {
        const data = loadThreadData(projectId);
        data.messages[activeThreadId] = [...(data.messages[activeThreadId] || []), assistantMsg];
        saveThreadData(projectId, data);
      }
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

  // Build context summary for display
  const contextSummary = contextMessages.length > 0
    ? `📚 +${contextMessages[0].content.length} 字符的创作上下文已注入`
    : null;

  return (
    <div className="h-full flex flex-col bg-gray-900">
      {/* === Header with thread management === */}
      <div className="px-4 py-3 border-b border-gray-700 bg-gray-800 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-300 flex-shrink-0">AI 对话</h3>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowNewThread(!showNewThread)}
            className="text-gray-400 hover:text-white transition-colors text-xs"
            title="新建对话线程"
          >
            +新对话
          </button>
          <button
            onClick={() => setShowChatSearch(!showChatSearch)}
            className="text-gray-400 hover:text-white transition-colors text-xs"
            title="搜索对话历史"
          >
            🔍
          </button>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="text-gray-400 hover:text-white transition-colors text-sm"
            title="管理 AI 配置"
          >
            ⚙️
          </button>
        </div>
      </div>
      {/* Thread tabs */}
      {threadData.threads.length > 0 && (
        <div className="flex items-center gap-0.5 px-2 py-1.5 bg-gray-800/50 border-b border-gray-700 overflow-x-auto">
          {threadData.threads.map(t => (
            <div
              key={t.id}
              className={`flex items-center gap-0.5 flex-shrink-0`}
            >
              <button
                onClick={() => setActiveThreadId(t.id)}
                className={`px-2 py-1 rounded text-[10px] whitespace-nowrap transition-colors ${
                  t.id === activeThreadId
                    ? 'bg-accent text-white'
                    : 'text-gray-400 hover:bg-gray-700 hover:text-white'
                }`}
                title={`${THREAD_CATEGORY_LABELS[t.category]} — ${t.name}`}
              >
                {THREAD_CATEGORY_ICONS[t.category]} {t.name}
              </button>
              <button
                onClick={() => handleDeleteThread(t.id)}
                className="text-gray-600 hover:text-red-400 text-[8px] px-0.5"
                title="删除对话"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* New thread form */}
      {showNewThread && (
        <div className="px-3 py-2 border-b border-gray-700 bg-gray-800/50 space-y-2">
          <input
            type="text"
            value={newThreadName}
            onChange={(e) => setNewThreadName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreateThread(); if (e.key === 'Escape') setShowNewThread(false); }}
            placeholder="对话名称..."
            className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-xs
                       focus:outline-none focus:border-accent placeholder-gray-500"
            autoFocus
          />
          <div className="flex items-center gap-2">
            <select
              value={newThreadCategory}
              onChange={(e) => setNewThreadCategory(e.target.value as Thread['category'])}
              className="flex-1 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-[10px]
                         focus:outline-none focus:border-accent"
            >
              {(Object.entries(THREAD_CATEGORY_LABELS) as [Thread['category'], string][]).map(([k, v]) => (
                <option key={k} value={k}>{THREAD_CATEGORY_ICONS[k]} {v}</option>
              ))}
            </select>
            <button
              onClick={handleCreateThread}
              disabled={!newThreadName.trim()}
              className="px-3 py-1 text-xs bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-50"
            >
              创建
            </button>
            <button
              onClick={() => setShowNewThread(false)}
              className="px-2 py-1 text-xs text-gray-400 hover:text-white"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* Chat history search */}
      {showChatSearch && (
        <div className="px-3 py-2 border-b border-gray-700 bg-gray-800/50 space-y-2">
          <div className="flex gap-1">
            <input
              type="text"
              value={chatSearchQuery}
              onChange={(e) => setChatSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && chatSearchQuery.trim() && projectId) {
                  const data = loadThreadData(projectId);
                  const allResults: { threadId: string; threadName: string; entries: ChatEntry[] }[] = [];
                  for (const t of data.threads) {
                    const msgs = (data.messages[t.id] || []).filter(m =>
                      m.content.toLowerCase().includes(chatSearchQuery.trim().toLowerCase())
                    );
                    if (msgs.length > 0) {
                      allResults.push({ threadId: t.id, threadName: t.name, entries: msgs });
                    }
                  }
                  setChatSearchResults(allResults);
                }
                if (e.key === 'Escape') { setShowChatSearch(false); setChatSearchResults([]); }
              }}
              placeholder="搜索所有对话..."
              className="flex-1 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-xs
                         focus:outline-none focus:border-accent placeholder-gray-500"
            />
            <button
              onClick={() => { setShowChatSearch(false); setChatSearchResults([]); }}
              className="px-2 py-1 text-xs text-gray-400 hover:text-white"
            >
              关闭
            </button>
          </div>
          {chatSearchResults.length > 0 && (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {chatSearchResults.map(r => (
                <div key={r.threadId}>
                  <div className="text-[10px] text-accent mb-1">
                    {THREAD_CATEGORY_ICONS[threadData.threads.find(t => t.id === r.threadId)?.category || 'general']} {r.threadName} ({r.entries.length})
                  </div>
                  {r.entries.slice(0, 5).map(entry => (
                    <div
                      key={entry.id}
                      className="px-2 py-1 my-0.5 bg-gray-900/50 rounded cursor-pointer hover:bg-gray-700 text-[10px] text-gray-400"
                      onClick={() => {
                        setActiveThreadId(r.threadId);
                        setShowChatSearch(false);
                        setChatSearchResults([]);
                        // Scroll to the message
                        setTimeout(() => {
                          const el = document.getElementById(`msg-${entry.id}`);
                          el?.scrollIntoView({ behavior: 'smooth' });
                        }, 200);
                      }}
                    >
                      <span className="text-gray-500">{entry.role === 'user' ? '👤' : '🤖'} </span>
                      {entry.content.slice(0, 80)}{entry.content.length > 80 ? '…' : ''}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Active config display + quick switch */}
      <div className="px-4 py-1.5 border-b border-gray-700 bg-gray-800/30 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {savedConfigs.length > 0 && (
            <select
              value={activeConfigId ?? ''}
              onChange={(e) => handleSwitchConfig(e.target.value)}
              className="text-[10px] bg-gray-700 border border-gray-600 rounded px-2 py-1 text-gray-300
                         focus:outline-none focus:border-accent max-w-[120px] truncate"
            >
              {savedConfigs.map(c => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          )}
          {activeProvider && (
            <span className="text-[10px] text-gray-500 truncate">
              {activeConfig?.model}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {lastRequestTokens && (
            <span className="text-[9px] text-gray-500" title={`输入 ~${lastRequestTokens.inputTokens} tokens, 输出 ~${lastRequestTokens.outputTokens} tokens`}>
              ~{lastRequestTokens.inputTokens + lastRequestTokens.outputTokens} tk
              <span className="text-gray-600"> · ¥{lastRequestTokens.cost.toFixed(4)}</span>
            </span>
          )}
          {activeThreadId && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-gray-600">
                {messages.length} 条消息
              </span>
              <button
                onClick={() => { setShowUsage(!showUsage); setUsage(loadUsage()); }}
                className="text-[10px] text-gray-500 hover:text-accent transition-colors"
                title="AI 用量统计"
              >
                📊
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Usage stats panel */}
      {showUsage && (
        <div className="px-4 py-3 border-b border-gray-700 bg-gray-800/50 space-y-2 text-[10px] max-h-[200px] overflow-y-auto">
          <div className="flex items-center justify-between">
            <span className="text-gray-400 font-medium">📊 用量统计</span>
            <button onClick={() => setShowUsage(false)} className="text-gray-500 hover:text-white text-xs">✕</button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-gray-900 rounded p-2 text-center">
              <div className="text-gray-400">总输入</div>
              <div className="text-white font-mono">{(usage.totalInputTokens / 1000).toFixed(1)}k</div>
              <div className="text-gray-600">tokens</div>
            </div>
            <div className="bg-gray-900 rounded p-2 text-center">
              <div className="text-gray-400">总输出</div>
              <div className="text-white font-mono">{(usage.totalOutputTokens / 1000).toFixed(1)}k</div>
              <div className="text-gray-600">tokens</div>
            </div>
            <div className="bg-gray-900 rounded p-2 text-center">
              <div className="text-gray-400">总花费</div>
              <div className="text-accent font-mono">¥{usage.totalCost.toFixed(4)}</div>
              <div className="text-gray-600">CNY</div>
            </div>
          </div>
          <div className="text-gray-500 text-center">
            今日会话: {(usage.sessionTokens / 1000).toFixed(1)}k tokens
          </div>
          {Object.keys(usage.sessions).length > 0 && (
            <details className="cursor-pointer">
              <summary className="text-gray-500 hover:text-gray-300">按日期/服务展开</summary>
              <div className="mt-1 space-y-1">
                {Object.entries(usage.sessions).slice(-10).reverse().map(([key, s]) => (
                  <div key={key} className="flex justify-between text-gray-400 bg-gray-900/50 px-2 py-0.5 rounded">
                    <span>{key}</span>
                    <span className="font-mono">
                      i:{(s.inputTokens / 1000).toFixed(1)}k o:{(s.outputTokens / 1000).toFixed(1)}k
                      <span className="text-accent ml-1">¥{s.cost.toFixed(4)}</span>
                    </span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
      {contextSummary && (
        <div className="px-4 py-1.5 bg-accent/10 border-b border-accent/20 text-[10px] text-accent">
          {contextSummary}
        </div>
      )}

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
                className="w-full py-1.5 text-xs bg-accent text-white rounded hover:bg-accent-hover
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
            <p>开始与 AI 讨论你的创作</p>
            <p className="text-xs mt-1 text-gray-500">
              {projectId
                ? 'AI 已了解当前小说的世界观、角色和大纲'
                : '请先选择一个小说项目'}
            </p>
            {savedConfigs.length === 0 ? (
              <p className="text-xs mt-2 text-accent">⚠️ 请先点击 ⚙️ 添加 AI 配置</p>
            ) : (
              <p className="text-xs mt-2 text-gray-500">当前: {activeConfig?.label} ({activeConfig?.model})</p>
            )}
            {contextSummary && (
              <p className="text-xs mt-1 text-accent">{contextSummary}</p>
            )}
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} id={`msg-${msg.id}`} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
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
            placeholder={savedConfigs.length > 0 ? '和 AI 讨论你的小说...' : '请先点击 ⚙️ 添加 AI 配置...'}
            rows={2}
            className="flex-1 resize-none rounded bg-gray-900 border border-gray-700 px-3 py-2 text-sm text-white
                       focus:outline-none focus:border-accent placeholder-gray-600"
            disabled={isStreaming}
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || isStreaming}
            className="px-4 py-2 bg-accent text-white text-sm rounded hover:bg-accent-hover
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
