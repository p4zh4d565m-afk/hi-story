import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { ChatMessage, ProviderConfig } from '../../main/ai/provider';
import { aiService, streamEndDisplay } from '../services/ai.service';
import { snapshotAIRequestConfig } from '../services/ai/request-config';
import { POLISH_SYSTEM_PROMPT, buildPolishUserPrompt, htmlToPlainText } from '../services/ai-prompts';
import type { Chapter, Character, WorldEntry } from '../types';
import type { TextRange } from './editor/RichEditor';
import { encrypt, decrypt } from '../services/crypto';
import { ContextBuilder } from '../../main/ai/context-builder';

// ============================================================
// AI 去 AI 味润色浮动面板
// - 整章润色（工具栏入口）+ 选中文本润色（右键入口）
// - 保守润色：保留原意、只改不通顺/生硬/有 AI 味的地方
// - 并排对比预览（原文 vs 润色后），确认后才写回
// ============================================================

interface AIPolishPanelProps {
  /** 是否显示 */
  open: boolean;
  /** 关闭回调 */
  onClose: () => void;
  /** 章节列表 */
  chapters: Chapter[];
  /** 当前激活章节 ID */
  activeChapterId: string | null;
  /** 角色列表 */
  characters: Character[];
  /** 世界观条目 */
  worldEntries: WorldEntry[];
  /** 项目名称 */
  projectName: string;
  /** 项目 ID（用于加载创作罗盘和风格指纹） */
  projectId: string;
  /** 项目类型标签 */
  typeTags: string[];
  /** 选中文本入口传入的原文 */
  initialTargetText?: string | null;
  /** 选中文本入口传入的选区范围 */
  initialRange?: TextRange | null;
  /** 整章润色写回 */
  onApplyChapter: (chapterId: string, content: string) => void;
  /** 选中文本润色写回 */
  onApplySelection: (range: TextRange, html: string) => void;
}

interface SavedConfig {
  id: string;
  providerId: string;
  apiKey: string;
  model: string;
  label: string;
  baseUrl?: string;
}

