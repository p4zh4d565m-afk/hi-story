import { describe, it, expect } from 'vitest';
import {
  type ChapterPosition,
  type ChapterAlias,
  mergeChapters,
  resolveTransitionOrdinal,
} from '../../src/main/ai/narrative-time-order';
import {
  type Transition,
  type FactInput,
  type HookInput,
  type DebtInput,
  type KnowledgeInput,
  resolveTimeMode,
  validateTaskTimeMode,
  defaultOrdinalForAppend,
  storyPositionOf,
  compareTransition,
  reduceStateFactsAsOf,
  accumulateEventsAsOf,
  reduceHookAsOf,
  reduceDebtAsOf,
  reduceKnowledgeAsOf,
  deriveDebtOverdue,
  deriveStateKey,
  verifyProjectionMatches,
  canAutoExtractOverwrite,
} from '../../src/main/ai/narrative-state-reducer';

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

function snap(data: unknown, schemaVersion = 1): Transition['afterSnapshot'] {
  return { schemaVersion, data };
}

function tr(
  partial: Omit<Transition, 'afterSnapshot' | 'seq' | 'atChapterOrdinal'> & {
    afterSnapshot?: Transition['afterSnapshot'];
    seq?: number;
    atChapterOrdinal?: number;
  },
): Transition {
  return {
    atChapterOrdinal: 0,
    seq: 0,
    afterSnapshot: snap({}),
    ...partial,
  };
}

