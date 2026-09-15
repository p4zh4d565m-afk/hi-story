import React, { useState, useRef, useEffect, useMemo } from 'react';
import type { ChatMessage } from '../../main/ai/provider';
import { aiService, isSilentAiStreamEnd } from '../services/ai.service';
import { snapshotAIRequestConfig } from '../services/ai/request-config';
import { encrypt, decrypt } from '../services/crypto';
import { createConversationLoader, runPersistedConversationTurn } from '../services/conversation-persistence';
import { createCleanupLock } from '../services/conversation-cleanup-lock';
import { createCreativeDecisionLoader } from '../services/creative-decision-loader';
import { buildDecisionExtractionMessages, parseDecisionDrafts } from '../services/creative-decision-extraction';
import CreativeDecisionPanel from './CreativeDecisionPanel';
import type {
  ClearConversationThreadInput,
  ConversationCleanupResult,
  ConversationMessage,
  ConversationRestoreResult,
  ConversationSnapshot,
  ConversationThread,
  CreateCreativeDecisionProposalsInput,
  CreativeDecision,
  CreativeDecisionEffect,
  DeleteConversationTurnInput,
  IpcResult,
  RestoreConversationBatchInput,
} from '../types';

/** 约 10 秒短时撤销（仅内存，关应用/切项目后消失） */
const CLEANUP_UNDO_MS = 10_000;

type PendingUndo = {
  batchId: string;
  threadId: string;
  projectId: string;
  expiresAt: number;
} | null;

// Provider preset definitions (mirrors main process but available in renderer)
interface ProviderPreset {
  id: string;
  name: string;
  displayName: string;
  baseUrl: string;
  type: 'claude' | 'openai-compatible';
  defaultModel: string;
  models: string[];
  hint?: string; // 提示信息（如火山方舟需要 ep- ID）
}

interface SavedConfig {
  id: string;
  providerId: string;
  apiKey: string;
  model: string;
  label: string;
  baseUrl?: string;
}

