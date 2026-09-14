import { describe, it, expect } from 'vitest';
import {
  createChapterDeletion,
  fixActiveChapterId,
  type InvokeFn,
} from '../../src/renderer/services/chapter-deletion';
import { createProjectSelectionGuard } from '../../src/renderer/services/project-data-loader';
import type { Chapter } from '../../src/renderer/types';

function makeChapter(id: string, projectId = 'A', sortOrder = 0): Chapter {
  return {
    id, projectId, title: id, content: '<p>x</p>', status: 'draft',
    wordCount: 0, sortOrder, summary: '', planningOutline: null, createdAt: '', updatedAt: '',
  } as Chapter;
}

interface DeferredIpc {
  channel: string;
  args: unknown[];
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

/** 与 App.tsx 相同的接线：真实项目选择守卫 + fixActiveChapterId 修正活动章 */
function createHarness(initial: Chapter[]) {
  const guard = createProjectSelectionGuard();
  guard.select('A');
  let chapters = [...initial];
  let activeId: string | null = initial[0]?.id ?? null;
  const applied: Chapter[][] = [];
  const alerts: string[] = [];
  const calls: DeferredIpc[] = [];

  const invoke: InvokeFn = (channel, ...args) => new Promise<unknown>((resolve, reject) => {
    calls.push({ channel, args, resolve, reject });
  });

  const svc = createChapterDeletion({
    invoke,
    snapshotSelection: () => guard.snapshot(),
    isSelectionCurrent: t => guard.isCurrent(t),
    applyChapters: list => {
      chapters = [...list];
      activeId = fixActiveChapterId(activeId, list);
      applied.push([...list]);
    },
    alert: m => alerts.push(m),
  });

  return {
    guard, svc, applied, alerts, calls,
    state: () => ({ ids: chapters.map(c => c.id), activeId }),
    select: (id: string) => { activeId = id; },
  };
}

describe('fixActiveChapterId（活动章统一修正）', () => {
  const c1 = makeChapter('c1');
  const c2 = makeChapter('c2');
  it('活动章仍在列表则不变', () => {
    expect(fixActiveChapterId('c1', [c1, c2])).toBe('c1');
  });
  it('活动章不在列表则落到第一章', () => {
    expect(fixActiveChapterId('c2', [c1])).toBe('c1');
  });
  it('列表为空则置 null', () => {
    expect(fixActiveChapterId('c1', [])).toBeNull();
  });
  it('活动章为 null 时落到第一章', () => {
    expect(fixActiveChapterId(null, [c1, c2])).toBe('c1');
  });
  it('活动章为 null 且列表空则 null', () => {
    expect(fixActiveChapterId(null, [])).toBeNull();
  });
});

describe('章节删除 / 撤销 / 重做（双层守卫）', () => {
  it('删除成功：应用列表并修正活动章', async () => {
    const c1 = makeChapter('c1', 'A', 0);
    const c2 = makeChapter('c2', 'A', 1);
    const h = createHarness([c1, c2]);
    h.select('c2');

    const p = h.svc.deleteChapter(c2);
    expect(h.calls[0].channel).toBe('db:chapter:remove');
    h.calls[0].resolve({ success: true, data: [c1] });
    const ok = await p;

    expect(ok).toBe(true);
    expect(h.state().ids).toEqual(['c1']);
    expect(h.state().activeId).toBe('c1'); // c2 被删，落到 c1
  });

  it('删除失败：alert 并返回 false，不应用列表', async () => {
    const c1 = makeChapter('c1');
    const c2 = makeChapter('c2');
    const h = createHarness([c1, c2]);

    const p = h.svc.deleteChapter(c2);
    h.calls[0].resolve({ success: false, error: '删除失败' });
    const ok = await p;

    expect(ok).toBe(false);
    expect(h.alerts).toEqual(['删除失败：删除失败']);
    expect(h.applied).toHaveLength(0);
  });

  it('A→B→A 后撤销仍刷新界面（重捕获 ticket，不复用删除时 ticket）', async () => {
    const c1 = makeChapter('c1', 'A', 0);
    const c2 = makeChapter('c2', 'A', 1);
    const h = createHarness([c1, c2]);

    let p = h.svc.deleteChapter(c2);
    h.calls[0].resolve({ success: true, data: [c1] });
    await p;
    expect(h.state().ids).toEqual(['c1']);

    // A→B→A：切换两次项目，使删除时 ticket 的代次失效
    h.guard.select('B');
    h.guard.select('A');

    const up = h.svc.buildUndo(c2)();
    expect(h.calls[1].channel).toBe('db:chapter:restore');
    h.calls[1].resolve({ success: true, data: [c1, c2] });
    await up;

    expect(h.state().ids).toEqual(['c1', 'c2']); // 撤销后界面刷新，c2 回来了
  });

  it('同项目并发删除：旧回执不覆盖新列表（同项目序号守卫）', async () => {
    const c1 = makeChapter('c1', 'A', 0);
    const c2 = makeChapter('c2', 'A', 1);
    const c3 = makeChapter('c3', 'A', 2);
    const h = createHarness([c1, c2, c3]);

    // 并发两次删除：不 await，让序号先分配（c2→seq1，c3→seq2）
    const p2 = h.svc.deleteChapter(c2);
    const p3 = h.svc.deleteChapter(c3);
    expect(h.calls.length).toBe(2);

    // 后发起的删除（c3，seq2）先返回
    h.calls[1].resolve({ success: true, data: [c1, c2] });
    await p3;
    expect(h.state().ids).toEqual(['c1', 'c2']);

    // 先发起的删除（c2，seq1）后返回——旧回执，必须丢弃
    h.calls[0].resolve({ success: true, data: [c1, c3] });
    await p2;
    expect(h.state().ids).toEqual(['c1', 'c2']); // 未被旧回执 [c1,c3] 覆盖
  });

  it('后发操作失败、先发成功晚回：先发成功回执仍生效（不被失败序号淘汰）', async () => {
    const c1 = makeChapter('c1', 'A', 0);
    const c2 = makeChapter('c2', 'A', 1);
    const c3 = makeChapter('c3', 'A', 2);
    const h = createHarness([c1, c2, c3]);

    // 并发两次删除：c2→seq1，c3→seq2
    const p2 = h.svc.deleteChapter(c2);
    const p3 = h.svc.deleteChapter(c3);
    expect(h.calls.length).toBe(2);

    // 后发起的删除（c3，seq2）先返回但失败——不应推进「已应用序号」
    h.calls[1].resolve({ success: false, error: '删除失败' });
    const ok3 = await p3;
    expect(ok3).toBe(false);

    // 先发起的删除（c2，seq1）晚回但成功——不能被失败的 seq2 淘汰
    h.calls[0].resolve({ success: true, data: [c1, c3] });
    const ok2 = await p2;
    expect(ok2).toBe(true);
    expect(h.state().ids).toEqual(['c1', 'c3']); // c2 已删，UI 同步
  });

  it('删除时章节不属于当前项目：拒绝删除，不 invoke 不应用', async () => {
    const c1 = makeChapter('c1', 'A', 0);
    const c2 = makeChapter('c2', 'A', 1);
    const h = createHarness([c1, c2]);

    // 切到别的项目，但章节仍属于 A（旧章节 UI 尚未清空的窗口）
    h.guard.select('B');

    const ok = await h.svc.deleteChapter(c2);

    expect(ok).toBe(false);
    expect(h.calls).toHaveLength(0); // 未发起删除 IPC
    expect(h.applied).toHaveLength(0); // 未应用列表
  });

  it('撤销时当前项目与章节不同：只恢复 DB，不碰当前 UI', async () => {
    const c1 = makeChapter('c1', 'A', 0);
    const c2 = makeChapter('c2', 'A', 1);
    const h = createHarness([c1, c2]);

    let p = h.svc.deleteChapter(c2);
    h.calls[0].resolve({ success: true, data: [c1] });
    await p;

    h.guard.select('B'); // 切到别的项目

    const up = h.svc.buildUndo(c2)();
    expect(h.calls[1].channel).toBe('db:chapter:restore');
    h.calls[1].resolve({ success: true, data: [c1, c2] });
    await up;

    expect(h.applied).toHaveLength(1); // 撤销未 apply，当前 UI 不被 A 的章节列表污染
    expect(h.state().ids).toEqual(['c1']);
  });

  it('撤销失败抛错（UndoManager 不推进栈）', async () => {
    const c1 = makeChapter('c1');
    const c2 = makeChapter('c2');
    const h = createHarness([c1, c2]);

    let p = h.svc.deleteChapter(c2);
    h.calls[0].resolve({ success: true, data: [c1] });
    await p;

    const up = h.svc.buildUndo(c2)();
    h.calls[1].resolve({ success: false, error: '恢复失败' });
    await expect(up).rejects.toThrow('恢复失败');
  });

  it('重做失败抛错（UndoManager 不推进栈）', async () => {
    const c1 = makeChapter('c1');
    const c2 = makeChapter('c2');
    const h = createHarness([c1, c2]);

    let p = h.svc.deleteChapter(c2);
    h.calls[0].resolve({ success: true, data: [c1] });
    await p;

    const rp = h.svc.buildRedo(c2)();
    expect(h.calls[1].channel).toBe('db:chapter:remove');
    h.calls[1].resolve({ success: false, error: '重做失败' });
    await expect(rp).rejects.toThrow('重做失败');
  });

  it('撤销后重做删除活动章：不留悬空活动章', async () => {
    const c1 = makeChapter('c1', 'A', 0);
    const c2 = makeChapter('c2', 'A', 1);
    const h = createHarness([c1, c2]);
    h.select('c2');

    // 删除活动章 c2
    let p = h.svc.deleteChapter(c2);
    h.calls[0].resolve({ success: true, data: [c1] });
    await p;
    expect(h.state().activeId).toBe('c1');

    // 撤销恢复 c2
    const up = h.svc.buildUndo(c2)();
    h.calls[1].resolve({ success: true, data: [c1, c2] });
    await up;

    // 用户重新选中恢复的 c2
    h.select('c2');

    // 重做删除 c2
    const rp = h.svc.buildRedo(c2)();
    h.calls[2].resolve({ success: true, data: [c1] });
    await rp;

    expect(h.state().ids).toEqual(['c1']);
    expect(h.state().activeId).toBe('c1'); // 不是悬空的 c2
  });
});
