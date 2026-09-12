import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { ChatMessage } from '../../main/ai/provider';
import { aiService, AI_STOPPED_MESSAGE } from '../services/ai.service';
import { WRITE_SYSTEM_PROMPT, buildWriteUserPrompt, FACT_EXTRACTION_SYSTEM_PROMPT, buildSummaryUserPrompt, htmlToPlainText } from '../services/ai-prompts';
import type { OutlineNode, Character, WorldEntry, Chapter, ChapterOutline } from '../types';
import { encrypt, decrypt } from '../services/crypto';
import { ContextBuilder } from '../../main/ai/context-builder';

// ============================================================
// 叙事事实层格式化工具 — 复用 context-builder 的分类标签
// ============================================================

const FACT_TYPE_LABELS: Record<string, string> = {
  location: '📍 位置',
  possession: '🎒 持有',
  relationship: '🤝 关系',
  knowledge: '🧠 认知',
  event: '⚡ 事件',
  emotional_state: '💭 情感',
  hook: '🪝 伏笔',
};

interface StoryFact {
  id: string;
  factType: string;
  subject: string;
  predicate: string;
  object: string;
  description: string;
  status: string;
  chapterId?: string | null;
  createdAt: string;
}

interface CharacterKnowledge {
  id: string;
  characterName: string;
  factDescription: string;
  source: string;
}

/** 将章纲字段格式化为「内容提要」摘要文本（A4b：代写/批量以章纲为结构输入） */
function formatChapterOutlineSummary(outline: ChapterOutline): string {
  const lines: string[] = [];
  if (outline.chapterGoal) lines.push(`本章任务：${outline.chapterGoal}`);
  if (outline.pov) lines.push(`视角：${outline.pov}`);
  if (outline.openingSituation) lines.push(`开场处境：${outline.openingSituation}`);
  if (outline.centralConflict) lines.push(`核心冲突：${outline.centralConflict}`);
  if (outline.keyBeats?.length) lines.push(`关键节拍：${outline.keyBeats.join(' → ')}`);
  if (outline.reveal) lines.push(`信息揭示：${outline.reveal}`);
  if (outline.characterChange) lines.push(`人物变化：${outline.characterChange}`);
  if (outline.emotionalBeat) lines.push(`情绪体验：${outline.emotionalBeat}`);
  if (outline.payoff) lines.push(`爽点/回报：${outline.payoff}`);
  if (outline.endingHook) lines.push(`章末钩子：${outline.endingHook}`);
  return lines.join('\n');
}

