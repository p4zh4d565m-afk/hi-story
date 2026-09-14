import { describe, it, expect } from 'vitest';
import {
  type OutlineIdentity,
  type OutlineDraft,
  type PlanningBinding,
  type BatchRunState,
  sameOutlineIdentity,
  splitOutlineIdentity,
  mapRegeneratedOutlineIds,
  assignChapterOutlineIds,
  findChapterForOutline,
  canRebindPlanningKey,
  replacePlanningBinding,
  resolveObsidianOutlineIdentity,
  invalidateBatchAfterChapter,
} from '../../src/main/ai/narrative-planning-key';

describe('narrative-planning-key', () => {
  // T3
  it('T3 拆章：原 id 保留，新章用预分配 id；sameOutlineIdentity 只比 id', () => {
    const original: OutlineIdentity = {
      id: 'out-1',
      volumeIndex: 0,
      chapterNumber: 1,
      title: '开篇',
    };
    const { original: kept, newChapter } = splitOutlineIdentity(original, 'out-2');
    expect(kept.id).toBe('out-1');
    expect(newChapter.id).toBe('out-2');
    expect(
      sameOutlineIdentity(original, {
        ...original,
        volumeIndex: 9,
        chapterNumber: 99,
        title: '改名',
      }),
    ).toBe(true);
    expect(sameOutlineIdentity(original, { ...original, id: 'other' })).toBe(false);
    expect(() => splitOutlineIdentity(original, 'out-1')).toThrow();
  });

  // T16
  it('T16 批量改前章：之后 pending/running 标 cancelled，清临时产物，done 不变', () => {
    const state: BatchRunState = {
      chapters: [
        { chapterId: 'c0', textHash: 'h0', status: 'done' },
        { chapterId: 'c1', textHash: 'h1', status: 'done' },
        { chapterId: 'c2', textHash: 'h2', status: 'running' },
        { chapterId: 'c3', textHash: 'h3', status: 'pending' },
      ],
      tempSummaries: [
        { forChapterId: 'c1', sourceHash: 'h1', text: 's1' },
        { forChapterId: 'c2', sourceHash: 'h2', text: 's2' },
        { forChapterId: 'c3', sourceHash: 'h3', text: 's3' },
      ],
      unconfirmedProposals: [{ forChapterId: 'c2' }, { forChapterId: 'c3' }],
    };
    const next = invalidateBatchAfterChapter(state, 1);
    expect(next.chapters.map((c) => c.status)).toEqual(['done', 'done', 'cancelled', 'cancelled']);
    expect(next.chapters).toHaveLength(4);
    expect(next.tempSummaries.map((t) => t.forChapterId)).toEqual(['c1']);
    expect(next.unconfirmedProposals).toEqual([]);
  });

  // T22
  it('T22 软删后再创建：tombstoned 拒绝自动重绑，显式 replace 才迁移', () => {
    const existing: PlanningBinding[] = [
      { outlineId: 'out-1', chapterId: 'ch-old', tombstoned: true },
    ];
    expect(canRebindPlanningKey(existing, 'out-1')).toBe(false);
    expect(canRebindPlanningKey(existing, 'out-new')).toBe(true);
    const replaced = replacePlanningBinding(existing, 'out-1', 'ch-new');
    expect(replaced).toEqual([
      { outlineId: 'out-1', chapterId: 'ch-new', tombstoned: false },
    ]);
  });

  // T23
  it('T23 Obsidian 无 explicitId 不因 pathHash 继承旧 key', () => {
    expect(resolveObsidianOutlineIdentity({ pathHash: 'abc' })).toEqual({
      id: null,
      reason: 'no-key',
    });
    expect(resolveObsidianOutlineIdentity({ explicitId: 'k1', pathHash: 'abc' })).toEqual({
      id: 'k1',
      reason: 'explicit',
    });
  });

  // T31
  it('T31 mapRegeneratedOutlineIds 校验与合法映射', () => {
    const oldOnes: OutlineIdentity[] = [
      { id: 'a', volumeIndex: 0, chapterNumber: 1, title: 'A' },
      { id: 'b', volumeIndex: 0, chapterNumber: 2, title: 'B' },
    ];
    const newOnes: OutlineDraft[] = [
      { volumeIndex: 0, chapterNumber: 1, title: 'A2' },
      { volumeIndex: 0, chapterNumber: 2, title: 'B2' },
      { volumeIndex: 0, chapterNumber: 3, title: 'C2' },
    ];

    // (a) oldId 不存在
    expect(() =>
      mapRegeneratedOutlineIds(oldOnes, newOnes, [{ oldId: 'missing', newIndex: 0 }], { 2: 'c-new' }),
    ).toThrow();
    // (b) oldId 重复
    expect(() =>
      mapRegeneratedOutlineIds(
        oldOnes,
        newOnes,
        [
          { oldId: 'a', newIndex: 0 },
          { oldId: 'a', newIndex: 1 },
        ],
        { 2: 'c-new' },
      ),
    ).toThrow();
    // (c) newIndex 重复
    expect(() =>
      mapRegeneratedOutlineIds(
        oldOnes,
        newOnes,
        [
          { oldId: 'a', newIndex: 0 },
          { oldId: 'b', newIndex: 0 },
        ],
        { 2: 'c-new' },
      ),
    ).toThrow();
    // (d) newIndex / freshIds 越界
    expect(() =>
      mapRegeneratedOutlineIds(oldOnes, newOnes, [{ oldId: 'a', newIndex: 9 }], { 2: 'c-new' }),
    ).toThrow();
    expect(() =>
      mapRegeneratedOutlineIds(oldOnes, newOnes, [{ oldId: 'a', newIndex: 0 }], { 9: 'x' }),
    ).toThrow();
    // (e) mapping 与 freshIds index 冲突
    expect(() =>
      mapRegeneratedOutlineIds(
        oldOnes,
        newOnes,
        [{ oldId: 'a', newIndex: 0 }],
        { 0: 'conflict', 2: 'c-new' },
      ),
    ).toThrow();
    // (f) 两个不同 fresh index 使用同一新 ID
    expect(() =>
      mapRegeneratedOutlineIds(oldOnes, newOnes, [], { 0: 'same', 1: 'same', 2: 'c' }),
    ).toThrow();
    // (g) fresh 新 ID 与 mapping 复用的旧 ID 相同
    expect(() =>
      mapRegeneratedOutlineIds(
        oldOnes,
        newOnes,
        [{ oldId: 'a', newIndex: 0 }],
        { 2: 'a' },
      ),
    ).toThrow();

    // 合法路径
    const result = mapRegeneratedOutlineIds(
      oldOnes,
      newOnes,
      [
        { oldId: 'a', newIndex: 0 },
        { oldId: 'b', newIndex: 1 },
      ],
      { 2: 'c-new' },
    );
    expect(result.map((r) => r.id)).toEqual(['a', 'b', 'c-new']);
    expect(new Set(result.map((r) => r.id)).size).toBe(3);
    expect(result[2]).toEqual({
      id: 'c-new',
      volumeIndex: 0,
      chapterNumber: 3,
      title: 'C2',
    });
  });

  it('assignChapterOutlineIds 保留已有 id、为缺 id 项分配，并拒绝重复', () => {
    const allocated: string[] = [];
    const result = assignChapterOutlineIds(
      [{ id: 'keep', volumeIndex: 0 }, { volumeIndex: 0 }],
      () => {
        allocated.push('fresh');
        return 'fresh';
      },
    );
    expect(result.map((x) => x.id)).toEqual(['keep', 'fresh']);
    expect(allocated).toEqual(['fresh']);
    expect(() => assignChapterOutlineIds(
      [{ id: 'dup' }, { id: 'dup' }],
      () => 'x',
    )).toThrow('章纲 id 重复');
  });

  it('findChapterForOutline 优先 planningOutlineId，否则回退卷号+章节号', () => {
    const chapters = [
      { id: 'ch-old', planningOutlineId: null, planningOutline: { volumeIndex: 0, chapterNumber: 1 } },
      { id: 'ch-new', planningOutlineId: 'out-9', planningOutline: { volumeIndex: 0, chapterNumber: 2 } },
    ];
    expect(findChapterForOutline(chapters, { id: 'out-9', volumeIndex: 0, chapterNumber: 99 })?.id).toBe('ch-new');
    expect(findChapterForOutline(chapters, { volumeIndex: 0, chapterNumber: 1 })?.id).toBe('ch-old');
  });
});