interface AIChatPanelProps {
  /** Context messages built from current project - prepended to every request */
  contextMessages?: ChatMessage[];
  /** Called when a message is sent or received */
  onSaveMessage?: (role: 'user' | 'assistant', content: string) => void;
  /** Current project ID - conversations are isolated per project */
  projectId?: string | null;
  /** 确认决策写入运行时表后，通知上层刷新 AI 上下文 */
  onCreativeDecisionsCommitted?: (effects: CreativeDecisionEffect[]) => void | Promise<void>;
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
  { id: 'doubao', name: 'doubao', displayName: '豆包 (火山方舟)', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', type: 'openai-compatible', defaultModel: 'doubao-seed-evolving', models: ['doubao-seed-evolving', 'doubao-seed-2-1-pro', 'doubao-seed-2-0-pro', 'doubao-seed-2-0-lite', 'doubao-seed-1-8', 'doubao-seed-1-6', 'doubao-seed-1-6-flash'], hint: '也可直接填入 ep- 接入点 ID 或任意豆包模型名' },
  { id: 'volcengine', name: 'volcengine', displayName: '火山方舟 (全模型)', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', type: 'openai-compatible', defaultModel: 'doubao-seed-evolving', models: ['doubao-seed-evolving', 'doubao-seed-2-1-pro', 'doubao-seed-2-0-pro', 'doubao-seed-2-0-lite', 'deepseek-v4-pro', 'deepseek-v4-flash', 'kimi-k2.6', 'glm-5.2'], hint: '也可直接填入 ep- 接入点 ID 或任意模型名' },
  { id: 'qwen', name: 'qwen', displayName: '通义千问 (阿里)', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', type: 'openai-compatible', defaultModel: 'qwen-plus', models: ['qwen-turbo', 'qwen-plus', 'qwen-max'] },
  { id: 'zhipu', name: 'zhipu', displayName: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', type: 'openai-compatible', defaultModel: 'glm-4-flash', models: ['glm-4-flash', 'glm-4', 'glm-4-plus'] },
  { id: 'moonshot', name: 'moonshot', displayName: 'Moonshot (Kimi)', baseUrl: 'https://api.moonshot.cn/v1', type: 'openai-compatible', defaultModel: 'moonshot-v1-8k', models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'] },
];

// Rough token pricing per 1M tokens (CNY, approximate 2025-2026 pricing)
const PROVIDER_PRICING: Record<string, { input: number; output: number }> = {
  'claude': { input: 80, output: 160 },
  'openai': { input: 8.7, output: 37 },
  'deepseek': { input: 2, output: 8 },
  'doubao': { input: 3, output: 12 },
  'volcengine': { input: 3, output: 12 },
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

// ═══════════════════════════════════════════════════════════
// Embedding provider 自动检测
// ═══════════════════════════════════════════════════════════
const EMBEDDING_SUPPORT: Record<string, string> = {
  qwen: 'text-embedding-v3',
  openai: 'text-embedding-3-small',
  doubao: 'doubao-embedding',
  volcengine: 'doubao-embedding',
};

/** 检查已保存的配置中是否有支持 Embedding 的 */
async function hasEmbeddingConfig(): Promise<boolean> {
  const configs = await loadConfigsDecrypted();
  return configs.some(c => EMBEDDING_SUPPORT[c.providerId] && c.apiKey);
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

// ===== 会话视图模型（主存为 SQLite） =====
interface Thread {
  id: string;
  name: string;
  category: 'character' | 'plot' | 'world' | 'general';
  createdAt: string;
  updatedAt: string;
}

interface ThreadData {
  threads: Thread[];
  messages: Record<string, ChatEntry[]>;  // threadId -> messages
}

const EMPTY_THREAD_DATA: ThreadData = { threads: [], messages: {} };

function toChatEntry(message: ConversationMessage): ChatEntry {
  return { id: message.id, role: message.role as ChatEntry['role'], content: message.content, timestamp: message.createdAt };
}

function toThreadData(snapshot: ConversationSnapshot): ThreadData {
  return {
    threads: snapshot.threads.map(thread => ({
      id: thread.id,
      name: thread.title,
      category: thread.category,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
    })),
    messages: Object.fromEntries(
      Object.entries(snapshot.messages).map(([threadId, messages]) => [threadId, messages.map(toChatEntry)]),
    ),
  };
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
  onCreativeDecisionsCommitted,
}) => {
  // ===== Config management =====
  const [savedConfigs, setSavedConfigs] = useState<SavedConfig[]>([]);
  const [activeConfigId, setActiveConfigId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  // New config form
  const [editingProviderId, setEditingProviderId] = useState('');
  const [editingApiKey, setEditingApiKey] = useState('');
  const [editingModel, setEditingModel] = useState('');
  const [editingLabel, setEditingLabel] = useState('');
  // 追踪用户是否已经开始填写表单，防止切换提供商后意外清空
  const formDirtyRef = useRef(false);

  // ===== Chat state =====
  const [threadData, setThreadData] = useState<ThreadData>(EMPTY_THREAD_DATA);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [loadedProjectId, setLoadedProjectId] = useState<string | null>(null);
  const [conversationLoading, setConversationLoading] = useState(false);
  const [showNewThread, setShowNewThread] = useState(false);
  const [newThreadName, setNewThreadName] = useState('');
  const [newThreadCategory, setNewThreadCategory] = useState<Thread['category']>('general');
  const [messages, setMessages] = useState<ChatEntry[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [decisionContextRefreshing, setDecisionContextRefreshing] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [cleanupTip, setCleanupTip] = useState<string | null>(null);
  const [pendingUndo, setPendingUndo] = useState<PendingUndo>(null);
  const [cleanupInFlight, setCleanupInFlight] = useState(false);
  const [creativeDecisions, setCreativeDecisions] = useState<CreativeDecision[]>([]);
  const [showDecisionPanel, setShowDecisionPanel] = useState(false);
  const [extractingMessageId, setExtractingMessageId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const initialScrollDoneRef = useRef(false);
  const projectIdRef = useRef(projectId);
  const activeThreadIdRef = useRef(activeThreadId);
  const decisionOperationGenerationRef = useRef(0);
  const contextRefreshGenerationRef = useRef(0);
  const cleanupLockRef = useRef(createCleanupLock());
  projectIdRef.current = projectId;
  activeThreadIdRef.current = activeThreadId;

  const cleanupLocked = isStreaming || cleanupInFlight;

  const conversationLoader = useMemo(() => createConversationLoader({
    invoke: (channel, ...args) => window.electronAPI.invoke(channel, ...args),
    storage: localStorage,
    isProjectCurrent: requestProjectId => projectIdRef.current === requestProjectId,
    onApply: (requestProjectId, snapshot) => {
      if (projectIdRef.current !== requestProjectId) return;
      const nextData = toThreadData(snapshot);
      setThreadData(nextData);
      setLoadedProjectId(requestProjectId);
      setActiveThreadId(current => (
        current && nextData.threads.some(thread => thread.id === current)
          ? current
          : nextData.threads[0]?.id ?? null
      ));
      setError(null);
    },
    onError: (requestProjectId, loadError) => {
      if (projectIdRef.current !== requestProjectId) return;
      const message = loadError instanceof Error ? loadError.message : String(loadError);
      setError(`会话加载失败：${message}`);
    },
    onLoadingChange: (requestProjectId, loading) => {
      if (projectIdRef.current === requestProjectId) setConversationLoading(loading);
    },
  }), []);

  const creativeDecisionLoader = useMemo(() => createCreativeDecisionLoader({
    invoke: (channel, ...args) => window.electronAPI.invoke(channel, ...args),
    getCurrentProjectId: () => projectIdRef.current ?? null,
    onApply: (requestProjectId, decisions) => {
      if (projectIdRef.current === requestProjectId) setCreativeDecisions(decisions);
    },
    onError: (requestProjectId, loadError) => {
      if (projectIdRef.current === requestProjectId) {
        setError(`决策账本加载失败：${loadError.message}`);
      }
    },
  }), []);

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
    // 首次打开弹到最底部，后续不自动滚（用户自己往上翻）
    if (!initialScrollDoneRef.current && messages.length > 0) {
      initialScrollDoneRef.current = true;
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
    }
  }, [messages, streamingText]);

  // 项目切换时重置滚动标记
  useEffect(() => {
    initialScrollDoneRef.current = false;
  }, [projectId]);

  // Load configs async on mount (decrypt keys via IPC)
  useEffect(() => {
    loadConfigsDecrypted().then(configs => {
      setSavedConfigs(configs);
      if (!activeConfigId && configs.length > 0) {
        setActiveConfigId(configs[0].id);
      }
    });
  }, []);

  // 项目切换时只从 SQLite 加载；旧项目的迟到结果会被 loader 丢弃。
  // 清理在飞锁不在此释放——等旧请求 finally + token 匹配后自行解锁。
  useEffect(() => {
    conversationLoader.invalidate();
    setThreadData(EMPTY_THREAD_DATA);
    setLoadedProjectId(null);
    setActiveThreadId(null);
    setMessages([]);
    setPendingUndo(null);
    setCleanupTip(null);
    setError(null);
    setStreamingText('');
    setIsStreaming(false);

    if (!projectId) {
      setConversationLoading(false);
      return;
    }
    setConversationLoading(true);
    void conversationLoader.load(projectId);
  }, [conversationLoader, projectId]);

  // 撤销条约 10 秒后自动收起（不调 restore，仅收 UI）
  useEffect(() => {
    if (!pendingUndo) return;
    const remaining = pendingUndo.expiresAt - Date.now();
    if (remaining <= 0) {
      setPendingUndo(null);
      return;
    }
    const timer = window.setTimeout(() => setPendingUndo(null), remaining);
    return () => window.clearTimeout(timer);
  }, [pendingUndo]);

  useEffect(() => {
    if (!cleanupTip) return;
    const timer = window.setTimeout(() => setCleanupTip(null), 2500);
    return () => window.clearTimeout(timer);
  }, [cleanupTip]);

  useEffect(() => {
    decisionOperationGenerationRef.current += 1;
    contextRefreshGenerationRef.current += 1;
    setDecisionContextRefreshing(false);
    creativeDecisionLoader.invalidate();
    setCreativeDecisions([]);
    setShowDecisionPanel(false);
    setExtractingMessageId(null);
    if (projectId) void creativeDecisionLoader.load(projectId);
  }, [creativeDecisionLoader, projectId]);

  // Load messages when active thread or its SQLite snapshot changes
  useEffect(() => {
    if (activeThreadId && threadData.messages[activeThreadId]) {
      setMessages(threadData.messages[activeThreadId]);
    } else {
      setMessages([]);
    }
    setStreamingText('');
  }, [activeThreadId, threadData]);

  // Handle thread creation
  const handleCreateThread = async () => {
    const requestProjectId = projectId;
    if (!newThreadName.trim() || !requestProjectId || loadedProjectId !== requestProjectId) return;
    if (isStreaming || cleanupInFlight) return;
    const response = await window.electronAPI.invoke('db:conversation:createThread', {
      projectId: requestProjectId,
      title: newThreadName.trim(),
      category: newThreadCategory,
    }) as IpcResult<ConversationThread>;
    if (projectIdRef.current !== requestProjectId) return;
    if (!response.success || !response.data) {
      setError(response.error || '新建会话失败');
      return;
    }
    const thread: Thread = {
      id: response.data.id,
      name: response.data.title,
      category: response.data.category,
      createdAt: response.data.createdAt,
      updatedAt: response.data.updatedAt,
    };
    setThreadData(current => ({
      threads: [...current.threads, thread],
      messages: { ...current.messages, [thread.id]: [] },
    }));
    setActiveThreadId(thread.id);
    setNewThreadName('');
    setShowNewThread(false);
    setError(null);
  };

  const showCleanupUndo = (result: ConversationCleanupResult, requestProjectId: string) => {
    if (!result.batchId || result.noop) return;
    setPendingUndo({
      batchId: result.batchId,
      threadId: result.threadId,
      projectId: requestProjectId,
      expiresAt: Date.now() + CLEANUP_UNDO_MS,
    });
  };

  const removeMessagesLocally = (threadId: string, deletedMessageIds: string[]) => {
    const removed = new Set(deletedMessageIds);
    setThreadData(current => ({
      ...current,
      messages: {
        ...current.messages,
        [threadId]: (current.messages[threadId] || []).filter(item => !removed.has(item.id)),
      },
    }));
  };

  const handleDeleteTurn = async (userMessageId: string) => {
    const requestProjectId = projectId;
    const requestThreadId = activeThreadId;
    if (!requestProjectId || !requestThreadId || loadedProjectId !== requestProjectId) return;
    if (isStreaming) return;
    const token = cleanupLockRef.current.tryAcquire();
    if (!token) return;
    setCleanupInFlight(true);
    setCleanupTip(null);
    try {
      const input: DeleteConversationTurnInput = {
        projectId: requestProjectId,
        threadId: requestThreadId,
        userMessageId,
      };
      const response = await window.electronAPI.invoke(
        'db:conversation:deleteTurn', input,
      ) as IpcResult<ConversationCleanupResult>;
      if (projectIdRef.current !== requestProjectId) return;
      if (!response.success || !response.data) {
        setError(response.error || '删除本轮失败');
        return;
      }
      if (response.data.noop) return;
      removeMessagesLocally(requestThreadId, response.data.deletedMessageIds);
      showCleanupUndo(response.data, requestProjectId);
      setError(null);
    } finally {
      cleanupLockRef.current.release(token);
      setCleanupInFlight(cleanupLockRef.current.isHeld());
    }
  };

  const handleClearThread = async () => {
    const requestProjectId = projectId;
    const requestThreadId = activeThreadId;
    if (!requestProjectId || !requestThreadId || loadedProjectId !== requestProjectId) return;
    if (isStreaming) return;
    const token = cleanupLockRef.current.tryAcquire();
    if (!token) return;
    setCleanupInFlight(true);
    setCleanupTip(null);
    try {
      const input: ClearConversationThreadInput = {
        projectId: requestProjectId,
        threadId: requestThreadId,
      };
      const response = await window.electronAPI.invoke(
        'db:conversation:clearThread', input,
      ) as IpcResult<ConversationCleanupResult>;
      if (projectIdRef.current !== requestProjectId) return;
      if (!response.success || !response.data) {
        setError(response.error || '清空消息失败');
        return;
      }
      if (response.data.noop) {
        setCleanupTip('已无消息');
        setPendingUndo(null);
        return;
      }
      setThreadData(current => ({
        ...current,
        messages: { ...current.messages, [requestThreadId]: [] },
      }));
      showCleanupUndo(response.data, requestProjectId);
      setError(null);
    } finally {
      cleanupLockRef.current.release(token);
      setCleanupInFlight(cleanupLockRef.current.isHeld());
    }
  };

  const handleUndoCleanup = async () => {
    const undo = pendingUndo;
    if (!undo) return;
    if (isStreaming) return;
    const requestProjectId = undo.projectId;
    const token = cleanupLockRef.current.tryAcquire();
    if (!token) return;
    setCleanupInFlight(true);
    try {
      const input: RestoreConversationBatchInput = {
        projectId: requestProjectId,
        threadId: undo.threadId,
        batchId: undo.batchId,
      };
      const response = await window.electronAPI.invoke(
        'db:conversation:restoreBatch', input,
      ) as IpcResult<ConversationRestoreResult>;
      if (projectIdRef.current !== requestProjectId) return;
      if (!response.success || !response.data) {
        setError(response.error || '撤销失败');
        return;
      }
      const snapshot = await window.electronAPI.invoke(
        'db:conversation:findByProject', requestProjectId,
      ) as IpcResult<ConversationSnapshot>;
      if (projectIdRef.current !== requestProjectId) return;
      if (!snapshot.success || !snapshot.data) {
        setError(snapshot.error || '撤销后刷新消息失败');
        return;
      }
      const nextMessages = (snapshot.data.messages[undo.threadId] || []).map(toChatEntry);
      setThreadData(current => ({
        ...current,
        messages: { ...current.messages, [undo.threadId]: nextMessages },
      }));
      setPendingUndo(null);
      setCleanupTip(null);
      setError(null);
    } finally {
      cleanupLockRef.current.release(token);
      setCleanupInFlight(cleanupLockRef.current.isHeld());
    }
  };

  // Handle thread deletion（硬删 + 二次确认；占用同一清理单飞锁）
  const handleDeleteThread = async (threadId: string) => {
    const requestProjectId = projectId;
    if (!requestProjectId || loadedProjectId !== requestProjectId) return;
    if (isStreaming) return;
    const thread = threadData.threads.find(t => t.id === threadId);
    if (!confirm(`确定删除会话「${thread?.name || '对话'}」？此操作不可短时撤销。`)) return;

    const token = cleanupLockRef.current.tryAcquire();
    if (!token) return;
    setCleanupInFlight(true);
    const msgs = threadData.messages[threadId] || [];

    try {
      // 保存到回收站
      try {
        const raw = localStorage.getItem('hi-story-trash-bin');
        const trash = raw ? JSON.parse(raw) : [];
        trash.unshift({
          id: 'trash_' + Date.now(),
          entityType: 'aiThread',
          entityId: threadId,
          entityName: thread?.name || '对话',
          projectId: requestProjectId,
          data: { thread, messages: msgs },
          deletedAt: new Date().toISOString(),
        });
        localStorage.setItem('hi-story-trash-bin', JSON.stringify(trash.slice(0, 100)));
      } catch {}

      const response = await window.electronAPI.invoke(
        'db:conversation:removeThread', requestProjectId, threadId,
      ) as IpcResult<void>;
      if (projectIdRef.current !== requestProjectId) return;
      if (!response.success) {
        setError(response.error || '删除会话失败');
        return;
      }
      setThreadData(current => {
        const { [threadId]: _removed, ...remainingMessages } = current.messages;
        return {
          threads: current.threads.filter(item => item.id !== threadId),
          messages: remainingMessages,
        };
      });
      if (activeThreadIdRef.current === threadId) {
        const remaining = threadData.threads.filter(item => item.id !== threadId);
        setActiveThreadId(remaining[0]?.id ?? null);
      }
      setPendingUndo(current => (current?.threadId === threadId ? null : current));
      setError(null);
    } finally {
      cleanupLockRef.current.release(token);
      setCleanupInFlight(cleanupLockRef.current.isHeld());
    }
  };

  const handleAddConfig = async () => {
    if (!editingApiKey.trim() || !editingProviderId) return;
    const provider = PROVIDERS.find(p => p.id === editingProviderId);
    if (!provider) return;
    const model = editingModel || provider.defaultModel;
    const label = editingLabel || `${provider.displayName} #${savedConfigs.length + 1}`;

    const newConfig: SavedConfig = {
      id: generateId(),
      providerId: editingProviderId,
      apiKey: editingApiKey.trim(),
      model: model || 'ep-',
      label,
    };

    const updated = [...savedConfigs, newConfig];
    setSavedConfigs(updated);
    await saveConfigsEncrypted(updated);
    setActiveConfigId(newConfig.id);
    // 保存后不清空表单，方便继续添加
    formDirtyRef.current = false;
    setShowSettings(false);
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
  const currentProviderPreset = PROVIDERS.find(p => p.id === editingProviderId);
  const currentProviderModels = currentProviderPreset?.models || [];
  const currentProviderHint = currentProviderPreset?.hint;

  const appendConversationMessage = async (
    requestProjectId: string,
    threadId: string,
    role: 'user' | 'assistant',
    content: string,
    contextType: string,
    providerId: string | null,
  ): Promise<ConversationMessage> => {
    const response = await window.electronAPI.invoke('db:conversation:appendMessage', {
      projectId: requestProjectId,
      threadId,
      role,
      content,
      contextType,
      providerId,
    }) as IpcResult<ConversationMessage>;
    if (!response.success || !response.data) throw new Error(response.error || '消息保存失败');
    return response.data;
  };

  const appendMessageToCurrentSnapshot = (
    requestProjectId: string,
    threadId: string,
    message: ConversationMessage,
  ) => {
    if (projectIdRef.current !== requestProjectId) return;
    setThreadData(current => ({
      threads: current.threads.map(thread => (
        thread.id === threadId ? { ...thread, updatedAt: message.updatedAt } : thread
      )),
      messages: {
        ...current.messages,
        [threadId]: [...(current.messages[threadId] || []), toChatEntry(message)],
      },
    }));
  };

  const performConversationTurn = async (text: string, contextType: string) => {
    const requestProjectId = projectId;
    const requestThreadId = activeThreadId;
    const requestConfig = activeConfig;
    if (!requestConfig) {
      setError('请先添加一个 AI 配置（点击 ⚙️ → 选择服务 → 输入 API Key）');
      return;
    }
    if (!requestProjectId || loadedProjectId !== requestProjectId || !requestThreadId) {
      setError('会话尚未加载完成，请稍后重试');
      return;
    }
    if (cleanupLockRef.current.isHeld()) {
      setError('清理操作进行中，请稍后再发送');
      return;
    }

    const history = [...messages];
    setError(null);
    setLastRequestTokens(null);
    setIsStreaming(true);
    setStreamingText('');

    try {
      const result = await runPersistedConversationTurn({
        persistUser: () => appendConversationMessage(
          requestProjectId, requestThreadId, 'user', text, contextType, null,
        ),
        onUserPersisted: message => {
          appendMessageToCurrentSnapshot(requestProjectId, requestThreadId, message);
          onSaveMessage?.('user', text);
        },
        createStream: userMessage => {
          const chatMessages: ChatMessage[] = [
            ...contextMessages,
            ...history.map(message => ({
              role: message.role,
              content: message.content,
            })),
            { role: 'user', content: userMessage.content },
          ];
          const requestProvider = PROVIDERS.find(p => p.id === requestConfig.providerId);
          const config = snapshotAIRequestConfig({
            name: requestProvider?.name ?? requestConfig.providerId,
            apiKey: requestConfig.apiKey,
            model: requestConfig.model,
            baseUrl: requestConfig.baseUrl || requestProvider?.baseUrl,
          });
          return aiService.chatStream(config, chatMessages, { maxTokens: 2048 }, requestProjectId);
        },
        onProgress: content => {
          if (projectIdRef.current === requestProjectId && activeThreadIdRef.current === requestThreadId) {
            setStreamingText(content);
          }
        },
        persistAssistant: content => appendConversationMessage(
          requestProjectId,
          requestThreadId,
          'assistant',
          content,
          contextType,
          requestConfig.providerId,
        ),
      });

      appendMessageToCurrentSnapshot(requestProjectId, requestThreadId, result.assistantMessage);
      onSaveMessage?.('assistant', result.assistantMessage.content);
      const stats = trackUsage(requestConfig.providerId, text, result.assistantMessage.content);
      if (projectIdRef.current === requestProjectId) {
        setLastRequestTokens(stats);
        setUsage(loadUsage());
      }
    } catch (requestError) {
      if (projectIdRef.current === requestProjectId) {
        const message = requestError instanceof Error ? requestError.message : String(requestError);
        if (!isSilentAiStreamEnd(message)) setError(message || 'AI 请求失败');
      }
    } finally {
      if (projectIdRef.current === requestProjectId) {
        setIsStreaming(false);
        setStreamingText('');
      }
    }
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || isStreaming || decisionContextRefreshing || cleanupInFlight) return;
    if (!activeConfig) {
      setError('请先添加一个 AI 配置（点击 ⚙️ → 选择服务 → 输入 API Key）');
      return;
    }
    setInput('');
    await performConversationTurn(text, 'chat');
  };

  const reloadCreativeDecisions = async () => {
    const requestProjectId = projectIdRef.current;
    if (requestProjectId) await creativeDecisionLoader.load(requestProjectId);
  };

  // ===== 停止当前对话流（一期：真实中止主进程流） =====
  const handleStopStream = async () => {
    const requestProjectId = projectIdRef.current;
    if (requestProjectId) await aiService.cancelActiveStreams(requestProjectId);
    setIsStreaming(false);
    setStreamingText('');
  };

  const handleExtractDecisions = async (message: ChatEntry) => {
    const requestProjectId = projectId;
    const requestThreadId = activeThreadId;
    const requestConfig = activeConfig;
    if (!requestProjectId || !requestThreadId || loadedProjectId !== requestProjectId) {
      setError('会话尚未加载完成，请稍后重试');
      return;
    }
    if (!requestConfig) {
      setError('请先添加一个 AI 配置（点击 ⚙️ → 选择服务 → 输入 API Key）');
      return;
    }

    const requestGeneration = ++decisionOperationGenerationRef.current;
    setExtractingMessageId(message.id);
    setError(null);
    try {
      const requestProvider = PROVIDERS.find(p => p.id === requestConfig.providerId);
      const config = snapshotAIRequestConfig({
        name: requestProvider?.name ?? requestConfig.providerId,
        apiKey: requestConfig.apiKey,
        model: requestConfig.model,
        baseUrl: requestConfig.baseUrl || requestProvider?.baseUrl,
      });
      let extractedText = '';
      for await (const text of aiService.chatStream(
        config,
        buildDecisionExtractionMessages(message.content),
        { maxTokens: 2048, temperature: 0.1 },
        requestProjectId,
      )) {
        extractedText = text;
      }
      const drafts = parseDecisionDrafts(extractedText);
      if (drafts.length === 0) throw new Error('这条回复中没有可确认的结构化决策');
      if (
        projectIdRef.current !== requestProjectId
        || decisionOperationGenerationRef.current !== requestGeneration
      ) return;

      const input: CreateCreativeDecisionProposalsInput = {
        projectId: requestProjectId,
        sourceThreadId: requestThreadId,
        sourceMessageId: message.id,
        drafts,
      };
      const response = await window.electronAPI.invoke(
        'db:creativeDecisions:createProposals', input,
      ) as IpcResult<CreativeDecision[]>;
      if (
        projectIdRef.current !== requestProjectId
        || decisionOperationGenerationRef.current !== requestGeneration
      ) return;
      if (!response.success || !response.data) {
        throw new Error(response.error || '决策提议保存失败');
      }
      setCreativeDecisions(current => {
        const createdIds = new Set(response.data!.map(item => item.id));
        return [...current.filter(item => !createdIds.has(item.id)), ...response.data!];
      });
      setShowDecisionPanel(true);
    } catch (extractionError) {
      if (
        projectIdRef.current === requestProjectId
        && decisionOperationGenerationRef.current === requestGeneration
      ) {
        const message = extractionError instanceof Error ? extractionError.message : String(extractionError);
        if (!isSilentAiStreamEnd(message)) setError(message);
      }
    } finally {
      if (
        projectIdRef.current === requestProjectId
        && decisionOperationGenerationRef.current === requestGeneration
      ) {
        setExtractingMessageId(null);
      }
    }
  };

  // 编辑器“继续写”请求复用同一持久化边界，并记录独立上下文类型。
  useEffect(() => {
    const continueReq = localStorage.getItem('hi-story-pending-ai-continue');
    if (
      continueReq
      && !isStreaming
      && !cleanupInFlight
      && activeConfig
      && contextMessages.length > 0
      && projectId
      && loadedProjectId === projectId
      && activeThreadId
    ) {
      localStorage.removeItem('hi-story-pending-ai-continue');
      void performConversationTurn(
        '请根据当前上下文，继续写接下来的内容。保持风格和情节的连贯性。',
        'continue',
      );
    }
  }, [activeConfigId, activeThreadId, cleanupInFlight, contextMessages.length, isStreaming, loadedProjectId, projectId]);

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
    <div className="h-full flex flex-col bg-aichat-900">
      {/* === Header with thread management === */}
      <div className="px-4 py-3 border-b border-aichat-700 bg-aichat-800 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-300 flex-shrink-0">AI 对话</h3>
        <div className="flex items-center gap-1">
          {projectId && (
            <button
              onClick={() => setShowDecisionPanel(true)}
              className="text-gray-400 hover:text-gray-100 transition-colors text-xs"
              title="打开创作决策账本"
            >
              决策{creativeDecisions.filter(item => item.status === 'proposed').length > 0
                ? `(${creativeDecisions.filter(item => item.status === 'proposed').length})`
                : ''}
            </button>
          )}
          <button
            onClick={() => {
              if (cleanupLocked) return;
              setShowNewThread(!showNewThread);
            }}
            disabled={cleanupLocked}
            className="text-gray-400 hover:text-gray-100 transition-colors text-xs disabled:opacity-40 disabled:cursor-not-allowed"
            title={cleanupLocked ? '生成或清理进行中，请稍后再新建' : '新建对话线程'}
          >
            +新对话
          </button>
          <button
            onClick={() => setShowChatSearch(!showChatSearch)}
            className="text-gray-400 hover:text-gray-100 transition-colors text-xs"
            title="搜索对话历史"
          >
            🔍
          </button>
          <button
            onClick={() => {
              setShowSettings(!showSettings);
            }}
            className="text-gray-400 hover:text-gray-100 transition-colors text-sm"
            title="管理 AI 配置"
          >
            ⚙️
          </button>
        </div>
      </div>
      {/* Thread tabs */}
      {threadData.threads.length > 0 && (
        <div className="flex items-center gap-0.5 px-2 py-1.5 bg-aichat-800/50 border-b border-aichat-700 overflow-x-auto">
          {threadData.threads.map(t => (
            <div
              key={t.id}
              className={`flex items-center gap-0.5 flex-shrink-0`}
            >
              <button
                onClick={() => {
                  if (cleanupLocked) return;
                  setActiveThreadId(t.id);
                }}
                disabled={cleanupLocked}
                className={`px-2 py-1 rounded text-[10px] whitespace-nowrap transition-colors disabled:cursor-not-allowed ${
                  t.id === activeThreadId
                    ? 'bg-accent text-white'
                    : 'text-gray-400 hover:bg-aichat-700 hover:text-gray-100 disabled:opacity-40'
                }`}
                title={cleanupLocked
                  ? '生成或清理进行中，请稍后再切换会话'
                  : `${THREAD_CATEGORY_LABELS[t.category]} — ${t.name}`}
              >
                {THREAD_CATEGORY_ICONS[t.category]} {t.name}
              </button>
              <button
                onClick={() => {
                  if (cleanupLocked) return;
                  void handleDeleteThread(t.id);
                }}
                disabled={cleanupLocked}
                className="text-gray-600 hover:text-red-400 text-[8px] px-0.5 disabled:opacity-40 disabled:cursor-not-allowed"
                title={cleanupLocked ? '生成或清理进行中' : '删除对话'}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* New thread form */}
      {showNewThread && (
        <div className="px-3 py-2 border-b border-aichat-700 bg-aichat-800/50 space-y-2">
          <input
            type="text"
            value={newThreadName}
            onChange={(e) => setNewThreadName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreateThread(); if (e.key === 'Escape') setShowNewThread(false); }}
            placeholder="对话名称..."
            className="w-full px-2 py-1 bg-aichat-700 border border-aichat-600 rounded text-gray-100 text-xs
                       focus:outline-none focus:border-accent placeholder-gray-500"
            autoFocus
          />
          <div className="flex items-center gap-2">
            <select
              value={newThreadCategory}
              onChange={(e) => setNewThreadCategory(e.target.value as Thread['category'])}
              className="flex-1 px-2 py-1 bg-aichat-700 border border-aichat-600 rounded text-gray-100 text-[10px]
                         focus:outline-none focus:border-accent"
            >
              {(Object.entries(THREAD_CATEGORY_LABELS) as [Thread['category'], string][]).map(([k, v]) => (
                <option key={k} value={k}>{THREAD_CATEGORY_ICONS[k]} {v}</option>
              ))}
            </select>
            <button
              onClick={handleCreateThread}
              disabled={!newThreadName.trim() || conversationLoading || loadedProjectId !== projectId || cleanupLocked}
              className="px-3 py-1 text-xs bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-50"
            >
              创建
            </button>
            <button
              onClick={() => setShowNewThread(false)}
              className="px-2 py-1 text-xs text-gray-400 hover:text-gray-100"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* Chat history search */}
      {showChatSearch && (
        <div className="px-3 py-2 border-b border-aichat-700 bg-aichat-800/50 space-y-2">
          <div className="flex gap-1">
            <input
              type="text"
              value={chatSearchQuery}
              onChange={(e) => setChatSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && chatSearchQuery.trim() && projectId) {
                  const allResults: { threadId: string; threadName: string; entries: ChatEntry[] }[] = [];
                  for (const t of threadData.threads) {
                    const msgs = (threadData.messages[t.id] || []).filter(m =>
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
              className="flex-1 px-2 py-1 bg-aichat-700 border border-aichat-600 rounded text-gray-100 text-xs
                         focus:outline-none focus:border-accent placeholder-gray-500"
            />
            <button
              onClick={() => { setShowChatSearch(false); setChatSearchResults([]); }}
              className="px-2 py-1 text-xs text-gray-400 hover:text-gray-100"
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
                      className="px-2 py-1 my-0.5 bg-aichat-900/50 rounded cursor-pointer hover:bg-aichat-700 text-[10px] text-gray-400"
                      onClick={() => {
                        if (cleanupLocked) return;
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
      <div className="px-4 py-1.5 border-b border-aichat-700 bg-aichat-800/30 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {savedConfigs.length > 0 && (
            <select
              value={activeConfigId ?? ''}
              onChange={(e) => handleSwitchConfig(e.target.value)}
              className="text-[10px] bg-aichat-700 border border-aichat-600 rounded px-2 py-1 text-gray-300
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
                onClick={() => void handleClearThread()}
                disabled={cleanupLocked || conversationLoading || loadedProjectId !== projectId}
                className="text-[10px] text-gray-500 hover:text-red-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                title={isStreaming ? '请先停止生成再清空' : cleanupInFlight ? '清理进行中' : '清空当前会话消息（约 10 秒内可撤销）'}
              >
                清空消息
              </button>
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
        <div className="px-4 py-3 border-b border-aichat-700 bg-aichat-800/50 space-y-2 text-[10px] max-h-[200px] overflow-y-auto">
          <div className="flex items-center justify-between">
            <span className="text-gray-400 font-medium">📊 用量统计</span>
            <button onClick={() => setShowUsage(false)} className="text-gray-500 hover:text-gray-100 text-xs">✕</button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-aichat-900 rounded p-2 text-center">
              <div className="text-gray-400">总输入</div>
              <div className="text-white font-mono">{(usage.totalInputTokens / 1000).toFixed(1)}k</div>
              <div className="text-gray-600">tokens</div>
            </div>
            <div className="bg-aichat-900 rounded p-2 text-center">
              <div className="text-gray-400">总输出</div>
              <div className="text-white font-mono">{(usage.totalOutputTokens / 1000).toFixed(1)}k</div>
              <div className="text-gray-600">tokens</div>
            </div>
            <div className="bg-aichat-900 rounded p-2 text-center">
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
                  <div key={key} className="flex justify-between text-gray-400 bg-aichat-900/50 px-2 py-0.5 rounded">
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
        <div className="px-4 py-3 border-b border-aichat-700 bg-aichat-800/50 space-y-4 max-h-[350px] overflow-y-auto">
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
                        ${c.id === activeConfigId ? 'bg-accent/20 border border-accent/30' : 'bg-aichat-700/50 border border-aichat-700 hover:bg-aichat-700'}`}
                      onClick={() => handleSwitchConfig(c.id)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (confirm(`删除配置「${c.label}」？`)) handleDeleteConfig(c.id);
                      }}
                    >
                      <span className="text-[10px]">{c.id === activeConfigId ? '✅' : '○'}</span>
                      <span className="flex-1 text-gray-300 truncate">{c.label}</span>
                      <span className="text-gray-500 text-[10px]">{p?.displayName} · {c.model}</span>
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
                  className="w-full px-2 py-1 bg-aichat-700 border border-aichat-600 rounded text-gray-100 text-xs
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
                    if (p) {
                      // 切换提供商时同时更新模型名
                      // 如果用户已经很填了自定义模型名，切换到有 preset 模型的提供商时才自动切
                      if (p.models.length > 0) {
                        setEditingModel(p.defaultModel);
                      } else {
                        setEditingModel('');
                      }
                    }
                  }}
                  className="w-full px-2 py-1.5 bg-aichat-700 border border-aichat-600 rounded text-gray-100 text-xs
                             focus:outline-none focus:border-accent"
                >
                  {PROVIDERS.map(p => (
                    <option key={p.id} value={p.id}>{p.displayName}</option>
                  ))}
                  {!editingProviderId && (
                    <option value="" disabled>-- 请选择 --</option>
                  )}
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
                  {editingProviderId === 'volcengine' && (
                    <a href="https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey" target="_blank" className="ml-1 text-accent hover:underline" rel="noreferrer">(获取 ↗)</a>
                  )}
                </label>
                <input
                  type="password"
                  value={editingApiKey}
                  onChange={(e) => setEditingApiKey(e.target.value)}
                  placeholder="sk-..."
                  className="w-full px-2 py-1 bg-aichat-700 border border-aichat-600 rounded text-gray-100 text-xs
                             focus:outline-none focus:border-accent placeholder-gray-500 font-mono"
                />
              </div>
              <div>
                <label className="text-[10px] text-gray-500">模型</label>
                {currentProviderModels.length > 0 && (
                  <select
                    value={editingModel}
                    onChange={(e) => setEditingModel(e.target.value)}
                    className="w-full px-2 py-1.5 bg-aichat-700 border border-aichat-600 rounded text-gray-100 text-xs
                               focus:outline-none focus:border-accent"
                  >
                    {currentProviderModels.map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                    {!currentProviderModels.includes(editingModel) && editingModel && (
                      <option value={editingModel}>{editingModel} (自定义)</option>
                    )}
                  </select>
                )}
                {/* 模型选择：豆包/火山方舟有下拉列表，其他提供商也有对应列表 */}
                {currentProviderModels.length > 0 && (
                  <select
                    value={editingModel}
                    onChange={(e) => setEditingModel(e.target.value)}
                    className="w-full px-2 py-1.5 bg-aichat-700 border border-aichat-600 rounded text-gray-100 text-xs
                               focus:outline-none focus:border-accent"
                  >
                    {currentProviderModels.map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                    {!currentProviderModels.includes(editingModel) && editingModel && (
                      <option value={editingModel}>{editingModel} (自定义)</option>
                    )}
                  </select>
                )}
                {/* 自定义模型名输入（始终显示，方便用户输入任意模型名或 ep- ID） */}
                <input
                  type="text"
                  value={editingModel}
                  onChange={(e) => setEditingModel(e.target.value)}
                  placeholder={currentProviderModels.length > 0
                    ? '或输入其他模型名 / ep- 接入点 ID...'
                    : '输入模型名（必填）...'}
                  className={`${currentProviderModels.length > 0 ? 'mt-1 ' : ''}w-full px-2 py-1 bg-aichat-700 border border-aichat-600 rounded text-gray-100 text-xs
                             focus:outline-none focus:border-accent placeholder-gray-500`}
                />
              </div>
              <button
                onClick={handleAddConfig}
                disabled={!editingApiKey.trim() || !editingProviderId}
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
        {conversationLoading && (
          <div className="text-center text-gray-500 text-xs mt-8">正在从数据库加载会话…</div>
        )}
        {messages.length === 0 && !isStreaming && !conversationLoading && (
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
              ${msg.role === 'user' ? 'bg-accent text-white' : 'bg-aichat-800 text-gray-200 border border-aichat-700'}`}>
              <div className="whitespace-pre-wrap">{msg.content}</div>
              <div className={`text-[10px] mt-1 flex items-center gap-2 ${msg.role === 'user' ? 'text-white/60' : 'text-gray-600'}`}>
                <span>
                  {new Date(msg.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                </span>
                {msg.role === 'user' && (
                  <button
                    onClick={() => void handleDeleteTurn(msg.id)}
                    disabled={cleanupLocked}
                    className="text-white/70 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
                    title={isStreaming ? '请先停止生成再删除' : cleanupInFlight ? '清理进行中' : '删除本轮（含后续回复，约 10 秒内可撤销）'}
                  >
                    删除本轮
                  </button>
                )}
              </div>
              {msg.role === 'assistant' && (
                <button
                  onClick={() => void handleExtractDecisions(msg)}
                  disabled={extractingMessageId !== null}
                  className="mt-2 text-[10px] text-accent hover:text-accent-hover disabled:opacity-50"
                >
                  {extractingMessageId === msg.id ? '整理中…' : '整理为决策'}
                </button>
              )}
            </div>
          </div>
        ))}

        {isStreaming && streamingText && (
          <div className="flex justify-start">
            <div className="max-w-[80%] rounded-lg px-4 py-2.5 text-sm bg-aichat-800 text-gray-200 border border-aichat-700">
              <div className="whitespace-pre-wrap">{streamingText}</div>
              <span className="inline-block w-2 h-4 bg-accent animate-pulse ml-0.5 align-text-bottom" />
            </div>
          </div>
        )}

        {isStreaming && !streamingText && (
          <div className="flex justify-start">
            <div className="rounded-lg px-4 py-2.5 bg-aichat-800 border border-aichat-700">
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
            <button onClick={() => setError(null)} className="ml-2 text-gray-500 hover:text-gray-100">关闭</button>
          </div>
        )}

        {cleanupTip && (
          <div className="text-center text-gray-500 text-xs py-1">{cleanupTip}</div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {pendingUndo
        && pendingUndo.projectId === projectId
        && pendingUndo.expiresAt > Date.now() && (
        <div className="px-3 py-2 border-t border-aichat-700 bg-aichat-800/80 flex items-center justify-between gap-2">
          <span className="text-xs text-gray-400">已删除 · 约 10 秒内可撤销</span>
          <button
            onClick={() => void handleUndoCleanup()}
            disabled={cleanupInFlight || isStreaming}
            className="text-xs px-2 py-1 rounded bg-accent text-white hover:bg-accent-hover disabled:opacity-50"
          >
            撤销
          </button>
        </div>
      )}

      {/* === Input === */}
      <div className="p-3 border-t border-aichat-700 bg-aichat-800">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={savedConfigs.length > 0 ? '和 AI 讨论你的小说...' : '请先点击 ⚙️ 添加 AI 配置...'}
            rows={2}
            className="flex-1 resize-y min-h-[2.5rem] max-h-40 rounded bg-aichat-900 border border-aichat-700 px-3 py-2 text-sm text-gray-100
                       focus:outline-none focus:border-accent placeholder-gray-600"
            disabled={isStreaming || decisionContextRefreshing || cleanupInFlight || conversationLoading || loadedProjectId !== projectId || !activeThreadId}
          />
          <button
            onClick={isStreaming ? handleStopStream : sendMessage}
            disabled={isStreaming ? false : (!input.trim() || decisionContextRefreshing || cleanupInFlight || conversationLoading || loadedProjectId !== projectId || !activeThreadId)}
            className={isStreaming
              ? 'px-4 py-2 bg-red-600 text-white text-sm rounded hover:bg-red-500 transition-colors self-end'
              : 'px-4 py-2 bg-accent text-white text-sm rounded hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors self-end'}
          >
            {isStreaming ? '⏹ 停止' : '发送'}
          </button>
        </div>
      </div>

      {showDecisionPanel && projectId && (
        <CreativeDecisionPanel
          projectId={projectId}
          decisions={creativeDecisions}
          onClose={() => setShowDecisionPanel(false)}
          onChanged={reloadCreativeDecisions}
          onCommitted={async (effects: CreativeDecisionEffect[]) => {
            const refreshGeneration = ++contextRefreshGenerationRef.current;
            setError(null);
            setDecisionContextRefreshing(true);
            try {
              await onCreativeDecisionsCommitted?.(effects);
            } finally {
              if (contextRefreshGenerationRef.current === refreshGeneration) {
                setDecisionContextRefreshing(false);
              }
            }
          }}
        />
      )}
    </div>
  );
};

export default AIChatPanel;
