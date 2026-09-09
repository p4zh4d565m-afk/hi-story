import React from 'react';
import ProjectList from './ProjectList';
import ChapterList from './ChapterList';
import ContextMenu from './ContextMenu';
import type { Project, Chapter, Character, WorldEntry } from '../types';
import { useUndo } from '../hooks/useUndoManager';

interface SidebarProps {
  projects: Project[];
  activeProjectId: string | null;
  onSelectProject: (id: string) => void;
  onCreateProject: () => void;
  onImportNovel: () => void;
  onOpenObsidian: () => void;
  onDeleteProject: (id: string) => void;
  loading: boolean;
  // Chapter props
  chapters: Chapter[];
  activeChapterId: string | null;
  onSelectChapter: (id: string) => void;
  onCreateChapter: (title: string) => void;
  onInsertChapterAfter: (afterChapterId: string, title: string) => void;
  onDeleteChapter: (id: string) => void;
  onRenameChapter: (id: string, title: string) => void;
  chaptersLoading: boolean;
  // Character & World Entry list props
  characters: Character[];
  worldEntries: WorldEntry[];
  activeCharacterId: string | null;
  onSelectCharacter: (id: string) => void;
  onCreateCharacter: () => void;
  onDeleteCharacter: (id: string) => void;
  onRenameCharacter: (id: string, name: string) => void;
  charactersLoading: boolean;
  activeWorldEntryId: string | null;
  onSelectWorldEntry: (id: string) => void;
  onCreateWorldEntry: (category: WorldEntry['category']) => void;
  onDeleteWorldEntry: (id: string) => void;
  onRenameWorldEntry: (id: string, name: string) => void;
  worldEntriesLoading: boolean;
  // 项目 ID（用于回收站过滤）
  projectId: string | null;
}

type TabId = 'chapters' | 'characters' | 'world';

