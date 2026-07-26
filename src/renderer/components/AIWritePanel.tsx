import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { ChatMessage } from '../../main/ai/provider';
import { aiService } from '../services/ai.service';
import { WRITE_SYSTEM_PROMPT, buildWriteUserPrompt } from '../services/ai-prompts';
import type { OutlineNode, Character, WorldEntry, Chapter } from '../types';
import { encrypt, decrypt } from '../services/crypto';

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
  /** 角色列表 */
  characters: Character[];
  /** 世界观条目 */
  worldEntries: WorldEntry[];
  /** 章节列表（用于取前文上下文） */
  chapters: Chapter[];
  /** 项目名称 */
  projectName: string;
  /** 项目类型标签 */
  typeTags: string[];
  /** 项目风格 */
  style: string;
  /** 保存为新章节的回调 */
  onSaveAsChapter: (title: string, content: string) => void;
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
  characters,
  worldEntries,
  chapters,
  projectName,
  typeTags,
  style,
  onSaveAsChapter,
}) => {
  // ===== 配置状态 =====
  const [selectedOutlineId, setSelectedOutlineId] = useState<string | null>(activeOutlineNodeId);
  const [targetWords, setTargetWords] = useState(3000);
  const [styleGuide, setStyleGuide] = useState('保持与项目风格一致');
  const [includeContext, setIncludeContext] = useState(true);
  const [includeCharacters, setIncludeCharacters] = useState(true);
  const [includeWorld, setIncludeWorld] = useState(true);
  const [extraRequirement, setExtraRequirement] = useState('');

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

  // ===== 构建 Write 上下文 =====
  const getContext = useCallback(() => {
    const selectedOutline = outlineNodes.find(n => n.id === selectedOutlineId);
    if (!selectedOutline) return null;

    // 前 2 章摘要
    const recentChapters = chapters
      .filter(ch => ch.status === 'draft' || ch.status === 'final')
      .slice(-3)
      .map(ch => ({
        title: ch.title,
        summary: ch.content
          ? (ch.content.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').slice(0, 200) + '...')
          : '(空)',
      }));

    return {
      projectName,
      typeTags,
      style,
      outlineTitle: selectedOutline.title,
      outlineSummary: selectedOutline.summary || '',
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
  }, [selectedOutlineId, outlineNodes, characters, worldEntries, chapters,
      projectName, typeTags, style, includeContext, includeCharacters, includeWorld]);

  // ===== 生成章节 =====
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
      const systemPrompt = WRITE_SYSTEM_PROMPT
        + (styleGuide && styleGuide !== '保持与项目风格一致' ? `\n\n## 用户指定的写作风格\n${styleGuide}` : '');

      const userPrompt = buildWriteUserPrompt(
        { targetWords, extraRequirement },
        context,
      );

      const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ];

      // 流式生成
      const generator = aiService.chatStream(messages, { temperature: 0.7, maxTokens: targetWords * 3 });
      let fullText = '';
      for await (const token of generator) {
        fullText = token;
        setGeneratedContent(fullText);
      }
    } catch (e) {
      setError(`AI 写作失败：${(e as Error).message}`);
    } finally {
      setGenerating(false);
    }
  }, [getContext, aiReady, styleGuide, targetWords, extraRequirement]);

  // ===== 停止生成 =====
  const handleStop = useCallback(() => {
    // 通过取消 generator 的方式无法停止 IPC 流，但可以换个方法：
    // 目前简单处理：允许继续等到结束。如需真正中断，需扩展 IPC 支持
    setGenerating(false);
  }, []);

  // ===== 保存为新章节 =====
  const handleSave = useCallback(() => {
    if (!generatedContent) return;
    // 从生成内容取第一句作为标题，或使用大纲标题
    const plainText = generatedContent.replace(/<[^>]+>/g, '');
    const firstLine = plainText.split('\n').find(l => l.trim().length > 0)?.trim() || '';
    const title = firstLine.length > 40 ? firstLine.slice(0, 40) + '...' : firstLine;
    onSaveAsChapter(title || 'AI 生成章节', generatedContent);
    setSaved(true);
  }, [generatedContent, onSaveAsChapter]);

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
        className="absolute pointer-events-auto bg-gray-950 border border-gray-700 rounded-lg shadow-2xl flex flex-col overflow-hidden"
        style={{
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '680px',
          maxHeight: '85vh',
        }}
      >
        {/* ── 标题栏 ── */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 shrink-0">
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
            </div>

            {/* 生成按钮 */}
            <div>
              {!generating ? (
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
      </div>
    </div>
  );
};

export default AIWritePanel;