const PROVIDERS: { id: string; name: string; baseUrl: string }[] = [
  { id: 'claude', name: 'claude', baseUrl: 'https://api.anthropic.com' },
  { id: 'openai', name: 'openai', baseUrl: 'https://api.openai.com/v1' },
  { id: 'deepseek', name: 'deepseek', baseUrl: 'https://api.deepseek.com/v1' },
  { id: 'doubao', name: 'doubao', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3' },
  { id: 'volcengine', name: 'volcengine', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3' },
  { id: 'qwen', name: 'qwen', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { id: 'zhipu', name: 'zhipu', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
  { id: 'moonshot', name: 'moonshot', baseUrl: 'https://api.moonshot.cn/v1' },
];

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

/** 将用户编辑后的纯文本转回 HTML（每个换行段落包 <p>） */
function plainTextToHtml(text: string): string {
  return text
    .split(/\n+/)
    .map(p => p.trim())
    .filter(p => p.length > 0)
    .map(p => `<p>${p}</p>`)
    .join('');
}

const AIPolishPanel: React.FC<AIPolishPanelProps> = ({
  open,
  onClose,
  chapters,
  activeChapterId,
  characters,
  worldEntries,
  projectName,
  projectId,
  typeTags,
  initialTargetText,
  initialRange,
  onApplyChapter,
  onApplySelection,
}) => {
  // ===== 状态 =====
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(activeChapterId);
  // 润色模式：selection=选中文本入口，chapter=整章入口
  const [mode, setMode] = useState<'chapter' | 'selection'>('chapter');
  // 选中文本入口的原文与选区范围
  const [selectionText, setSelectionText] = useState<string>('');
  const [selectionRange, setSelectionRange] = useState<TextRange | null>(null);
  const [polishing, setPolishing] = useState(false);
  const polishingRef = useRef(false);
  polishingRef.current = polishing;
  const [polishedContent, setPolishedContent] = useState('');
  // 用户可编辑的润色后纯文本（初始化时由 polishedContent 转换，用户可粘贴原文想保留的部分）
  const [editablePolishText, setEditablePolishText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [aiReady, setAiReady] = useState(false);
  const [requestBase, setRequestBase] = useState<ProviderConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [initDone, setInitDone] = useState(false);
  const [applied, setApplied] = useState(false);

  // 对比区（原文 / 润色后）共用的高度，两个框同步上下拉伸
  const [compareHeight, setCompareHeight] = useState(340);
  const compareResizingRef = useRef(false);
  const compareResizeStartRef = useRef({ startY: 0, startH: 340 });

  // ===== 面板尺寸拖拽缩放 =====
  const [panelSize, setPanelSize] = useState({ width: 820, height: 560 });
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
        width: Math.max(520, Math.min(1500, resizeStartRef.current.startW + dx)),
        height: Math.max(350, Math.min(950, resizeStartRef.current.startH + dy)),
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

  // 面板打开时计算初始居中位置
  useEffect(() => {
    if (open && !panelPos) {
      setPanelPos({
        x: Math.max(0, (window.innerWidth - panelSize.width) / 2),
        y: Math.max(0, (window.innerHeight - panelSize.height) / 2),
      });
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // ===== 初始化 AI =====
  useEffect(() => {
    async function init() {
      try {
        const configs = await loadConfigsDecrypted();
        if (configs.length === 0) {
          setConfigError('请先在 AI 对话面板配置 API Key（点击 ⚙️ 图标）');
          setAiReady(false);
          setRequestBase(null);
          return;
        }
        const active = configs[0];
        const preset = PROVIDERS.find(p => p.id === active.providerId);
        if (!preset && !active.baseUrl) {
          setConfigError(`未识别的提供商：${active.providerId}`);
          setAiReady(false);
          setRequestBase(null);
          return;
        }
        setRequestBase({
          name: preset?.name ?? active.providerId,
          apiKey: active.apiKey,
          model: active.model,
          baseUrl: active.baseUrl || preset?.baseUrl,
        });
        setAiReady(true);
        setConfigError(null);
      } catch (e) {
        setConfigError('AI 配置加载失败');
        setAiReady(false);
        setRequestBase(null);
      } finally {
        setInitDone(true);
      }
    }
    init();
  }, [open]);

  // ===== 同步外部章节选择 =====
  useEffect(() => {
    if (activeChapterId) setSelectedChapterId(activeChapterId);
  }, [activeChapterId]);

  // ===== 处理选中文本入口 =====
  useEffect(() => {
    if (open && initialTargetText) {
      setMode('selection');
      setSelectionText(initialTargetText);
      setSelectionRange(initialRange ?? null);
      setPolishedContent('');
      setEditablePolishText('');
      setApplied(false);
      setError(null);
    } else if (open && !initialTargetText) {
      // 工具栏入口，默认整章润色
      setMode('chapter');
      setSelectionText('');
      setSelectionRange(null);
    }
  }, [open, initialTargetText, initialRange]);

  // ===== 当前要润色的原文 =====
  const sourceText = mode === 'selection'
    ? selectionText
    : (chapters.find(ch => ch.id === selectedChapterId)?.content || '');

  // ===== 执行润色 =====
  const handlePolish = useCallback(async () => {
    const target = htmlToPlainText(sourceText);
    if (!target.trim()) {
      setError('没有可润色的内容，请先选择章节或选中文字。');
      return;
    }
    if (!requestBase) {
      setError('AI 未配置');
      return;
    }

    setPolishing(true);
    setError(null);
    setPolishedContent('');
    setApplied(false);

    try {
      const compassCtx = ContextBuilder.getCompassContext(projectId);
      const styleFpCtx = ContextBuilder.getStyleFingerprintContext(projectId);

      const userPrompt = buildPolishUserPrompt(target, {
        projectName,
        typeTags,
        characters: characters.map(c => ({
          name: c.name,
          aliases: c.aliases,
          personality: c.personality,
          background: c.background,
        })),
        worldEntries: worldEntries.map(w => ({ name: w.name, description: w.description })),
        compassContext: compassCtx || undefined,
        styleFpContext: styleFpCtx || undefined,
      });

      const messages: ChatMessage[] = [
        { role: 'system', content: POLISH_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ];

      const generator = aiService.chatStream(
        snapshotAIRequestConfig(requestBase),
        messages,
        { temperature: 0.5, maxTokens: 8192 },
        projectId,
      );
      let fullText = '';
      for await (const token of generator) {
        fullText = token;
        setPolishedContent(fullText);
      }
      // 流式结束后，把润色结果转成可编辑纯文本，供用户微调
      setEditablePolishText(htmlToPlainText(fullText));
    } catch (e) {
      const display = streamEndDisplay((e as Error).message, '润色失败：');
      if (display) setError(display);
    } finally {
      setPolishing(false);
    }
  }, [sourceText, projectId, projectName, typeTags, characters, worldEntries, requestBase]);

  // ===== 接受润色 =====
  const handleAccept = useCallback(() => {
    const finalText = editablePolishText.trim();
    if (!finalText) return;
    const finalHtml = plainTextToHtml(finalText);
    if (mode === 'selection' && selectionRange) {
      onApplySelection(selectionRange, finalHtml);
    } else if (mode === 'chapter' && selectedChapterId) {
      onApplyChapter(selectedChapterId, finalHtml);
    }
    setApplied(true);
  }, [editablePolishText, mode, selectionRange, selectedChapterId, onApplySelection, onApplyChapter]);

  // ===== 放弃润色 =====
  const handleDiscard = useCallback(() => {
    setPolishedContent('');
    setEditablePolishText('');
    setApplied(false);
    setError(null);
  }, []);

  const handleClose = useCallback(() => {
    if (projectId && polishingRef.current) {
      void aiService.cancelActiveStreams(projectId);
    }
    onClose();
  }, [projectId, onClose]);

  // 对比区高度拖动：两个框同步上下拉伸
  const handleCompareResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    compareResizingRef.current = true;
    compareResizeStartRef.current = { startY: e.clientY, startH: compareHeight };
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
    const onMove = (ev: MouseEvent) => {
      if (!compareResizingRef.current) return;
      const dy = ev.clientY - compareResizeStartRef.current.startY;
      // 向下拖增高，向上拖减矮；限 120~70vh
      setCompareHeight(Math.max(120, Math.min(Math.round(window.innerHeight * 0.7), compareResizeStartRef.current.startH + dy)));
    };
    const onUp = () => {
      compareResizingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [compareHeight]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 pointer-events-none">
      <div className="absolute inset-0 pointer-events-none" onClick={handleClose} />
      <div
        ref={panelRef}
        className="absolute pointer-events-auto bg-gray-950 border border-gray-700 rounded-lg shadow-2xl flex flex-col overflow-hidden"
        style={panelPos ? {
          top: `${panelPos.y}px`,
          left: `${panelPos.x}px`,
          width: `${panelSize.width}px`,
          maxHeight: '92vh',
          height: `${panelSize.height}px`,
        } : {
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: `${panelSize.width}px`,
          maxHeight: '92vh',
          height: `${panelSize.height}px`,
        }}
      >
        {/* ── 标题栏（可拖拽移动）── */}
        <div
          className="flex items-center justify-between px-4 py-2 border-b border-gray-800 shrink-0 cursor-move select-none"
          onMouseDown={handleDragStart}
        >
          <span className="text-sm font-semibold text-gray-200">✨ 去 AI 味润色</span>
          <div className="flex items-center gap-2">
            {!initDone ? (
              <span className="text-[10px] text-gray-500">检查 AI 配置...</span>
            ) : aiReady ? (
              <span className="text-[10px] text-green-500">🤖 AI 就绪</span>
            ) : (
              <span className="text-[10px] text-red-400">⚠️ 未配置 AI</span>
            )}
            <button onClick={handleClose} className="text-gray-500 hover:text-gray-100 text-lg leading-none">✕</button>
          </div>
        </div>

        {/* ── 主体 ── */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-sm">
          {/* 润色范围选择 */}
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <label className="text-[11px] text-gray-400 block mb-1">
                {mode === 'selection' ? '润色范围：选中文本' : '选择要润色的章节'}
              </label>
              {mode === 'selection' ? (
                <div className="px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-xs text-gray-300 truncate">
                  已选中 {selectionText.length.toLocaleString()} 字
                </div>
              ) : (
                <select
                  value={selectedChapterId || ''}
                  onChange={e => { setSelectedChapterId(e.target.value || null); setPolishedContent(''); setEditablePolishText(''); setApplied(false); setError(null); }}
                  className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-xs text-gray-200 focus:outline-none focus:border-accent"
                >
                  <option value="">(选择章节)</option>
                  {chapters.map(ch => (
                    <option key={ch.id} value={ch.id}>
                      {ch.title}{ch.wordCount ? ` (${ch.wordCount.toLocaleString()}字)` : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <button
              onClick={handlePolish}
              disabled={!aiReady || polishing || (!sourceText.trim())}
              className="px-4 py-1.5 bg-accent text-white text-xs rounded hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {polishing ? '⏳ 润色中...' : '✨ 开始润色'}
            </button>
          </div>

          {/* 提示 */}
          <p className="text-[10px] text-gray-600">
            文笔润色：让表达更流畅、生动、有画面感，同时去 AI 味。不增删情节、不改角色行为与对话含义。
          </p>

          {/* 错误提示 */}
          {error && (
            <div className="p-3 bg-red-900/30 border border-red-800 rounded text-xs text-red-400">
              {error}
            </div>
          )}

          {/* 润色中 */}
          {polishing && (
            <div className="p-3 bg-gray-900/50 border border-gray-800 rounded text-xs text-gray-400">
              <div className="flex items-center justify-between mb-1">
                <span>AI 正在润色...</span>
                {polishedContent && (
                  <span className="text-gray-600">
                    已生成 {polishedContent.replace(/<[^>]+>/g, '').length.toLocaleString()} 字
                  </span>
                )}
              </div>
            </div>
          )}

          {/* ── 对比预览：原文 vs 润色后（可编辑，两个框同步上下拉伸） ── */}
          {polishedContent && !polishing && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                {/* 原文 */}
                <div>
                  <h4 className="text-[13px] font-semibold text-gray-400 mb-1">原文（只读）</h4>
                  <div
                    className="p-3 bg-gray-900/50 border border-gray-800 rounded text-[15px] text-gray-400 leading-relaxed overflow-y-auto whitespace-pre-wrap"
                    style={{ height: `${compareHeight}px` }}
                  >
                    {htmlToPlainText(sourceText)}
                  </div>
                </div>
                {/* 润色后（可编辑） */}
                <div>
                  <h4 className="text-[13px] font-semibold text-green-400 mb-1">✨ 润色后（可编辑，可粘贴原文保留）</h4>
                  <textarea
                    value={editablePolishText}
                    onChange={e => { setEditablePolishText(e.target.value); setApplied(false); }}
                    className="w-full p-3 bg-gray-900/50 border border-green-800/50 rounded text-[15px] text-gray-200 leading-relaxed overflow-y-auto resize-none focus:outline-none focus:border-accent"
                    style={{ height: `${compareHeight}px` }}
                    spellCheck={false}
                  />
                </div>
              </div>

              {/* 对比区高度拖动条 */}
              <div
                onMouseDown={handleCompareResizeStart}
                className="flex items-center justify-center h-2 cursor-ns-resize rounded hover:bg-gray-800 select-none"
                title="拖动调整原文/润色框高度"
              >
                <div className="w-12 h-1 rounded bg-gray-700" />
              </div>

              <p className="text-[11px] text-gray-500">
                原文 {htmlToPlainText(sourceText).length.toLocaleString()} 字 → 润色后 {editablePolishText.length.toLocaleString()} 字
                {applied ? ' ✅ 已写回' : '（可编辑润色结果，从左侧复制原文想保留的部分粘贴进来）'}
              </p>

              {/* 操作栏 */}
              <div className="flex items-center gap-2 pt-2 border-t border-gray-800">
                <button
                  onClick={handleAccept}
                  disabled={applied || !editablePolishText.trim()}
                  className="px-4 py-1.5 bg-green-600 text-white text-xs rounded hover:bg-green-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {mode === 'selection' ? '✅ 替换选中内容' : '✅ 覆盖章节原文'}
                </button>
                <button
                  onClick={handleDiscard}
                  className="px-4 py-1.5 bg-gray-700 text-gray-200 text-xs rounded hover:bg-gray-600 transition-colors"
                >
                  ❌ 放弃
                </button>
                <span className="text-[10px] text-gray-500">
                  {mode === 'selection'
                    ? '将润色后的内容替换掉编辑器里选中的原文'
                    : '将润色后的内容直接替换掉章节里的原文'}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* ── 右下角缩放手柄 ── */}
        <div
          className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize"
          onMouseDown={handleResizeStart}
          style={{
            background: 'linear-gradient(135deg, transparent 50%, #4a4a4a 50%)',
          }}
        />
      </div>
    </div>
  );
};

export default AIPolishPanel;
