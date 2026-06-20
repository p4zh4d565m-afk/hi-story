import React, { useEffect, useRef, useCallback } from 'react';
import RichEditor from './editor/RichEditor';
import type { Chapter, Project } from '../types';

interface WritingAreaProps {
  activeProject: Project | null;
  chapters: Chapter[];
  activeChapter: Chapter | null;
  onSelectChapter: (id: string) => void;
  onCreateChapter: (title: string) => void;
  onDeleteChapter: (id: string) => void;
  onSaveChapter: (id: string, content: string) => void;
  saving: boolean;
}

const WritingArea: React.FC<WritingAreaProps> = ({
  activeProject,
  chapters,
  activeChapter,
  onSelectChapter,
  onCreateChapter,
  onDeleteChapter,
  onSaveChapter,
  saving,
}) => {
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [localContent, setLocalContent] = React.useState('');

  // Sync local content when active chapter changes
  useEffect(() => {
    setLocalContent(activeChapter?.content ?? '');
  }, [activeChapter?.id]);

  // Auto-save with debounce (2 seconds after last edit)
  const handleUpdate = useCallback((html: string) => {
    setLocalContent(html);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      if (activeChapter && html !== activeChapter.content) {
        onSaveChapter(activeChapter.id, html);
      }
    }, 2000);
  }, [activeChapter, onSaveChapter]);

  // Manual save with Ctrl+S
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (activeChapter && localContent !== activeChapter.content) {
          if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
          onSaveChapter(activeChapter.id, localContent);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeChapter, localContent, onSaveChapter]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  if (!activeProject) {
    return (
      <div className="h-full flex items-center justify-center text-gray-600">
        <div className="text-center">
          <p className="text-4xl mb-4">📝</p>
          <p className="text-lg">选择一本小说开始创作</p>
          <p className="text-sm mt-2 text-gray-700">或点击 + 创建新项目</p>
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
              {saving && (
                <span className="text-[10px] text-accent animate-pulse">保存中...</span>
              )}
            </>
          )}
        </div>

        {/* Chapter selector */}
        <div className="flex items-center gap-2">
          <select
            value={activeChapter?.id ?? ''}
            onChange={(e) => onSelectChapter(e.target.value)}
            className="text-xs bg-gray-700 border border-gray-600 rounded px-2 py-1 text-gray-300
                       focus:outline-none focus:border-accent"
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
          <button
            key={ch.id}
            onClick={() => onSelectChapter(ch.id)}
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
          />
        ) : (
          <div className="h-full flex items-center justify-center text-gray-600">
            <div className="text-center">
              <p className="text-2xl mb-2">📖</p>
              <p className="text-sm">选择一个章节开始写作</p>
              <button
                onClick={() => onCreateChapter('第一章')}
                className="mt-3 px-4 py-2 text-sm bg-accent text-white rounded hover:bg-purple-600 transition-colors"
              >
                创建第一章
              </button>
            </div>
          </div>
        )}
      </div>

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
        <div>
          <span>Ctrl+S 保存</span>
        </div>
      </div>
    </div>
  );
};

export default WritingArea;
