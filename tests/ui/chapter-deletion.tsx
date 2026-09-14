import React, { useState, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { UndoProvider, useUndo } from '../../src/renderer/hooks/useUndoManager';
import { createChapterDeletion, fixActiveChapterId } from '../../src/renderer/services/chapter-deletion';
import { createProjectSelectionGuard } from '../../src/renderer/services/project-data-loader';
import type { Chapter } from '../../src/renderer/types';

// 用真实 App.tsx 同款的「createChapterDeletion + 项目选择守卫 + UndoProvider」，
// 仅把 DB 换成内存存储，锁定章节删除/撤销/重做的三层缺陷：
//   A→B→A 撤销不刷新、同项目旧回执覆盖、重做删除活动章留悬空。
const guard = createProjectSelectionGuard();

function ch(id: string, projectId = 'A', sortOrder = 0): Chapter {
  return {
    id, projectId, title: id, content: '<p>x</p>', status: 'draft',
    wordCount: 0, sortOrder, summary: '', planningOutline: null, createdAt: '', updatedAt: '',
  } as Chapter;
}

// 内存章节库（键 projectId）；每次 case 前 reset
let store: Map<string, Chapter[]>;

function findInStore(id: string): Chapter | undefined {
  for (const list of store.values()) {
    const found = list.find(c => c.id === id);
    if (found) return found;
  }
  return undefined;
}

// 与 db:chapter:remove / db:chapter:restore 同语义的内存实现
const fakeInvoke = async (channel: string, ...args: unknown[]) => {
  if (channel === 'db:chapter:remove') {
    const id = args[0] as string;
    const found = findInStore(id);
    if (!found) return { success: false, error: '未找到章节' };
    const list = (store.get(found.projectId) ?? []).filter(c => c.id !== id);
    store.set(found.projectId, list);
    return { success: true, data: [...list] };
  }
  if (channel === 'db:chapter:restore') {
    const chapter = args[0] as Chapter;
    const list = store.get(chapter.projectId) ?? [];
    const next = [...list.filter(c => c.id !== chapter.id), chapter].sort((a, b) => a.sortOrder - b.sortOrder);
    store.set(chapter.projectId, next);
    return { success: true, data: [...next] };
  }
  return { success: false, error: '未知 channel' };
};

let control: {
  deleteChapter: (id: string) => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  selectChapter: (id: string) => void;
  switchProject: (id: string) => void;
};

function Fixture() {
  const [projectId, setProjectId] = useState('A');
  const [chapters, setChapters] = useState<Chapter[]>(() => [...(store.get('A') ?? [])]);
  const [activeId, setActiveId] = useState<string | null>('c1');
  const { pushUndo, undo, redo } = useUndo();

  // 与 App.tsx 一致：完整章节列表应用时同步修正活动章
  const chapterDeletion = useMemo(() => createChapterDeletion({
    invoke: fakeInvoke,
    snapshotSelection: () => guard.snapshot(),
    isSelectionCurrent: t => guard.isCurrent(t),
    applyChapters: list => {
      setChapters([...list]);
      setActiveId(prev => fixActiveChapterId(prev, list));
    },
    alert: () => {},
  }), []);

  const deleteChapter = async (id: string) => {
    const target = chapters.find(c => c.id === id);
    if (!target) return;
    const ok = await chapterDeletion.deleteChapter(target);
    if (!ok) return;
    pushUndo({
      id: 'undo_' + Date.now(),
      label: `删除章节「${target.title}」`,
      undo: chapterDeletion.buildUndo(target),
      redo: chapterDeletion.buildRedo(target),
    });
  };

  const switchProject = (id: string) => {
    guard.select(id);
    setProjectId(id);
    const list = store.get(id) ?? [];
    setChapters([...list]);
    setActiveId(list[0]?.id ?? null);
  };

  control = {
    deleteChapter,
    undo: async () => { await undo(); },
    redo: async () => { await redo(); },
    selectChapter: setActiveId,
    switchProject,
  };

  return (
    <div>
      <div id="project">{projectId}</div>
      <ul id="chapters">
        {chapters.map(c => (
          <li key={c.id} data-id={c.id} data-active={c.id === activeId} onClick={() => setActiveId(c.id)}>
            {c.title}
            <button data-del={c.id} onClick={() => void deleteChapter(c.id)}>删除</button>
          </li>
        ))}
      </ul>
      <button id="undo" onClick={() => void undo()}>撤销</button>
      <button id="redo" onClick={() => void redo()}>重做</button>
      <button data-proj="A" onClick={() => switchProject('A')}>切A</button>
      <button data-proj="B" onClick={() => switchProject('B')}>切B</button>
    </div>
  );
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
async function until(predicate: () => boolean) {
  const deadline = Date.now() + 6000;
  while (!predicate()) {
    assert(Date.now() < deadline, '等待界面刷新超时');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
const tick = () => new Promise(resolve => setTimeout(resolve, 30));

const chapterIds = () => Array.from(document.querySelectorAll('#chapters li')).map(li => li.getAttribute('data-id'));
const activeId = () => document.querySelector('#chapters li[data-active="true"]')?.getAttribute('data-id') ?? null;

const cases: Array<[string, () => Promise<void>]> = [
  ['删除活动章后活动章落到第一章', async () => {
    control.switchProject('A');
    flushSync();
    control.selectChapter('c2');
    flushSync();
    await control.deleteChapter('c2');
    await until(() => chapterIds().join(',') === 'c1');
    assert(activeId() === 'c1', '删除活动章 c2 后活动章应落到 c1');
  }],
  ['A→B→A 后撤销仍刷新界面（重捕获 ticket）', async () => {
    control.switchProject('A');
    flushSync();
    await control.deleteChapter('c2');
    await until(() => chapterIds().join(',') === 'c1');

    control.switchProject('B');
    flushSync();
    control.switchProject('A');
    flushSync();
    await until(() => chapterIds().join(',') === 'c1'); // A 重新加载后仍只有 c1

    await control.undo();
    await until(() => chapterIds().join(',') === 'c1,c2');
    assert(chapterIds().join(',') === 'c1,c2', 'A→B→A 后撤销应刷新界面，c2 应回来');
  }],
  ['撤销后重做删除活动章：不留悬空活动章', async () => {
    control.switchProject('A');
    flushSync();
    control.selectChapter('c2');
    flushSync();
    await control.deleteChapter('c2');
    await until(() => chapterIds().join(',') === 'c1');
    assert(activeId() === 'c1', '删除活动章后活动章应落到 c1');

    await control.undo();
    await until(() => chapterIds().join(',') === 'c1,c2');
    control.selectChapter('c2'); // 重新选中恢复的 c2
    flushSync();

    await control.redo();
    await until(() => chapterIds().join(',') === 'c1');
    assert(activeId() === 'c1', '重做删除活动章 c2 后活动章不能悬空为 c2');
  }],
];

(window as any).runChapterDeletionRegression = async () => {
  const results: Array<{ name: string; error?: string }> = [];
  for (const [name, run] of cases) {
    store = new Map([['A', [ch('c1', 'A', 0), ch('c2', 'A', 1)]], ['B', []]]);
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
      flushSync(() => root.render(<React.StrictMode><UndoProvider><Fixture /></UndoProvider></React.StrictMode>));
      await tick();
      await run();
      results.push({ name });
    } catch (error) {
      results.push({ name, error: String(error) });
    } finally {
      flushSync(() => root.unmount());
      container.remove();
    }
  }
  return results;
};
