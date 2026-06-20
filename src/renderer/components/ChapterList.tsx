import React, { useState } from 'react';
import type { Chapter } from '../types';

interface ChapterListProps {
  chapters: Chapter[];
  activeChapterId: string | null;
  onSelect: (id: string) => void;
  onCreate: (title: string) => void;
  onDelete: (id: string) => void;
  loading: boolean;
}

const ChapterList: React.FC<ChapterListProps> = ({
  chapters,
  activeChapterId,
  onSelect,
  onCreate,
  onDelete,
  loading,
}) => {
  const [isCreating, setIsCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');

  const handleCreate = () => {
    if (!newTitle.trim()) return;
    onCreate(newTitle.trim());
    setNewTitle('');
    setIsCreating(false);
  };

  return (
    <div className="py-1">
      <div className="px-4 py-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">章节</span>
        <button
          onClick={() => setIsCreating(true)}
          className="text-xs text-gray-400 hover:text-white transition-colors"
          title="新建章节"
        >
          + 新章节
        </button>
      </div>

      {isCreating && (
        <div className="px-3 pb-2">
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate();
              if (e.key === 'Escape') { setIsCreating(false); setNewTitle(''); }
            }}
            placeholder="章节标题..."
            className="w-full px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-white text-xs
                       focus:outline-none focus:border-accent placeholder-gray-500"
            autoFocus
          />
        </div>
      )}

      {loading && chapters.length === 0 && (
        <div className="px-4 py-4 text-center text-gray-500 text-xs">加载中...</div>
      )}

      {!loading && chapters.length === 0 && !isCreating && (
        <div className="px-4 py-4 text-center text-gray-500 text-xs">
          还没有章节
          <br />
          点击上方按钮创建
        </div>
      )}

      <ul>
        {chapters.map((chapter, index) => (
          <li key={chapter.id}>
            <div
              className={`
                group flex items-center px-4 py-1.5 cursor-pointer text-sm
                ${chapter.id === activeChapterId
                  ? 'bg-sidebar-active border-l-2 border-accent text-white'
                  : 'border-l-2 border-transparent hover:bg-sidebar-hover text-gray-400'
                }
              `}
              onClick={() => onSelect(chapter.id)}
            >
              <span className="text-xs text-gray-600 w-6 flex-shrink-0">
                {index + 1}
              </span>
              <span className="flex-1 truncate text-xs">
                {chapter.title}
              </span>
              <span className="text-[10px] text-gray-600 flex-shrink-0 ml-1">
                {chapter.status === 'final' ? '📌' : '📝'}
              </span>

              {/* Delete button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(chapter.id);
                }}
                className="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-400 transition-all ml-1 text-xs"
                title="删除章节"
              >
                ×
              </button>
            </div>
          </li>
        ))}
      </ul>

      {/* Chapter stats */}
      {chapters.length > 0 && (
        <div className="px-4 py-2 border-t border-gray-700/50 mt-1">
          <p className="text-[10px] text-gray-600">
            {chapters.length} 章 · {chapters.filter(c => c.status === 'final').length} 定稿
          </p>
        </div>
      )}
    </div>
  );
};

export default ChapterList;
