import React from 'react';
import type { AIReviewResult, ReviewIssue } from '../types';

// ============================================================
// AI 审稿结果展示子组件
// - 总分圆环
// - 各维度状态网格
// - 问题列表（支持点击跳转到对应段落）
// ============================================================

interface AIReviewResultProps {
  result: AIReviewResult;
  onJumpToIssue?: (issue: ReviewIssue) => void;
}

/** 根据分数返回颜色 */
function scoreColor(score: number): string {
  if (score >= 90) return 'text-green-400';
  if (score >= 75) return 'text-blue-400';
  if (score >= 60) return 'text-yellow-400';
  return 'text-red-400';
}

function scoreBg(score: number): string {
  if (score >= 90) return 'bg-green-400';
  if (score >= 75) return 'bg-blue-400';
  if (score >= 60) return 'bg-yellow-400';
  return 'bg-red-400';
}

function scoreLabel(score: number): string {
  if (score >= 90) return '优秀';
  if (score >= 75) return '良好';
  if (score >= 60) return '合格';
  if (score >= 40) return '不佳';
  return '差';
}

function severityIcon(severity: string): string {
  switch (severity) {
    case 'critical': return '🔴';
    case 'warning': return '🟡';
    case 'info': return '🔵';
    default: return '⚪';
  }
}

function severityLabel(severity: string): string {
  switch (severity) {
    case 'critical': return '严重';
    case 'warning': return '警告';
    case 'info': return '建议';
    default: return severity;
  }
}

const AIReviewResultComponent: React.FC<AIReviewResultProps> = ({ result, onJumpToIssue }) => {
  const { totalScore, summary, criticalCount, warningCount, passedCount, dimensions, issues } = result;

  // SVG 圆环参数
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const progress = (totalScore / 100) * circumference;
  const strokeColor = totalScore >= 75 ? '#4ade80' : totalScore >= 60 ? '#fbbf24' : '#f87171';

  return (
    <div className="space-y-4 text-sm">
      {/* ── 总分区 ── */}
      <div className="flex items-center gap-4 p-4 bg-gray-900/50 border border-gray-800 rounded-lg">
        {/* 圆环 */}
        <div className="relative flex-shrink-0">
          <svg width="80" height="80" viewBox="0 0 88 88">
            <circle cx="44" cy="44" r={radius} fill="none" stroke="#1f2937" strokeWidth="8" />
            <circle
              cx="44" cy="44" r={radius}
              fill="none"
              stroke={strokeColor}
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={circumference - progress}
              transform="rotate(-90 44 44)"
              style={{ transition: 'stroke-dashoffset 0.8s ease' }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className={`text-lg font-bold ${scoreColor(totalScore)}`}>{totalScore}</span>
            <span className="text-[9px] text-gray-500">分</span>
          </div>
        </div>
        {/* 文字摘要 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-base font-bold ${scoreColor(totalScore)}`}>{scoreLabel(totalScore)}</span>
            <span className="text-[10px] text-gray-500">({totalScore}/100)</span>
          </div>
          <p className="text-[11px] text-gray-400 leading-relaxed">{summary}</p>
          <div className="flex items-center gap-3 mt-2">
            <span className="text-[10px] text-red-400">严重 {criticalCount}</span>
            <span className="text-[10px] text-yellow-400">警告 {warningCount}</span>
            <span className="text-[10px] text-green-400">通过 {passedCount}</span>
          </div>
        </div>
      </div>

      {/* ── 各维度状态 ── */}
      <div>
        <h4 className="text-[11px] font-semibold text-gray-400 mb-2 uppercase tracking-wide">各维度评分</h4>
        <div className="grid grid-cols-3 gap-1.5">
          {dimensions.map(d => (
            <div
              key={d.id}
              className={`
                px-2 py-1.5 rounded text-[10px] flex items-center gap-1.5 border
                ${d.passed
                  ? 'bg-green-900/20 border-green-800/30 text-green-300'
                  : d.score >= 60
                    ? 'bg-yellow-900/20 border-yellow-800/30 text-yellow-300'
                    : 'bg-red-900/20 border-red-800/30 text-red-300'
                }
              `}
            >
              <span>{d.passed ? '✅' : d.score >= 60 ? '⚠️' : '❌'}</span>
              <span className="truncate" title={`${d.name}：${d.score}分`}>
                {d.name}
                <span className="text-gray-500 ml-1">{d.score}</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ── 问题列表 ── */}
      {issues.length > 0 && (
        <div>
          <h4 className="text-[11px] font-semibold text-gray-400 mb-2 uppercase tracking-wide">
            具体问题 ({issues.length})
          </h4>
          <div className="space-y-2">
            {issues.map((issue, idx) => (
              <div
                key={idx}
                className={`
                  p-2.5 rounded border text-[11px]
                  ${issue.severity === 'critical'
                    ? 'bg-red-900/20 border-red-800/30'
                    : issue.severity === 'warning'
                      ? 'bg-yellow-900/20 border-yellow-800/30'
                      : 'bg-blue-900/20 border-blue-800/30'
                  }
                `}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <span>{severityIcon(issue.severity)}</span>
                  <span className={`
                    font-semibold
                    ${issue.severity === 'critical' ? 'text-red-400' : issue.severity === 'warning' ? 'text-yellow-400' : 'text-blue-400'}
                  `}>
                    {severityLabel(issue.severity)}
                  </span>
                  <span className="text-gray-500">— {dimensions.find(d => d.id === issue.dimensionId)?.name || `维度${issue.dimensionId}`}</span>
                </div>
                <p className="text-gray-300 mb-1">{issue.description}</p>
                {issue.location && (
                  <div className="flex items-center gap-1 mb-1">
                    <span className="text-[10px] text-gray-500">📍 位置：</span>
                    <span className="text-[10px] text-gray-400 italic truncate max-w-[300px]">
                      "{issue.location.slice(0, 100)}"
                    </span>
                    {onJumpToIssue && (
                      <button
                        onClick={() => onJumpToIssue(issue)}
                        className="text-[10px] text-accent hover:text-accent-hover transition-colors flex-shrink-0"
                      >
                        → 跳转
                      </button>
                    )}
                  </div>
                )}
                {issue.suggestion && (
                  <div className="flex items-start gap-1">
                    <span className="text-[10px] text-gray-500 flex-shrink-0">💡 建议：</span>
                    <span className="text-[10px] text-gray-400">{issue.suggestion}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default AIReviewResultComponent;
