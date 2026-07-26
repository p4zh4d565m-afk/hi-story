import React, { useState, useRef, useEffect } from 'react';
import type { Chapter } from '../types';
import ContextMenu from './ContextMenu';

interface ChapterListProps {
  chapters: Chapter[];
  activeChapterId: string | null;
  onSelect: (id: string) => void;
  onCreate: (title: string) => void;
  onInsertAfter: (afterChapterId: string, title: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  loading: boolean;
}

const ChapterList: React.FC<ChapterListProps> = ({
  chapters,
  activeChapterId,
  onSelect,
  onCreate,
  onInsertAfter,
  onDelete,
  onRename,
  loading,
}) => {
  const [isCreating, setIsCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [contextMenu, setContextMenu] = useState<{ visible: boolean; x: number; y: number; chapterId: string }>({
    visible: false, x: 0, y: 0, chapterId: '',
  });
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  const handleCreate = () => {
    if (!newTitle.trim()) return;
    onCreate(newTitle.trim());
    setNewTitle('');
    setIsCreating(false);
  };

  const handleContextMenu = (e: React.MouseEvent, chapterId: string) => {
    e.preventDefault();
    setContextMenu({ visible: true, x: e.clientX, y: e.clientY, chapterId });
  };

  const handleRenameStart = (chapterId: string) => {
    const ch = chapters.find(c => c.id === chapterId);
    if (ch) {
      setRenamingId(chapterId);
      setRenameTitle(ch.title);
    }
  };

  const handleRenameConfirm = () => {
    if (renamingId && renameTitle.trim()) {
      onRename(renamingId, renameTitle.trim());
    }
    setRenamingId(null);
    setRenameTitle('');
  };

  const handleInsertAfter = (afterChapterId: string) => {
    const afterCh = chapters.find(c => c.id === afterChapterId);
    // 自动生成标题：基于被点击章节的序号 + 1
    const defaultTitle = afterCh ? `第${afterCh.sortOrder + 2}章` : '新章节';
    onInsertAfter(afterChapterId, defaultTitle);
  };

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

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
            className="w-full px-2 py-1.5 bg-sidebar-700 border border-sidebar-700 rounded text-white text-xs
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
              onContextMenu={(e) => handleContextMenu(e, chapter.id)}
            >
              {renamingId === chapter.id ? (
                <input
                  ref={renameInputRef}
                  type="text"
                  value={renameTitle}
                  onChange={(e) => setRenameTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRenameConfirm();
                    if (e.key === 'Escape') { setRenamingId(null); setRenameTitle(''); }
                  }}
          onBlur={handleRenameConfirm}
                  onClick={(e) => e.stopPropagation()}
                  className="flex-1 px-1 py-0 bg-sidebar-700 border border-accent rounded text-white text-xs
                             focus:outline-none"
                />
              ) : (
                <span className="flex-1 truncate text-xs">
                  {chapter.title}
                </span>
              )}
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
        <div className="px-4 py-2 border-t border-sidebar-700/50 mt-1">
          <p className="text-[10px] text-gray-600">
            {chapters.length} 章 · {chapters.filter(c => c.status === 'final').length} 定稿
          </p>
        </div>
      )}

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
              onCreate(`第${nextNum}章`);
            },
          },
          {
            label: '在下方插入',
            icon: '📥',
            onClick: () => handleInsertAfter(contextMenu.chapterId),
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
                onDelete(contextMenu.chapterId);
              }
            },
          },
        ]}
      />
    </div>
  );
};

export default ChapterList;
