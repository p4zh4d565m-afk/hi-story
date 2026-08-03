import React, { useState, useEffect, useCallback } from 'react';
import type { ChatMessage } from '../../main/ai/provider';
import { aiService } from '../services/ai.service';
import {
  REVIEW_SYSTEM_PROMPT,
  buildReviewUserPrompt,
  htmlToPlainText,
  extractSummary,
  REVIEW_DIMENSIONS,
  runAntiAICheck,
} from '../services/ai-prompts';
import AIReviewResultComponent from './AIReviewResult';
import type { AIReviewResult, ReviewIssue, Chapter, Character, WorldEntry, OutlineNode, AntiAICheckResult } from '../types';
import { encrypt, decrypt } from '../services/crypto';

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
  /** 项目名称 */
  projectName: string;
  /** 项目类型标签 */
  typeTags: string[];
  /** 跳转到编辑器段落 */
  onNavigateToParagraph?: (searchText: string) => void;
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
  projectName,
  typeTags,
  onNavigateToParagraph,
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
  const [activeTab, setActiveTab] = useState<'review' | 'quickcheck'>('review');
  const [quickCheckResult, setQuickCheckResult] = useState<AntiAICheckResult | null>(null);

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
        outlineNodes: outlineNodes.map(n => ({
          title: n.title,
          summary: n.summary || '',
        })),
      };

      const userPrompt = buildReviewUserPrompt(chapter.title, plainContent, reviewContext);

      const messages: ChatMessage[] = [
        { role: 'system', content: REVIEW_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ];

      const response = await aiService.chat(messages, { temperature: 0.3, maxTokens: 4096 });

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
      setError(`审稿失败：${(e as Error).message}`);
    } finally {
      setReviewing(false);
    }
  }, [selectedChapterId, aiReady, chapters, projectName, typeTags, characters, worldEntries, outlineNodes]);

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

  /** 反AI检测结果颜色 */
  function quickScoreColor(score: number): string {
    if (score >= 80) return 'text-green-400';
    if (score >= 60) return 'text-yellow-400';
    return 'text-red-400';
  }

  if (!open) return null;

  const selectedChapter = chapters.find(ch => ch.id === selectedChapterId);

  return (
    <div className="fixed inset-0 z-40 pointer-events-none">
      <div className="absolute inset-0 pointer-events-none" onClick={onClose} />
      <div
        className="absolute pointer-events-auto bg-gray-950 border border-gray-700 rounded-lg shadow-2xl flex flex-col overflow-hidden"
        style={{
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '760px',
          maxHeight: '88vh',
        }}
      >
        {/* ── 标题栏 ── */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 shrink-0">
          <span className="text-sm font-semibold text-gray-200">🔍 AI 审稿</span>
          <div className="flex items-center gap-2">
            {!initDone ? (
              <span className="text-[10px] text-gray-500">检查 AI 配置...</span>
            ) : aiReady ? (
              <span className="text-[10px] text-green-500">🤖 AI 就绪</span>
            ) : (
              <span className="text-[10px] text-red-400">⚠️ 未配置 AI</span>
            )}
            <button onClick={onClose} className="text-gray-500 hover:text-white text-lg leading-none">✕</button>
          </div>
        </div>

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
            <div className="flex-1" />
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-gray-500 text-xs hover:text-white transition-colors"
            >
              关闭
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default AIReviewPanel;
