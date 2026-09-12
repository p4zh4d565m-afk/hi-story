import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { ChatMessage } from '../../main/ai/provider';
import { aiService, isSilentAiStreamEnd } from '../services/ai.service';
import {
  REVIEW_SYSTEM_PROMPT,
  buildReviewUserPrompt,
  REVISE_SYSTEM_PROMPT,
  buildReviseUserPrompt,
  htmlToPlainText,
  extractSummary,
  REVIEW_DIMENSIONS,
  runAntiAICheck,
  runStyleStats,
} from '../services/ai-prompts';
import type { StyleStatsResult } from '../services/ai-prompts';
import AIReviewResultComponent from './AIReviewResult';
import type { AIReviewResult, ReviewIssue, Chapter, Character, WorldEntry, OutlineNode, ChapterOutline, AntiAICheckResult } from '../types';
import { encrypt, decrypt } from '../services/crypto';
import { ContextBuilder } from '../../main/ai/context-builder';

// ============================================================
// AI 审稿浮动面板
// - 选择章节 → 点击审稿 → 加载 → 展示评分和问题列表
// - 点击问题 → 尝试跳转到编辑器中对应段落
// ============================================================

interface AIReviewPanelProps {
  /** 是否显示 */
  open: boolean;
  /** 关闭回调 */
  onClose: () => void;
  /** 章节列表 */
  chapters: Chapter[];
  /** 当前激活的章节 ID */
  activeChapterId: string | null;
  /** 角色列表 */
  characters: Character[];
  /** 世界观条目 */
  worldEntries: WorldEntry[];
  /** 大纲节点 */
  outlineNodes: OutlineNode[];
  /** 策划章纲（A4b：有则审稿以章纲为结构参考，回退 outlineNodes） */
  chapterOutlines?: ChapterOutline[];
  /** 项目名称 */
  projectName: string;
  /** 项目 ID（用于加载创作罗盘和风格指纹） */
  projectId: string;
  /** 项目类型标签 */
  typeTags: string[];
  /** Obsidian 只读资料的有界上下文 */
  obsidianContext?: string;
  /** 跳转到编辑器段落 */
  onNavigateToParagraph?: (searchText: string) => void;
  /** 接受修订后回写章节内容到 App（让编辑器显示新正文） */
  onChapterAccepted?: (chapterId: string, content: string) => void;
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

const AIReviewPanel: React.FC<AIReviewPanelProps> = ({
  open,
  onClose,
  chapters,
  activeChapterId,
  characters,
  worldEntries,
  outlineNodes,
  chapterOutlines,
  projectName,
  projectId,
  typeTags,
  obsidianContext,
  onNavigateToParagraph,
  onChapterAccepted,
}) => {
  // ===== 状态 =====
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(activeChapterId);
  const [reviewing, setReviewing] = useState(false);
  const [result, setResult] = useState<AIReviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aiReady, setAiReady] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [initDone, setInitDone] = useState(false);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'review' | 'quickcheck' | 'revise' | 'stylestats'>('review');
  const [quickCheckResult, setQuickCheckResult] = useState<AntiAICheckResult | null>(null);
  const [styleStatsResult, setStyleStatsResult] = useState<StyleStatsResult | null>(null);
  const [styleStatsLoading, setStyleStatsLoading] = useState(false);

  // ===== 修订状态 =====
  const [revising, setRevising] = useState(false);
  const [revisedContent, setRevisedContent] = useState('');
  const [revisionAccepted, setRevisionAccepted] = useState(false);
  const reviewingRef = useRef(false);
  reviewingRef.current = reviewing;
  const revisingRef = useRef(false);
  revisingRef.current = revising;

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
        // 直接使用已保存的配置
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

