import { describe, it, expect } from 'vitest';
import { buildNarrativeAsOfContext } from '../../src/main/ai/narrative-as-of-context';
import type { ChapterPosition } from '../../src/main/ai/narrative-time-order';
import type { Transition } from '../../src/main/ai/narrative-state-reducer';

function ch(id: string, sortOrder: number | null): ChapterPosition {
  return { id, projectId: 'p1', sortOrder, deletedSortOrder: sortOrder === null ? 0 : null };
}

describe('buildNarrativeAsOfContext', () => {
  const chapters = [ch('c1', 0), ch('c2', 1)];

  it('write 默认 before_target，不含目标章事件', () => {
    const ctx = buildNarrativeAsOfContext({
      taskType: 'write',
      hasActiveChapter: true,
      targetChapterId: 'c2',
      chapters,
      aliases: [],
      transitions: [],
      facts: [
        { id: 'e1', factType: 'event', chapterId: 'c1', stateKey: 'e' },
        { id: 'e2', factType: 'event', chapterId: 'c2', stateKey: 'e' },
      ],
      hooks: [],
      debts: [],
      knowledge: [],
    });
    expect(ctx.mode).toBe('before_target');
    expect(ctx.events.map((e) => e.id)).toEqual(['e1']);
    expect(ctx.textBlock).toContain('before_target');
  });

  it('非法 write+through_target 抛错', () => {
    expect(() =>
      buildNarrativeAsOfContext({
        taskType: 'write',
        hasActiveChapter: true,
        requestedMode: 'through_target',
        targetChapterId: 'c1',
        chapters,
        aliases: [],
        transitions: [],
        facts: [],
        hooks: [],
        debts: [],
        knowledge: [],
      }),
    ).toThrow();
  });

  it('跨项目/已删目标章抛错', () => {
    expect(() =>
      buildNarrativeAsOfContext({
        taskType: 'write',
        hasActiveChapter: true,
        targetChapterId: 'missing',
        chapters,
        aliases: [],
        transitions: [],
        facts: [],
        hooks: [],
        debts: [],
        knowledge: [],
      }),
    ).toThrow();
    expect(() =>
      buildNarrativeAsOfContext({
        taskType: 'write',
        hasActiveChapter: true,
        targetChapterId: 'tomb',
        chapters: [ch('tomb', null)],
        aliases: [],
        transitions: [],
        facts: [],
        hooks: [],
        debts: [],
        knowledge: [],
      }),
    ).toThrow();
  });

  it('planning_only 零运行时', () => {
    const ctx = buildNarrativeAsOfContext({
      taskType: 'planning',
      hasActiveChapter: false,
      targetChapterId: null,
      chapters,
      aliases: [],
      transitions: [] as Transition[],
      facts: [{ id: 'e1', factType: 'event', chapterId: 'c1' }],
      hooks: [{ id: 'h1', chapterId: 'c1', status: 'open' }],
      debts: [],
      knowledge: [],
    });
    expect(ctx.mode).toBe('planning_only');
    expect(ctx.facts).toEqual([]);
    expect(ctx.hooks).toEqual([]);
  });
});
