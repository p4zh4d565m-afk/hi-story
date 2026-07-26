import React, { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import RichEditor from './editor/RichEditor';
import WritingGoal from './WritingGoal';
import ContextMenu from './ContextMenu';
import type { MenuItem } from './ContextMenu';
import type { Chapter, ChapterHistorySnapshot, Project } from '../types';

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
  onSearchInReference?: (text: string) => void;
  onAIPolish?: (text: string) => void;
  onAIContinue?: () => void;
  /** 编辑器字号预设 */
  editorFontSize?: 0 | 1 | 2 | 3;
  /** 编辑器字号变更回调 */
  onSetEditorFontSize?: (preset: 0 | 1 | 2 | 3) => void;
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
  onSearchInReference,
  onAIPolish,
  onAIContinue,
  editorFontSize = 1,
  onSetEditorFontSize,
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

  // ===== 历史版本 =====
  const [showHistory, setShowHistory] = useState(false);
  const [snapshots, setSnapshots] = useState<ChapterHistorySnapshot[]>([]);
  const [loadingSnapshots, setLoadingSnapshots] = useState(false);
  const historyPanelRef = useRef<HTMLDivElement>(null);

  const loadSnapshots = useCallback(async () => {
    if (!activeChapter) return;
    setLoadingSnapshots(true);
    try {
      const res = await window.electronAPI.invoke('db:chapterHistory:list', activeChapter.id) as any;
      if (res.success) setSnapshots(res.data);
    } catch {} finally { setLoadingSnapshots(false); }
  }, [activeChapter?.id]);

  // 打开历史面板时自动加载
  useEffect(() => {
    if (showHistory) loadSnapshots();
  }, [showHistory, loadSnapshots]);

  // 点击外部关闭历史面板
  useEffect(() => {
    if (!showHistory) return;
    const h = (e: MouseEvent) => {
      if (historyPanelRef.current && !historyPanelRef.current.contains(e.target as Node)) {
        setShowHistory(false);
      }
    };
    setTimeout(() => document.addEventListener('click', h), 100);
    return () => document.removeEventListener('click', h);
  }, [showHistory]);

  const handleRestoreSnapshot = useCallback(async (snapshot: ChapterHistorySnapshot) => {
    if (!activeChapter) return;
    if (!confirm(`确定恢复到 ${formatTimeAgo(snapshot.savedAt)} 的版本吗？\n当前内容将被保存为一个新版本。`)) return;
    try {
      const res = await window.electronAPI.invoke('db:chapterHistory:restore', snapshot.id) as any;
      if (res.success) {
        // 刷新编辑器内容：通过强制切换 key 重新挂载
        onSaveChapter(activeChapter.id, res.data.content);
        setShowHistory(false);
        setSnapshots([]);
      } else {
        alert('恢复失败：' + (res.error || '未知错误'));
      }
    } catch {
      alert('恢复失败，请重试');
    }
  }, [activeChapter, onSaveChapter]);

  /** "X 分钟前" 格式化 */
  function formatTimeAgo(isoStr: string): string {
    const diff = Date.now() - new Date(isoStr).getTime();
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (mins < 1) return '刚刚';
    if (mins < 60) return `${mins} 分钟前`;
    if (hours < 24) return `${hours} 小时前`;
    if (days < 7) return `${days} 天前`;
    return new Date(isoStr).toLocaleString('zh-CN');
  }

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
              className="px-4 py-2 text-sm border border-editor-600 text-gray-400 rounded hover:bg-editor-800 hover:text-white transition-colors"
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
      <div className="px-6 py-3 border-b border-editor-700 bg-editor-800 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-white">{activeProject.name}</h2>
          {activeChapter && (
            <>
              <span className="text-gray-600">/</span>
              <span className="text-sm text-gray-300">{activeChapter.title}</span>
            </>
          )}
          <span className="text-[11px] text-gray-500 bg-editor-700/50 px-2 py-0.5 rounded">
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

          {/* 历史版本按钮 */}
          {activeChapter && (
            <div className="relative" ref={historyPanelRef}>
              <button
                onClick={() => setShowHistory(!showHistory)}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs text-gray-400 hover:text-white hover:bg-editor-700 transition-colors"
                title="查看历史版本"
              >
                📋 历史
              </button>
              {showHistory && (
                <div className="absolute right-0 top-full mt-1 w-72 max-h-64 bg-editor-800 border border-editor-600 rounded-lg shadow-xl z-40 overflow-y-auto">
                  <div className="px-3 py-2 border-b border-editor-700 text-[10px] text-gray-500 uppercase tracking-wide">
                    历史版本（每章最多保留 30 个）
                  </div>
                  {loadingSnapshots && (
                    <div className="px-3 py-4 text-center text-xs text-gray-500">加载中...</div>
                  )}
                  {!loadingSnapshots && snapshots.length === 0 && (
                    <div className="px-3 py-4 text-center text-xs text-gray-500">
                      暂无历史快照
                      <br /><span className="text-gray-600">每次保存时自动记录</span>
                    </div>
                  )}
                  {!loadingSnapshots && snapshots.map((s, i) => (
                    <button
                      key={s.id}
                      onClick={() => handleRestoreSnapshot(s)}
                      className="w-full text-left px-3 py-2 hover:bg-editor-700 transition-colors border-b border-editor-700/30 group"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-300">
                          {i === 0 ? '🕐 上一版本' : `📝 ${formatTimeAgo(s.savedAt)}`}
                        </span>
                        <span className="text-[9px] text-accent opacity-0 group-hover:opacity-100 transition-opacity">
                          ↩ 恢复此版本
                        </span>
                      </div>
                      <div className="text-[10px] text-gray-600 mt-0.5">
                        {s.wordCount.toLocaleString()} 字 · {new Date(s.savedAt).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Chapter selector */}
          <select
            value={activeChapter?.id ?? ''}
            onChange={(e) => onSelectChapter(e.target.value)}
            className="text-xs bg-editor-700 border border-editor-600 rounded px-2 py-1 text-gray-300
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
      <div className="flex items-center gap-0.5 px-2 py-1.5 bg-editor-850 border-b border-editor-700 overflow-x-auto">
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
                onBlur={handleRenameConfirm}
                className="px-2 py-0.5 bg-editor-700 border border-accent rounded text-xs text-white
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
                  : 'text-gray-400 hover:bg-editor-700 hover:text-white'
                }
              `}
            >
              {ch.title}
            </button>
          )
        ))}
        <button
          onClick={() => {
            const nextNum = chapters.length + 1;
            onCreateChapter(`第${nextNum}章`);
          }}
          className="px-2 py-1 rounded text-xs text-gray-500 hover:bg-editor-700 hover:text-white transition-colors"
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
            onSearchInReference={onSearchInReference}
            onAIPolish={onAIPolish}
            onAIContinue={onAIContinue}
            fontSizePreset={editorFontSize}
            onSetFontSize={onSetEditorFontSize}
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
      <div className="px-4 py-1.5 border-t border-editor-700 bg-editor-800 flex items-center justify-between text-[10px] text-gray-600">
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
            label: '新章节',
            icon: '➕',
            onClick: () => {
              const nextNum = chapters.length + 1;
              onCreateChapter(`第${nextNum}章`);
            },
          },
          { type: 'separator' as const },
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