  // ===== 执行审稿 =====
  const handleReview = useCallback(async () => {
    if (!selectedChapterId) {
      setError('请先选择要审查的章节');
      return;
    }
    if (!aiReady) {
      setError('AI 未配置');
      return;
    }

    const chapter = chapters.find(ch => ch.id === selectedChapterId);
    if (!chapter) {
      setError('未找到所选章节');
      return;
    }

    setReviewing(true);
    setError(null);
    setResult(null);

    try {
      const plainContent = htmlToPlainText(chapter.content || '');
      if (!plainContent.trim()) {
        setError('所选章节内容为空');
        setReviewing(false);
        return;
      }

      // 加载叙事事实层数据（P0 闭环）
      let storyFactsSummary = '';
      let knowledgeSummary = '';
      let hooksSummary = '';
      if (projectId) {
        try {
          // 并行加载事实、知识边界、钩子
          const [factsRes, knowledgeRes, hooksRes] = await Promise.all([
            (window as any).electronAPI.invoke('db:storyFacts:getGroupedFacts', projectId),
            (window as any).electronAPI.invoke('db:storyFacts:findAllKnowledgeByProject', projectId),
            (window as any).electronAPI.invoke('db:narrativeHooks:getContext', projectId),
          ]);

          if (factsRes?.success && factsRes.data) {
            const grouped = factsRes.data;
            const factLines: string[] = [];
            for (const [type, label] of [
              ['locations', '📍 角色位置'],
              ['possessions', '🎒 物品持有'],
              ['relationships', '🤝 角色关系'],
              ['events', '⚡ 重要事件'],
              ['emotionalStates', '💭 情感状态'],
              ['hooks', '🪝 伏笔钩子'],
            ] as const) {
              const items = grouped[type as keyof typeof grouped];
              if (items && items.length > 0) {
                factLines.push(`### ${label}`);
                items.slice(0, 6).forEach((f: any) => factLines.push(`- ${f.description}`));
                if (items.length > 6) factLines.push(`  *(还有 ${items.length - 6} 条，已省略)*`);
                factLines.push('');
              }
            }
            if (factLines.length > 0) {
              storyFactsSummary = factLines.join('\n');
            }
          }

          if (knowledgeRes?.success && knowledgeRes.data?.length > 0) {
            const byChar: Record<string, string[]> = {};
            for (const k of knowledgeRes.data) {
              const name = k.characterName || '未知';
              if (!byChar[name]) byChar[name] = [];
              byChar[name].push(`- 知道「${k.factDescription}」（来源：${k.source}）`);
            }
            const lines: string[] = [];
            for (const [name, items] of Object.entries(byChar)) {
              lines.push(`### ${name}`);
              lines.push(...items.slice(0, 4));
              lines.push('');
            }
            if (lines.length > 0) knowledgeSummary = lines.join('\n');
          }

          if (hooksRes?.success && hooksRes.data) {
            hooksSummary = hooksRes.data as string;
          } else if (hooksRes && !hooksRes.success) {
            hooksSummary = '';
          }
        } catch { /* 忽略加载失败 */ }
      }

      const reviewContext = {
        projectName,
        typeTags,
        characters: characters.map(c => ({
          name: c.name,
          aliases: c.aliases,
          personality: c.personality,
          background: c.background,
          arc: c.arc,
        })),
        worldEntries: worldEntries.map(w => ({
          name: w.name,
          description: w.description,
        })),
        // A4b：有章纲时以章纲为结构参考，回退 outlineNodes
        outlineNodes: (chapterOutlines && chapterOutlines.length > 0)
          ? chapterOutlines.map(c => ({ title: `第${c.chapterNumber}章 ${c.title}`, summary: c.chapterGoal || '' }))
          : outlineNodes.map(n => ({ title: n.title, summary: n.summary || '' })),
        storyFactsSummary,
        knowledgeSummary,
        hooksSummary,
      };

      const userPrompt = buildReviewUserPrompt(chapter.title, plainContent, reviewContext);

      // 拼接 system prompt：基础审稿 prompt + 创作罗盘 + 风格指纹
      const compassCtx = ContextBuilder.getCompassContext(projectId);
      const styleFpCtx = ContextBuilder.getStyleFingerprintContext(projectId);
      const extraBlocks: string[] = [];
      if (compassCtx) extraBlocks.push(compassCtx);
      if (styleFpCtx) extraBlocks.push(styleFpCtx);
      if (obsidianContext) extraBlocks.push(obsidianContext);

      const systemPrompt = REVIEW_SYSTEM_PROMPT
        + (extraBlocks.length > 0 ? '\n\n---\n\n' + extraBlocks.join('\n\n---\n\n') : '');

      const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ];

      let response = '';
      const generator = aiService.chatStream(messages, { temperature: 0.3, maxTokens: 4096 }, projectId);
      for await (const token of generator) {
        response = token;
      }
      if (!response.trim()) throw new Error('AI 未返回审稿结果');

      // 解析 AI 返回的 JSON
      let parsed: AIReviewResult;
      try {
        // 尝试清理可能的 markdown 代码块包裹
        let jsonStr = response.trim();
        if (jsonStr.startsWith('```json')) jsonStr = jsonStr.slice(7);
        if (jsonStr.startsWith('```')) jsonStr = jsonStr.slice(3);
        if (jsonStr.endsWith('```')) jsonStr = jsonStr.slice(0, -3);
        jsonStr = jsonStr.trim();

        parsed = JSON.parse(jsonStr);

        // 验证基本结构
        if (typeof parsed.totalScore !== 'number' || !Array.isArray(parsed.dimensions) || !Array.isArray(parsed.issues)) {
          throw new Error('返回的数据结构不完整');
        }

        // 计算统计
        parsed.criticalCount = parsed.issues.filter(i => i.severity === 'critical').length;
        parsed.warningCount = parsed.issues.filter(i => i.severity === 'warning').length;
        parsed.passedCount = parsed.dimensions.filter(d => d.passed).length;

      } catch (parseErr) {
        console.error('AI 审稿解析失败，原始响应：', response);
        throw new Error(`AI 返回格式解析失败：${(parseErr as Error).message}`);
      }

      setResult(parsed);
    } catch (e) {
      const msg = (e as Error).message;
      if (!isSilentAiStreamEnd(msg)) setError(`审稿失败：${msg}`);
    } finally {
      setReviewing(false);
    }
  }, [selectedChapterId, aiReady, chapters, projectName, projectId, typeTags, characters, worldEntries, outlineNodes, chapterOutlines, obsidianContext]);

  // ===== AI 自动修复 =====
  const handleAutoRevise = useCallback(async () => {
    if (!result) return;
    const chapter = chapters.find(ch => ch.id === selectedChapterId);
    if (!chapter) return;

    setRevising(true);
    setError(null);
    setRevisedContent('');
    setActiveTab('revise');

    try {
      // 构建角色/世界观/罗盘/风格上下文
      const compassCtx = ContextBuilder.getCompassContext(projectId);
      const styleFpCtx = ContextBuilder.getStyleFingerprintContext(projectId);

      let characterCtx = '';
      if (characters.length > 0) {
        characterCtx = characters.map(c =>
          `- ${c.name}${c.aliases ? `（${c.aliases}）` : ''}：${[c.personality, c.background].filter(Boolean).join('；')}`
        ).join('\n');
      }

      let worldCtx = '';
      if (worldEntries.length > 0) {
        worldCtx = worldEntries.map(w => `- ${w.name}：${w.description.slice(0, 300)}`).join('\n');
      }

      const issuesForPrompt = result.issues.map(i => ({
        severity: i.severity,
        description: i.description,
        location: i.location,
        suggestion: i.suggestion,
        dimensionName: result.dimensions.find(d => d.id === i.dimensionId)?.name,
      }));

      const userPrompt = buildReviseUserPrompt(
        chapter.title,
        chapter.content || '',
        issuesForPrompt,
        characterCtx,
        worldCtx,
        compassCtx || undefined,
        styleFpCtx || undefined,
      );

      const messages: ChatMessage[] = [
        { role: 'system', content: REVISE_SYSTEM_PROMPT + (obsidianContext ? `\n\n---\n\n${obsidianContext}` : '') },
        { role: 'user', content: userPrompt },
      ];

      const generator = aiService.chatStream(messages, { temperature: 0.4, maxTokens: 8192 }, projectId);
      let fullText = '';
      for await (const token of generator) {
        fullText = token;
        setRevisedContent(fullText);
      }
    } catch (e) {
      const msg = (e as Error).message;
      if (!isSilentAiStreamEnd(msg)) setError(`AI 修复失败：${msg}`);
    } finally {
      setRevising(false);
    }
  }, [selectedChapterId, result, chapters, projectId, characters, worldEntries, obsidianContext]);

  // ===== 接受修订 =====
  const handleAcceptRevision = useCallback(async () => {
    if (!selectedChapterId || !revisedContent) return;
    if (!projectId) {
      setError('当前项目无效，无法保存修订');
      return;
    }
    try {
      const res = await (window as any).electronAPI.invoke('db:chapter:update', {
        id: selectedChapterId,
        content: revisedContent,
      });
      if (res?.success) {
        setRevisionAccepted(true);
        // 回写 App，让打开的编辑器读到新正文（不再用字面量 'current' 刷新）
        onChapterAccepted?.(selectedChapterId, revisedContent);
        setResult(null);
        setRevisedContent('');
        setActiveTab('review');
      }
    } catch (e) {
      setError(`保存修订失败：${(e as Error).message}`);
    }
  }, [selectedChapterId, revisedContent, projectId, onChapterAccepted]);

  // ===== 放弃修订 =====
  const handleDiscardRevision = useCallback(() => {
    setRevisedContent('');
    setActiveTab('review');
  }, []);

  const handleClose = useCallback(() => {
    if (projectId && (reviewingRef.current || revisingRef.current)) {
      void aiService.cancelActiveStreams(projectId);
    }
    onClose();
  }, [projectId, onClose]);

  // ===== 跳转到问题段落 =====
  const handleJumpToIssue = useCallback((issue: ReviewIssue) => {
    if (onNavigateToParagraph && issue.location) {
      onNavigateToParagraph(issue.location);
    }
  }, [onNavigateToParagraph]);

  // ===== 复制审稿报告 =====
  const handleCopyReport = useCallback(() => {
    if (!result) return;
    const lines: string[] = [];
    lines.push(`# AI 审稿报告`);
    lines.push(`总分：${result.totalScore}/100`);
    lines.push(`严重 ${result.criticalCount} 项 | 警告 ${result.warningCount} 项 | 通过 ${result.passedCount} 项`);
    lines.push(`\n## 总结\n${result.summary}`);
    lines.push(`\n## 各维度评分`);
    for (const d of result.dimensions) {
      lines.push(`- ${d.passed ? '✅' : '⚠️'} ${d.name}：${d.score}分`);
    }
    lines.push(`\n## 具体问题`);
    for (const i of result.issues) {
      lines.push(`- ${i.severity === 'critical' ? '🔴严重' : i.severity === 'warning' ? '🟡警告' : '🔵建议'}：${i.description}`);
      if (i.location) lines.push(`  位置：${i.location}`);
      if (i.suggestion) lines.push(`  建议：${i.suggestion}`);
    }
    const report = lines.join('\n');
    navigator.clipboard.writeText(report).catch((err) => {
      // 降级：如果 Clipboard API 不可用（如非 HTTPS 环境），提示用户手动复制
      console.warn('复制到剪贴板失败:', err?.message);
    });
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [result]);

  // ===== 反 AI 痕迹检测 =====
  const handleQuickCheck = useCallback(() => {
    if (!selectedChapterId) return;
    const chapter = chapters.find(ch => ch.id === selectedChapterId);
    if (!chapter) return;
    const plainContent = htmlToPlainText(chapter.content || '');
    if (!plainContent.trim()) return;
    setActiveTab('quickcheck');
    const checkResult = runAntiAICheck(plainContent);
    setQuickCheckResult(checkResult);
  }, [selectedChapterId, chapters]);

  // ===== 全书级句式 tic 统计 =====
  const handleStyleStats = useCallback(() => {
    setActiveTab('stylestats');
    setStyleStatsLoading(true);
    // 用 setTimeout 让 loading 态先渲染（统计本身是同步的）
    setTimeout(() => {
      try {
        // 收集所有章节纯文本（按 sortOrder 排序）
        const sorted = [...chapters].sort((a, b) => a.sortOrder - b.sortOrder);
        const contents = sorted.map(c => htmlToPlainText(c.content || ''));
        // 角色名作为停用词，避免人名混进口头禅清单
        const stopwords = characters.map(c => c.name).filter(Boolean);
        const stats = runStyleStats(contents, { stopwords, titles: sorted.map(c => c.title) });
        setStyleStatsResult(stats);
      } finally {
        setStyleStatsLoading(false);
      }
    }, 0);
  }, [chapters, characters]);

  /** 反AI检测结果颜色 */
  function quickScoreColor(score: number): string {
    if (score >= 80) return 'text-green-400';
    if (score >= 60) return 'text-yellow-400';
    return 'text-red-400';
  }

  /** 章均频率是否异常（用于句式模式染色） */
  function patternTone(perChapter: number): string {
    if (perChapter >= 3) return 'text-red-400';
    if (perChapter >= 1.5) return 'text-yellow-400';
    return 'text-gray-400';
  }

  const selectedChapter = chapters.find(ch => ch.id === selectedChapterId);

  return (
    <div className="h-full w-full bg-gray-950 flex flex-col overflow-hidden">
        {/* ── 主体 ── */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-sm">
          {/* 章节选择 */}
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <label className="text-[11px] text-gray-400 block mb-1">选择要审查的章节</label>
              <select
                value={selectedChapterId || ''}
                onChange={e => setSelectedChapterId(e.target.value || null)}
                className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-xs text-gray-200 focus:outline-none focus:border-accent"
              >
                <option value="">(选择章节)</option>
                {chapters.map(ch => (
                  <option key={ch.id} value={ch.id}>
                    {ch.title}{ch.wordCount ? ` (${ch.wordCount.toLocaleString()}字)` : ''}
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={handleReview}
              disabled={!selectedChapterId || !aiReady || reviewing}
              className="px-4 py-1.5 bg-accent text-white text-xs rounded hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {reviewing ? '⏳ 审查中...' : '🔍 开始审稿'}
            </button>
            <button
              onClick={handleQuickCheck}
              disabled={!selectedChapterId}
              className="px-4 py-1.5 bg-gray-700 text-gray-200 text-xs rounded hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              title="纯前端规则检测，零 AI 消耗，秒级完成"
            >
              ⚡ 快速检测
            </button>
          </div>

          {/* ── Tab 切换栏 ── */}
          <div className="flex items-center gap-1 border-b border-gray-800">
            <button
              onClick={() => setActiveTab('review')}
              className={`px-3 py-1.5 text-[11px] border-b-2 transition-colors ${
                activeTab === 'review' ? 'border-accent text-accent' : 'border-transparent text-gray-500 hover:text-white'
              }`}
            >
              🤖 AI 审稿
            </button>
            <button
              onClick={() => setActiveTab('quickcheck')}
              className={`px-3 py-1.5 text-[11px] border-b-2 transition-colors ${
                activeTab === 'quickcheck' ? 'border-accent text-accent' : 'border-transparent text-gray-500 hover:text-white'
              }`}
            >
              ⚡ 快速检测 (反AI痕迹)
            </button>
            <button
              onClick={handleStyleStats}
              className={`px-3 py-1.5 text-[11px] border-b-2 transition-colors ${
                activeTab === 'stylestats' ? 'border-accent text-accent' : 'border-transparent text-gray-500 hover:text-white'
              }`}
              title="全书级句式统计，纯本地计算零 AI 消耗，发现单章看不出的固化模式"
            >
              📊 全书文风统计
            </button>
            {activeTab === 'revise' && (
              <span className="px-3 py-1.5 text-[11px] border-b-2 border-accent text-accent">
                🪄 自动修复
              </span>
            )}
          </div>

          {/* 选中章节信息 */}
          {selectedChapter && (
            <div className="p-2 bg-gray-900/50 rounded border border-gray-800 text-[11px] text-gray-400">
              📖 <span className="text-gray-300">{selectedChapter.title}</span>
              <span className="mx-1 text-gray-600">|</span>
              {selectedChapter.wordCount?.toLocaleString() || 0} 字
              <span className="mx-1 text-gray-600">|</span>
              {selectedChapter.status === 'final' ? '📌 定稿' : '✏️ 草稿'}
            </div>
          )}

          {/* 错误/提示 */}
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

          {/* 加载中 */}
          {reviewing && (
            <div className="flex flex-col items-center justify-center py-8 space-y-3">
              <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              <span className="text-xs text-gray-500">AI 正在从 15 个维度审查章节...</span>
            </div>
          )}

          {/* 审稿结果 */}
          {result && !reviewing && activeTab === 'review' && (
            <AIReviewResultComponent
              result={result}
              onJumpToIssue={handleJumpToIssue}
            />
          )}

          {/* ── 修订视图：加载中 ── */}
          {revising && (
            <div className="flex flex-col items-center justify-center py-8 space-y-3">
              <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              <span className="text-xs text-gray-500">AI 正在根据审稿意见修复章节内容...</span>
              {revisedContent && (
                <span className="text-xs text-gray-600">
                  已生成 {revisedContent.replace(/<[^>]+>/g, '').length.toLocaleString()} 字
                </span>
              )}
            </div>
          )}

          {/* ── 修订视图：对比预览 ── */}
          {activeTab === 'revise' && revisedContent && !revising && (
            <div className="space-y-3">
              {/* 审稿问题摘要 */}
              <div className="p-3 bg-gray-900/50 border border-gray-800 rounded">
                <h4 className="text-[11px] font-semibold text-yellow-400 mb-1">
                  已修复的问题 ({result?.issues.length ?? 0} 项)
                </h4>
                <div className="text-[10px] text-gray-500 space-y-0.5 max-h-[120px] overflow-y-auto">
                  {result?.issues.map((i, idx) => (
                    <div key={idx} className="flex items-start gap-1">
                      <span className="flex-shrink-0">{i.severity === 'critical' ? '🔴' : i.severity === 'warning' ? '🟡' : '🔵'}</span>
                      <span>{i.description.slice(0, 100)}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* 修订后内容预览 */}
              <div>
                <h4 className="text-[11px] font-semibold text-green-400 mb-1">✨ 修订后正文</h4>
                <div className="p-3 bg-gray-900/50 border border-gray-800 rounded text-[12px] text-gray-300 leading-relaxed max-h-[300px] overflow-y-auto whitespace-pre-wrap">
                  {revisedContent.replace(/<[^>]+>/g, '\n').replace(/&nbsp;/g, ' ')}
                </div>
                <p className="text-[9px] text-gray-600 mt-1">
                  修订后字数：{revisedContent.replace(/<[^>]+>/g, '').length.toLocaleString()} 字
                  {revisionAccepted ? ' ✅ 已保存到章节' : ''}
                </p>
              </div>
            </div>
          )}

          {/* 反AI痕迹检测结果 */}
          {activeTab === 'quickcheck' && (
            <div>
              {quickCheckResult ? (
                <div className="space-y-3 text-sm">
                  {/* 总分 */}
                  <div className="flex items-center gap-3 p-3 bg-gray-900/50 border border-gray-800 rounded-lg">
                    <div className={`text-2xl font-bold ${quickScoreColor(quickCheckResult.totalScore)}`}>
                      {quickCheckResult.totalScore}<span className="text-xs text-gray-500">/100</span>
                    </div>
                    <div className="flex-1">
                      <p className="text-[11px] text-gray-300">
                        {quickCheckResult.totalScore >= 80
                          ? '🎉 自然度较高，无明显AI痕迹'
                          : quickCheckResult.totalScore >= 60
                            ? '⚠️ 有轻微AI痕迹，建议手动润色'
                            : '🔴 AI痕迹明显，强烈建议重写相关段落'}
                      </p>
                      <p className="text-[9px] text-gray-600 mt-0.5">
                        {quickCheckResult.checks.filter(c => !c.passed).length}/{quickCheckResult.checks.length} 项未通过
                        · 纯规则检测 · 零AI消耗 · 秒级完成
                      </p>
                    </div>
                  </div>
                  {/* 各项详情 */}
                  <div className="space-y-2">
                    {quickCheckResult.checks.map((check, idx) => (
                      <div
                        key={idx}
                        className={`p-3 rounded border text-[11px] ${
                          check.passed
                            ? 'bg-green-900/10 border-green-800/30'
                            : check.score <= 30
                              ? 'bg-red-900/20 border-red-800/40'
                              : 'bg-yellow-900/10 border-yellow-800/30'
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold text-gray-200 flex-1">{check.name}</span>
                          <span className={`text-[10px] font-bold ${quickScoreColor(check.score)}`}>
                            {check.passed ? '✅ 通过' : `⚠️ ${check.score}分`}
                          </span>
                        </div>
                        <p className="text-gray-400 mb-1">{check.detail}</p>
                        {check.suggestions.length > 0 && (
                          <div className="flex items-start gap-1 mt-1.5">
                            <span className="text-[9px] text-gray-500 flex-shrink-0">💡</span>
                            <div className="text-[10px] text-accent">
                              {check.suggestions.map((s, si) => (
                                <span key={si} className="mr-3">{si + 1}. {s}</span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-center py-10">
                  <p className="text-xs text-gray-600 mb-2">选择章节后点击「⚡ 快速检测」按钮</p>
                  <p className="text-[10px] text-gray-700">纯前端规则引擎检测，不需要配置AI</p>
                  <button
                    onClick={handleQuickCheck}
                    disabled={!selectedChapterId}
                    className="mt-3 px-4 py-1.5 bg-gray-700 text-gray-200 text-xs rounded hover:bg-gray-600 disabled:opacity-40 transition-colors"
                  >
                    ⚡ 开始检测
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── 全书级句式 tic 统计 ── */}
          {activeTab === 'stylestats' && (
            <div>
              {styleStatsLoading ? (
                <div className="flex flex-col items-center justify-center py-10 space-y-3">
                  <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                  <span className="text-xs text-gray-500">统计中...</span>
                </div>
              ) : styleStatsResult ? (
                <div className="space-y-3 text-sm">
                  {/* 概览 */}
                  <div className="p-3 bg-gray-900/50 border border-gray-800 rounded-lg">
                    <p className="text-[11px] text-gray-300 mb-1">
                      已统计 <span className="text-accent font-semibold">{styleStatsResult.chapters}</span> 章全文
                    </p>
                    <p className="text-[9px] text-gray-600">
                      全书级统计能发现单章看不出的固化模式——单章每处都"正常"，章均几十次就是 AI 味
                    </p>
                  </div>

                  {/* 句式模式计数 */}
                  {styleStatsResult.patterns.length > 0 && (
                    <div>
                      <h4 className="text-[11px] font-semibold text-gray-400 mb-1.5">📈 固定句式模式（章均频率）</h4>
                      <div className="space-y-1.5">
                        {styleStatsResult.patterns.map((p, i) => (
                          <div key={i} className="flex items-center justify-between p-2 bg-gray-900/50 border border-gray-800 rounded text-[11px]">
                            <span className="text-gray-300">{p.name}</span>
                            <span className={`font-semibold ${patternTone(p.perChapter)}`}>
                              共 {p.total} 次 · 章均 {p.perChapter}
                            </span>
                          </div>
                        ))}
                      </div>
                      <p className="text-[9px] text-gray-600 mt-1">章均 ≥ 3 为明显异常，≥ 1.5 需留意</p>
                    </div>
                  )}

                  {/* 高频短语（口头禅镜像） */}
                  {styleStatsResult.topPhrases.length > 0 && (
                    <div>
                      <h4 className="text-[11px] font-semibold text-gray-400 mb-1.5">🗣️ 近期高频短语（口头禅镜像）</h4>
                      <div className="flex flex-wrap gap-1.5">
                        {styleStatsResult.topPhrases.map((p, i) => (
                          <span key={i} className="px-2 py-1 bg-yellow-900/20 border border-yellow-800/30 rounded text-[11px] text-yellow-300">
                            「{p.text}」×{p.count}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 跨章重复句 */}
                  {styleStatsResult.repeatedSentences.length > 0 && (
                    <div>
                      <h4 className="text-[11px] font-semibold text-red-400 mb-1.5">🔁 跨章重复句（≥3 章复现）</h4>
                      <div className="space-y-1.5">
                        {styleStatsResult.repeatedSentences.map((s, i) => (
                          <div key={i} className="p-2 bg-red-900/10 border border-red-800/30 rounded text-[11px] text-gray-300">
                            <span className="text-red-400 font-semibold">{s.chapters}章 × {s.count}次</span>
                            <span className="ml-2">{s.text}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 章末形态 / 开篇 / 标题 */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="p-2.5 bg-gray-900/50 border border-gray-800 rounded">
                      <p className="text-[10px] text-gray-500 mb-0.5">章末短句收尾占比</p>
                      <p className={`text-sm font-bold ${styleStatsResult.endingShortRatio > 0.8 ? 'text-red-400' : styleStatsResult.endingShortRatio > 0.6 ? 'text-yellow-400' : 'text-gray-300'}`}>
                        {(styleStatsResult.endingShortRatio * 100).toFixed(0)}%
                      </p>
                      <p className="text-[9px] text-gray-600">接近 100% = 章末形态同构</p>
                    </div>
                    <div className="p-2.5 bg-gray-900/50 border border-gray-800 rounded">
                      <p className="text-[10px] text-gray-500 mb-0.5">开篇时间词率</p>
                      <p className={`text-sm font-bold ${styleStatsResult.openingTimeRate > 0.5 ? 'text-yellow-400' : 'text-gray-300'}`}>
                        {(styleStatsResult.openingTimeRate * 100).toFixed(0)}%
                      </p>
                      <p className="text-[9px] text-gray-600">每章都从"清晨/夜"开头是 AI 味</p>
                    </div>
                  </div>

                  {styleStatsResult.titleFormatMixed && (
                    <div className="p-2.5 bg-gray-900/50 border border-yellow-800/30 rounded">
                      <p className="text-[10px] text-yellow-400 mb-0.5">⚠️ 标题格式混用</p>
                      <p className="text-[11px] text-gray-300">
                        带「第N章」{styleStatsResult.titleFormatMixed.withPrefix} 章 · 不带 {styleStatsResult.titleFormatMixed.withoutPrefix} 章
                      </p>
                      <p className="text-[9px] text-gray-600">格式不统一会暴露生成痕迹</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-10">
                  <p className="text-xs text-gray-600 mb-2">点击「📊 全书文风统计」按钮查看</p>
                  <p className="text-[10px] text-gray-700">纯本地正则计算，零 AI 消耗，秒级完成</p>
                  <p className="text-[10px] text-gray-700 mt-1">需至少 5 章内容才有统计意义</p>
                  <button
                    onClick={handleStyleStats}
                    disabled={chapters.length < 5}
                    className="mt-3 px-4 py-1.5 bg-gray-700 text-gray-200 text-xs rounded hover:bg-gray-600 disabled:opacity-40 transition-colors"
                  >
                    📊 开始统计（当前 {chapters.length} 章）
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── 底部操作栏 ── */}
        {result && !reviewing && activeTab === 'review' && (
          <div className="flex items-center gap-2 px-4 py-3 border-t border-gray-800 shrink-0 bg-gray-950">
            <button
              onClick={handleReview}
              className="px-3 py-1.5 bg-gray-700 text-gray-200 text-xs rounded hover:bg-gray-600 transition-colors"
            >
              🔄 重新审查
            </button>
            <button
              onClick={handleCopyReport}
              className="px-3 py-1.5 bg-gray-700 text-gray-200 text-xs rounded hover:bg-gray-600 transition-colors"
            >
              {copied ? '✓ 已复制' : '📋 复制报告'}
            </button>
            {result.issues.length > 0 && (
              <button
                onClick={handleAutoRevise}
                disabled={!aiReady}
                className="px-3 py-1.5 bg-accent text-white text-xs rounded hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                🪄 自动修复 ({result.issues.length}项)
              </button>
            )}
            <div className="flex-1" />
            <button
              onClick={handleClose}
              className="px-3 py-1.5 text-gray-500 text-xs hover:text-white transition-colors"
            >
              关闭
            </button>
          </div>
        )}

        {/* ── 修订底部操作栏 ── */}
        {activeTab === 'revise' && revisedContent && !revising && (
          <div className="flex items-center gap-2 px-4 py-3 border-t border-gray-800 shrink-0 bg-gray-950">
            <button
              onClick={handleAcceptRevision}
              className="px-3 py-1.5 bg-green-600 text-white text-xs rounded hover:bg-green-500 transition-colors"
            >
              ✅ 接受修订
            </button>
            <button
              onClick={handleDiscardRevision}
              className="px-3 py-1.5 bg-gray-700 text-gray-200 text-xs rounded hover:bg-gray-600 transition-colors"
            >
              ❌ 放弃
            </button>
            <div className="flex-1" />
            <span className="text-[10px] text-gray-500">接受将覆盖章节原文</span>
          </div>
        )}
    </div>
  );
};

export default AIReviewPanel;
