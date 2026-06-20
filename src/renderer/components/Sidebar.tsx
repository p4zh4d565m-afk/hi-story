import React from 'react';
import ProjectList from './ProjectList';
import ChapterList from './ChapterList';
import type { Project, Chapter } from '../types';

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

      {/* Project List */}
      <div className="flex-1 overflow-y-auto divide-y divide-gray-700/50">
        <ProjectList
          projects={projects}
          activeProjectId={activeProjectId}
          onSelect={onSelectProject}
          onDelete={onDeleteProject}
          loading={loading}
        />

        {/* Chapter list — show only when a project is selected */}
        {activeProjectId && (
          <ChapterList
            chapters={chapters}
            activeChapterId={activeChapterId}
            onSelect={onSelectChapter}
            onCreate={onCreateChapter}
            onDelete={onDeleteChapter}
            loading={chaptersLoading}
          />
        )}
      </div>
    </div>
  );
};

export default Sidebar;
