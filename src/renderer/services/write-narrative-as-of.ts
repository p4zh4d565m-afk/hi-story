/**
 * 写章 as-of 加载：与 Main after_chapter / 空 write 合同对齐。
 * 锚点按 sortOrder（及 id 并列）取活跃末章，避免仅用数组末元素。
 */
import type { Chapter } from '../types';

export type WriteAsOfInvoke = (channel: string, payload: unknown) => Promise<unknown>;

/** 按故事序取活跃末章；空列表返回 null */
export function pickLastActiveChapter(chapters: Chapter[]): Chapter | null {
  const active = chapters.filter((c) => typeof c.sortOrder === 'number');
  if (active.length === 0) return null;
  return active.reduce((best, cur) => {
    if (cur.sortOrder !== best.sortOrder) {
      return cur.sortOrder > best.sortOrder ? cur : best;
    }
    return cur.id > best.id ? cur : best;
  });
}

/**
 * 写「下一新章」截面。失败 / success:false / 无 textBlock → null（调用方须阻断生成）。
 */
export async function loadNarrativeAsOfForWrite(
  invoke: WriteAsOfInvoke,
  projectId: string,
  chapters: Chapter[],
): Promise<string | null> {
  try {
    const last = pickLastActiveChapter(chapters);
    const payload = last
      ? {
          projectId,
          taskType: 'write' as const,
          placement: 'after_chapter' as const,
          anchorChapterId: last.id,
        }
      : {
          projectId,
          taskType: 'write' as const,
        };
    const res = await invoke('db:narrative:buildAsOfContext', payload) as {
      success?: boolean;
      data?: { textBlock?: string };
      error?: string;
    } | null | undefined;
    if (res?.success && res.data?.textBlock) return res.data.textBlock;
    return null;
  } catch {
    return null;
  }
}

/** A7：as-of 未拿到文本则不得继续生成 */
export function shouldBlockWriteWithoutAsOf(asOfText: string | null | undefined): boolean {
  return !asOfText;
}
