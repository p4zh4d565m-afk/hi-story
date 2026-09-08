import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import DockLayout from '../../src/renderer/components/DockLayout';
import WritingArea from '../../src/renderer/components/WritingArea';
import type { RichEditorHandle } from '../../src/renderer/components/editor/RichEditor';
import type { Chapter, Project } from '../../src/renderer/types';

// 使用真实布局和 TipTap，仅用内存存储替代数据库，避免接触用户小说。
const noop = () => {};
const initial = { id: 'a', projectId: 'project', title: '第一章', content: '<p>原文</p>', wordCount: 2, status: 'draft' } as Chapter;
let control: { edit: (html: string) => void; select: (id: string) => void };
let writes: Array<{ id: string; content: string }>;
let stored: Map<string, string>;
let saveDelay = 0;

function Fixture() {
  const [mode, setMode] = useState<'writing' | 'planning'>('writing');
  const [chapters, setChapters] = useState<Chapter[]>([initial, { ...initial, id: 'b', title: '第二章', content: '<p>第二章原文</p>' }]);
  const [activeId, setActiveId] = useState('a');
  const [saving, setSaving] = useState(false);
  const editorRef = useRef<RichEditorHandle>(null);
  control = { edit: html => editorRef.current!.setContent(html), select: setActiveId };
  const save = async (id: string, content: string) => {
    writes.push({ id, content });
    setSaving(true);
    await new Promise(resolve => setTimeout(resolve, saveDelay));
    stored.set(id, content);
    setChapters(prev => prev.map(ch => ch.id === id ? { ...ch, content } : ch));
    setSaving(false);
  };
  return <DockLayout
    {...Object.fromEntries(['onToggleSidebar', 'onToggleAiChat', 'onMinimizeAiChat', 'onToggleInspiration', 'onToggleMindmap', 'onToggleMaterial', 'onToggleOutline', 'onToggleReference', 'onToggleNamegen', 'onToggleAiWrite', 'onToggleAiReview', 'onToggleAiPolish', 'onToggleForeshadowing', 'onSetAiLevel', 'onSetFontSize'].map(key => [key, noop])) as any}
    panelState={{ aiLevel: 'off' } as any}
    fontSizes={{ editor: 1, panels: 1, ui: 1 }}
    workspaceMode={mode} onSetWorkspaceMode={setMode}
    planningArea={<div data-planning>策划内容</div>}
    writingArea={<WritingArea
      isActive={mode === 'writing'}
      activeProject={{ id: 'project', name: '回归测试小说' } as Project}
      chapters={chapters} activeChapter={chapters.find(ch => ch.id === activeId)!}
      onSelectChapter={setActiveId} onCreateChapter={noop} onDeleteChapter={noop}
      onRenameChapter={noop} onSaveChapter={save} onCreateProject={noop}
      onImportNovel={noop} saving={saving} editorRef={editorRef}
    />}
  />;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
async function until(predicate: () => boolean) {
  const deadline = Date.now() + 6000;
  while (!predicate()) {
    assert(Date.now() < deadline, '等待界面或自动保存超时');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
const tick = () => new Promise(resolve => setTimeout(resolve, 30));
function switchTo(mode: 'planning' | 'writing') {
  const title = mode === 'planning' ? '从创意生成故事方案、大纲和章纲' : '自己写作或使用 AI 起草、续写';
  flushSync(() => document.querySelector<HTMLButtonElement>(`button[title="${title}"]`)!.click());
}
const text = () => document.querySelector('.tiptap')?.textContent;
const edit = (html: string) => flushSync(() => control.edit(html));

const cases: Array<[string, () => Promise<void>]> = [
  ['两秒内快速往返保留编辑内容', async () => {
    edit('<p>尚未自动保存的新内容</p>');
    assert(writes.length === 0, '测试必须在自动保存前切换');
    switchTo('planning');
    switchTo('writing');
    await tick();
    assert(text() === '尚未自动保存的新内容', '快速往返丢失了待保存内容');
    await until(() => stored.get('a') === '<p>尚未自动保存的新内容</p>');
    assert(writes.length === 1, '往返切换不应重复保存');
  }],
  ['停留策划页时自动保存继续执行', async () => {
    edit('<p>后台保存内容</p>');
    switchTo('planning');
    await until(() => stored.get('a') === '<p>后台保存内容</p>');
    switchTo('writing');
    assert(text() === '后台保存内容', '返回写作页未保留新内容');
  }],
  ['保存回执延迟时返回继续输入不被旧内容覆盖', async () => {
    saveDelay = 350;
    edit('<p>第一版</p>');
    await until(() => writes.length === 1);
    switchTo('planning');
    switchTo('writing');
    edit('<p>第二版</p>');
    await until(() => stored.get('a') === '<p>第一版</p>');
    assert(text() === '第二版', '旧保存回执覆盖了新输入');
    await until(() => stored.get('a') === '<p>第二版</p>');
  }],
  ['策划页不拦截写作保存快捷键，返回后仍可手动保存', async () => {
    edit('<p>手动保存内容</p>');
    switchTo('planning');
    await tick();
    const hiddenKey = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, cancelable: true });
    window.dispatchEvent(hiddenKey);
    assert(!hiddenKey.defaultPrevented && writes.length === 0, '隐藏写作页仍拦截了快捷键');
    switchTo('writing');
    await tick();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, cancelable: true }));
    await until(() => stored.get('a') === '<p>手动保存内容</p>');
  }],
  ['策划期间切换章节仍保存到原章节', async () => {
    edit('<p>第一章新内容</p>');
    switchTo('planning');
    flushSync(() => control.select('b'));
    await until(() => stored.get('a') === '<p>第一章新内容</p>');
    switchTo('writing');
    await tick();
    assert(text() === '第二章原文', '切章后显示了错误的正文');
    assert(!stored.has('b'), '第一章内容误写入第二章');
  }],
  ['清空正文后快速往返仍保存空正文', async () => {
    edit('<p></p>');
    switchTo('planning');
    switchTo('writing');
    await tick();
    assert(text() === '', '清空正文后旧内容重新出现');
    await until(() => stored.get('a') === '<p></p>');
  }],
];

(window as any).runWritingRegression = async () => {
  const results: Array<{ name: string; error?: string }> = [];
  for (const [name, run] of cases) {
    writes = []; stored = new Map(); saveDelay = 0;
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
      flushSync(() => root.render(<React.StrictMode><Fixture /></React.StrictMode>));
      await until(() => Boolean(document.querySelector('.tiptap')));
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
