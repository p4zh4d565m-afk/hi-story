import { describe, expect, it, vi } from 'vitest';
import {
  loadNarrativeAsOfForWrite,
  pickLastActiveChapter,
  shouldBlockWriteWithoutAsOf,
} from '../../src/renderer/services/write-narrative-as-of';
import type { Chapter } from '../../src/renderer/types';

function chapter(partial: Partial<Chapter> & Pick<Chapter, 'id' | 'sortOrder'>): Chapter {
  return {
    projectId: 'p1',
    title: partial.id,
    content: '',
    status: 'draft',
    wordCount: 0,
    summary: '',
    planningOutline: null,
    createdAt: 't',
    updatedAt: 't',
    ...partial,
  };
}

describe('write-narrative-as-of', () => {
  it('按 sortOrder 取活跃末章，不依赖数组顺序', () => {
    const c1 = chapter({ id: 'c1', sortOrder: 0 });
    const c2 = chapter({ id: 'c2', sortOrder: 2 });
    const c3 = chapter({ id: 'c3', sortOrder: 1 });
    expect(pickLastActiveChapter([c2, c1, c3])?.id).toBe('c2');
    expect(pickLastActiveChapter([c1, c3, c2])?.id).toBe('c2');
  });

  it('有章时发送 write + after_chapter + 末章锚点', async () => {
    const invoke = vi.fn(async () => ({
      success: true,
      data: { textBlock: '【叙事时间截面】mode=before_target', mode: 'before_target' },
    }));
    const text = await loadNarrativeAsOfForWrite(invoke, 'p1', [
      chapter({ id: 'old', sortOrder: 0 }),
      chapter({ id: 'new', sortOrder: 1 }),
    ]);
    expect(text).toContain('before_target');
    expect(invoke).toHaveBeenCalledWith('db:narrative:buildAsOfContext', {
      projectId: 'p1',
      taskType: 'write',
      placement: 'after_chapter',
      anchorChapterId: 'new',
    });
  });

  it('A7：IPC success:false 或无 textBlock 返回 null，应阻断生成', async () => {
    const fail = vi.fn(async () => ({ success: false, error: '锚点必须是库内当前活跃末章' }));
    expect(await loadNarrativeAsOfForWrite(fail, 'p1', [chapter({ id: 'c1', sortOrder: 0 })])).toBeNull();
    expect(shouldBlockWriteWithoutAsOf(null)).toBe(true);
    expect(shouldBlockWriteWithoutAsOf('截面')).toBe(false);
  });

  it('无章时只发 write，不挂 placement', async () => {
    const invoke = vi.fn(async () => ({
      success: true,
      data: { textBlock: '【叙事时间截面】write / before_target — 无活跃章节，运行时截面为空。' },
    }));
    await loadNarrativeAsOfForWrite(invoke, 'p1', []);
    expect(invoke).toHaveBeenCalledWith('db:narrative:buildAsOfContext', {
      projectId: 'p1',
      taskType: 'write',
    });
  });
});
