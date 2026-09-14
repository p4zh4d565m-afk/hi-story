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
};

export function loadNarrativeAsOfFromDb(
  db: Database.Database,
  input: LoadNarrativeAsOfInput,
): NarrativeAsOfContext {
  if (!input?.projectId) throw new Error('缺少 projectId');
  if (!input?.taskType) throw new Error('缺少 taskType');

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

  return buildNarrativeAsOfContext({
    taskType: input.taskType,
    hasActiveChapter: input.hasActiveChapter ?? !!input.targetChapterId,
    requestedMode: input.requestedMode,
    targetChapterId: input.targetChapterId ?? null,
    chapters,
    aliases,
    transitions,
    facts,
    hooks,
    debts,
    knowledge,
  });
}
