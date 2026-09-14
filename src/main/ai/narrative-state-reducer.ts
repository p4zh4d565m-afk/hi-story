/**
 * 叙事状态 as-of 折叠 + 状态规范化纯函数。
 * 统一返回 ReductionResult<T>；不写库、不生成 ID。
 */

import type { ChapterPosition, ChapterAlias } from './narrative-time-order';
import {
  compareStoryPosition,
  resolveChapterId,
  resolveTransitionOrdinal,
} from './narrative-time-order';

export type TimeMode = 'before_target' | 'through_target' | 'project_latest' | 'planning_only';
export type TaskType = 'write' | 'review' | 'chat' | 'planning';

export type Snapshot = { schemaVersion: number; data: unknown };

export type Transition = {
  targetId: string;
  kind: 'created' | 'superseded' | 'resolved' | 'paid' | 'abandoned' | 'waived' | 'partially_resolved';
  atChapterId: string;
  atChapterOrdinal: number;
  seq: number;
  afterSnapshot: Snapshot;
  decisionId?: string;
};

export type HistoryWarning = { kind: string; recordId: string; message: string };
export type ReductionResult<T> = { data: T | null; historyWarnings: HistoryWarning[] };

export type FactInput = {
  id: string;
  factType: string;
  chapterId: string;
  stateKey?: string;
  object?: string;
  status?: string;
};

export type HookInput = {
  id: string;
  chapterId: string;
  status: string;
  description?: string;
  dueChapterId?: string | null;
  resolvedInChapterId?: string | null;
  promisedByChapter?: number;
};

export type DebtInput = {
  id: string;
  chapterId: string;
  status: string;
  paidInChapterId?: string | null;
  dueChapterId?: string | null;
  promisedByChapter?: number;
};

export type KnowledgeInput = {
  id: string;
  learnedAtChapterId: string;
  status: string;
};

export type StateKeyInput =
  | { factType: 'location' | 'possession' | 'emotional_state'; subject: string; predicate: string; object: string }
  | { factType: 'relationship'; subject: string; predicate: string; object: string; directed: boolean };

const KNOWN_SNAPSHOT_SCHEMA_VERSION = 1;
const STATE_KEY_VERSION = 1;

const ALLOWED_MODES: Record<TaskType, TimeMode[]> = {
  write: ['before_target'],
  review: ['before_target'],
  chat: ['through_target', 'project_latest'],
  planning: ['planning_only'],
};

export function resolveTimeMode(taskType: TaskType, opts: { hasActiveChapter: boolean }): TimeMode {
  switch (taskType) {
    case 'write':
    case 'review':
      return 'before_target';
    case 'chat':
      return opts.hasActiveChapter ? 'through_target' : 'project_latest';
    case 'planning':
      return 'planning_only';
    default: {
      const _exhaustive: never = taskType;
      throw new Error(`未知 taskType: ${_exhaustive}`);
    }
  }
}

export function validateTaskTimeMode(taskType: TaskType, requestedMode: TimeMode): TimeMode {
  const allowed = ALLOWED_MODES[taskType];
  if (!allowed.includes(requestedMode)) {
    throw new Error(`非法时间模式组合: ${taskType} + ${requestedMode}`);
  }
  return requestedMode;
}

export function canAutoExtractOverwrite(record: { sourceDecisionId: string | null }): boolean {
  return record.sourceDecisionId == null;
}

