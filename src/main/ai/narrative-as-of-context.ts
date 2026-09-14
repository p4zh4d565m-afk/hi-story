/**
 * 叙事 as-of 上下文组装：按 taskType 固定截面，调用 P1 reduce*AsOf。
 */
import type { ChapterPosition, ChapterAlias } from './narrative-time-order';
import {
  type TimeMode,
  type TaskType,
  type Transition,
  type FactInput,
  type HookInput,
  type DebtInput,
  type KnowledgeInput,
  type HistoryWarning,
  resolveTimeMode,
  validateTaskTimeMode,
  reduceStateFactsAsOf,
  accumulateEventsAsOf,
  reduceHookAsOf,
  reduceDebtAsOf,
  reduceKnowledgeAsOf,
  storyPositionOf,
} from './narrative-state-reducer';

export type NarrativeAsOfRequest = {
  taskType: TaskType;
  hasActiveChapter: boolean;
  /** 显式请求的模式；非法组合抛错。省略则用 resolveTimeMode 默认 */
  requestedMode?: TimeMode;
  targetChapterId: string | null;
  chapters: ChapterPosition[];
  aliases: ChapterAlias[];
  transitions: Transition[];
  facts: FactInput[];
  hooks: HookInput[];
  debts: DebtInput[];
  knowledge: KnowledgeInput[];
};

export type NarrativeAsOfContext = {
  mode: TimeMode;
  target: ChapterPosition | null;
  facts: FactInput[];
  events: FactInput[];
  hooks: HookInput[];
  debts: DebtInput[];
  knowledge: KnowledgeInput[];
  historyWarnings: HistoryWarning[];
  /** 有界文本块，供 ContextBuilder 注入 */
  textBlock: string;
};

export function buildNarrativeAsOfContext(req: NarrativeAsOfRequest): NarrativeAsOfContext {
  const defaultMode = resolveTimeMode(req.taskType, { hasActiveChapter: req.hasActiveChapter });
  const mode = req.requestedMode
    ? validateTaskTimeMode(req.taskType, req.requestedMode)
    : defaultMode;

  let target: ChapterPosition | null = null;
  if (mode !== 'planning_only' && mode !== 'project_latest') {
    if (!req.targetChapterId) {
      throw new Error('该时间模式需要目标章');
    }
    target = storyPositionOf(req.targetChapterId, req.chapters, req.aliases);
  } else if (mode === 'project_latest' && req.targetChapterId) {
    // 可选目标：若传入则校验归属，但不用于截断
    storyPositionOf(req.targetChapterId, req.chapters, req.aliases);
  }

  const warnings: HistoryWarning[] = [];

  const factsResult = reduceStateFactsAsOf(
    req.facts, req.transitions, req.chapters, req.aliases, target, mode,
  );
  warnings.push(...factsResult.historyWarnings);
  const eventsResult = accumulateEventsAsOf(
    req.facts, req.transitions, req.chapters, req.aliases, target, mode,
  );
  warnings.push(...eventsResult.historyWarnings);

  const hooks: HookInput[] = [];
  for (const h of req.hooks) {
    const r = reduceHookAsOf(h, req.transitions, req.chapters, req.aliases, target, mode);
    warnings.push(...r.historyWarnings);
    if (r.data) hooks.push(r.data);
  }

  const debts: DebtInput[] = [];
  for (const d of req.debts) {
    const r = reduceDebtAsOf(d, req.transitions, req.chapters, req.aliases, target, mode);
    warnings.push(...r.historyWarnings);
    if (r.data) debts.push(r.data);
  }

  const knowledge: KnowledgeInput[] = [];
  for (const k of req.knowledge) {
    const r = reduceKnowledgeAsOf(k, req.transitions, req.chapters, req.aliases, target, mode);
    warnings.push(...r.historyWarnings);
    if (r.data) knowledge.push(r.data);
  }

  const textBlock = formatAsOfBlock({
    mode,
    targetId: target?.id ?? null,
    facts: factsResult.data ?? [],
    events: eventsResult.data ?? [],
    hooks,
    debts,
    knowledge,
    historyWarnings: warnings,
  });

  return {
    mode,
    target,
    facts: factsResult.data ?? [],
    events: eventsResult.data ?? [],
    hooks,
    debts,
    knowledge,
    historyWarnings: warnings,
    textBlock,
  };
}

function formatAsOfBlock(input: {
  mode: TimeMode;
  targetId: string | null;
  facts: FactInput[];
  events: FactInput[];
  hooks: HookInput[];
  debts: DebtInput[];
  knowledge: KnowledgeInput[];
  historyWarnings: HistoryWarning[];
}): string {
  if (input.mode === 'planning_only') {
    return '【叙事时间截面】planning_only — 不注入运行时事实。';
  }
  const lines: string[] = [
    `【叙事时间截面】mode=${input.mode}` + (input.targetId ? ` target=${input.targetId}` : ''),
  ];
  if (input.facts.length) {
    lines.push('状态事实：');
    for (const f of input.facts.slice(0, 40)) {
      lines.push(`- [${f.factType}] ${formatFactLine(f)}`);
    }
  }
  if (input.events.length) {
    lines.push('事件：');
    for (const e of input.events.slice(0, 40)) {
      lines.push(`- ${formatFactLine(e)}`);
    }
  }
  if (input.hooks.length) {
    lines.push('钩子：');
    for (const h of input.hooks.slice(0, 20)) {
      const text = h.description || h.subject || h.id;
      lines.push(`- ${h.status} ${text}`);
    }
  }
  if (input.debts.length) {
    lines.push('债务：');
    for (const d of input.debts.slice(0, 20)) {
      const text = d.description || d.subject || d.id;
      lines.push(`- ${d.status} ${text}`);
    }
  }
  if (input.knowledge.length) {
    lines.push('知识：');
    for (const k of input.knowledge.slice(0, 20)) {
      const who = k.characterName ? `${k.characterName} ` : '';
      const text = k.factDescription || k.id;
      lines.push(`- ${who}${text}`);
    }
  }
  if (input.historyWarnings.length) {
    const ids = input.historyWarnings.slice(0, 10).map((w) => w.recordId).join(',');
    lines.push(`历史不完整告警 ${input.historyWarnings.length} 条（示例 id: ${ids}）`);
  }
  return lines.join('\n');
}

function formatFactLine(f: FactInput): string {
  if (f.description) return f.description;
  const triple = [f.subject, f.predicate, f.object].filter(Boolean).join(' ');
  return triple || f.id;
}
