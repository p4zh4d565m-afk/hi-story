import React from 'react';
import type { Project, Chapter, OutlineNode, Character, WorldEntry } from '../types';
import type { SearchResult } from '../types/search';
import CharacterCard from './CharacterCard';
import WorldEntryCard from './WorldEntryCard';
import RelationshipGraph from './RelationshipGraph';

interface ContextPanelProps {
  activeProject: Project | null;
  activeChapter?: Chapter | null;
  activeOutlineNode?: OutlineNode | null;
  characters?: Character[];
  worldEntries?: WorldEntry[];
  relationships?: { source: string; target: string; type: string }[];
  selectedCharacter?: Character | null;
  selectedWorldEntry?: WorldEntry | null;
  onSelectCharacter?: (ch: Character | null) => void;
  onSaveCharacter?: (data: Partial<Character>) => void;
  onCloseCharacter?: () => void;
  onSaveWorldEntry?: (data: Partial<WorldEntry>) => void;
  onDeleteWorldEntry?: (id: string) => void;
  onCloseWorldEntry?: () => void;
}

const ContextPanel: React.FC<ContextPanelProps> = ({
  activeProject,
  activeChapter,
  activeOutlineNode,
  characters = [],
  worldEntries = [],
  relationships = [],
  selectedCharacter,
  selectedWorldEntry,
  onSelectCharacter,
  onSaveCharacter,
  onCloseCharacter,
  onSaveWorldEntry,
  onDeleteWorldEntry,
  onCloseWorldEntry,
}) => {
  // Show world entry editor if selected
  if (selectedWorldEntry && onSaveWorldEntry && onDeleteWorldEntry && onCloseWorldEntry) {
    return (
      <WorldEntryCard
        entry={selectedWorldEntry}
        onSave={onSaveWorldEntry}
        onDelete={onDeleteWorldEntry}
        onClose={onCloseWorldEntry}
      />
    );
  }

  // Show character editor if a character is selected
  if (selectedCharacter) {
    return (
      <div className="h-full">
        <CharacterCard
          character={selectedCharacter}
          onSave={(data) => onSaveCharacter?.(data)}
          onClose={() => onCloseCharacter?.()}
        />
      </div>
    );
  }

  if (!activeProject) {
    return (
      <div className="h-full flex items-center justify-center text-gray-600 text-sm">
        <p>选择一个项目查看上下文</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      {/* Project Info */}
      <div className="p-4 border-b border-gray-700/50">
        <h3 className="text-sm font-semibold text-gray-300 mb-3 uppercase tracking-wide">
          📖 {activeProject.name}
        </h3>
        <dl className="space-y-2 text-sm">
          {activeProject.typeTags.length > 0 && (
            <div>
              <dt className="text-gray-500 text-xs">类型</dt>
              <dd className="flex flex-wrap gap-1 mt-0.5">
                {activeProject.typeTags.map((tag) => (
                  <span key={tag} className="px-1.5 py-0.5 rounded text-[10px] bg-gray-700 text-gray-300">
                    {tag}
                  </span>
                ))}
              </dd>
            </div>
          )}
          {activeProject.style && (
            <div>
              <dt className="text-gray-500 text-xs">风格</dt>
              <dd className="text-gray-300 text-xs">{activeProject.style}</dd>
            </div>
          )}
          {activeProject.summary && (
            <div>
              <dt className="text-gray-500 text-xs">简介</dt>
              <dd className="text-gray-400 text-xs leading-relaxed mt-0.5">{activeProject.summary}</dd>
            </div>
          )}
        </dl>
      </div>

      {/* Current Chapter Info */}
      {activeChapter && (
        <div className="p-4 border-b border-gray-700/50">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">当前章节</h3>
          <p className="text-sm text-gray-300">{activeChapter.title}</p>
          <div className="flex items-center gap-3 mt-1 text-[10px] text-gray-600">
            <span>{activeChapter.wordCount.toLocaleString()} 字</span>
            <span>{activeChapter.status === 'final' ? '📌 定稿' : '📝 草稿'}</span>
          </div>
        </div>
      )}

      {/* Outline Node Detail */}
      {activeOutlineNode && (
        <div className="p-4 border-b border-gray-700/50">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">大纲节点</h3>
          <p className="text-sm text-gray-300">{activeOutlineNode.title}</p>
          {activeOutlineNode.summary && (
            <p className="text-xs text-gray-500 mt-1">{activeOutlineNode.summary}</p>
          )}
        </div>
      )}

      {/* Characters */}
      {characters.length > 0 && (
        <div className="p-4 border-b border-gray-700/50">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            角色 ({characters.length})
          </h3>
          <ul className="space-y-1">
            {characters.map((ch) => (
              <li
                key={ch.id}
                className="text-xs text-gray-400 hover:text-white cursor-pointer px-2 py-1 rounded hover:bg-gray-800 transition-colors"
                onClick={() => onSelectCharacter?.(ch)}
              >
                👤 {ch.name}
                {ch.aliases && <span className="text-gray-600 ml-1">({ch.aliases})</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* World Entries */}
      {worldEntries.length > 0 && (
        <div className="p-4 border-b border-gray-700/50">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            世界观 ({worldEntries.length})
          </h3>
          <ul className="space-y-1">
            {worldEntries.map((entry) => (
              <li
                key={entry.id}
                className="text-xs text-gray-400 hover:text-white cursor-pointer px-2 py-1 rounded hover:bg-gray-800 transition-colors"
              >
                <span className="text-[10px]">
                  {entry.category === 'place' && '🌍'}
                  {entry.category === 'faction' && '🏛️'}
                  {entry.category === 'race' && '🧬'}
                  {entry.category === 'law' && '⚖️'}
                  {entry.category === 'history' && '📜'}
                  {entry.category === 'culture' && '🎭'}
                </span>{' '}
                {entry.name}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Relationship Graph */}
      {characters.length >= 2 && relationships.length > 0 && (
        <div className="p-4">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">角色关系</h3>
          <RelationshipGraph
            characters={characters.map(c => ({ id: c.id, name: c.name }))}
            relationships={relationships}
            width={288}
            height={300}
          />
        </div>
      )}

      {characters.length === 0 && worldEntries.length === 0 && !activeChapter && !activeOutlineNode && (
        <div className="p-4 text-center text-gray-600 text-xs">
          <p>暂无上下文</p>
          <p className="mt-1">创建角色、世界观后</p>
          <p>相关信息会自动显示在这里</p>
        </div>
      )}
    </div>
  );
};

export default ContextPanel;