const Sidebar: React.FC<SidebarProps> = ({
  projects,
  activeProjectId,
  onSelectProject,
  onCreateProject,
  onImportNovel,
  onOpenObsidian,
  onDeleteProject,
  loading,
  chapters,
  activeChapterId,
  onSelectChapter,
  onCreateChapter,
  onInsertChapterAfter,
  onDeleteChapter,
  onRenameChapter,
  chaptersLoading,
  characters,
  worldEntries,
  activeCharacterId,
  onSelectCharacter,
  onCreateCharacter,
  onDeleteCharacter,
  onRenameCharacter,
  charactersLoading,
  activeWorldEntryId,
  onSelectWorldEntry,
  onCreateWorldEntry,
  onDeleteWorldEntry,
  onRenameWorldEntry,
  worldEntriesLoading,
  projectId,
}) => {
  const [tab, setTab] = React.useState<TabId>('chapters');

  // === Character context menu & inline rename ===
  const [charCtxMenu, setCharCtxMenu] = React.useState<{ visible: boolean; x: number; y: number; id: string }>({ visible: false, x: 0, y: 0, id: '' });
  const [renamingCharId, setRenamingCharId] = React.useState<string | null>(null);
  const [renameCharName, setRenameCharName] = React.useState('');
  const renameCharRef = React.useRef<HTMLInputElement>(null);

  // === WorldEntry context menu & inline rename ===
  const [weCtxMenu, setWeCtxMenu] = React.useState<{ visible: boolean; x: number; y: number; id: string }>({ visible: false, x: 0, y: 0, id: '' });
  const [renamingWeId, setRenamingWeId] = React.useState<string | null>(null);
  const [renameWeName, setRenameWeName] = React.useState('');
  const renameWeRef = React.useRef<HTMLInputElement>(null);

  const WORLD_CATEGORY_ICONS: Record<string, string> = {
    place: '🌍', faction: '🏛️', race: '🧬', law: '⚖️', history: '📜', culture: '🎭',
  };

  // 撤销管理器
  const { undo } = useUndo();

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-sidebar-700 flex items-center justify-between">
        <h1 className="text-lg font-bold text-accent">hi story</h1>
        <div className="flex items-center gap-0.5">
          {activeProjectId && (
            <button
              onClick={onOpenObsidian}
              className="w-7 h-7 rounded hover:bg-sidebar-hover flex items-center justify-center text-gray-400 hover:text-white transition-colors"
              title="Obsidian 资料"
            >
              📚
            </button>
          )}
          <button
            onClick={onImportNovel}
            className="w-7 h-7 rounded hover:bg-sidebar-hover flex items-center justify-center text-gray-400 hover:text-white transition-colors"
            title="导入小说"
          >
            📥
          </button>
          <button
            onClick={onCreateProject}
            className="w-7 h-7 rounded hover:bg-sidebar-hover flex items-center justify-center text-gray-400 hover:text-white transition-colors"
            title="新建小说"
          >
            +
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto divide-y divide-sidebar-700/50">
        <ProjectList
          projects={projects}
          activeProjectId={activeProjectId}
          onSelect={onSelectProject}
          onDelete={onDeleteProject}
          loading={loading}
        />

        {activeProjectId && (
          <>
            {/* Tab bar */}
            <div className="flex border-b border-sidebar-700">
              {([
                { id: 'chapters' as TabId, label: '目录', icon: '📑' },
                { id: 'characters' as TabId, label: '角色', icon: '👤' },
                { id: 'world' as TabId, label: '世界', icon: '🌍' },
              ]).map(({ id, label, icon }) => (
                <button
                  key={id}
                  onClick={() => setTab(id)}
                  className={`
                    flex-1 py-1.5 text-[10px] font-medium transition-colors
                    ${tab === id
                      ? 'text-accent border-b border-accent bg-sidebar-active/50'
                      : 'text-gray-500 hover:text-gray-300'
                    }
                  `}
                >
                  {icon} {label}
                </button>
              ))}
            </div>

            {tab === 'chapters' && (
                <ChapterList
                  chapters={chapters}
                  activeChapterId={activeChapterId}
                  onSelect={onSelectChapter}
                  onCreate={onCreateChapter}
                  onInsertAfter={onInsertChapterAfter}
                  onDelete={onDeleteChapter}
                  onRename={onRenameChapter}
                  loading={chaptersLoading}
                />
            )}

            {tab === 'characters' && (
              <div className="py-1">
                <div className="px-4 py-2 flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">角色</span>
                  <button
                    onClick={onCreateCharacter}
                    className="text-xs text-gray-400 hover:text-white transition-colors"
                  >
                    + 新角色
                  </button>
                </div>
                {charactersLoading && <div className="px-4 py-4 text-center text-gray-500 text-xs">加载中...</div>}
                {!charactersLoading && characters.length === 0 && (
                  <div className="px-4 py-4 text-center text-gray-500 text-xs">
                    还没有角色
                    <br />点击上方按钮创建
                  </div>
                )}
                <ul>
                  {characters.map((ch) => (
                    <li
                      key={ch.id}
                      onClick={() => onSelectCharacter(ch.id)}
                      onContextMenu={(e) => { e.preventDefault(); setCharCtxMenu({ visible: true, x: e.clientX, y: e.clientY, id: ch.id }); }}
                      className={`
                        px-4 py-1.5 cursor-pointer text-xs transition-colors flex items-center gap-2 group
                        ${ch.id === activeCharacterId
                          ? 'bg-sidebar-active border-l-2 border-accent text-white'
                          : 'border-l-2 border-transparent hover:bg-sidebar-hover text-gray-400'
                        }
                      `}
                    >
                      <span>👤</span>
                      {renamingCharId === ch.id ? (
                        <input
                          ref={renameCharRef}
                          type="text"
                          value={renameCharName}
                          onChange={(e) => setRenameCharName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { onRenameCharacter(ch.id, renameCharName.trim() || ch.name); setRenamingCharId(null); }
                            if (e.key === 'Escape') setRenamingCharId(null);
                          }}
                          onBlur={() => { onRenameCharacter(ch.id, renameCharName.trim() || ch.name); setRenamingCharId(null); }}
                          className="flex-1 px-1 py-0 bg-sidebar-700 border border-sidebar-700 rounded text-white text-xs
                                     focus:outline-none focus:border-accent"
                          autoFocus
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <span className="flex-1 truncate">{ch.name}</span>
                      )}
                    </li>
                  ))}
                </ul>

                {/* Character context menu */}
                <ContextMenu
                  visible={charCtxMenu.visible}
                  x={charCtxMenu.x}
                  y={charCtxMenu.y}
                  onClose={() => setCharCtxMenu(p => ({ ...p, visible: false }))}
                  items={[
                    {
                      label: '重命名',
                      icon: '✏️',
                      onClick: () => {
                        const ch = characters.find(c => c.id === charCtxMenu.id);
                        if (ch) { setRenameCharName(ch.name); setRenamingCharId(ch.id); setTimeout(() => renameCharRef.current?.focus(), 50); }
                      },
                    },
                    {
                      label: '删除',
                      icon: '🗑️',
                      danger: true,
                      onClick: () => {
                        const ch = characters.find(c => c.id === charCtxMenu.id);
                        if (ch && confirm(`确定要删除角色「${ch.name}」吗？`)) onDeleteCharacter(charCtxMenu.id);
                      },
                    },
                  ]}
                />
              </div>
            )}

            {tab === 'world' && (
              <div className="py-1">
                <div className="px-4 py-2 flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">世界观</span>
                  <button
                    onClick={() => onCreateWorldEntry('place')}
                    className="text-xs text-gray-400 hover:text-white transition-colors"
                  >
                    + 新条目
                  </button>
                </div>
                {worldEntriesLoading && <div className="px-4 py-4 text-center text-gray-500 text-xs">加载中...</div>}
                {!worldEntriesLoading && worldEntries.length === 0 && (
                  <div className="px-4 py-4 text-center text-gray-500 text-xs">
                    还没有世界观条目
                    <br />点击上方按钮创建
                  </div>
                )}
                <ul>
                  {worldEntries.map((entry) => (
                    <li
                      key={entry.id}
                      onClick={() => onSelectWorldEntry(entry.id)}
                      onContextMenu={(e) => { e.preventDefault(); setWeCtxMenu({ visible: true, x: e.clientX, y: e.clientY, id: entry.id }); }}
                      className={`
                        px-4 py-1.5 cursor-pointer text-xs transition-colors flex items-center gap-2 group
                        ${entry.id === activeWorldEntryId
                          ? 'bg-sidebar-active border-l-2 border-accent text-white'
                          : 'border-l-2 border-transparent hover:bg-sidebar-hover text-gray-400'
                        }
                      `}
                    >
                      <span>{WORLD_CATEGORY_ICONS[entry.category] || '📌'}</span>
                      {renamingWeId === entry.id ? (
                        <input
                          ref={renameWeRef}
                          type="text"
                          value={renameWeName}
                          onChange={(e) => setRenameWeName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { onRenameWorldEntry(entry.id, renameWeName.trim() || entry.name); setRenamingWeId(null); }
                            if (e.key === 'Escape') setRenamingWeId(null);
                          }}
                          onBlur={() => { onRenameWorldEntry(entry.id, renameWeName.trim() || entry.name); setRenamingWeId(null); }}
                          className="flex-1 px-1 py-0 bg-sidebar-700 border border-sidebar-700 rounded text-white text-xs
                                     focus:outline-none focus:border-accent"
                          autoFocus
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <span className="flex-1 truncate">{entry.name}</span>
                      )}
                    </li>
                  ))}
                </ul>

                {/* WorldEntry context menu */}
                <ContextMenu
                  visible={weCtxMenu.visible}
                  x={weCtxMenu.x}
                  y={weCtxMenu.y}
                  onClose={() => setWeCtxMenu(p => ({ ...p, visible: false }))}
                  items={[
                    {
                      label: '重命名',
                      icon: '✏️',
                      onClick: () => {
                        const we = worldEntries.find(w => w.id === weCtxMenu.id);
                        if (we) { setRenameWeName(we.name); setRenamingWeId(we.id); setTimeout(() => renameWeRef.current?.focus(), 50); }
                      },
                    },
                    {
                      label: '删除',
                      icon: '🗑️',
                      danger: true,
                      onClick: () => {
                        const we = worldEntries.find(w => w.id === weCtxMenu.id);
                        if (we && confirm(`确定要删除世界观条目「${we.name}」吗？`)) onDeleteWorldEntry(weCtxMenu.id);
                      },
                    },
                  ]}
                />
              </div>
            )}
          </>
        )}

        {/* ===== 撤销按钮 ===== */}
        <button
          onClick={() => undo()}
          className="w-full px-4 py-2 text-[10px] text-gray-500 hover:text-gray-300 transition-colors flex items-center justify-between border-t border-sidebar-700"
          title="撤销（Ctrl+Z）"
        >
          <span>↩ 撤销</span>
          <span className="text-[8px] text-gray-600">Ctrl+Z</span>
        </button>
      </div>
    </div>
  );
};

export default Sidebar;