describe('narrative-state-reducer', () => {
  const baseChapters = [
    ch('ch50', 0),
    ch('ch60', 1),
    ch('ch70', 2),
    ch('ch75', 3),
    ch('ch80', 4),
    ch('ch85', 5),
    ch('ch90', 6),
  ];

  // —— M1–M7 ——
  it('M1 write → before_target', () => {
    expect(resolveTimeMode('write', { hasActiveChapter: true })).toBe('before_target');
  });
  it('M2 review → before_target', () => {
    expect(resolveTimeMode('review', { hasActiveChapter: true })).toBe('before_target');
  });
  it('M3 chat 无活动章 → project_latest', () => {
    expect(resolveTimeMode('chat', { hasActiveChapter: false })).toBe('project_latest');
  });
  it('M4 chat 有活动章 → through_target', () => {
    expect(resolveTimeMode('chat', { hasActiveChapter: true })).toBe('through_target');
  });
  it('M5 planning → planning_only', () => {
    expect(resolveTimeMode('planning', { hasActiveChapter: false })).toBe('planning_only');
  });
  it('M6 validateTaskTimeMode 非法组合抛错、合法通过', () => {
    expect(() => validateTaskTimeMode('write', 'through_target')).toThrow();
    expect(validateTaskTimeMode('chat', 'project_latest')).toBe('project_latest');
  });

  // —— T13 ——
  it('T13 写入守卫', () => {
    expect(canAutoExtractOverwrite({ sourceDecisionId: 'd1' })).toBe(false);
    expect(canAutoExtractOverwrite({ sourceDecisionId: null })).toBe(true);
  });

  // —— T24a–d ——
  it('T24a location：object 不同但 key 相同', () => {
    const a = deriveStateKey({ factType: 'location', subject: '张三', predicate: 'at', object: '北京' });
    const b = deriveStateKey({ factType: 'location', subject: '张三', predicate: 'at', object: '上海' });
    expect(a.key).toBe(b.key);
    expect(a.version).toBeTypeOf('number');
  });
  it('T24b possession：object 不同则 key 不同', () => {
    const a = deriveStateKey({ factType: 'possession', subject: '张三', predicate: 'has', object: '剑' });
    const b = deriveStateKey({ factType: 'possession', subject: '张三', predicate: 'has', object: '刀' });
    expect(a.key).not.toBe(b.key);
  });
  it('T24c relationship：有向区分方向，无向排序双方', () => {
    const ab = deriveStateKey({
      factType: 'relationship', subject: 'A', predicate: 'loves', object: 'B', directed: true,
    });
    const ba = deriveStateKey({
      factType: 'relationship', subject: 'B', predicate: 'loves', object: 'A', directed: true,
    });
    expect(ab.key).not.toBe(ba.key);
    const u1 = deriveStateKey({
      factType: 'relationship', subject: 'A', predicate: 'friends', object: 'B', directed: false,
    });
    const u2 = deriveStateKey({
      factType: 'relationship', subject: 'B', predicate: 'friends', object: 'A', directed: false,
    });
    expect(u1.key).toBe(u2.key);
  });
  it('T24d emotional_state：object 不同但 key 相同', () => {
    const a = deriveStateKey({ factType: 'emotional_state', subject: '张三', predicate: 'mood', object: '愤怒' });
    const b = deriveStateKey({ factType: 'emotional_state', subject: '张三', predicate: 'mood', object: '平静' });
    expect(a.key).toBe(b.key);
  });

  // —— T6 ——
  it('T6 planning_only 零运行时', () => {
    const facts: FactInput[] = [{ id: 'f1', factType: 'event', chapterId: 'ch50', stateKey: 'e1' }];
    expect(reduceStateFactsAsOf(facts, [], baseChapters, [], null, 'planning_only')).toEqual({
      data: [],
      historyWarnings: [],
    });
    const hook: HookInput = { id: 'h1', chapterId: 'ch50', status: 'open', description: 'x' };
    expect(reduceHookAsOf(hook, [], baseChapters, [], null, 'planning_only')).toEqual({
      data: null,
      historyWarnings: [],
    });
  });

  // —— T7 ——
  it('T7 回看关闭钩子仍 open', () => {
    const hook: HookInput = {
      id: 'h1', chapterId: 'ch50', status: 'resolved', description: 'final',
      resolvedInChapterId: 'ch80',
    };
    const transitions: Transition[] = [
      tr({
        targetId: 'h1', kind: 'created', atChapterId: 'ch50', seq: 0,
        afterSnapshot: snap({ status: 'open', description: 'seed', chapterId: 'ch50' }),
      }),
      tr({
        targetId: 'h1', kind: 'resolved', atChapterId: 'ch80', seq: 0,
        afterSnapshot: snap({ status: 'resolved', description: 'final', chapterId: 'ch50', resolvedInChapterId: 'ch80' }),
      }),
    ];
    const r = reduceHookAsOf(hook, transitions, baseChapters, [], ch('ch50', 0), 'through_target');
    expect(r.data?.status).toBe('open');
  });

  // —— T8 ——
  it('T8 回看偿债仍 unpaid', () => {
    const debt: DebtInput = {
      id: 'd1', chapterId: 'ch50', status: 'paid', paidInChapterId: 'ch90',
    };
    const transitions: Transition[] = [
      tr({
        targetId: 'd1', kind: 'created', atChapterId: 'ch50',
        afterSnapshot: snap({ status: 'unpaid', chapterId: 'ch50' }),
      }),
      tr({
        targetId: 'd1', kind: 'paid', atChapterId: 'ch90',
        afterSnapshot: snap({ status: 'paid', chapterId: 'ch50', paidInChapterId: 'ch90' }),
      }),
    ];
    const r = reduceDebtAsOf(debt, transitions, baseChapters, [], ch('ch60', 1), 'through_target');
    expect(r.data?.status).toBe('unpaid');
  });

  // —— T9 ——
  it('T9 partially 后再 resolved，回看中间是 partially', () => {
    const hook: HookInput = { id: 'h1', chapterId: 'ch50', status: 'resolved' };
    const transitions: Transition[] = [
      tr({
        targetId: 'h1', kind: 'created', atChapterId: 'ch50',
        afterSnapshot: snap({ status: 'open' }),
      }),
      tr({
        targetId: 'h1', kind: 'partially_resolved', atChapterId: 'ch70',
        afterSnapshot: snap({ status: 'partially_resolved' }),
      }),
      tr({
        targetId: 'h1', kind: 'resolved', atChapterId: 'ch90',
        afterSnapshot: snap({ status: 'resolved' }),
      }),
    ];
    const r = reduceHookAsOf(hook, transitions, baseChapters, [], ch('ch75', 3), 'through_target');
    expect(r.data?.status).toBe('partially_resolved');
  });

  // —— T10 ——
  it('T10 删章排除：墓碑绑定不出现在 as-of', () => {
    const chapters = [ch('alive', 0), ch('tomb', null, { deletedSortOrder: 1 })];
    const facts: FactInput[] = [
      { id: 'f1', factType: 'event', chapterId: 'tomb', stateKey: 'e1' },
      { id: 'f2', factType: 'event', chapterId: 'alive', stateKey: 'e2' },
    ];
    const r = accumulateEventsAsOf(facts, [], chapters, [], ch('alive', 0), 'through_target');
    expect(r.data?.map((f) => f.id)).toEqual(['f2']);
    expect(facts[0].chapterId).toBe('tomb');
  });

  // —— T12 / T20 ——
  it('T12 旧记录无转换：历史截面 data null + historyWarnings；不猜整数期限', () => {
    const hook: HookInput = {
      id: 'h-old', chapterId: 'ch50', status: 'resolved', promisedByChapter: 80,
    };
    const r = reduceHookAsOf(hook, [], baseChapters, [], ch('ch50', 0), 'before_target');
    expect(r.data).toBeNull();
    expect(r.historyWarnings.some((w) => w.message.includes('历史不完整'))).toBe(true);
    // 整数期限不得变成 chapter 映射猜测
    expect(r.historyWarnings.every((w) => !w.message.includes('ch80'))).toBe(true);
  });

  it('T20 旧记录仅 status：through_target 也不注入', () => {
    const hook: HookInput = { id: 'h-old', chapterId: 'ch50', status: 'open' };
    const r = reduceHookAsOf(hook, [], baseChapters, [], ch('ch60', 1), 'through_target');
    expect(r.data).toBeNull();
    expect(r.historyWarnings.length).toBeGreaterThan(0);
  });

  // —— T14 / T15 ——
  it('T14 事件累计不互相取代', () => {
    const facts: FactInput[] = [
      { id: 'e1', factType: 'event', chapterId: 'ch50', stateKey: 'evt' },
      { id: 'e2', factType: 'event', chapterId: 'ch60', stateKey: 'evt' },
    ];
    const r = accumulateEventsAsOf(facts, [], baseChapters, [], ch('ch70', 2), 'before_target');
    expect(r.data?.map((f) => f.id).sort()).toEqual(['e1', 'e2']);
  });

  it('T15 状态取最后一条', () => {
    const key = deriveStateKey({
      factType: 'location', subject: '张三', predicate: 'at', object: '北京',
    }).key;
    const facts: FactInput[] = [
      { id: 's1', factType: 'location', chapterId: 'ch50', stateKey: key, object: '北京' },
      { id: 's2', factType: 'location', chapterId: 'ch60', stateKey: key, object: '上海' },
    ];
    const r = reduceStateFactsAsOf(facts, [], baseChapters, [], ch('ch70', 2), 'before_target');
    expect(r.data).toHaveLength(1);
    expect(r.data![0].id).toBe('s2');
  });

  it('状态折叠不含 event：累计只走 accumulateEventsAsOf', () => {
    const facts: FactInput[] = [
      { id: 's1', factType: 'location', chapterId: 'ch50', stateKey: 'loc|林岚|位于', object: '废站' },
      { id: 'e1', factType: 'event', chapterId: 'ch50', description: '林岚捡到铜钥' },
    ];
    const states = reduceStateFactsAsOf(facts, [], baseChapters, [], ch('ch60', 1), 'before_target');
    expect(states.data?.map((f) => f.id)).toEqual(['s1']);
    expect(states.data?.some((f) => f.factType === 'event')).toBe(false);
    const events = accumulateEventsAsOf(facts, [], baseChapters, [], ch('ch60', 1), 'before_target');
    expect(events.data?.map((f) => f.id)).toEqual(['e1']);
  });

  // —— T17 ——
  it('T17 字段穿越：回看得旧描述 + open', () => {
    const hook: HookInput = {
      id: 'h1', chapterId: 'ch50', status: 'resolved', description: 'new-desc',
    };
    const transitions: Transition[] = [
      tr({
        targetId: 'h1', kind: 'created', atChapterId: 'ch50',
        afterSnapshot: snap({ status: 'open', description: 'old-desc' }),
      }),
      tr({
        targetId: 'h1', kind: 'resolved', atChapterId: 'ch80',
        afterSnapshot: snap({ status: 'resolved', description: 'new-desc' }),
      }),
    ];
    const r = reduceHookAsOf(hook, transitions, baseChapters, [], ch('ch50', 0), 'through_target');
    expect(r.data).toEqual(expect.objectContaining({ status: 'open', description: 'old-desc' }));
  });

  it('P1-2 快照漏字段时不得泄漏当前投影的未来描述', () => {
    const hook: HookInput = {
      id: 'h1',
      chapterId: 'ch50',
      status: 'resolved',
      description: '未来描述',
    };
    const transitions: Transition[] = [
      tr({
        targetId: 'h1',
        kind: 'created',
        atChapterId: 'ch50',
        // 故意不完整：只有 status，没有 description
        afterSnapshot: snap({ status: 'open', chapterId: 'ch50' }),
      }),
      tr({
        targetId: 'h1',
        kind: 'resolved',
        atChapterId: 'ch80',
        afterSnapshot: snap({ status: 'resolved', description: '未来描述', chapterId: 'ch50' }),
      }),
    ];
    const r = reduceHookAsOf(hook, transitions, baseChapters, [], ch('ch50', 0), 'through_target');
    expect(r.data?.status).toBe('open');
    expect(r.data?.description).toBeUndefined();
    expect(r.data).not.toEqual(expect.objectContaining({ description: '未来描述' }));
  });

  it('P1-1 墓碑来源章的 hook/debt 即使后续有 resolved 转换也排除', () => {
    const chapters = [ch('alive', 0), ch('tomb', null, { deletedSortOrder: 1 }), ch('ch80', 1)];
    const hook: HookInput = {
      id: 'h-tomb',
      chapterId: 'tomb',
      status: 'resolved',
      description: '应被排除',
      resolvedInChapterId: 'ch80',
    };
    const hookTransitions: Transition[] = [
      tr({
        targetId: 'h-tomb',
        kind: 'created',
        atChapterId: 'tomb',
        afterSnapshot: snap({ status: 'open', chapterId: 'tomb' }),
      }),
      tr({
        targetId: 'h-tomb',
        kind: 'resolved',
        atChapterId: 'ch80',
        afterSnapshot: snap({ status: 'resolved', chapterId: 'tomb', resolvedInChapterId: 'ch80' }),
      }),
    ];
    const hookResult = reduceHookAsOf(
      hook,
      hookTransitions,
      chapters,
      [],
      ch('ch80', 1),
      'through_target',
    );
    expect(hookResult.data).toBeNull();

    const debt: DebtInput = {
      id: 'd-tomb',
      chapterId: 'tomb',
      status: 'paid',
      paidInChapterId: 'ch80',
    };
    const debtTransitions: Transition[] = [
      tr({
        targetId: 'd-tomb',
        kind: 'created',
        atChapterId: 'tomb',
        afterSnapshot: snap({ status: 'unpaid', chapterId: 'tomb' }),
      }),
      tr({
        targetId: 'd-tomb',
        kind: 'paid',
        atChapterId: 'ch80',
        afterSnapshot: snap({ status: 'paid', chapterId: 'tomb', paidInChapterId: 'ch80' }),
      }),
    ];
    const debtResult = reduceDebtAsOf(
      debt,
      debtTransitions,
      chapters,
      [],
      ch('ch80', 1),
      'through_target',
    );
    expect(debtResult.data).toBeNull();
  });

  it('P1-3 project_latest 无转换时回退当前投影', () => {
    const hook: HookInput = {
      id: 'h-legacy',
      chapterId: 'ch50',
      status: 'open',
      description: '旧投影',
    };
    const r = reduceHookAsOf(hook, [], baseChapters, [], null, 'project_latest');
    expect(r.data).toEqual(hook);
    expect(r.historyWarnings).toEqual([]);

    const debt: DebtInput = {
      id: 'd-legacy',
      chapterId: 'ch50',
      status: 'unpaid',
    };
    const dr = reduceDebtAsOf(debt, [], baseChapters, [], null, 'project_latest');
    expect(dr.data).toEqual(debt);
  });

  it('P1-4 deriveDebtOverdue 对不存在/已删目标章显式抛错', () => {
    const debt: DebtInput = {
      id: 'd1',
      chapterId: 'ch50',
      status: 'unpaid',
      dueChapterId: 'ch50',
    };
    expect(() =>
      deriveDebtOverdue(debt, baseChapters, [], ch('missing', 0)),
    ).toThrow();
    expect(() =>
      deriveDebtOverdue(debt, [ch('tomb', null, { deletedSortOrder: 0 })], [], ch('tomb', null, { deletedSortOrder: 0 })),
    ).toThrow();
  });

  // —— T18 ——
  it('T18 同章多转换按 ordinal/seq 折叠，defaultOrdinalForAppend 可复现', () => {
    const chapters = [ch('c1', 0)];
    const aliases: ChapterAlias[] = [];
    let transitions: Transition[] = [
      tr({
        targetId: 'h1', kind: 'partially_resolved', atChapterId: 'c1',
        atChapterOrdinal: 0, seq: 0,
        afterSnapshot: snap({ status: 'partially_resolved' }),
      }),
    ];
    const nextOrdinal = defaultOrdinalForAppend(transitions, 'c1', aliases);
    transitions = [
      ...transitions,
      tr({
        targetId: 'h1', kind: 'resolved', atChapterId: 'c1',
        atChapterOrdinal: nextOrdinal, seq: 0,
        afterSnapshot: snap({ status: 'resolved' }),
      }),
    ];
    const hook: HookInput = { id: 'h1', chapterId: 'c1', status: 'resolved' };
    const r = reduceHookAsOf(hook, transitions, chapters, aliases, ch('c1', 0), 'through_target');
    expect(r.data?.status).toBe('resolved');
    // 乱序输入结果相同
    const shuffled = [transitions[1], transitions[0]];
    const r2 = reduceHookAsOf(hook, shuffled, chapters, aliases, ch('c1', 0), 'through_target');
    expect(r2.data).toEqual(r.data);
  });

  // —— T19 ——
  it('T19 verifyProjectionMatches 一致 true / 不一致抛错', () => {
    const chapters = [ch('c1', 0)];
    const transitions: Transition[] = [
      tr({
        targetId: 'x', kind: 'created', atChapterId: 'c1',
        afterSnapshot: snap({ status: 'open', v: 1 }),
      }),
    ];
    expect(verifyProjectionMatches({ status: 'open', v: 1 }, transitions, chapters, [])).toBe(true);
    expect(() => verifyProjectionMatches({ status: 'resolved' }, transitions, chapters, [])).toThrow();
  });

  // —— T25 ——
  it('T25 Review 先验 before_target 不含目标章自身转换', () => {
    const hook: HookInput = { id: 'h1', chapterId: 'ch50', status: 'resolved' };
    const transitions: Transition[] = [
      tr({
        targetId: 'h1', kind: 'created', atChapterId: 'ch50',
        afterSnapshot: snap({ status: 'open' }),
      }),
      tr({
        targetId: 'h1', kind: 'resolved', atChapterId: 'ch80',
        afterSnapshot: snap({ status: 'resolved' }),
      }),
    ];
    const r = reduceHookAsOf(hook, transitions, baseChapters, [], ch('ch80', 4), 'before_target');
    expect(r.data?.status).toBe('open');
  });

  // —— T26 / M7 ——
  it('T26/M7 跨项目或已删目标章抛错', () => {
    expect(() => storyPositionOf('missing', baseChapters, [])).toThrow();
    expect(() => storyPositionOf('tomb', [ch('tomb', null, { deletedSortOrder: 0 })], [])).toThrow();
    expect(() =>
      reduceHookAsOf(
        { id: 'h1', chapterId: 'ch50', status: 'open' },
        [],
        baseChapters,
        [],
        ch('ch50', 0, { projectId: 'p2' }),
        'through_target',
      ),
    ).toThrow();
  });

  // —— T27 ——
  it('T27 重抽取：superseded 后退休事件不重复累计', () => {
    const facts: FactInput[] = [
      { id: 'e-old', factType: 'event', chapterId: 'ch50', stateKey: 'evt' },
      { id: 'e-new', factType: 'event', chapterId: 'ch50', stateKey: 'evt' },
    ];
    const transitions: Transition[] = [
      tr({
        targetId: 'e-old', kind: 'superseded', atChapterId: 'ch50',
        afterSnapshot: snap({ status: 'superseded' }),
      }),
    ];
    const r = accumulateEventsAsOf(facts, transitions, baseChapters, [], ch('ch60', 1), 'before_target');
    expect(r.data?.map((f) => f.id)).toEqual(['e-new']);
  });

  // —— T28 ——
  it('T28 逾期派生', () => {
    const chapters = [ch('ch35', 0), ch('ch40', 1), ch('ch41', 2)];
    const debt: DebtInput = {
      id: 'd1', chapterId: 'ch35', status: 'unpaid', dueChapterId: 'ch40',
    };
    expect(deriveDebtOverdue(debt, chapters, [], ch('ch35', 0))).toBe(false);
    expect(deriveDebtOverdue(debt, chapters, [], ch('ch41', 2))).toBe(true);
  });

  // —— T29 ——
  it('T29 知识回放：superseded 后回看仍 active', () => {
    const knowledge: KnowledgeInput = {
      id: 'k1', learnedAtChapterId: 'ch50', status: 'superseded',
    };
    const transitions: Transition[] = [
      tr({
        targetId: 'k1', kind: 'created', atChapterId: 'ch50',
        afterSnapshot: snap({ status: 'active', learnedAtChapterId: 'ch50' }),
      }),
      tr({
        targetId: 'k1', kind: 'superseded', atChapterId: 'ch85',
        afterSnapshot: snap({ status: 'superseded', learnedAtChapterId: 'ch50' }),
      }),
    ];
    const r = reduceKnowledgeAsOf(knowledge, transitions, baseChapters, [], ch('ch60', 1), 'through_target');
    expect(r.data?.status).toBe('active');
  });

  // —— T30 ——
  it('T30 未知快照版本抛错', () => {
    const hook: HookInput = { id: 'h1', chapterId: 'ch50', status: 'open' };
    const transitions: Transition[] = [
      tr({
        targetId: 'h1', kind: 'created', atChapterId: 'ch50',
        afterSnapshot: { schemaVersion: 999, data: { status: 'open' } },
      }),
    ];
    expect(() =>
      reduceHookAsOf(hook, transitions, baseChapters, [], ch('ch50', 0), 'through_target'),
    ).toThrow();
  });

  // —— T4b 表驱动 ——
  describe('T4b 并章后 as-of', () => {
    function setupMerge() {
      let chapters = [
        ch('surv', 0),
        ch('merged', 1),
        ch('ch60', 2),
        ch('ch80', 3),
        ch('ch90', 4),
      ];
      let aliases: ChapterAlias[] = [];
      // 幸存章已有转换 ordinal 0..1 → offset = 2
      const survivingTransitions: Transition[] = [
        tr({ targetId: 't-surv-0', kind: 'created', atChapterId: 'surv', atChapterOrdinal: 0, seq: 0 }),
        tr({ targetId: 't-surv-1', kind: 'created', atChapterId: 'surv', atChapterOrdinal: 1, seq: 0 }),
      ];
      const mergedTransitions: Transition[] = [
        tr({ targetId: 't-merged-0', kind: 'created', atChapterId: 'merged', atChapterOrdinal: 0, seq: 0 }),
        tr({ targetId: 't-merged-1', kind: 'created', atChapterId: 'merged', atChapterOrdinal: 1, seq: 0 }),
      ];
      const merged = mergeChapters(chapters, aliases, 'surv', 'merged', 2);
      chapters = merged.chapters;
      aliases = merged.aliases;
      const all = [...survivingTransitions, ...mergedTransitions];
      // 深拷贝守卫：折叠不得改写
      const frozen = JSON.parse(JSON.stringify(all)) as Transition[];
      return { chapters, aliases, all, frozen, survivingTransitions, mergedTransitions };
    }

    it('fact 主锚经 alias 在 surviving 之后可见', () => {
      const { chapters, aliases, all, frozen } = setupMerge();
      const facts: FactInput[] = [
        { id: 'f-m', factType: 'event', chapterId: 'merged', stateKey: 'e' },
      ];
      const r = accumulateEventsAsOf(facts, all, chapters, aliases, ch('ch60', 2), 'through_target');
      expect(r.data?.some((f) => f.id === 'f-m')).toBe(true);
      expect(all).toEqual(frozen);
    });

    it('knowledge 主锚经 alias 可见', () => {
      const { chapters, aliases, all } = setupMerge();
      const knowledge: KnowledgeInput = {
        id: 'k-m', learnedAtChapterId: 'merged', status: 'active',
      };
      const transitions: Transition[] = [
        tr({
          targetId: 'k-m', kind: 'created', atChapterId: 'merged',
          afterSnapshot: snap({ status: 'active', learnedAtChapterId: 'merged' }),
        }),
      ];
      const r = reduceKnowledgeAsOf(knowledge, transitions, chapters, aliases, ch('ch60', 2), 'through_target');
      expect(r.data).not.toBeNull();
      expect(r.data?.status).toBe('active');
      void all;
    });

    it('hook 主锚+副锚：不压扁历史，due/resolved 经 alias', () => {
      const { chapters, aliases } = setupMerge();
      const hook: HookInput = {
        id: 'h-m',
        chapterId: 'merged',
        status: 'resolved',
        dueChapterId: 'merged',
        resolvedInChapterId: 'ch80',
      };
      const transitions: Transition[] = [
        tr({
          targetId: 'h-m', kind: 'created', atChapterId: 'merged',
          afterSnapshot: snap({
            status: 'open', chapterId: 'merged', dueChapterId: 'merged',
          }),
        }),
        tr({
          targetId: 'h-m', kind: 'resolved', atChapterId: 'ch80',
          afterSnapshot: snap({
            status: 'resolved', chapterId: 'merged', dueChapterId: 'merged', resolvedInChapterId: 'ch80',
          }),
        }),
      ];
      const after80 = reduceHookAsOf(hook, transitions, chapters, aliases, ch('ch80', 3), 'through_target');
      expect(after80.data?.status).toBe('resolved');
      expect(after80.data?.dueChapterId).toBe('merged');
      expect(after80.data?.resolvedInChapterId).toBe('ch80');
      // 副锚 due=merged 经 alias 解析到活跃幸存章，可参与故事位置
      expect(storyPositionOf(after80.data!.dueChapterId!, chapters, aliases).id).toBe('surv');

      const at60 = reduceHookAsOf(hook, transitions, chapters, aliases, ch('ch60', 2), 'through_target');
      expect(at60.data?.status).toBe('open');
      expect(at60.data?.dueChapterId).toBe('merged');
      expect(at60.data?.resolvedInChapterId).toBeUndefined();
      expect(storyPositionOf(at60.data!.dueChapterId!, chapters, aliases).id).toBe('surv');
    });

    it('debt 主锚+副锚：paid 不压扁', () => {
      const { chapters, aliases } = setupMerge();
      const debt: DebtInput = {
        id: 'd-m', chapterId: 'merged', status: 'paid', paidInChapterId: 'ch90',
      };
      const transitions: Transition[] = [
        tr({
          targetId: 'd-m', kind: 'created', atChapterId: 'merged',
          afterSnapshot: snap({ status: 'unpaid', chapterId: 'merged' }),
        }),
        tr({
          targetId: 'd-m', kind: 'paid', atChapterId: 'ch90',
          afterSnapshot: snap({ status: 'paid', chapterId: 'merged', paidInChapterId: 'ch90' }),
        }),
      ];
      const paid = reduceDebtAsOf(debt, transitions, chapters, aliases, ch('ch90', 4), 'through_target');
      expect(paid.data?.status).toBe('paid');
      expect(paid.data?.paidInChapterId).toBe('ch90');
      expect(paid.data?.chapterId).toBe('merged');
      expect(storyPositionOf(paid.data!.chapterId, chapters, aliases).id).toBe('surv');

      const unpaid = reduceDebtAsOf(debt, transitions, chapters, aliases, ch('ch60', 2), 'through_target');
      expect(unpaid.data?.status).toBe('unpaid');
      expect(unpaid.data?.paidInChapterId).toBeUndefined();
      expect(unpaid.data?.chapterId).toBe('merged');
    });

    it('不撞车：compareTransition 恒非 0，乱序归约稳定', () => {
      const { chapters, aliases, survivingTransitions, mergedTransitions } = setupMerge();
      for (const s of survivingTransitions) {
        for (const m of mergedTransitions) {
          expect(compareTransition(s, m, chapters, aliases)).not.toBe(0);
        }
      }
      const hook: HookInput = { id: 'h1', chapterId: 'surv', status: 'open' };
      const transitions: Transition[] = [
        tr({
          targetId: 'h1', kind: 'created', atChapterId: 'surv', atChapterOrdinal: 0, seq: 0,
          afterSnapshot: snap({ status: 'open', tag: 'surv' }),
        }),
        tr({
          targetId: 'h1', kind: 'created', atChapterId: 'merged', atChapterOrdinal: 0, seq: 0,
          afterSnapshot: snap({ status: 'open', tag: 'merged' }),
        }),
      ];
      // 两条不同 targetId 的 created — 用同一 hook 不合适；改为断言 ordinal 偏移后比较键不同
      const a = survivingTransitions[0];
      const b = mergedTransitions[0];
      expect(compareTransition(a, b, chapters, aliases)).not.toBe(0);
      const ordered = [a, b].slice().sort((x, y) => compareTransition(x, y, chapters, aliases));
      const reversed = [b, a].slice().sort((x, y) => compareTransition(x, y, chapters, aliases));
      expect(ordered.map((t) => t.targetId)).toEqual(reversed.map((t) => t.targetId));
      void hook;
      void transitions;
    });

    it('连续并章累加 ordinal', () => {
      const aliases: ChapterAlias[] = [
        { from: 'A', to: 'B', ordinalOffset: 10 },
        { from: 'B', to: 'C', ordinalOffset: 20 },
      ];
      expect(resolveTransitionOrdinal('A', 5, aliases)).toBe(35);
    });

    it('并章后 append 避让别名占用序号', () => {
      const { chapters, aliases, all } = setupMerge();
      // 另有直接绑定 C(=surv) 的转换
      const withDirect: Transition[] = [
        ...all,
        tr({ targetId: 'direct', kind: 'created', atChapterId: 'surv', atChapterOrdinal: 0, seq: 1 }),
      ];
      const next = defaultOrdinalForAppend(withDirect, 'surv', aliases);
      // 被并章 ordinal 0,1 → 有效 2,3；幸存 0,1；直接 0 → 最大有效至少 3，next >= 4
      expect(next).toBeGreaterThanOrEqual(4);
      // 不得返回已被占用的 0/1/2/3
      const occupied = new Set(
        withDirect
          .filter((t) => {
            // resolve via alias to surv
            return t.atChapterId === 'surv' || t.atChapterId === 'merged';
          })
          .map((t) => resolveTransitionOrdinal(t.atChapterId, t.atChapterOrdinal, aliases)),
      );
      expect(occupied.has(next)).toBe(false);
      void chapters;
    });
  });
});