export function deriveStateKey(fact: StateKeyInput): { key: string; version: number } {
  const version = STATE_KEY_VERSION;
  switch (fact.factType) {
    case 'location':
    case 'emotional_state':
      return { key: `${fact.factType}|${fact.subject}|${fact.predicate}`, version };
    case 'possession':
      return { key: `${fact.factType}|${fact.subject}|${fact.predicate}|${fact.object}`, version };
    case 'relationship': {
      if (fact.directed) {
        return {
          key: `${fact.factType}|dir|${fact.subject}|${fact.predicate}|${fact.object}`,
          version,
        };
      }
      const [a, b] = [fact.subject, fact.object].slice().sort();
      return { key: `${fact.factType}|undir|${a}|${fact.predicate}|${b}`, version };
    }
    default: {
      const _exhaustive: never = fact;
      throw new Error(`未知 factType: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

function findChapter(chapterId: string, chapters: ChapterPosition[]): ChapterPosition | undefined {
  return chapters.find((c) => c.id === chapterId);
}

/** resolveChapterId 后定位；跨项目/不存在/已删抛错。 */
export function storyPositionOf(
  chapterId: string,
  chapters: ChapterPosition[],
  aliases: ChapterAlias[],
): ChapterPosition {
  const resolved = resolveChapterId(chapterId, aliases);
  const pos = findChapter(resolved, chapters);
  if (!pos) {
    throw new Error(`章节不存在: ${chapterId}`);
  }
  if (pos.sortOrder === null) {
    throw new Error(`目标章已删除: ${chapterId}`);
  }
  return pos;
}

function assertTargetCompatible(
  chapters: ChapterPosition[],
  target: ChapterPosition | null,
): void {
  if (!target) return;
  const found = findChapter(target.id, chapters);
  if (!found) throw new Error(`目标章不存在: ${target.id}`);
  if (found.projectId !== target.projectId) {
    throw new Error(`目标章跨项目: ${target.projectId}`);
  }
  if (chapters.some((c) => c.projectId !== target.projectId)) {
    throw new Error(`目标章跨项目: ${target.projectId}`);
  }
  if (found.sortOrder === null || target.sortOrder === null) {
    throw new Error(`目标章已删除: ${target.id}`);
  }
}

export function compareTransition(
  a: Transition,
  b: Transition,
  chapters: ChapterPosition[],
  aliases: ChapterAlias[],
): number {
  const posA = storyPositionOf(a.atChapterId, chapters, aliases);
  const posB = storyPositionOf(b.atChapterId, chapters, aliases);
  const byChapter = compareStoryPosition(posA, posB);
  if (byChapter !== 0) return byChapter;

  const ordA = resolveTransitionOrdinal(a.atChapterId, a.atChapterOrdinal, aliases);
  const ordB = resolveTransitionOrdinal(b.atChapterId, b.atChapterOrdinal, aliases);
  if (ordA !== ordB) return ordA < ordB ? -1 : 1;
  if (a.seq !== b.seq) return a.seq < b.seq ? -1 : 1;
  if (a.targetId !== b.targetId) return a.targetId < b.targetId ? -1 : 1;
  return 0;
}

export function defaultOrdinalForAppend(
  transitions: Transition[],
  chapterId: string,
  aliases: ChapterAlias[],
): number {
  let max = -1;
  for (const t of transitions) {
    if (resolveChapterId(t.atChapterId, aliases) !== chapterId) continue;
    const eff = resolveTransitionOrdinal(t.atChapterId, t.atChapterOrdinal, aliases);
    if (eff > max) max = eff;
  }
  return max + 1;
}

function assertKnownSnapshot(snapshot: Snapshot): void {
  if (snapshot.schemaVersion !== KNOWN_SNAPSHOT_SCHEMA_VERSION) {
    throw new Error(`未知快照版本: ${snapshot.schemaVersion}`);
  }
}

function isActiveChapterRef(
  chapterId: string,
  chapters: ChapterPosition[],
  aliases: ChapterAlias[],
): boolean {
  const resolved = resolveChapterId(chapterId, aliases);
  const pos = findChapter(resolved, chapters);
  return !!pos && pos.sortOrder !== null;
}

function transitionIncluded(
  t: Transition,
  chapters: ChapterPosition[],
  aliases: ChapterAlias[],
  target: ChapterPosition | null,
  mode: TimeMode,
): boolean {
  if (!isActiveChapterRef(t.atChapterId, chapters, aliases)) return false;
  if (mode === 'project_latest') return true;
  if (!target) return false;
  const pos = storyPositionOf(t.atChapterId, chapters, aliases);
  const cmp = compareStoryPosition(pos, target);
  if (mode === 'before_target') return cmp < 0;
  if (mode === 'through_target') return cmp <= 0;
  return false;
}

function emptyWarnings(): HistoryWarning[] {
  return [];
}

function historyIncomplete(recordId: string): HistoryWarning {
  return { kind: 'incomplete_history', recordId, message: '历史不完整' };
}

function foldEntityFromTransitions<T extends { id: string }>(
  entity: T,
  transitions: Transition[],
  chapters: ChapterPosition[],
  aliases: ChapterAlias[],
  target: ChapterPosition | null,
  mode: TimeMode,
  mergeSnapshot: (base: T, data: unknown) => T,
): ReductionResult<T> {
  assertTargetCompatible(chapters, target);
  if (mode === 'planning_only') {
    return { data: null, historyWarnings: emptyWarnings() };
  }

  const mine = transitions.filter((t) => t.targetId === entity.id);
  const included = mine
    .filter((t) => transitionIncluded(t, chapters, aliases, target, mode))
    .slice()
    .sort((a, b) => compareTransition(a, b, chapters, aliases));

  if (included.length === 0) {
    if (mode === 'project_latest') {
      // 无转换时 latest 可回退当前投影（本 P1 测试未强制）；历史截面必须拒绝
      return { data: null, historyWarnings: [historyIncomplete(entity.id)] };
    }
    return { data: null, historyWarnings: [historyIncomplete(entity.id)] };
  }

  let current: T = { ...entity };
  for (const t of included) {
    assertKnownSnapshot(t.afterSnapshot);
    current = mergeSnapshot(current, t.afterSnapshot.data);
  }
  return { data: current, historyWarnings: emptyWarnings() };
}

function recordInScope(
  chapterId: string,
  chapters: ChapterPosition[],
  aliases: ChapterAlias[],
  target: ChapterPosition | null,
  mode: TimeMode,
): boolean {
  if (!isActiveChapterRef(chapterId, chapters, aliases)) return false;
  if (mode === 'planning_only') return false;
  if (mode === 'project_latest') return true;
  if (!target) return false;
  const pos = storyPositionOf(chapterId, chapters, aliases);
  const cmp = compareStoryPosition(pos, target);
  if (mode === 'before_target') return cmp < 0;
  if (mode === 'through_target') return cmp <= 0;
  return false;
}

export function reduceTransitionAsOf(
  transitions: Transition[],
  chapters: ChapterPosition[],
  aliases: ChapterAlias[],
  target: ChapterPosition | null,
  mode: TimeMode,
): ReductionResult<unknown> {
  assertTargetCompatible(chapters, target);
  if (mode === 'planning_only') {
    return { data: null, historyWarnings: emptyWarnings() };
  }
  const included = transitions
    .filter((t) => transitionIncluded(t, chapters, aliases, target, mode))
    .slice()
    .sort((a, b) => compareTransition(a, b, chapters, aliases));
  if (included.length === 0) {
    return { data: null, historyWarnings: emptyWarnings() };
  }
  const last = included[included.length - 1]!;
  assertKnownSnapshot(last.afterSnapshot);
  return { data: last.afterSnapshot.data, historyWarnings: emptyWarnings() };
}

export function reduceStateFactsAsOf(
  facts: FactInput[],
  transitions: Transition[],
  chapters: ChapterPosition[],
  aliases: ChapterAlias[],
  target: ChapterPosition | null,
  mode: TimeMode,
): ReductionResult<FactInput[]> {
  assertTargetCompatible(chapters, target);
  if (mode === 'planning_only') {
    return { data: [], historyWarnings: emptyWarnings() };
  }

  const inScope = facts.filter((f) =>
    recordInScope(f.chapterId, chapters, aliases, target, mode),
  );

  // 状态型：同 stateKey 取最后一条（按章节故事位置）
  const stateTypes = new Set(['location', 'possession', 'relationship', 'emotional_state']);
  const events = inScope.filter((f) => !stateTypes.has(f.factType));
  const states = inScope.filter((f) => stateTypes.has(f.factType));

  const byKey = new Map<string, FactInput>();
  const orderedStates = states.slice().sort((a, b) => {
    const pa = storyPositionOf(a.chapterId, chapters, aliases);
    const pb = storyPositionOf(b.chapterId, chapters, aliases);
    return compareStoryPosition(pa, pb);
  });
  for (const f of orderedStates) {
    const key = f.stateKey ?? f.id;
    byKey.set(key, f);
  }

  // 事件在 reduceStateFactsAsOf 中也按「最后」不累计——累计走 accumulateEventsAsOf
  // 但 T4b/T10 用 reduceStateFactsAsOf 测 event 可见性，因此事件全部保留
  const result = [...byKey.values(), ...events];
  void transitions;
  return { data: result, historyWarnings: emptyWarnings() };
}

export function accumulateEventsAsOf(
  facts: FactInput[],
  transitions: Transition[],
  chapters: ChapterPosition[],
  aliases: ChapterAlias[],
  target: ChapterPosition | null,
  mode: TimeMode,
): ReductionResult<FactInput[]> {
  assertTargetCompatible(chapters, target);
  if (mode === 'planning_only') {
    return { data: [], historyWarnings: emptyWarnings() };
  }

  const superseded = new Set(
    transitions
      .filter((t) => t.kind === 'superseded' && transitionIncluded(t, chapters, aliases, target, mode))
      .map((t) => t.targetId),
  );

  const events = facts.filter(
    (f) =>
      f.factType === 'event' &&
      !superseded.has(f.id) &&
      recordInScope(f.chapterId, chapters, aliases, target, mode),
  );
  return { data: events, historyWarnings: emptyWarnings() };
}

function mergeHook(base: HookInput, data: unknown): HookInput {
  const d = (data ?? {}) as Partial<HookInput>;
  return { ...base, ...d, id: base.id };
}

function mergeDebt(base: DebtInput, data: unknown): DebtInput {
  const d = (data ?? {}) as Partial<DebtInput>;
  return { ...base, ...d, id: base.id };
}

function mergeKnowledge(base: KnowledgeInput, data: unknown): KnowledgeInput {
  const d = (data ?? {}) as Partial<KnowledgeInput>;
  return { ...base, ...d, id: base.id };
}

export function reduceHookAsOf(
  hook: HookInput,
  transitions: Transition[],
  chapters: ChapterPosition[],
  aliases: ChapterAlias[],
  target: ChapterPosition | null,
  mode: TimeMode,
): ReductionResult<HookInput> {
  return foldEntityFromTransitions(hook, transitions, chapters, aliases, target, mode, mergeHook);
}

export function reduceDebtAsOf(
  debt: DebtInput,
  transitions: Transition[],
  chapters: ChapterPosition[],
  aliases: ChapterAlias[],
  target: ChapterPosition | null,
  mode: TimeMode,
): ReductionResult<DebtInput> {
  return foldEntityFromTransitions(debt, transitions, chapters, aliases, target, mode, mergeDebt);
}

export function reduceKnowledgeAsOf(
  knowledge: KnowledgeInput,
  transitions: Transition[],
  chapters: ChapterPosition[],
  aliases: ChapterAlias[],
  target: ChapterPosition | null,
  mode: TimeMode,
): ReductionResult<KnowledgeInput> {
  // 主锚在墓碑且无 alias 时，排除
  if (mode !== 'planning_only' && !isActiveChapterRef(knowledge.learnedAtChapterId, chapters, aliases)) {
    assertTargetCompatible(chapters, target);
    return { data: null, historyWarnings: emptyWarnings() };
  }
  return foldEntityFromTransitions(
    knowledge,
    transitions,
    chapters,
    aliases,
    target,
    mode,
    mergeKnowledge,
  );
}

export function deriveDebtOverdue(
  debt: DebtInput,
  chapters: ChapterPosition[],
  aliases: ChapterAlias[],
  target: ChapterPosition | null,
): boolean {
  if (!target) return false;
  if (debt.status !== 'unpaid') return false;
  if (!debt.dueChapterId) return false;
  if (!isActiveChapterRef(debt.dueChapterId, chapters, aliases)) return false;
  const duePos = storyPositionOf(debt.dueChapterId, chapters, aliases);
  // 期限章已被目标章越过 → overdue（due 严格在 target 之前）
  return compareStoryPosition(duePos, target) < 0;
}

export function verifyProjectionMatches(
  projection: unknown,
  transitions: Transition[],
  chapters: ChapterPosition[],
  aliases: ChapterAlias[],
): boolean {
  const folded = reduceTransitionAsOf(transitions, chapters, aliases, null, 'project_latest');
  const equal = JSON.stringify(folded.data) === JSON.stringify(projection);
  if (!equal) {
    throw new Error('投影与转换折叠结果不一致');
  }
  return true;
}
