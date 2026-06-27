import React, { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import RichEditor from './editor/RichEditor';
import WritingGoal from './WritingGoal';
import ContextMenu from './ContextMenu';
import type { MenuItem } from './ContextMenu';
import type { Chapter, Project } from '../types';

interface WritingAreaProps {
  activeProject: Project | null;
  chapters: Chapter[];
  activeChapter: Chapter | null;
  onSelectChapter: (id: string) => void;
  onCreateChapter: (title: string) => void;
  onDeleteChapter: (id: string) => void;
  onRenameChapter: (id: string, title: string) => void;
  onSaveChapter: (id: string, content: string) => void;
  onCreateProject: () => void;
  onImportNovel: () => void;
  saving: boolean;
  onSearchInInspiration?: (text: string) => void;
  onAIPolish?: (text: string) => void;
  onAIContinue?: () => void;
}

const WritingArea: React.FC<WritingAreaProps> = ({
  activeProject,
  chapters,
  activeChapter,
  onSelectChapter,
  onCreateChapter,
  onDeleteChapter,
  onRenameChapter,
  onSaveChapter,
  onCreateProject,
  onImportNovel,
  saving,
  onSearchInInspiration,
  onAIPolish,
  onAIContinue,
}) => {
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeChapterRef = useRef(activeChapter);
  activeChapterRef.current = activeChapter;
  // Track pending (unsaved) content keyed by chapter ID for chapter-switch flush
  const pendingContentRef = useRef<{ chapterId: string; content: string } | null>(null);
  // Refs to avoid stale closures in effects
  const chaptersRef = useRef(chapters);
  chaptersRef.current = chapters;
  const onSaveChapterRef = useRef(onSaveChapter);
  onSaveChapterRef.current = onSaveChapter;
  const [localContent, setLocalContent] = React.useState('');
  const [saveStatus, setSaveStatus] = React.useState<'saved' | 'unsaved' | 'saving'>('saved');
  const lastSavedContentRef = useRef(activeChapter?.content ?? '');

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ visible: boolean; x: number; y: number; chapterId: string }>({
    visible: false, x: 0, y: 0, chapterId: '',
  });
  const [renamingChapterId, setRenamingChapterId] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Sync local content when active chapter changes
  // CRITICAL: flush any pending save for the PREVIOUS chapter before switching
  useEffect(() => {
    // Cancel any pending auto-save timer for the previous chapter
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    // Flush pending content for the previous chapter (if different and unsaved)
    const pending = pendingContentRef.current;
    if (pending && pending.chapterId !== activeChapter?.id && pending.content !== lastSavedContentRef.current) {
      // Synchronously fire off a save for the previous chapter before switching
      const prevChapter = chaptersRef.current.find(ch => ch.id === pending.chapterId);
      if (prevChapter && pending.content !== prevChapter.content) {
        onSaveChapterRef.current(pending.chapterId, pending.content);
      }
    }
    pendingContentRef.current = null;

    // Load new chapter's content into local state
    setLocalContent(activeChapter?.content ?? '');
    lastSavedContentRef.current = activeChapter?.content ?? '';
    setSaveStatus('saved');
  }, [activeChapter?.id]);

  // When saving prop changes to false, it means save completed
  useEffect(() => {
    if (!saving && saveStatus === 'saving') {
      setSaveStatus('saved');
      lastSavedContentRef.current = activeChapterRef.current?.content ?? '';
    }
  }, [saving]);

  // Track unsaved changes
  useEffect(() => {
    if (localContent !== lastSavedContentRef.current) {
      setSaveStatus('unsaved');
    }
  }, [localContent]);

  // Perform save (called by auto-save timer, Ctrl+S, or save button)
  const doSave = useCallback((chapter: Chapter, html: string) => {
    if (html !== chapter.content) {
      setSaveStatus('saving');
      onSaveChapter(chapter.id, html);
    } else {
      setSaveStatus('saved');
    }
  }, [onSaveChapter]);

  // Auto-save with debounce (2 seconds after last edit)
  const handleUpdate = useCallback((html: string) => {
    setLocalContent(html);
    // Capture chapter ID NOW (at keystroke time), NOT when the timer fires
    const chapterId = activeChapterRef.current?.id;
    if (!chapterId) return;
    // Track pending content so chapter-switch can flush it
    pendingContentRef.current = { chapterId, content: html };
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      // Re-verify we're still on the same chapter when timer fires
      if (activeChapterRef.current?.id !== chapterId) {
        // Chapter changed while timer was pending — the switch effect already
        // flushed the save; don't double-save or save to wrong chapter
        return;
      }
      pendingContentRef.current = null;
      const currentChapter = activeChapterRef.current;
      if (currentChapter && html !== currentChapter.content) {
        doSave(currentChapter, html);
      }
    }, 2000);
  }, [doSave]);

  // Manual save with Ctrl+S
  const handleManualSave = useCallback(() => {
    if (!activeChapter) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    doSave(activeChapter, localContent);
  }, [activeChapter, localContent, doSave]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleManualSave();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleManualSave]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  // Context menu handler for chapter tabs
  const handleChapterContextMenu = useCallback((e: React.MouseEvent, chapterId: string) => {
    e.preventDefault();
    setContextMenu({ visible: true, x: e.clientX, y: e.clientY, chapterId });
  }, []);

  const handleRenameStart = useCallback((chapterId: string) => {
    const ch = chapters.find(c => c.id === chapterId);
    if (ch) {
      setRenamingChapterId(chapterId);
      setRenameTitle(ch.title);
    }
  }, [chapters]);

  const handleRenameConfirm = useCallback(() => {
    if (renamingChapterId && renameTitle.trim()) {
      onRenameChapter(renamingChapterId, renameTitle.trim());
    }
    setRenamingChapterId(null);
    setRenameTitle('');
  }, [renamingChapterId, renameTitle, onRenameChapter]);

  // Focus rename input when it appears
  useEffect(() => {
    if (renamingChapterId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingChapterId]);

  const totalWords = useMemo(() => chapters.reduce((sum, ch) => sum + ch.wordCount, 0), [chapters]);

  if (!activeProject) {
    return (
      <div className="h-full flex items-center justify-center text-gray-600">
        <div className="text-center">
          <p className="text-4xl mb-4">📝</p>
          <p className="text-lg">选择一本小说开始创作</p>
          <p className="text-sm mt-2 text-gray-700">或点击 + 创建新项目</p>
          <div className="flex items-center justify-center gap-3 mt-4">
            <button
              onClick={onCreateProject}
              className="px-4 py-2 text-sm border border-gray-600 text-gray-400 rounded hover:bg-gray-800 hover:text-white transition-colors"
            >
              + 新建项目
            </button>
            <button
              onClick={onImportNovel}
              className="px-4 py-2 text-sm bg-accent text-white rounded hover:bg-accent-hover transition-colors"
            >
              📥 导入小说
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Chapter header bar */}
      <div className="px-6 py-3 border-b border-gray-700 bg-gray-800 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-white">{activeProject.name}</h2>
          {activeChapter && (
            <>
              <span className="text-gray-600">/</span>
              <span className="text-sm text-gray-300">{activeChapter.title}</span>
            </>
          )}
          <span className="text-[11px] text-gray-500 bg-gray-700/50 px-2 py-0.5 rounded">
            {totalWords.toLocaleString()} 字
          </span>
        </div>

        {/* Chapter selector + Save button */}
        <div className="flex items-center gap-3">
          {/* Save button with status indicator */}
          {activeChapter && (
            <button
              onClick={handleManualSave}
              disabled={saveStatus === 'saving'}
              title={saveStatus === 'saved' ? '已保存' : saveStatus === 'unsaved' ? '点击保存 (Ctrl+S)' : '保存中...'}
              className={`
                flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-all
                ${saveStatus === 'saved'
                  ? 'bg-green-900/40 text-green-400 border border-green-700/50 hover:bg-green-900/60'
                  : saveStatus === 'unsaved'
                    ? 'bg-amber-900/40 text-amber-400 border border-amber-700/50 hover:bg-amber-900/60 animate-pulse'
                    : 'bg-accent/20 text-accent border border-accent/50 cursor-wait'
                }
              `}
            >
              {saveStatus === 'saved' && (
                <>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M11.5 3.5L5.5 10L2.5 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  已保存
                </>
              )}
              {saveStatus === 'unsaved' && (
                <>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2"/></svg>
                  保存
                </>
              )}
              {saveStatus === 'saving' && (
                <>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="animate-spin"><circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2" strokeDasharray="8 26" strokeLinecap="round"/></svg>
                  保存中
                </>
              )}
            </button>
          )}

          {/* Chapter selector */}
          <select
            value={activeChapter?.id ?? ''}
            onChange={(e) => onSelectChapter(e.target.value)}
            className="text-xs bg-gray-700 border border-gray-600 rounded px-2 py-1 text-gray-300
                       focus:outline-none focus:border-accent max-w-[200px] truncate"
          >
            {chapters.map((ch, i) => (
              <option key={ch.id} value={ch.id}>
                {i + 1}. {ch.title}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Quick chapter tabs */}
      <div className="flex items-center gap-0.5 px-2 py-1.5 bg-gray-850 border-b border-gray-700 overflow-x-auto">
        {chapters.map((ch, i) => (
          renamingChapterId === ch.id ? (
            <div key={ch.id} className="flex items-center gap-1">
              <input
                ref={renameInputRef}
                type="text"
                value={renameTitle}
                onChange={(e) => setRenameTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRenameConfirm();
                  if (e.key === 'Escape') { setRenamingChapterId(null); setRenameTitle(''); }
                }}
                onBlur={() => { setRenamingChapterId(null); setRenameTitle(''); }}
                className="px-2 py-0.5 bg-gray-700 border border-accent rounded text-xs text-white
                           focus:outline-none min-w-[80px] max-w-[180px]"
              />
            </div>
          ) : (
            <button
              key={ch.id}
              onClick={() => onSelectChapter(ch.id)}
              onContextMenu={(e) => handleChapterContextMenu(e, ch.id)}
              className={`
                flex items-center gap-1 px-3 py-1 rounded text-xs whitespace-nowrap transition-colors
                ${ch.id === activeChapter?.id
                  ? 'bg-accent text-white'
                  : 'text-gray-400 hover:bg-gray-700 hover:text-white'
                }
              `}
            >
              <span className="text-[10px]">{i + 1}</span>
              {ch.title}
            </button>
          )
        ))}
        <button
          onClick={() => onCreateChapter('未命名章节')}
          className="px-2 py-1 rounded text-xs text-gray-500 hover:bg-gray-700 hover:text-white transition-colors"
          title="快速新建章节"
        >
          +
        </button>
      </div>

      {/* Editor area */}
      <div className="flex-1 overflow-hidden">
        {activeChapter ? (
          <RichEditor
            key={activeChapter.id}
            content={activeChapter.content}
            onUpdate={handleUpdate}
            placeholder={`继续写「${activeChapter.title}」...`}
            onSearchInInspiration={onSearchInInspiration}
            onAIPolish={onAIPolish}
            onAIContinue={onAIContinue}
          />
        ) : (
          <div className="h-full flex items-center justify-center text-gray-600">
            <div className="text-center">
              <p className="text-2xl mb-2">📖</p>
              <p className="text-sm">选择一个章节开始写作</p>
              <button
                onClick={() => onCreateChapter('第一章')}
                className="mt-3 px-4 py-2 text-sm bg-accent text-white rounded hover:bg-accent-hover transition-colors"
              >
                创建第一章
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Writing goal tracker */}
      <WritingGoal
        projectId={activeProject.id}
        totalWords={totalWords}
        chapterCount={chapters.length}
      />

      {/* Status bar */}
      <div className="px-4 py-1.5 border-t border-gray-700 bg-gray-800 flex items-center justify-between text-[10px] text-gray-600">
        <div className="flex items-center gap-4">
          {activeChapter && (
            <>
              <span>字数: {activeChapter.wordCount.toLocaleString()}</span>
              <span>状态: {activeChapter.status === 'final' ? '定稿' : '草稿'}</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {saveStatus === 'saved' && <span className="text-green-600">✅ 已保存</span>}
          {saveStatus === 'unsaved' && <span className="text-amber-600 animate-pulse">⚠️ 未保存</span>}
          {saveStatus === 'saving' && <span className="text-accent animate-pulse">⏳ 保存中...</span>}
          <span className="text-gray-700 mx-2">|</span>
          <span>Ctrl+S 保存</span>
        </div>
      </div>

      {/* Context Menu */}
      <ContextMenu
        visible={contextMenu.visible}
        x={contextMenu.x}
        y={contextMenu.y}
        onClose={() => setContextMenu(p => ({ ...p, visible: false }))}
        items={[
          {
            label: '重命名',
            icon: '✏️',
            onClick: () => handleRenameStart(contextMenu.chapterId),
          },
          {
            label: '删除',
            icon: '🗑️',
            danger: true,
            onClick: () => {
              if (confirm('确定要删除这个章节吗？')) {
                onDeleteChapter(contextMenu.chapterId);
              }
            },
          },
        ]}
      />
    </div>
  );
};

export default WritingArea;
