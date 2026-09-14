import { describe, it, expect } from 'vitest';
import {
  type ChapterPosition,
  type ChapterAlias,
  compareStoryPosition,
  chaptersBefore,
  normalizeChapterOrder,
  deleteChapter,
  restoreChapter,
  mergeChapters,
  resolveChapterId,
  resolveTransitionOrdinal,
} from '../../src/main/ai/narrative-time-order';

function ch(
  id: string,
  sortOrder: number | null,
  opts: { projectId?: string; deletedSortOrder?: number | null } = {},
): ChapterPosition {
  return {
    id,
    projectId: opts.projectId ?? 'p1',
    sortOrder,
    deletedSortOrder: opts.deletedSortOrder ?? null,
  };
}

describe('narrative-time-order', () => {
  // T1 插章：在 c20 前插 c20b → normalize 得 c19→0, c20b→1, c20→2；c20.id 不变
  it('T1 插章后 normalize 连续且原章 id 不变', () => {
    const afterInsert = [
      ch('c19', 19),
      ch('c20b', 20), // 插在原 c20 位置
      ch('c20', 21),  // 原 c20 后移，id 不变
    ];
    const normalized = normalizeChapterOrder(afterInsert);
    expect(normalized.filter((c) => c.sortOrder !== null).map((c) => ({ id: c.id, sortOrder: c.sortOrder }))).toEqual([
      { id: 'c19', sortOrder: 0 },
      { id: 'c20b', sortOrder: 1 },
      { id: 'c20', sortOrder: 2 },
    ]);
    expect(normalized.find((c) => c.id === 'c20')!.id).toBe('c20');
  });

  // T2 移章
  it('T2 移章后 compareStoryPosition 反映新顺序且 id 不变', () => {
    const c30 = ch('c30', 0);
    const c50 = ch('c50', 1); // 移到 c30 后
    expect(compareStoryPosition(c30, c50)).toBeLessThan(0);
    expect(c50.id).toBe('c50');
  });

  // T4 并章
  it('T4 并章：墓碑 + alias + ordinalOffset；七类非法输入抛错', () => {
    const chapters = [
      ch('surv', 0),
      ch('merged', 1),
      ch('other', 2),
    ];
    const aliases: ChapterAlias[] = [];
    const result = mergeChapters(chapters, aliases, 'surv', 'merged', 10);

    const mergedPos = result.chapters.find((c) => c.id === 'merged')!;
    expect(mergedPos.sortOrder).toBeNull();
    expect(mergedPos.deletedSortOrder).toBe(1);

    expect(result.aliases).toEqual([{ from: 'merged', to: 'surv', ordinalOffset: 10 }]);
    expect(resolveChapterId('merged', result.aliases)).toBe('surv');
    expect(resolveTransitionOrdinal('merged', 0, result.aliases)).toBe(10);

    // 1 self-alias
    expect(() => mergeChapters(chapters, [], 'surv', 'surv', 0)).toThrow();
    // 2 跨项目
    expect(() =>
      mergeChapters(
        [ch('surv', 0), ch('merged', 1, { projectId: 'p2' })],
        [],
        'surv',
        'merged',
        0,
      ),
    ).toThrow();
    // 3 源/目标不存在
    expect(() => mergeChapters(chapters, [], 'surv', 'missing', 0)).toThrow();
    expect(() => mergeChapters(chapters, [], 'missing', 'merged', 0)).toThrow();
    // 4 源/目标已软删
    const withTomb = [ch('surv', 0), ch('merged', null, { deletedSortOrder: 1 })];
    expect(() => mergeChapters(withTomb, [], 'surv', 'merged', 0)).toThrow();
    expect(() => mergeChapters([ch('surv', null, { deletedSortOrder: 0 }), ch('merged', 1)], [], 'surv', 'merged', 0)).toThrow();
    // 5 重复 from
    expect(() =>
      mergeChapters(chapters, [{ from: 'merged', to: 'surv', ordinalOffset: 1 }], 'surv', 'merged', 0),
    ).toThrow();
    // 6 循环：surv 最终归属是 merged
    expect(() =>
      mergeChapters(
        [ch('surv', 0), ch('merged', 1), ch('mid', 2)],
        [{ from: 'surv', to: 'merged', ordinalOffset: 1 }],
        'surv',
        'merged',
        0,
      ),
    ).toThrow();
    // 7 非法 offset
    expect(() => mergeChapters(chapters, [], 'surv', 'merged', -1)).toThrow();
  });

  // T5 重写早期章：只由 (sortOrder,id) 决定
  it('T5 compareStoryPosition 只由 sortOrder 与 id 决定', () => {
    const a = ch('early', 0);
    const b = ch('late', 5);
    expect(compareStoryPosition(a, b)).toBeLessThan(0);
    expect(compareStoryPosition(b, a)).toBeGreaterThan(0);
    expect(compareStoryPosition(a, { ...a })).toBe(0);
  });

  // T11 并列
  it('T11 同 sortOrder 按 id 字符串序稳定全序', () => {
    const a = ch('a', 5);
    const b = ch('b', 5);
    expect(compareStoryPosition(a, b)).toBeLessThan(0);
    expect(compareStoryPosition(b, a)).toBeGreaterThan(0);
    expect(compareStoryPosition(a, b)).toBe(compareStoryPosition(a, b));
  });

  // T21 软删恢复
  it('T21 删中间章后活跃序连续，恢复到 min(deletedSortOrder, activeCount)', () => {
    const chapters = [ch('c0', 0), ch('c1', 1), ch('c2', 2)];
    const afterDelete = deleteChapter(chapters, 'c1');
    const active = afterDelete.filter((c) => c.sortOrder !== null);
    expect(active.map((c) => c.sortOrder)).toEqual([0, 1]);
    expect(active.map((c) => c.id)).toEqual(['c0', 'c2']);
    const tomb = afterDelete.find((c) => c.id === 'c1')!;
    expect(tomb.sortOrder).toBeNull();
    expect(tomb.deletedSortOrder).toBe(1);

    const restored = restoreChapter(afterDelete, 'c1');
    expect(restored.find((c) => c.id === 'c1')!.sortOrder).toBe(1);
    expect(normalizeChapterOrder(restored).filter((c) => c.sortOrder !== null).map((c) => c.sortOrder)).toEqual([0, 1, 2]);
  });

  it('跨项目 compareStoryPosition 抛错', () => {
    expect(() => compareStoryPosition(ch('a', 0), ch('b', 1, { projectId: 'p2' }))).toThrow();
  });

  it('resolveChapterId / resolveTransitionOrdinal 链式累加与环检测', () => {
    const aliases: ChapterAlias[] = [
      { from: 'A', to: 'B', ordinalOffset: 10 },
      { from: 'B', to: 'C', ordinalOffset: 20 },
    ];
    expect(resolveChapterId('A', aliases)).toBe('C');
    expect(resolveTransitionOrdinal('A', 5, aliases)).toBe(35);
    expect(() =>
      resolveChapterId('X', [
        { from: 'X', to: 'Y', ordinalOffset: 1 },
        { from: 'Y', to: 'X', ordinalOffset: 1 },
      ]),
    ).toThrow();
  });

  it('chaptersBefore 只返回故事位置更早的活跃章', () => {
    const chapters = [ch('a', 0), ch('b', 1), ch('c', 2), ch('tomb', null, { deletedSortOrder: 1 })];
    const before = chaptersBefore(chapters, ch('c', 2));
    expect(before.map((x) => x.id)).toEqual(['a', 'b']);
  });
});
