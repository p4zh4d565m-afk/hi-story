import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { ChatMessage } from '../../main/ai/provider';
import { aiService, isSilentAiStreamEnd } from '../services/ai.service';
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
  const [configError, setConfigError] = useState<string | null>(null);
  const [initDone, setInitDone] = useState(false);
  const [applied, setApplied] = useState(false);

  // ===== 初始化 AI =====
  useEffect(() => {
    async function init() {
      try {
        const configs = await loadConfigsDecrypted();
        if (configs.length === 0) {
          setConfigError('请先在 AI 对话面板配置 API Key（点击 ⚙️ 图标）');
          setAiReady(false);
          return;
        }
        const active = configs[0];
        const providerNames: Record<string, string> = {
          claude: 'claude', openai: 'openai', deepseek: 'deepseek',
          doubao: 'doubao', volcengine: 'volcengine', qwen: 'qwen',
          zhipu: 'zhipu', moonshot: 'moonshot',
        };
        const provider = providerNames[active.providerId] || 'custom';
        const baseUrls: Record<string, string> = {
          claude: 'https://api.anthropic.com', openai: 'https://api.openai.com/v1',
          deepseek: 'https://api.deepseek.com/v1',
          doubao: 'https://ark.cn-beijing.volces.com/api/v3',
          volcengine: 'https://ark.cn-beijing.volces.com/api/v3',
          qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
          zhipu: 'https://open.bigmodel.cn/api/paas/v4',
          moonshot: 'https://api.moonshot.cn/v1',
        };
        aiService.configure(provider, active.apiKey, active.model, baseUrls[active.providerId] || '');
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

      const generator = aiService.chatStream(messages, { temperature: 0.5, maxTokens: 8192 }, projectId);
      let fullText = '';
      for await (const token of generator) {
        fullText = token;
        setPolishedContent(fullText);
      }
      // 流式结束后，把润色结果转成可编辑纯文本，供用户微调
      setEditablePolishText(htmlToPlainText(fullText));
    } catch (e) {
      const msg = (e as Error).message;
      if (!isSilentAiStreamEnd(msg)) setError(`润色失败：${msg}`);
    } finally {
      setPolishing(false);
    }
  }, [sourceText, projectId, projectName, typeTags, characters, worldEntries]);

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

  return (
    <div className="h-full w-full bg-gray-950 flex flex-col overflow-hidden">
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

          {/* ── 对比预览：原文 vs 润色后（可编辑） ── */}
          {polishedContent && !polishing && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                {/* 原文 */}
                <div>
                  <h4 className="text-[13px] font-semibold text-gray-400 mb-1">原文（只读）</h4>
                  <div className="p-3 bg-gray-900/50 border border-gray-800 rounded text-[15px] text-gray-400 leading-relaxed max-h-[340px] overflow-y-auto whitespace-pre-wrap">
                    {htmlToPlainText(sourceText)}
                  </div>
                </div>
                {/* 润色后（可编辑） */}
                <div>
                  <h4 className="text-[13px] font-semibold text-green-400 mb-1">✨ 润色后（可编辑，可粘贴原文保留）</h4>
                  <textarea
                    value={editablePolishText}
                    onChange={e => { setEditablePolishText(e.target.value); setApplied(false); }}
                    className="w-full p-3 bg-gray-900/50 border border-green-800/50 rounded text-[15px] text-gray-200 leading-relaxed min-h-[160px] max-h-[70vh] overflow-y-auto resize-y focus:outline-none focus:border-accent"
                    spellCheck={false}
                  />
                </div>
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
    </div>
  );
};

export default AIPolishPanel;
