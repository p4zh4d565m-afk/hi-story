/**
 * 从 SQLite 组装叙事 as-of 截面（供 IPC 与 DB 回归共用）。
 * 读取含 superseded 的历史投影，折叠结果输出业务内容。
 */
import type Database from 'better-sqlite3';
import { buildNarrativeAsOfContext, type NarrativeAsOfContext } from './narrative-as-of-context';
import type {
  TaskType,
  TimeMode,
  FactInput,
  HookInput,
  DebtInput,
  KnowledgeInput,
} from './narrative-state-reducer';
import type { ChapterPosition } from './narrative-time-order';
import { compareStoryPosition } from './narrative-time-order';
import {
  NarrativeTransitionRepo,
  rowToFactInput,
  rowToKnowledgeInput,
  rowToHookInput,
  rowToDebtInput,
} from '../db/repositories/narrative-transition.repo';

export type LoadNarrativeAsOfInput = {
  projectId: string;
  taskType: TaskType;
  targetChapterId?: string | null;
  hasActiveChapter?: boolean;
  requestedMode?: TimeMode;
  /** 写「末章之后新章」时传 after_chapter；已有目标章可省略或 at_chapter */
  placement?: 'at_chapter' | 'after_chapter' | null;
  /** after_chapter 时必填，且必须是库内当前活跃末章 */
  anchorChapterId?: string | null;
};

/** 虚拟下一新章 id 前缀（故事位置严格在锚点之后） */
export const WRITE_AFTER_VIRTUAL_PREFIX = '__write_after__:';

function isNonEmptyId(id: string | null | undefined): id is string {
  return typeof id === 'string' && id.length > 0;
}

/** 活跃章中故事序最后一章；无活跃章返回 null */
function findLastActiveChapter(chapters: ChapterPosition[]): ChapterPosition | null {
  const active = chapters.filter((c) => c.sortOrder !== null);
  if (active.length === 0) return null;
  return active.reduce((best, c) => (compareStoryPosition(c, best) > 0 ? c : best));
}

function emptyWriteBeforeTargetContext(): NarrativeAsOfContext {
  return {
    mode: 'before_target',
    target: null,
    facts: [],
    events: [],
    hooks: [],
    debts: [],
    knowledge: [],
    historyWarnings: [],
    textBlock: '【叙事时间截面】write / before_target — 无活跃章节，运行时截面为空。',
  };
}

function annotateAfterChapter(textBlock: string, anchorChapterId: string): string {
  return `${textBlock}\nplacement=after_chapter anchor=${anchorChapterId}`;
}