/** 将叙事事实列表格式化为 AI 可读的上下文文本 */
function formatFactsContext(facts: StoryFact[]): string | null {
  if (!facts || facts.length === 0) return null;

  const byType: Record<string, StoryFact[]> = {};
  for (const f of facts) {
    if (!byType[f.factType]) byType[f.factType] = [];
    byType[f.factType].push(f);
  }

  const lines: string[] = [];
  for (const [type, items] of Object.entries(byType)) {
    const label = FACT_TYPE_LABELS[type] || type;
    lines.push(`### ${label}`);
    const shown = items.slice(0, 8);
    for (const item of shown) {
      lines.push(`- ${item.description}`);
    }
    if (items.length > 8) {
      lines.push(`  *(还有 ${items.length - 8} 条，已省略)*`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

/** 将角色知识列表格式化为 AI 可读的上下文文本 */
function formatKnowledgeContext(knowledge: CharacterKnowledge[]): string | null {
  if (!knowledge || knowledge.length === 0) return null;

  const byChar: Record<string, CharacterKnowledge[]> = {};
  for (const k of knowledge) {
    const name = k.characterName || '未知角色';
    if (!byChar[name]) byChar[name] = [];
    byChar[name].push(k);
  }

  const lines: string[] = [];
  for (const [name, items] of Object.entries(byChar)) {
    lines.push(`### ${name}`);
    const shown = items.slice(0, 5);
    for (const item of shown) {
      lines.push(`- 知道「${item.factDescription}」—— 来源：${item.source}`);
    }
    if (items.length > 5) {
      lines.push(`  *(还有 ${items.length - 5} 条，已省略)*`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

/** 加载项目的叙事事实层上下文（故事事实 + 角色知识） */
async function loadFactsContext(projectId: string): Promise<{ factsStr: string | null; knowledgeStr: string | null }> {
  try {
    const [factsRes, knowledgeRes] = await Promise.all([
      (window as any).electronAPI.invoke('db:storyFacts:findRecentActive', projectId, 80),
      (window as any).electronAPI.invoke('db:storyFacts:findAllKnowledgeByProject', projectId),
    ]);
    const factsStr = factsRes?.success ? formatFactsContext(factsRes.data) : null;
    const knowledgeStr = knowledgeRes?.success ? formatKnowledgeContext(knowledgeRes.data) : null;
    return { factsStr, knowledgeStr };
  } catch {
    return { factsStr: null, knowledgeStr: null };
  }
}

// ============================================================
// AI 写章浮动面板
// - 上半部分：配置区（大纲选择、字数、风格）
// - 下半部分：流式生成预览 + 操作按钮
// ============================================================

interface AIWritePanelProps {
  /** 是否显示 */
  open: boolean;
  /** 关闭回调 */
  onClose: () => void;
  /** 大纲节点列表 */
  outlineNodes: OutlineNode[];
  /** 激活的大纲节点 ID（外部传入） */
  activeOutlineNodeId: string | null;
  /** 策划章纲（A4b：有则代写/批量以章纲为结构输入，回退 outlineNodes） */
  chapterOutlines?: ChapterOutline[];
  /** 从结构化章纲进入时的当前章纲（优先于选中节点） */
  pendingChapterOutline?: ChapterOutline | null;
  /** 角色列表 */
  characters: Character[];
  /** 世界观条目 */
  worldEntries: WorldEntry[];
  /** 章节列表（用于取前文上下文） */
  chapters: Chapter[];
  /** 项目名称 */
  projectName: string;
  /** 项目 ID（用于加载创作罗盘和风格指纹） */
  projectId: string;
  /** 项目类型标签 */
  typeTags: string[];
  /** 项目风格 */
  style: string;
  /** Obsidian 只读资料的有界上下文 */
  obsidianContext?: string;
  /** 从结构化章纲进入时使用的固定章节标题 */
  preferredTitle?: string;
  /** 保存为新章节的回调，返回新建章节 id（失败返回 null） */
  onSaveAsChapter: (title: string, content: string) => Promise<string | null>;
  /** 抽取结果（摘要/事实/角色知识）落库回调 */
  onPersistExtraction?: (
    projectId: string,
    chapterId: string,
    extraction: { summary?: string; facts?: unknown[]; knowledge?: unknown[] },
  ) => Promise<void>;
}

// Provider preset (与 AIChatPanel 保持一致)
interface ProviderPreset {
  id: string;
  name: string;
  displayName: string;
  baseUrl: string;
  type: 'claude' | 'openai-compatible';
  defaultModel: string;
  models: string[];
  hint?: string;
}

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

interface SavedConfig {
  id: string;
  providerId: string;
  apiKey: string;
  model: string;
  label: string;
}

const AI_CONFIGS_KEY = 'hi-story-ai-configs';

function loadConfigs(): SavedConfig[] {
  try {
    const raw = localStorage.getItem(AI_CONFIGS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

async function loadConfigsDecrypted(): Promise<SavedConfig[]> {
  const configs = loadConfigs();
  const decrypted = [];
  for (const c of configs) {
    decrypted.push({ ...c, apiKey: await decrypt(c.apiKey) });
  }
  return decrypted;
}

const AIWritePanel: React.FC<AIWritePanelProps> = ({
  open,
  onClose,
  outlineNodes,
  activeOutlineNodeId,
  chapterOutlines,
  pendingChapterOutline,
  characters,
  worldEntries,
  chapters,
  projectName,
  projectId,
  typeTags,
  style,
  obsidianContext,
  preferredTitle,
  onSaveAsChapter,
  onPersistExtraction,
}) => {
  // ===== 配置状态 =====
  const [selectedOutlineId, setSelectedOutlineId] = useState<string | null>(activeOutlineNodeId);
  const [targetWords, setTargetWords] = useState(3000);
  const [styleGuide, setStyleGuide] = useState('保持与项目风格一致');
  const [includeContext, setIncludeContext] = useState(true);
  const [includeCharacters, setIncludeCharacters] = useState(true);
  const [includeWorld, setIncludeWorld] = useState(true);
  const [extraRequirement, setExtraRequirement] = useState('');
  const [writeModel, setWriteModel] = useState<string>('');       // 写章用的模型（空=用全局默认）
  const [summaryModel, setSummaryModel] = useState<string>('');   // 摘要/事实抽取用的模型（空=用全局默认）

  // ===== AI 配置 =====
  const [aiReady, setAiReady] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [initDone, setInitDone] = useState(false);

  // ===== 生成状态 =====
  const [generating, setGenerating] = useState(false);
  const [generatedContent, setGeneratedContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // ===== 批量生成 + 断点续写（P2）=====
  const [batchMode, setBatchMode] = useState(false);
  const [selectedOutlineIds, setSelectedOutlineIds] = useState<Set<string>>(new Set());
  const [batchProgress, setBatchProgress] = useState<{
    total: number;
    completed: number;
    current?: string;       // 当前正在写的章节标题
    results: Array<{ title: string; content: string; saved: boolean }>;
  }>({ total: 0, completed: 0, results: [] });
  const BATCH_PROGRESS_KEY = 'hi-story-batch-progress';
  const [batchPaused, setBatchPaused] = useState(false);

  // ===== 面板尺寸拖拽缩放 =====
  const [panelSize, setPanelSize] = useState({ width: 680, height: 500 });
  const resizing = useRef(false);
  const resizeStartRef = useRef({ startX: 0, startY: 0, startW: 0, startH: 0 });

  // ===== 面板拖拽移动 =====
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelPos, setPanelPos] = useState<{ x: number; y: number } | null>(null);
  const dragging = useRef(false);
  const dragStartRef = useRef({ mouseX: 0, mouseY: 0, panelX: 0, panelY: 0 });

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizing.current = true;
    resizeStartRef.current = { startX: e.clientX, startY: e.clientY, startW: panelSize.width, startH: panelSize.height };
    document.body.style.cursor = 'nwse-resize';
    document.body.style.userSelect = 'none';
    const onMove = (ev: MouseEvent) => {
      if (!resizing.current) return;
      const dx = ev.clientX - resizeStartRef.current.startX;
      const dy = ev.clientY - resizeStartRef.current.startY;
      setPanelSize({
        width: Math.max(480, Math.min(1400, resizeStartRef.current.startW + dx)),
        height: Math.max(300, Math.min(900, resizeStartRef.current.startH + dy)),
      });
    };
    const onUp = () => {
      resizing.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [panelSize]);

  // ===== 拖拽移动：标题栏按下开始拖动 =====
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    // 不拖拽按钮（关闭按钮等）
    if ((e.target as HTMLElement).tagName === 'BUTTON' || (e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    dragging.current = true;
    const rect = panelRef.current!.getBoundingClientRect();
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      panelX: rect.left,
      panelY: rect.top,
    };
    document.body.style.cursor = 'move';
    document.body.style.userSelect = 'none';
    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const dx = ev.clientX - dragStartRef.current.mouseX;
      const dy = ev.clientY - dragStartRef.current.mouseY;
      setPanelPos({
        x: Math.max(-200, Math.min(window.innerWidth - 200, dragStartRef.current.panelX + dx)),
        y: Math.max(0, Math.min(window.innerHeight - 40, dragStartRef.current.panelY + dy)),
      });
    };
    const onUp = () => {
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  // 面板打开时计算初始居中位置（仅在首次打开且未被拖动过时）
  useEffect(() => {
    if (open && !panelPos) {
      setPanelPos({
        x: Math.max(0, (window.innerWidth - panelSize.width) / 2),
        y: Math.max(0, (window.innerHeight - panelSize.height) / 2),
      });
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // ===== 初始化 AI 配置 =====
  useEffect(() => {
    async function init() {
      try {
        const configs = await loadConfigsDecrypted();
        if (configs.length === 0) {
          setConfigError('请先在 AI 对话面板配置 API Key（点击 ⚙️ 图标）');
          setAiReady(false);
          return;
        }
        // 找激活的配置，或使用第一个
        const active = configs[0];
        const preset = PROVIDERS.find(p => p.id === active.providerId);
        if (!preset) {
          setConfigError(`未识别的提供商：${active.providerId}`);
          setAiReady(false);
          return;
        }
        aiService.configure(active.providerId, active.apiKey, active.model, preset.baseUrl);
        setAiReady(true);
        setConfigError(null);
      } catch (e) {
        setConfigError('AI 配置加载失败');
        setAiReady(false);
      } finally {
        setInitDone(true);
      }
    }
    init();
  }, [open]);

  // ===== 同步外部大纲选择 =====
  useEffect(() => {
    if (activeOutlineNodeId) setSelectedOutlineId(activeOutlineNodeId);
  }, [activeOutlineNodeId]);

  // ===== 切项目：作废旧项目的活跃流，迟到 token 不再进入本面板（一期） =====
  const prevProjectIdRef = useRef(projectId);
  useEffect(() => {
    if (prevProjectIdRef.current && prevProjectIdRef.current !== projectId) {
      aiService.ignoreProjectStreams(prevProjectIdRef.current);
    }
    prevProjectIdRef.current = projectId;
  }, [projectId]);

  // ===== 断点续写：页面打开时恢复进度 =====
  useEffect(() => {
    if (!open || !projectId) return;
    try {
      const saved = localStorage.getItem(`${BATCH_PROGRESS_KEY}-${projectId}`);
      if (saved) {
        const progress = JSON.parse(saved);
        if (progress.total > 0 && progress.completed < progress.total) {
          setBatchProgress(progress);
          setBatchMode(true);
          setBatchPaused(true); // 恢复后默认暂停，让用户手动继续
        }
      }
    } catch { /* ignore */ }
  }, [open, projectId]);

  // ===== 持久化批量进度 =====
  useEffect(() => {
    if (!projectId || batchProgress.total === 0) return;
    localStorage.setItem(`${BATCH_PROGRESS_KEY}-${projectId}`, JSON.stringify(batchProgress));
    // 全部完成后清除
    if (batchProgress.completed >= batchProgress.total) {
      localStorage.removeItem(`${BATCH_PROGRESS_KEY}-${projectId}`);
    }
  }, [batchProgress, projectId]);

  // ===== 构建 Write 上下文 =====
  const getContext = useCallback(() => {
    const selectedOutline = outlineNodes.find(n => n.id === selectedOutlineId);
    // A4b：从策划「AI 代写」进入时，pendingChapterOutline 是权威结构输入（不依赖 outline_nodes）
    const plannedOutline = pendingChapterOutline ?? null;
    if (!selectedOutline && !plannedOutline) return null;

    // 取最近章节的 AI 摘要（优先使用 summary 字段，回退到正文前 200 字）
    const recentChapters = chapters
      .filter(ch => ch.status === 'draft' || ch.status === 'final')
      .slice(-10)
      .map(ch => {
        if (ch.summary && ch.summary.length > 10) {
          return { title: ch.title, summary: ch.summary };
        }
        // 回退：取正文前 200 字
        return {
          title: ch.title,
          summary: ch.content
            ? (ch.content.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').slice(0, 200) + '...')
            : '(空)',
        };
      });

    // 章纲 → outlineTitle/outlineSummary；相关上下文优先用相邻章纲，回退 outlineNodes
    if (plannedOutline) {
      const summary = formatChapterOutlineSummary(plannedOutline);
      const relatedChapters = (chapterOutlines ?? [])
        .filter(c => c.chapterNumber !== plannedOutline.chapterNumber)
        .map(c => ({ title: `第${c.chapterNumber}章 ${c.title}`, summary: `${c.chapterGoal || ''}` }));
      return {
        projectName,
        typeTags,
        style,
        outlineTitle: `第${plannedOutline.chapterNumber}章 ${plannedOutline.title}`,
        outlineSummary: summary,
        characters: includeCharacters
          ? characters.map(c => ({
              name: c.name, aliases: c.aliases, personality: c.personality,
              background: c.background, arc: c.arc,
            }))
          : [],
        worldEntries: includeWorld
          ? worldEntries.map(w => ({ category: w.category, name: w.name, description: w.description }))
          : [],
        recentChapters: includeContext ? recentChapters : [],
        outlineNodes: relatedChapters,
      };
    }

    return {
      projectName,
      typeTags,
      style,
      outlineTitle: selectedOutline!.title,
      outlineSummary: selectedOutline!.summary || '',
      characters: includeCharacters
        ? characters.map(c => ({
            name: c.name,
            aliases: c.aliases,
            personality: c.personality,
            background: c.background,
            arc: c.arc,
          }))
        : [],
      worldEntries: includeWorld
        ? worldEntries.map(w => ({ category: w.category, name: w.name, description: w.description }))
        : [],
      recentChapters: includeContext ? recentChapters : [],
      outlineNodes: outlineNodes.map(n => ({ title: n.title, summary: n.summary || '' })),
    };
  }, [selectedOutlineId, outlineNodes, pendingChapterOutline, chapterOutlines, characters, worldEntries, chapters,
      projectName, typeTags, style, includeContext, includeCharacters, includeWorld]);

  // ===== 批量生成（P2 断点续写）=====
  const handleBatchGenerate = useCallback(async () => {
    if (selectedOutlineIds.size === 0) return;
    const ordered = outlineNodes.filter(n => selectedOutlineIds.has(n.id));
    setBatchProgress({ total: ordered.length, completed: 0, current: ordered[0]?.title, results: [] });
    setBatchPaused(false);
    await runBatch(ordered, 0);
  }, [selectedOutlineIds, outlineNodes, aiReady, styleGuide, targetWords, extraRequirement, projectId, characters, chapters, includeContext, includeCharacters, includeWorld]);

  const handleBatchResume = useCallback(() => {
    setBatchPaused(false);
    const ordered = outlineNodes.filter(n => selectedOutlineIds.has(n.id));
    runBatch(ordered, batchProgress.completed);
  }, [selectedOutlineIds, outlineNodes, batchProgress, aiReady, styleGuide, targetWords, extraRequirement, projectId, characters, chapters, includeContext, includeCharacters, includeWorld]);

  const handleBatchReset = useCallback(() => {
    setBatchProgress({ total: 0, completed: 0, results: [] });
    if (projectId) localStorage.removeItem(`${BATCH_PROGRESS_KEY}-${projectId}`);
  }, [projectId]);

  const runBatch = useCallback(async (nodes: OutlineNode[], startIndex: number) => {
    // 批量模式：一次性加载创作罗盘/风格指纹/钩子/叙事事实层（这些在整个批量中不变）
    const compassCtx = ContextBuilder.getCompassContext(projectId);
    const styleFpCtx = ContextBuilder.getStyleFingerprintContext(projectId);
    let hooksContext: string | null = null;
    let factsStr: string | null = null;
    let knowledgeStr: string | null = null;
    try {
      const [hooksRes, factsCtx] = await Promise.all([
        (window as any).electronAPI.invoke('db:narrativeHooks:getContext', projectId),
        loadFactsContext(projectId),
      ]);
      if (hooksRes?.success && hooksRes.data) hooksContext = hooksRes.data as string;
      else if (hooksRes && !hooksRes.success) hooksContext = null;
      factsStr = factsCtx.factsStr;
      knowledgeStr = factsCtx.knowledgeStr;
    } catch { /* ignore */ }

    for (let i = startIndex; i < nodes.length; i++) {
      setBatchProgress(p => ({ ...p, completed: i, current: nodes[i].title }));

      try {
        // 构建该章节的上下文
        const node = nodes[i];
        const recentChapters = chapters
          .filter(ch => ch.status === 'draft' || ch.status === 'final')
          .slice(-10)
          .map(ch => ({ title: ch.title, summary: ch.summary || '(空)' }));

        const ctx = {
          projectName,
          typeTags,
          style,
          outlineTitle: node.title,
          outlineSummary: node.summary || '',
          characters: includeCharacters ? characters.map(c => ({
            name: c.name, aliases: c.aliases, personality: c.personality,
            background: c.background, arc: c.arc,
          })) : [],
          worldEntries: includeWorld ? worldEntries.map(w => ({
            category: w.category, name: w.name, description: w.description,
          })) : [],
          recentChapters: includeContext ? recentChapters : [],
          outlineNodes: outlineNodes.map(n => ({ title: n.title, summary: n.summary || '' })),
          storyFactsSummary: factsStr ?? undefined,
          knowledgeSummary: knowledgeStr ?? undefined,
        };

        const extraBlocks: string[] = [];
        if (styleGuide && styleGuide !== '保持与项目风格一致') extraBlocks.push(`## 用户指定的写作风格\n${styleGuide}`);
        if (compassCtx) extraBlocks.push(compassCtx);
        if (styleFpCtx) extraBlocks.push(styleFpCtx);
        if (hooksContext) extraBlocks.push(hooksContext);
        if (obsidianContext) extraBlocks.push(obsidianContext);

        const systemPrompt = WRITE_SYSTEM_PROMPT
          + (extraBlocks.length > 0 ? '\n\n' + extraBlocks.join('\n\n---\n\n') : '');
        const userPrompt = buildWriteUserPrompt({ targetWords, extraRequirement }, ctx);

        const messages: ChatMessage[] = [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ];

        // 流式生成到面板
        setGeneratedContent('');
        const generator = aiService.chatStream(messages, {
          temperature: 0.7, maxTokens: targetWords * 3,
          ...(writeModel ? { model: writeModel } : {}),
        }, projectId);
        let fullText = '';
        for await (const token of generator) {
          fullText = token;
          setGeneratedContent(fullText);
        }

        // 自动保存（拿到章节 id，失败则记录 saved:false）
        const chapterId = await onSaveAsChapter(node.title || 'AI 生成章节', fullText);

        setBatchProgress(p => ({
          ...p,
          completed: i + 1,
          results: [...p.results, { title: node.title, content: fullText, saved: !!chapterId }],
        }));

        // 短延迟避免 IPC 拥塞
        await new Promise(r => setTimeout(r, 500));
      } catch (e) {
        console.error(`批量生成失败 [${nodes[i].title}]:`, e);
        setBatchProgress(p => ({
          ...p,
          completed: i + 1,
          results: [...p.results, { title: nodes[i].title, content: '', saved: false }],
        }));
      }
    }

    setBatchProgress(p => ({ ...p, current: undefined }));
    // 清除进度
    if (projectId) localStorage.removeItem(`${BATCH_PROGRESS_KEY}-${projectId}`);
  }, [projectId, projectName, typeTags, style, chapters, characters, worldEntries, outlineNodes, includeCharacters, includeWorld, includeContext, styleGuide, extraRequirement, targetWords, writeModel, obsidianContext, onSaveAsChapter]);

  // ===== 生成章节（单章）=====
  const handleGenerate = useCallback(async () => {
    const context = getContext();
    if (!context) {
      setError('请先选择一个大纲节点');
      return;
    }
    if (!aiReady) {
      setError('AI 未配置，请在 AI 对话面板配置 API Key');
      return;
    }

    setGenerating(true);
    setGeneratedContent('');
    setError(null);
    setSaved(false);

    try {
      // 拼接 system prompt：基础写章 prompt + 风格指南 + 创作罗盘 + 风格指纹 + 待回收钩子
      const compassCtx = ContextBuilder.getCompassContext(projectId);
      const styleFpCtx = ContextBuilder.getStyleFingerprintContext(projectId);

      // 并行加载钩子 + 叙事事实层（P0 修复：写章必须包含此前建立的事实，防止 AI 乱编）
      let hooksContext: string | null = null;
      let factsStr: string | null = null;
      let knowledgeStr: string | null = null;
      if (projectId) {
        try {
          const [hooksRes, factsCtx] = await Promise.all([
            (window as any).electronAPI.invoke('db:narrativeHooks:getContext', projectId),
            loadFactsContext(projectId),
          ]);
          if (hooksRes?.success && hooksRes.data) {
            hooksContext = hooksRes.data as string;
          } else if (hooksRes && !hooksRes.success) {
            hooksContext = null;
          }
          factsStr = factsCtx.factsStr;
          knowledgeStr = factsCtx.knowledgeStr;
        } catch { /* 忽略加载失败 */ }
      }

      const extraBlocks: string[] = [];
      if (styleGuide && styleGuide !== '保持与项目风格一致') {
        extraBlocks.push(`## 用户指定的写作风格\n${styleGuide}`);
      }
      if (compassCtx) extraBlocks.push(compassCtx);
      if (styleFpCtx) extraBlocks.push(styleFpCtx);
      if (hooksContext) extraBlocks.push(hooksContext);
      if (obsidianContext) extraBlocks.push(obsidianContext);

      const systemPrompt = WRITE_SYSTEM_PROMPT
        + (extraBlocks.length > 0 ? '\n\n' + extraBlocks.join('\n\n---\n\n') : '');

      // 注入叙事事实层到 user prompt
      const contextWithFacts = factsStr || knowledgeStr
        ? { ...context, storyFactsSummary: factsStr ?? undefined, knowledgeSummary: knowledgeStr ?? undefined }
        : context;

      const userPrompt = buildWriteUserPrompt(
        { targetWords, extraRequirement },
        contextWithFacts,
      );

      const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ];

      // 流式生成
      const generator = aiService.chatStream(messages, {
        temperature: 0.7,
        maxTokens: targetWords * 3,
        ...(writeModel ? { model: writeModel } : {}),
      }, projectId);
      let fullText = '';
      for await (const token of generator) {
        fullText = token;
        setGeneratedContent(fullText);
      }
    } catch (e) {
      const msg = (e as Error).message;
      if (msg !== AI_STOPPED_MESSAGE) setError(`AI 写作失败：${msg}`);
    } finally {
      setGenerating(false);
    }
  }, [getContext, aiReady, styleGuide, targetWords, extraRequirement, projectId, obsidianContext, writeModel]);

  // ===== 停止生成 =====
  const handleStop = useCallback(() => {
    // 一期：真正中止主进程流；for-await 会抛「已停止」，不会保存。
    if (projectId) void aiService.cancelActiveStreams(projectId);
    setGenerating(false);
  }, [projectId]);

  // ===== 保存为新章节 =====
  const handleSave = useCallback(async () => {
    if (!generatedContent) return;
    // 从生成内容取第一句作为标题，或使用大纲标题
    const plainText = generatedContent.replace(/<[^>]+>/g, '');
    const firstLine = plainText.split('\n').find(l => l.trim().length > 0)?.trim() || '';
    const title = firstLine.length > 40 ? firstLine.slice(0, 40) + '...' : firstLine;
    const chapterId = await onSaveAsChapter(preferredTitle || title || 'AI 生成章节', generatedContent);
    if (!chapterId) {
      setError('保存章节失败');
      return;
    }
    setSaved(true);

    // 异步生成章节摘要 + 抽取叙事事实（后台执行，不阻塞 UI）
    if (aiReady) {
      generateAndSaveSummary(projectId, chapterId, title || 'AI 生成章节', generatedContent);
    }
  }, [generatedContent, onSaveAsChapter, aiReady, characters, projectName, preferredTitle, projectId, onPersistExtraction]);

  // ===== 后台生成章节摘要 + 抽取叙事事实（合并为一次 AI 调用）=====
  const generateAndSaveSummary = useCallback(async (projectId: string, chapterId: string, chapterTitle: string, content: string) => {
    try {
      const userPrompt = buildSummaryUserPrompt(
        chapterTitle,
        content,
        characters.map(c => c.name),
      );

      const messages: ChatMessage[] = [
        { role: 'system', content: FACT_EXTRACTION_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ];

      // 事实抽取需要更大输出空间（每条事实约 80-100 tokens）
      const response = await aiService.chat(messages, {
        temperature: 0.3,
        maxTokens: 2048,
        ...(summaryModel ? { model: summaryModel } : {}),
      });

      // 解析 AI 返回的 JSON
      let jsonStr = response.trim();
      if (jsonStr.startsWith('```json')) jsonStr = jsonStr.slice(7);
      if (jsonStr.startsWith('```')) jsonStr = jsonStr.slice(3);
      if (jsonStr.endsWith('```')) jsonStr = jsonStr.slice(0, -3);
      jsonStr = jsonStr.trim();

      const parsed = JSON.parse(jsonStr);
      const summaryText = (parsed.summary || `${parsed.events || ''} | ${parsed.characters || ''}`).slice(0, 300);

      // 直接把抽取结果交给 App 落库（不再走 localStorage）
      onPersistExtraction?.(projectId, chapterId, {
        summary: summaryText,
        facts: parsed.facts || [],
        knowledge: parsed.knowledge || [],
      });
    } catch (e) {
      console.warn('章节摘要/事实抽取失败（不影响正文保存）：', e);
    }
  }, [aiReady, characters, onPersistExtraction]);

  // ===== 复制到剪贴板 =====
  const handleCopy = useCallback(async () => {
    if (!generatedContent) return;
    const plainText = generatedContent.replace(/<[^>]+>/g, '\n').replace(/&nbsp;/g, ' ');
    try {
      await navigator.clipboard.writeText(plainText);
    } catch {
      // 回退方案
      const ta = document.createElement('textarea');
      ta.value = plainText;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [generatedContent]);

  if (!open) return null;

  const selectedOutline = outlineNodes.find(n => n.id === selectedOutlineId);
  const wordCount = generatedContent
    ? (generatedContent.replace(/<[^>]+>/g, '').match(/[一-鿿㐀-䶿]/g) || []).length
    : 0;

  return (
    <div className="fixed inset-0 z-40 pointer-events-none">
      <div className="absolute inset-0 pointer-events-none" onClick={onClose} />
      <div
        ref={panelRef}
        className="absolute pointer-events-auto bg-gray-950 border border-gray-700 rounded-lg shadow-2xl flex flex-col overflow-hidden"
        style={panelPos ? {
          top: `${panelPos.y}px`,
          left: `${panelPos.x}px`,
          width: `${panelSize.width}px`,
          maxHeight: '90vh',
          height: `${panelSize.height}px`,
        } : {
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: `${panelSize.width}px`,
          maxHeight: '90vh',
          height: `${panelSize.height}px`,
        }}
      >
        {/* ── 标题栏（可拖拽移动）── */}
        <div
          className="flex items-center justify-between px-4 py-2 border-b border-gray-800 shrink-0 cursor-move select-none"
          onMouseDown={handleDragStart}
        >
          <span className="text-sm font-semibold text-gray-200">🤖 AI 写章</span>
          <div className="flex items-center gap-2">
            {!initDone ? (
              <span className="text-[10px] text-gray-500">检查 AI 配置...</span>
            ) : aiReady ? (
              <span className="text-[10px] text-green-500">🤖 AI 就绪</span>
            ) : (
              <span className="text-[10px] text-red-400">⚠️ 未配置 AI</span>
            )}
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-white text-lg leading-none"
            >
              ✕
            </button>
          </div>
        </div>

        {/* ── 主体 ── */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-sm">
          {/* 配置区 */}
          <div className="space-y-3">
            {/* 大纲节点选择 */}
            <div>
              <label className="text-[11px] text-gray-400 block mb-1">大纲节点</label>
              <select
                value={selectedOutlineId || ''}
                onChange={e => setSelectedOutlineId(e.target.value || null)}
                className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-xs text-gray-200 focus:outline-none focus:border-accent"
              >
                <option value="">(不选择大纲)</option>
                {outlineNodes.map(n => (
                  <option key={n.id} value={n.id}>{n.title}{n.summary ? ` — ${n.summary.slice(0, 50)}...` : ''}</option>
                ))}
              </select>
            </div>

            {/* 目标字数和风格 */}
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-[11px] text-gray-400 block mb-1">目标字数</label>
                <input
                  type="number"
                  value={targetWords}
                  onChange={e => setTargetWords(Number(e.target.value))}
                  min={500}
                  max={20000}
                  step={500}
                  className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-xs text-gray-200 focus:outline-none focus:border-accent"
                />
              </div>
              <div className="flex-1">
                <label className="text-[11px] text-gray-400 block mb-1">写作风格</label>
                <select
                  value={styleGuide}
                  onChange={e => setStyleGuide(e.target.value)}
                  className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-xs text-gray-200 focus:outline-none focus:border-accent"
                >
                  <option>保持与项目风格一致</option>
                  <option>古风武侠 — 文白夹杂、意象丰富</option>
                  <option>现代都市 — 简洁明快、口语化</option>
                  <option>玄幻修仙 — 恢弘大气、设定细致</option>
                  <option>悬疑推理 — 细节铺垫、气氛紧张</option>
                  <option>言情 — 细腻温柔、情感丰富</option>
                  <option>轻小说 — 轻松活泼、对话为主</option>
                </select>
              </div>
            </div>

            {/* 额外要求 */}
            <div>
              <label className="text-[11px] text-gray-400 block mb-1">额外要求（可选）</label>
              <input
                type="text"
                value={extraRequirement}
                onChange={e => setExtraRequirement(e.target.value)}
                placeholder="例如：本章应该以打斗场面为主..."
                className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-xs text-gray-200 focus:outline-none focus:border-accent placeholder-gray-600"
              />
            </div>

            {/* 开关组 */}
            <div className="flex flex-wrap gap-3">
              <label className="flex items-center gap-1.5 text-[11px] text-gray-400 cursor-pointer">
                <input type="checkbox" checked={includeContext} onChange={e => setIncludeContext(e.target.checked)} className="accent-accent" />
                前文上下文
              </label>
              <label className="flex items-center gap-1.5 text-[11px] text-gray-400 cursor-pointer">
                <input type="checkbox" checked={includeCharacters} onChange={e => setIncludeCharacters(e.target.checked)} className="accent-accent" />
                角色设定
              </label>
              <label className="flex items-center gap-1.5 text-[11px] text-gray-400 cursor-pointer">
                <input type="checkbox" checked={includeWorld} onChange={e => setIncludeWorld(e.target.checked)} className="accent-accent" />
                世界观
              </label>
              <label className="flex items-center gap-1.5 text-[11px] text-gray-400 cursor-pointer" title="选中多个大纲节点，依次生成">
                <input type="checkbox" checked={batchMode} onChange={e => { setBatchMode(e.target.checked); if (!e.target.checked) setSelectedOutlineIds(new Set()); }} className="accent-yellow" />
                批量模式
              </label>
            </div>

            {/* 批量模式：大纲多选列表 */}
            {batchMode && (
              <div className="max-h-[150px] overflow-y-auto bg-gray-900 border border-gray-700 rounded p-2 space-y-1">
                {outlineNodes.length === 0 ? (
                  <span className="text-[10px] text-gray-500">暂无大纲节点</span>
                ) : (
                  outlineNodes.map(n => (
                    <label key={n.id} className="flex items-center gap-2 text-[11px] text-gray-300 cursor-pointer hover:text-white">
                      <input
                        type="checkbox"
                        checked={selectedOutlineIds.has(n.id)}
                        onChange={e => {
                          const next = new Set(selectedOutlineIds);
                          e.target.checked ? next.add(n.id) : next.delete(n.id);
                          setSelectedOutlineIds(next);
                        }}
                        className="accent-yellow"
                      />
                      <span className="truncate">{n.title}{n.summary ? ` — ${n.summary.slice(0, 30)}...` : ''}</span>
                    </label>
                  ))
                )}
                {selectedOutlineIds.size > 0 && (
                  <div className="text-[10px] text-yellow-400 pt-1 border-t border-gray-800">
                    已选 {selectedOutlineIds.size} 章，按大纲顺序生成
                  </div>
                )}
              </div>
            )}

            {/* 批量进度 */}
            {batchMode && batchProgress.total > 0 && (
              <div className="bg-gray-900 border border-gray-700 rounded p-2 space-y-1">
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-gray-400">
                    进度：{batchProgress.completed}/{batchProgress.total}
                    {batchProgress.current && <span className="text-yellow-400 ml-2">▶ {batchProgress.current}</span>}
                  </span>
                  <span className="text-gray-500">{batchProgress.completed > 0 ? Math.round(batchProgress.completed / batchProgress.total * 100) : 0}%</span>
                </div>
                <div className="w-full h-1.5 bg-gray-800 rounded overflow-hidden">
                  <div
                    className="h-full bg-yellow-500 rounded transition-all"
                    style={{ width: `${batchProgress.total > 0 ? (batchProgress.completed / batchProgress.total) * 100 : 0}%` }}
                  />
                </div>
              </div>
            )}

            {/* 生成按钮 */}
            <div className="flex gap-2">
              {batchMode ? (
                <>
                  {(batchProgress.completed === 0 || batchProgress.completed >= batchProgress.total) ? (
                    <button
                      onClick={handleBatchGenerate}
                      disabled={!aiReady || selectedOutlineIds.size === 0}
                      className="px-4 py-1.5 bg-yellow-600 text-white text-xs rounded hover:bg-yellow-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      🖋 批量生成（{selectedOutlineIds.size} 章）
                    </button>
                  ) : batchProgress.completed < batchProgress.total ? (
                    <>
                      <button
                        onClick={handleBatchResume}
                        disabled={!aiReady}
                        className="px-4 py-1.5 bg-yellow-600 text-white text-xs rounded hover:bg-yellow-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        ▶ 继续生成
                      </button>
                      <button
                        onClick={handleBatchReset}
                        className="px-4 py-1.5 bg-gray-700 text-gray-300 text-xs rounded hover:bg-gray-600 transition-colors"
                      >
                        🔄 重置
                      </button>
                    </>
                  ) : null}
                </>
              ) : (
                !generating ? (
                  <button
                    onClick={handleGenerate}
                    disabled={!aiReady || !selectedOutlineId}
                    className="px-4 py-1.5 bg-accent text-white text-xs rounded hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    🖋 开始生成
                  </button>
                ) : (
                  <button
                    onClick={handleStop}
                    className="px-4 py-1.5 bg-red-600 text-white text-xs rounded hover:bg-red-500 transition-colors"
                  >
                    ⏹ 停止生成
                  </button>
                )
              )}
            </div>
          </div>

          {/* 错误提示 */}
          {configError && !aiReady && (
            <div className="p-3 bg-red-900/30 border border-red-800 rounded text-xs text-red-400">
              ⚠️ {configError}
            </div>
          )}
          {error && (
            <div className="p-3 bg-red-900/30 border border-red-800 rounded text-xs text-red-400">
              {error}
            </div>
          )}

          {/* 分隔线 */}
          {(generatedContent || generating) && (
            <div className="border-t border-gray-800" />
          )}

          {/* 生成预览区 */}
          {(generatedContent || generating) && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-gray-400">
                  {generating ? '生成中...' : `已生成 ${wordCount.toLocaleString()} 字`}
                </span>
              </div>
              <div className="p-3 bg-gray-900 border border-gray-700 rounded max-h-[300px] overflow-y-auto text-xs text-gray-200 leading-relaxed">
                {generating && !generatedContent ? (
                  <span className="text-gray-500 italic">正在创作...</span>
                ) : (
                  <div
                    className="prose prose-invert prose-xs max-w-none"
                    dangerouslySetInnerHTML={{
                      __html: generatedContent || '<span class="text-gray-500 italic">等待生成...</span>',
                    }}
                  />
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── 底部操作栏 ── */}
        {generatedContent && !generating && (
          <div className="flex items-center gap-2 px-4 py-3 border-t border-gray-800 shrink-0 bg-gray-950">
            <button
              onClick={handleSave}
              disabled={saved}
              className="px-3 py-1.5 bg-green-700 text-white text-xs rounded hover:bg-green-600 disabled:opacity-40 transition-colors"
            >
              {saved ? '✓ 已保存' : '💾 保存为新章节'}
            </button>
            <button
              onClick={handleCopy}
              className="px-3 py-1.5 bg-gray-700 text-gray-200 text-xs rounded hover:bg-gray-600 transition-colors"
            >
              {copied ? '✓ 已复制' : '📋 复制到剪贴板'}
            </button>
            <button
              onClick={handleGenerate}
              className="px-3 py-1.5 bg-gray-700 text-gray-200 text-xs rounded hover:bg-gray-600 transition-colors"
            >
              🔄 重新生成
            </button>
            <div className="flex-1" />
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-gray-500 text-xs hover:text-white transition-colors"
            >
              放弃
            </button>
          </div>
        )}

        {/* 拖拽缩放手柄（右下角） */}
        <div
          onMouseDown={handleResizeStart}
          className="absolute bottom-0 right-0 w-5 h-5 cursor-nwse-resize group select-none"
          title="拖动调整面板大小"
        >
          <svg
            width="14" height="14" viewBox="0 0 14 14"
            className="absolute bottom-1 right-1 text-gray-700 group-hover:text-gray-400 transition-colors"
          >
            <path d="M2 12 L12 2 M6 12 L12 6 M10 12 L12 10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
        </div>
      </div>
    </div>
  );
};

export default AIWritePanel;
