// 章节删除 / 撤销 / 重做的双层守卫编排（纯逻辑，可单测）。
// 依赖注入 invoke 与项目选择守卫，把竞态逻辑从 App.tsx 抽出，让单测与生产共用同一份实现。
import type { Chapter } from '../types';

/** 项目选择 ticket（与 project-data-loader 的 ProjectSelectionTicket 结构一致） */
export interface ProjectSelectionTicket {
  projectId: string | null;
  generation: number;
}

export type InvokeFn = (channel: string, ...args: unknown[]) => Promise<unknown>;

interface IpcArrayResult {
  success?: boolean;
  data?: unknown;
  error?: string;
}

function isChapterArray(data: unknown): data is Chapter[] {
  return Array.isArray(data);
}

/**
 * 统一修正活动章：当前活动章 id 不在返回的完整列表里（已被删），就落到第一章；
 * 列表为空则置 null。所有「应用完整章节列表」都必须走这里，
 * 否则撤销后重做删除活动章会留下悬空的 activeChapterId。
 */
export function fixActiveChapterId(activeId: string | null, chapters: Chapter[]): string | null {
  if (activeId !== null && chapters.some(c => c.id === activeId)) return activeId;
  return chapters[0]?.id ?? null;
}

export interface ChapterDeletionDeps {
  invoke: InvokeFn;
  /** 捕获当前项目选择 ticket（含 generation） */
  snapshotSelection: () => ProjectSelectionTicket;
  /** 校验 ticket 是否仍是最新选择（项目 id + generation 都匹配） */
  isSelectionCurrent: (ticket: ProjectSelectionTicket) => boolean;
  /** 应用完整章节列表（调用方负责同步修正活动章） */
  applyChapters: (chapters: Chapter[]) => void;
  /** 删除失败等需要提示用户时调用 */
  alert: (message: string) => void;
}

export interface ChapterDeletion {
  /** 删除章节；DB 成功后返回 true（调用方据此无条件 pushUndo），失败返回 false */
  deleteChapter: (chapter: Chapter) => Promise<boolean>;
  /** 撤销命令（恢复章节）。每次执行重新捕获 ticket，不复用删除时 ticket */
  buildUndo: (chapter: Chapter) => () => Promise<void>;
  /** 重做命令（再次删除章节）。每次执行重新捕获 ticket */
  buildRedo: (chapter: Chapter) => () => Promise<void>;
}

export function createChapterDeletion(deps: ChapterDeletionDeps): ChapterDeletion {
  // 同项目操作序号：阻止同一项目内并发删除/撤销/重做的旧回执覆盖新列表。
  // 项目选择 ticket 只防「跨项目」乱序（A→B→A），防不了「同项目」乱序。
  const opSeq: Record<string, number> = {};

  const nextOpSeq = (projectId: string): number => {
    const next = (opSeq[projectId] ?? 0) + 1;
    opSeq[projectId] = next;
    return next;
  };
  const isOpCurrent = (projectId: string, seq: number): boolean => opSeq[projectId] === seq;

  const deleteChapter = async (chapter: Chapter): Promise<boolean> => {
    const ticket = deps.snapshotSelection();
    if (!ticket.projectId) return false;
    const seq = nextOpSeq(ticket.projectId);
    const res = await deps.invoke('db:chapter:remove', chapter.id) as IpcArrayResult;
    if (!res?.success || !isChapterArray(res.data)) {
      deps.alert('删除失败：' + (res?.error || '未知错误'));
      return false;
    }
    // DB 已删除成功：无论 UI 回执是否 stale，都返回 true，让调用方无条件 pushUndo。
    // UI 应用受「项目选择 ticket + 同项目序号」双层守卫，避免旧回执污染。
    if (deps.isSelectionCurrent(ticket) && isOpCurrent(ticket.projectId, seq)) {
      deps.applyChapters(res.data);
    }
    return true;
  };

  const buildUndo = (chapter: Chapter) => async () => {
    // 每次执行重新捕获 ticket，不复用删除时的 ticket；并核对当前项目与章节所属项目。
    const ticket = deps.snapshotSelection();
    const projectId = ticket.projectId;
    const matches = projectId === chapter.projectId;
    const seq = matches && projectId ? nextOpSeq(projectId) : 0;
    const r = await deps.invoke('db:chapter:restore', chapter) as IpcArrayResult;
    if (!r?.success || !isChapterArray(r.data)) {
      throw new Error(r?.error || '恢复失败');
    }
    // 当前项目不匹配时只恢复 DB、不碰当前 UI（UI 属于别的项目）。
    if (matches && projectId && deps.isSelectionCurrent(ticket) && isOpCurrent(projectId, seq)) {
      deps.applyChapters(r.data);
    }
  };

  const buildRedo = (chapter: Chapter) => async () => {
    const ticket = deps.snapshotSelection();
    const projectId = ticket.projectId;
    const matches = projectId === chapter.projectId;
    const seq = matches && projectId ? nextOpSeq(projectId) : 0;
    const r = await deps.invoke('db:chapter:remove', chapter.id) as IpcArrayResult;
    if (!r?.success || !isChapterArray(r.data)) {
      throw new Error(r?.error || '重做失败');
    }
    if (matches && projectId && deps.isSelectionCurrent(ticket) && isOpCurrent(projectId, seq)) {
      deps.applyChapters(r.data);
    }
  };

  return { deleteChapter, buildUndo, buildRedo };
}
