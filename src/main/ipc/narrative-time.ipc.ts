/**
 * 叙事时间截面 IPC：按 taskType 固定模式折叠，渲染端不得自选任意截面。
 */
import { ipcMain } from 'electron';
import type { IpcResult } from '../../renderer/types';
import { getDb } from '../db/connection';
import { ChapterRepo } from '../db/repositories/chapter.repo';
import { StoryFactsRepo } from '../db/repositories/story-facts.repo';
import { NarrativeTransitionRepo } from '../db/repositories/narrative-transition.repo';
import { buildNarrativeAsOfContext } from '../ai/narrative-as-of-context';
import type {
  TaskType,
  FactInput,
  HookInput,
  DebtInput,
  KnowledgeInput,
  TimeMode,
} from '../ai/narrative-state-reducer';
import type { ChapterPosition } from '../ai/narrative-time-order';

export type BuildAsOfContextInput = {
  projectId: string;
  taskType: TaskType;
  targetChapterId?: string | null;
  hasActiveChapter?: boolean;
  /** 仅当与 taskType 合法组合时允许；否则由 Main 校验抛错 */
  requestedMode?: TimeMode;
};

export function registerNarrativeTimeIpc(): void {
  ipcMain.handle(
    'db:narrative:buildAsOfContext',
    (_e, input: BuildAsOfContextInput): IpcResult<{
      mode: string;
      textBlock: string;
      historyWarningCount: number;
    }> => {
      try {
        if (!input?.projectId) throw new Error('缺少 projectId');
        if (!input?.taskType) throw new Error('缺少 taskType');

        const db = getDb();
        const chapterRepo = new ChapterRepo(db);
        const factsRepo = new StoryFactsRepo(db);
        const transitionsRepo = new NarrativeTransitionRepo(db);

        const active = chapterRepo.findByProject(input.projectId);
        if (!active.success) throw new Error(active.error || '章节读取失败');

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

        const aliases = transitionsRepo.listAliases(input.projectId);
        const transitions = transitionsRepo.listByProject(input.projectId);

        const factsRes = factsRepo.findActiveByProject(input.projectId);
        if (!factsRes.success || !factsRes.data) throw new Error(factsRes.error || '事实读取失败');
        const facts: FactInput[] = factsRes.data
          .filter((f) => f.chapterId)
          .map((f) => ({
            id: f.id,
            factType: f.factType,
            chapterId: f.chapterId as string,
            object: f.object,
            status: f.status,
          }));

        const knowledgeRes = factsRepo.findAllKnowledgeByProject(input.projectId);
        const knowledge: KnowledgeInput[] = (knowledgeRes.data ?? [])
          .filter((k) => k.learnedAtChapterId)
          .map((k) => ({
            id: k.id,
            learnedAtChapterId: k.learnedAtChapterId as string,
            status: k.status,
          }));

        const hookRows = db.prepare(`
          SELECT id, chapter_id, status, description, due_chapter_id, resolved_in_chapter_id
          FROM narrative_hooks WHERE project_id = ?
        `).all(input.projectId) as Array<Record<string, unknown>>;
        const hooks: HookInput[] = hookRows
          .filter((r) => r.chapter_id)
          .map((r) => ({
            id: r.id as string,
            chapterId: r.chapter_id as string,
            status: r.status as string,
            description: r.description as string | undefined,
            dueChapterId: (r.due_chapter_id as string | null) ?? null,
            resolvedInChapterId: (r.resolved_in_chapter_id as string | null) ?? null,
          }));

        const debtRows = db.prepare(`
          SELECT id, chapter_id, status, paid_in_chapter_id, promised_by_chapter
          FROM narrative_debts WHERE project_id = ?
        `).all(input.projectId) as Array<Record<string, unknown>>;
        const debts: DebtInput[] = debtRows
          .filter((r) => r.chapter_id)
          .map((r) => ({
            id: r.id as string,
            chapterId: r.chapter_id as string,
            status: r.status as string,
            paidInChapterId: (r.paid_in_chapter_id as string | null) ?? null,
            promisedByChapter: (r.promised_by_chapter as number | null) ?? undefined,
          }));

        const hasActive = input.hasActiveChapter ?? !!input.targetChapterId;
        const ctx = buildNarrativeAsOfContext({
          taskType: input.taskType,
          hasActiveChapter: hasActive,
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

        if (ctx.historyWarnings.length > 0) {
          console.warn(
            `[narrative-as-of] project=${input.projectId} warnings=${ctx.historyWarnings.length}`,
          );
        }

        return {
          success: true,
          data: {
            mode: ctx.mode,
            textBlock: ctx.textBlock,
            historyWarningCount: ctx.historyWarnings.length,
          },
        };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );
}
