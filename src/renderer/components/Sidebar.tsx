import React from 'react';
import ProjectList from './ProjectList';
import ChapterList from './ChapterList';
import OutlineTree from './OutlineTree';
import type { Project, Chapter, OutlineNode } from '../types';

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
}

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
}) => {
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
      </div>
    </div>
  );
};

export default Sidebar;
