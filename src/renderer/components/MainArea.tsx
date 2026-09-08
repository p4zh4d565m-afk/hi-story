import React, { useState } from 'react';
import WritingArea from './WritingArea';
import AIChatPanel from './AIChatPanel';
import InspirationPanel from './InspirationPanel';
import type { Project, Chapter, OutlineNode, Character, WorldEntry } from '../types';
import type { SearchResult } from '../types/search';

interface MainAreaProps {
  activeProject: Project | null;
  chapters: Chapter[];
  activeChapter: Chapter | null;
  onSelectChapter: (id: string) => void;
  onCreateChapter: (title: string) => void;
  onDeleteChapter: (id: string) => void;
  onRenameChapter?: (id: string, title: string) => void;
  onSaveChapter: (id: string, content: string) => Promise<boolean>;
  saving: boolean;
  // AI Chat
  contextMessages?: { role: 'system' | 'user' | 'assistant'; content: string }[];
  projectId?: string | null;
  // Inspiration
  showInspiration?: boolean;
  onCloseInspiration?: () => void;
}

type MainView = 'write' | 'chat';

const MainArea: React.FC<MainAreaProps> = ({
  activeProject,
  chapters,
  activeChapter,
  onSelectChapter,
  onCreateChapter,
  onDeleteChapter,
  onRenameChapter,
  onSaveChapter,
  saving,
  contextMessages = [],
  projectId,
  showInspiration = false,
  onCloseInspiration,
}) => {
  const [view, setView] = useState<MainView>('write');

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
      {/* View toggle bar */}
      <div className="flex items-center gap-0 px-1 py-1 bg-editor-800 border-b border-editor-700">
        {([
          { id: 'write' as MainView, label: '✍️ 写作', title: '写作模式' },
          { id: 'chat' as MainView, label: '💬 AI 对话', title: 'AI 对话' },
        ]).map(({ id, label, title }) => (
          <button
            key={id}
            onClick={() => setView(id)}
            className={`
              px-3 py-1 rounded text-xs transition-colors
              ${view === id
                ? 'bg-accent text-white'
                : 'text-gray-400 hover:text-white hover:bg-editor-700'
              }
            `}
            title={title}
          >
            {label}
          </button>
        ))}
        <div className="flex-1" />
        <span className="text-[10px] text-gray-600 px-2">{activeProject.name}</span>
      </div>

      {/* Main content area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Primary area */}
        <div className="flex-1 min-w-0">
          {view === 'write' && (
            <WritingArea
              activeProject={activeProject}
              chapters={chapters}
              activeChapter={activeChapter}
              onSelectChapter={onSelectChapter}
              onCreateChapter={onCreateChapter}
              onDeleteChapter={onDeleteChapter}
              onRenameChapter={onRenameChapter}
              onSaveChapter={onSaveChapter}
              saving={saving}
            />
          )}
          {view === 'chat' && (
            <AIChatPanel
              contextMessages={contextMessages}
              projectId={projectId}
              onSaveMessage={() => {}}
            />
          )}
        </div>

        {/* Inspiration side panel */}
        {showInspiration && (
          <div className="w-[360px] flex-shrink-0">
            <InspirationPanel
              open={true}
              onClose={() => onCloseInspiration?.()}
              onSendToChat={(result: SearchResult) => {
                console.log('Send to chat:', result.title);
              }}
              onSaveAsMaterial={(result: SearchResult) => {
                console.log('Save as material:', result.title);
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default MainArea;
