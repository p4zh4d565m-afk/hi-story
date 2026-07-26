/**
 * 参考匹配面板
 * - 手动搜索：输入关键词，同时搜索「用户导入」和「系统开放」两个来源
 * - 同义词扩展：搜索词自动扩展为古诗词中的同义表达
 * - 结果按「命中扩展词数量」降序排列，分区展示
 * - 不做阈值过滤（现阶段排序足以替代阈值）
 */

import React, { useState, useCallback, useEffect } from 'react';
import type { SimilarityResult } from '../../main/ai/similarity';

interface ReferencePanelProps {
  open: boolean;
  userMatches: SimilarityResult[];
  openMatches: SimilarityResult[];
  autoSearch: boolean;
  onToggleAutoSearch: () => void;
  onManualSearch: (text: string) => void;
  onClose: () => void;
  pendingSearchText?: string;
  searching?: boolean;
}

const ReferencePanel: React.FC<ReferencePanelProps> = ({
  open,
  userMatches,
  openMatches,
  autoSearch,
  onToggleAutoSearch,
  onManualSearch,
  onClose,
  pendingSearchText,
  searching = false,
}) => {
  const [manualQuery, setManualQuery] = useState('');
  const [hasSearched, setHasSearched] = useState(false);
  const [showHighlights, setShowHighlights] = useState(true);

  // 过滤：只保留文本中含原始输入字的结果
  // 注意：语义匹配结果不参与字符级过滤（它们是通过向量相似度找到的）
  const queryChars = manualQuery.trim().replace(/[^一-鿿㐀-䶿a-zA-Z0-9]/g, '').split('').filter(c => c.trim().length > 0);
  const filterByQuery = (results: SimilarityResult[]): SimilarityResult[] => {
    if (queryChars.length === 0) return results;
    return results.filter(r =>
      // 语义匹配和 AI 精排结果始终保留（不要求字面包含）
      r.matchSource === 'semantic' ||
      r.matchSource === 'ai_ranked' ||
      queryChars.some(ch => r.content.includes(ch))
    );
  };

  const filteredUser = filterByQuery(userMatches);
  const filteredOpen = filterByQuery(openMatches);
  const totalMatches = filteredUser.length + filteredOpen.length;

  // 分离 AI 精排结果和纯 LIKE 结果
  const aiRankedUser = filteredUser.filter(r => r.matchSource === 'ai_ranked');
  const aiRankedOpen = filteredOpen.filter(r => r.matchSource === 'ai_ranked');
  const keywordUser = filteredUser.filter(r => r.matchSource !== 'ai_ranked');
  const keywordOpen = filteredOpen.filter(r => r.matchSource !== 'ai_ranked');
  const hasAiRanked = aiRankedUser.length + aiRankedOpen.length > 0;
  const totalKeyword = keywordUser.length + keywordOpen.length;

  // AI 精排成功时显示用户查看的小字提示
  const filterSummary = hasAiRanked
    ? `共找到 ${totalKeyword} 条字面匹配结果，AI 已精选最相关的 ${aiRankedUser.length + aiRankedOpen.length} 条`
    : null;

  // 手动搜索
  const handleManualSearch = useCallback(() => {
    const q = manualQuery.trim();
    if (!q) return;
    setHasSearched(true);
    onManualSearch(q);
  }, [manualQuery, onManualSearch]);

  // 处理选中文字搜索：填入搜索框并自动触发 AI 精排搜索
  useEffect(() => {
    if (pendingSearchText && pendingSearchText.trim()) {
      setManualQuery(pendingSearchText);
      setHasSearched(true);
      // 自动触发搜索，无需用户再点"搜索"按钮
      onManualSearch(pendingSearchText);
    }
  }, [pendingSearchText, onManualSearch]);

  if (!open) return null;

  // 高亮匹配词：黄色字面高亮（用户输入与结果中相同的字）
  // 单字停用词不标亮——避免"的""了""是"等虚词满屏闪烁
  const STOP_WORDS = new Set(
    '的了吗呢啊吧呀么着过是就都会很也还更再这与不那之而其和但或及在从被把向对于因'.split(''),
  );

  const highlightMatch = (text: string, query: string): React.ReactNode => {
    if (!query) return text;
    // 清洗 query：去掉所有标点符号，只保留汉字/字母/数字
    const cleanQuery = query.replace(/[^一-鿿㐀-䶿a-zA-Z0-9]/g, '');
    if (!cleanQuery) return text;
    // 提取 query 中所有不重叠子串，按长度降序排列（优先匹配长词）
    const terms: string[] = [];
    for (let len = cleanQuery.length; len >= 1; len--) {
      for (let i = 0; i <= cleanQuery.length - len; i++) {
        const sub = cleanQuery.slice(i, i + len);
        // 跳过单字停用词（"的""了"等虚词不应高亮）
        if (sub.length === 1 && STOP_WORDS.has(sub)) continue;
        if (!terms.includes(sub)) terms.push(sub);
      }
    }
    // 过滤：排除纯标点、纯空格（cleanQuery 已去标点，此处兜底）
    if (terms.length === 0) return text;

    // 检查文本中是否包含任一匹配词
    const hasAny = terms.some(t => text.includes(t));
    if (!hasAny) return text;

    const escaped = terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const regex = new RegExp(`(${escaped.join('|')})`, 'gu');

    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push(text.slice(lastIndex, match.index));
      }
      parts.push(
        <mark key={`y-${match.index}-${match[0]}`} className="bg-yellow-500/30 text-yellow-200 px-0.5 rounded">
          {match[0]}
        </mark>
      );
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) {
      parts.push(text.slice(lastIndex));
    }
    return parts.length > 0 ? <>{parts}</> : text;
  };

  /**
   * 双层高亮：紫色(AI意境对应词) + 黄色(用户输入字面匹配)
   * 紫色优先——当重叠时紫色盖过黄色
   */
  const highlightDual = (text: string, query: string, aiHighlights?: string[]): React.ReactNode => {
    // 如果没有任何高亮需要，直接返回文本
    if (!aiHighlights || aiHighlights.length === 0) {
      return highlightMatch(text, query);
    }

    // 收集所有需要高亮的区间
    type Span = { start: number; end: number; type: 'purple' | 'yellow'; word: string };
    const spans: Span[] = [];

    // 紫色区间（AI highlights）
    // 先清洗标点符号，再用纯文字去匹配——避免 AI 返回的 "思念，" 把逗号也标亮
    for (const rawHw of aiHighlights) {
      const hw = rawHw.replace(/[^一-鿿㐀-䶿a-zA-Z0-9]/g, '');
      if (!hw) continue;
      let pos = 0;
      while (pos < text.length) {
        const idx = text.indexOf(hw, pos);
        if (idx === -1) break;
        spans.push({ start: idx, end: idx + hw.length, type: 'purple', word: hw });
        pos = idx + 1;
      }
    }

    // 黄色区间（用户查询字面匹配）——只在非紫色区间
    if (query) {
      // 清洗 query：去掉所有标点符号，只保留汉字/字母/数字
      const cleanQuery = query.replace(/[^一-鿿㐀-䶿a-zA-Z0-9]/g, '');
      const terms: string[] = [];
      if (cleanQuery) {
        for (let len = cleanQuery.length; len >= 1; len--) {
          for (let i = 0; i <= cleanQuery.length - len; i++) {
            const sub = cleanQuery.slice(i, i + len);
            // 跳过单字停用词（"的""了"等虚词不应高亮）
            if (sub.length === 1 && STOP_WORDS.has(sub)) continue;
            if (!terms.includes(sub)) terms.push(sub);
          }
        }
      }

      for (const term of terms) {
        let pos = 0;
        while (pos < text.length) {
          const idx = text.indexOf(term, pos);
          if (idx === -1) break;
          // 检查是否与紫色区间重叠
          const overlapsPurple = spans.some(
            s => s.type === 'purple' && idx < s.end && idx + term.length > s.start
          );
          if (!overlapsPurple) {
            spans.push({ start: idx, end: idx + term.length, type: 'yellow', word: term });
          }
          pos = idx + 1;
        }
      }
    }

    // 按起始位置排序，重叠时紫色优先
    spans.sort((a, b) => {
      if (a.start !== b.start) return a.start - b.start;
      if (a.type === 'purple' && b.type === 'yellow') return -1;
      if (a.type === 'yellow' && b.type === 'purple') return 1;
      return a.end - b.end;
    });

    // 合并重叠区间（紫色优先）
    const merged: Span[] = [];
    for (const span of spans) {
      if (merged.length === 0) { merged.push(span); continue; }
      const last = merged[merged.length - 1];
      if (span.start < last.end) {
        // 重叠：紫色优先
        if (span.type === 'purple' && last.type === 'yellow') {
          // 紫色吞并黄色重叠部分
          merged.pop();
          merged.push(span);
        }
        // 否则跳过（黄色被紫色覆盖，或同色合并）
      } else {
        merged.push(span);
      }
    }

    // 构建输出
    const parts: React.ReactNode[] = [];
    let lastEnd = 0;
    for (let i = 0; i < merged.length; i++) {
      const span = merged[i];
      if (span.start > lastEnd) {
        parts.push(text.slice(lastEnd, span.start));
      }
      if (span.type === 'purple') {
        parts.push(
          <mark key={`p-${i}-${span.start}`} className="bg-purple-500/30 text-purple-200 px-0.5 rounded">
            {text.slice(span.start, span.end)}
          </mark>
        );
      } else {
        parts.push(
          <mark key={`y-${i}-${span.start}`} className="bg-yellow-500/30 text-yellow-200 px-0.5 rounded">
            {text.slice(span.start, span.end)}
          </mark>
        );
      }
      lastEnd = span.end;
    }
    if (lastEnd < text.length) {
      parts.push(text.slice(lastEnd));
    }
    return parts.length > 0 ? <>{parts}</> : text;
  };

  // 渲染单个结果条目
  const renderItem = (match: SimilarityResult, idx: number, sourceLabel: string) => {
    const query = manualQuery.trim();
    const isSemantic = match.matchSource === 'semantic';
    const isAiRanked = match.matchSource === 'ai_ranked';
    const isKeyword = match.matchSource === 'keyword';

    // 展示文本：AI精排优先用 matchedSentence，否则用 content（兜底截断）
    let displayText = match.content || '';
    if (match.matchedSentence) {
      displayText = match.matchedSentence;
    } else if (displayText.length > 150) {
      // 兜底：寻找句子边界截断
      const truncateAt = displayText.slice(0, 150);
      const lastEndMark = truncateAt.match(/[。！？；][^。！？；]*$/);
      displayText = lastEndMark
        ? displayText.slice(0, truncateAt.lastIndexOf(lastEndMark[0]) + 1)
        : truncateAt + '…';
    }

    // 高亮策略：showHighlights 关闭时走纯文本；AI精排用双层高亮，关键词匹配用黄色字面高亮
    const highlightedContent = !showHighlights
      ? displayText
      : isAiRanked
        ? highlightDual(displayText, query, match.highlights)
        : isKeyword
          ? highlightMatch(displayText, query)
          : displayText;  // semantic 不要求字面包含，不高亮

    // 出处信息
    const attribution = [match.docAuthor, match.docTitle]
      .filter(Boolean)
      .join(' · ');

    return (
      <div key={match.chunkId} className="border-b border-context-700/50">
        <div className="px-3 py-2.5">
          {/* 顶行：排名 + 标签 + 分数 */}
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[10px] text-gray-500 font-mono bg-context-800 px-1.5 py-0.5 rounded flex-shrink-0">
              #{idx + 1}
            </span>
            {/* 🤖AI精排 标签 */}
            {isAiRanked && (
              <span className="text-[10px] text-purple-300 font-medium flex-shrink-0 bg-purple-500/15 px-1.5 py-0.5 rounded border border-purple-500/30" title="AI 理解意境后精选">
                🤖AI精排
              </span>
            )}
            {/* 💡语义匹配 标签 */}
            {isSemantic && (
              <span className="text-[10px] text-cyan-300 font-medium flex-shrink-0 bg-cyan-500/15 px-1.5 py-0.5 rounded border border-cyan-500/30" title="语义理解匹配">
                💡语义匹配
              </span>
            )}
            {/* 所有结果的匹配度百分比 — AI精排用紫色，关键词用绿色 */}
            {match.matchPercentage > 0 && (
              <span className={`text-[10px] font-medium flex-shrink-0 px-1.5 py-0.5 rounded ${
                isAiRanked
                  ? 'text-purple-300 bg-purple-500/10 ml-auto'
                  : isKeyword
                    ? 'text-accent bg-accent/10'
                    : 'text-gray-500'
              }`}>
                {match.matchPercentage}%
              </span>
            )}
          </div>

          {/* 出处 */}
          {attribution && (
            <div className="text-[9px] text-gray-500 ml-8 mb-1 truncate">
              📖 {attribution}
            </div>
          )}

          {/* 匹配句子 — 双层高亮 */}
          <p className="text-[12px] text-gray-300 ml-8 leading-relaxed">
            {highlightedContent}
          </p>

          {/* AI 精排理由 — 灰色小字 */}
          {isAiRanked && match.rankReason && (
            <p className="text-[10px] text-gray-500 ml-8 mt-1 italic leading-relaxed">
              💡 {match.rankReason}
            </p>
          )}
          {/* AI 意境关键词高亮 — 紫色标签 */}
          {isAiRanked && match.highlights && match.highlights.length > 0 && (
            <div className="ml-8 mt-1 flex flex-wrap gap-1">
              {match.highlights.map(hw => (
                <span key={hw} className="text-[9px] bg-purple-500/15 text-purple-300 px-1 py-0.5 rounded">
                  {hw}
                </span>
              ))}
            </div>
          )}

          {/* 来源标签 */}
          <div className="mt-1 ml-8">
            <span className="text-[9px] text-gray-600">{sourceLabel}</span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col bg-context-900 border-l border-context-700">
      {/* Header */}
      <div className="px-3 py-2 border-b border-context-700 flex items-center justify-between">
        <h3 className="text-xs font-semibold text-gray-300 uppercase tracking-wide">📚 参考搜索</h3>
        <div className="flex items-center gap-2">
          {/* 高亮开关 */}
          <button
            onClick={() => setShowHighlights(!showHighlights)}
            className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
              showHighlights
                ? 'bg-yellow-500/15 text-yellow-300 border border-yellow-500/30'
                : 'bg-context-700 text-gray-500 border border-context-600'
            }`}
            title={showHighlights ? '点击关闭高亮' : '点击开启高亮'}
          >
            {showHighlights ? '✨ 高亮中' : '📖 纯文本'}
          </button>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors text-sm" title="关闭">
            ✕
          </button>
        </div>
      </div>

      {/* 搜索区 */}
      <div className="p-3 border-b border-context-700 space-y-3">
        {/* 自动搜索开关 */}
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={autoSearch}
            onChange={onToggleAutoSearch}
            className="w-3.5 h-3.5 accent-accent cursor-pointer rounded"
          />
          <span className="text-[11px] text-gray-300">🔄 自动检测</span>
          {autoSearch && <span className="text-[9px] text-gray-600">每 3 秒</span>}
        </label>

        {/* 手动搜索 */}
        <div>
          <div className="flex gap-1">
            <input
              type="text"
              value={manualQuery}
              onChange={(e) => setManualQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleManualSearch()}
              placeholder="输入关键词或句子…"
              className="flex-1 px-2 py-1.5 bg-context-800 border border-context-700 rounded text-white text-xs
                         focus:outline-none focus:border-accent placeholder-gray-600"
            />
            {manualQuery.length > 0 && (
              <button
                onClick={() => { setManualQuery(''); setHasSearched(false); }}
                className="px-2 py-1.5 bg-context-700 text-gray-400 text-xs rounded hover:bg-context-600 hover:text-white transition-colors"
                title="清空输入"
              >
                ✕
              </button>
            )}
            <button
              onClick={handleManualSearch}
              disabled={!manualQuery.trim()}
              className="px-3 py-1.5 bg-accent text-white text-xs rounded hover:bg-accent-hover
                         disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              搜索
            </button>
          </div>
          <p className="text-[9px] text-gray-600 mt-1">
            🔍 自动扩展同义词（如"晚上"→"夜·暮·夕·宵"），搜得更全
          </p>
        </div>
      </div>

      {/* 结果列表 */}
      <div className="flex-1 overflow-y-auto">
        {/* 尚未搜索且无结果 */}
        {!hasSearched && totalMatches === 0 && !searching && (
          <div className="px-4 py-8 text-center text-gray-600 text-xs">
            <p className="text-lg mb-2">📚</p>
            <p>输入关键词搜索参考库</p>
            <p className="mt-1 text-gray-700">用户导入的小说 + 系统开放的诗词典故</p>
          </div>
        )}

        {/* 搜索中 — 保持旧结果显示，仅显示 loading 提示 */}
        {searching && (
          <div className="px-3 py-2 text-center text-gray-500 text-xs animate-pulse">
            {totalMatches > 0
              ? `🔍 正在 AI 精排中… (当前 ${totalMatches} 条)`
              : '🔍 正在搜索中…'}
          </div>
        )}

        {/* 搜索完成且无结果（不在搜索中且有搜过） */}
        {!searching && hasSearched && totalMatches === 0 && (
          <div className="px-4 py-8 text-center text-gray-500 text-xs">
            <p className="text-lg mb-2">📭</p>
            <p className="font-medium">无匹配结果</p>
            <p className="mt-1 text-gray-600">尝试更短的关键词，或换个说法</p>
          </div>
        )}

        {/* ── AI 精排成功：只展示精排结果 ── */}
        {hasAiRanked && aiRankedUser.length > 0 && (
          <div>
            <div className="px-3 py-2 text-[10px] text-purple-300 font-semibold uppercase sticky top-0 bg-context-900/95 backdrop-blur z-10 border-b border-context-700/30">
              📖 用户导入 — AI 精选 ({aiRankedUser.length} 条)
            </div>
            {aiRankedUser.map((m, i) => renderItem(m, i, '用户导入'))}
          </div>
        )}
        {hasAiRanked && aiRankedOpen.length > 0 && (
          <div>
            <div className="px-3 py-2 text-[10px] text-purple-300 font-semibold uppercase sticky top-0 bg-context-900/95 backdrop-blur z-10 border-b border-context-700/30">
              📚 系统开放 — AI 精选 ({aiRankedOpen.length} 条)
            </div>
            {aiRankedOpen.map((m, i) => renderItem(m, i, '系统开放'))}
          </div>
        )}

        {/* ── 筛选提示 ── */}
        {filterSummary && (
          <div className="px-3 py-1.5 text-[9px] text-gray-600 text-center border-b border-context-700/30">
            {filterSummary}
          </div>
        )}

        {/* ── 无 AI 精排：展示全部 LIKE 结果 ── */}
        {!hasAiRanked && filteredUser.length > 0 && (
          <div>
            <div className="px-3 py-2 text-[10px] text-gray-500 font-semibold uppercase sticky top-0 bg-context-900/95 backdrop-blur z-10 border-b border-context-700/30">
              📖 用户导入 ({filteredUser.length} 条)
            </div>
            {filteredUser.map((m, i) => renderItem(m, i, '用户导入'))}
          </div>
        )}

        {!hasAiRanked && filteredOpen.length > 0 && (
          <div>
            <div className="px-3 py-2 text-[10px] text-gray-500 font-semibold uppercase sticky top-0 bg-context-900/95 backdrop-blur z-10 border-b border-context-700/30">
              📚 系统开放 ({filteredOpen.length} 条)
            </div>
            {filteredOpen.map((m, i) => renderItem(m, i, '系统开放'))}
          </div>
        )}
      </div>

      {/* 底部状态 */}
      <div className="px-3 py-1.5 border-t border-context-700 text-[9px] text-gray-600 flex items-center justify-between">
        <span>{autoSearch ? '🔵 自动检测中' : '⏸ 手动模式'}</span>
        {hasSearched && <span>共 {totalMatches} 条</span>}
      </div>
    </div>
  );
};

export default ReferencePanel;
