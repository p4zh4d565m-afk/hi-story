import React from 'react';
import ProjectList from './ProjectList';
import ChapterList from './ChapterList';
import OutlineTree from './OutlineTree';
import type { Project, Chapter, OutlineNode, Character, WorldEntry } from '../types';

interface SidebarProps {
  projects: Project[];
  activeProjectId: string | null;
  onSelectProject: (id: string) => void;
  onCreateProject: () => void;
  onDeleteProject: (id: string) => void;
  loading: boolean;
  // Chapter props
  chapters: Chapter[];
  activeChapterId: string | null;
  onSelectChapter: (id: string) => void;
  onCreateChapter: (title: string) => void;
  onDeleteChapter: (id: string) => void;
  chaptersLoading: boolean;
  // Outline props
  outlineNodes: OutlineNode[];
  activeOutlineNodeId: string | null;
  onSelectOutlineNode: (id: string) => void;
  onCreateOutlineNode: (parentId: string | null, title: string) => void;
  onDeleteOutlineNode: (id: string) => void;
  onUpdateOutlineNode: (id: string, title: string, summary: string) => void;
  outlineLoading: boolean;
  // Character & World Entry list props
  characters: Character[];
  worldEntries: WorldEntry[];
  activeCharacterId: string | null;
  onSelectCharacter: (id: string) => void;
  onCreateCharacter: () => void;
  charactersLoading: boolean;
  activeWorldEntryId: string | null;
  onSelectWorldEntry: (id: string) => void;
  onCreateWorldEntry: (category: WorldEntry['category']) => void;
  worldEntriesLoading: boolean;
}

type TabId = 'structure' | 'characters' | 'world';

const Sidebar: React.FC<SidebarProps> = ({
  projects,
  activeProjectId,
  onSelectProject,
  onCreateProject,
  onDeleteProject,
  loading,
  chapters,
  activeChapterId,
  onSelectChapter,
  onCreateChapter,
  onDeleteChapter,
  chaptersLoading,
  outlineNodes,
  activeOutlineNodeId,
  onSelectOutlineNode,
  onCreateOutlineNode,
  onDeleteOutlineNode,
  onUpdateOutlineNode,
  outlineLoading,
  characters,
  worldEntries,
  activeCharacterId,
  onSelectCharacter,
  onCreateCharacter,
  charactersLoading,
  activeWorldEntryId,
  onSelectWorldEntry,
  onCreateWorldEntry,
  worldEntriesLoading,
}) => {
  const [tab, setTab] = React.useState<TabId>('structure');

  const WORLD_CATEGORY_ICONS: Record<string, string> = {
    place: '🌍', faction: '🏛️', race: '🧬', law: '⚖️', history: '📜', culture: '🎭',
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
        <h1 className="text-lg font-bold text-accent">hi story</h1>
        <button
          onClick={onCreateProject}
          className="w-7 h-7 rounded hover:bg-sidebar-hover flex items-center justify-center text-gray-400 hover:text-white transition-colors"
          title="新建小说"
        >
          +
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto divide-y divide-gray-700/50">
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
            <div className="flex border-b border-gray-700">
              {([
                { id: 'structure' as TabId, label: '结构', icon: '🗂' },
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

            {tab === 'structure' && (
              <>
                <OutlineTree
                  nodes={outlineNodes}
                  activeNodeId={activeOutlineNodeId}
                  onSelect={onSelectOutlineNode}
                  onCreate={onCreateOutlineNode}
                  onDelete={onDeleteOutlineNode}
                  onUpdate={onUpdateOutlineNode}
                  loading={outlineLoading}
                />
                <ChapterList
                  chapters={chapters}
                  activeChapterId={activeChapterId}
                  onSelect={onSelectChapter}
                  onCreate={onCreateChapter}
                  onDelete={onDeleteChapter}
                  loading={chaptersLoading}
                />
              </>
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
                      className={`
                        px-4 py-1.5 cursor-pointer text-xs transition-colors flex items-center gap-2
                        ${ch.id === activeCharacterId
                          ? 'bg-sidebar-active border-l-2 border-accent text-white'
                          : 'border-l-2 border-transparent hover:bg-sidebar-hover text-gray-400'
                        }
                      `}
                    >
                      <span>👤</span>
                      <span className="flex-1 truncate">{ch.name}</span>
                    </li>
                  ))}
                </ul>
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
                      className={`
                        px-4 py-1.5 cursor-pointer text-xs transition-colors flex items-center gap-2
                        ${entry.id === activeWorldEntryId
                          ? 'bg-sidebar-active border-l-2 border-accent text-white'
                          : 'border-l-2 border-transparent hover:bg-sidebar-hover text-gray-400'
                        }
                      `}
                    >
                      <span>{WORLD_CATEGORY_ICONS[entry.category] || '📌'}</span>
                      <span className="flex-1 truncate">{entry.name}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default Sidebar;