export function loadNarrativeAsOfFromDb(
  db: Database.Database,
  input: LoadNarrativeAsOfInput,
): NarrativeAsOfContext {
  if (!input?.projectId) throw new Error('缺少 projectId');
  if (!input?.taskType) throw new Error('缺少 taskType');

  if (input.placement === 'after_chapter' && input.taskType !== 'write') {
    throw new Error('placement=after_chapter 仅可用于写章');
  }

  const allRows = db.prepare(`
    SELECT id, project_id, sort_order, deleted_sort_order, deleted_at
    FROM chapters WHERE project_id = ?
  `).all(input.projectId) as Array<{
    id: string;
    project_id: string;
    sort_order: number | null;
    deleted_sort_order: number | null;
    deleted_at: string | null;
  }>;

  const chapters: ChapterPosition[] = allRows.map((r) => ({
    id: r.id,
    projectId: r.project_id,
    sortOrder: r.deleted_at ? null : r.sort_order,
    deletedSortOrder: r.deleted_sort_order,
  }));

  const lastActive = findLastActiveChapter(chapters);

  // 无活跃章的写章：正式 before_target 空运行时，不改走 planning
  if (
    input.taskType === 'write' &&
    input.placement !== 'after_chapter' &&
    !lastActive &&
    !isNonEmptyId(input.targetChapterId)
  ) {
    return emptyWriteBeforeTargetContext();
  }

  let chaptersForFold = chapters;
  let targetChapterId = input.targetChapterId ?? null;
  let hasActiveChapter = input.hasActiveChapter ?? !!input.targetChapterId;
  let requestedMode = input.requestedMode;
  let afterAnchorId: string | null = null;

  if (input.taskType === 'write' && input.placement === 'after_chapter') {
    if (isNonEmptyId(input.targetChapterId)) {
      throw new Error('after_chapter 不得同时传入 targetChapterId');
    }
    if (!isNonEmptyId(input.anchorChapterId)) {
      throw new Error('after_chapter 需要 anchorChapterId');
    }
    const anchorId = input.anchorChapterId;
    const anchor = chapters.find((c) => c.id === anchorId);
    if (!anchor) {
      throw new Error(`锚点章不存在或不属于本项目: ${anchorId}`);
    }
    if (anchor.sortOrder === null) {
      throw new Error(`锚点章已删除: ${anchorId}`);
    }
    if (!lastActive || lastActive.id !== anchorId) {
      throw new Error('锚点必须是库内当前活跃末章，请重新拉取章节后再写');
    }
    // Main 推导 hasActiveChapter=true；显式传入且与推导矛盾则拒绝
    if (input.hasActiveChapter !== undefined && input.hasActiveChapter !== true) {
      throw new Error('after_chapter 的 hasActiveChapter 必须为 true（或由 Main 推导）');
    }
    if (input.requestedMode !== undefined && input.requestedMode !== 'before_target') {
      throw new Error('after_chapter 仅允许 before_target');
    }

    const virtual: ChapterPosition = {
      id: `${WRITE_AFTER_VIRTUAL_PREFIX}${anchorId}`,
      projectId: input.projectId,
      sortOrder: (anchor.sortOrder as number) + 1,
      deletedSortOrder: null,
    };
    chaptersForFold = [...chapters, virtual];
    targetChapterId = virtual.id;
    hasActiveChapter = true;
    requestedMode = undefined; // 走 write 默认 before_target
    afterAnchorId = anchorId;
  }

  const transitionsRepo = new NarrativeTransitionRepo(db);
  const aliases = transitionsRepo.listAliases(input.projectId);
  const transitions = transitionsRepo.listByProject(input.projectId);

  const factRows = db.prepare(`
    SELECT * FROM story_facts
    WHERE project_id = ? AND archived = 0
  `).all(input.projectId) as Array<Record<string, unknown>>;
  const facts: FactInput[] = factRows.map((r) => rowToFactInput(r));

  const knowledgeRows = db.prepare(`
    SELECT * FROM character_knowledge WHERE project_id = ?
  `).all(input.projectId) as Array<Record<string, unknown>>;
  const knowledge: KnowledgeInput[] = knowledgeRows.map((r) => rowToKnowledgeInput(r));

  const hookRows = db.prepare(`
    SELECT id, chapter_id, status, description, subject, due_chapter_id, resolved_in_chapter_id
    FROM narrative_hooks WHERE project_id = ?
  `).all(input.projectId) as Array<Record<string, unknown>>;
  const hooks: HookInput[] = hookRows.map((r) => rowToHookInput(r));

  const debtRows = db.prepare(`
    SELECT id, chapter_id, status, description, subject, paid_in_chapter_id, promised_by_chapter
    FROM narrative_debts WHERE project_id = ?
  `).all(input.projectId) as Array<Record<string, unknown>>;
  const debts: DebtInput[] = debtRows.map((r) => rowToDebtInput(r));

  const ctx = buildNarrativeAsOfContext({
    taskType: input.taskType,
    hasActiveChapter,
    requestedMode,
    targetChapterId,
    chapters: chaptersForFold,
    aliases,
    transitions,
    facts,
    hooks,
    debts,
    knowledge,
  });

  if (afterAnchorId) {
    return {
      ...ctx,
      textBlock: annotateAfterChapter(ctx.textBlock, afterAnchorId),
    };
  }
  return ctx;
}
