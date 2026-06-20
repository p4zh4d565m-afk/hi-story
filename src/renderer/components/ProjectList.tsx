import React, { useState } from 'react';
import type { Project } from '../types';

interface ProjectListProps {
  projects: Project[];
  activeProjectId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  loading: boolean;
}

const ProjectList: React.FC<ProjectListProps> = ({
  projects,
  activeProjectId,
  onSelect,
  onDelete,
  loading,
}) => {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="px-4 py-8 text-center text-gray-500 text-sm">
        加载中...
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-gray-500 text-sm">
        还没有小说项目
        <br />
        点击 + 创建第一个
      </div>
    );
  }

  return (
    <ul className="py-1">
      {projects.map((project) => (
        <li key={project.id}>
          <div
            className={`
              group flex items-center px-4 py-2.5 cursor-pointer text-sm
              ${project.id === activeProjectId
                ? 'bg-sidebar-active border-l-2 border-accent text-white'
                : 'border-l-2 border-transparent hover:bg-sidebar-hover text-gray-300'
              }
            `}
            onClick={() => onSelect(project.id)}
          >
            <span className="mr-2 text-base">📖</span>
            <span className="flex-1 truncate">{project.name}</span>

            {/* Delete button — appear on hover */}
            {confirmDeleteId === project.id ? (
              <div className="flex items-center gap-1">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(project.id);
                    setConfirmDeleteId(null);
                  }}
                  className="text-red-400 hover:text-red-300 text-xs px-1"
                >
                  确认
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmDeleteId(null);
                  }}
                  className="text-gray-400 hover:text-gray-300 text-xs px-1"
                >
                  取消
                </button>
              </div>
            ) : (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmDeleteId(project.id);
                }}
                className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 transition-all text-sm"
                title="删除项目"
              >
                🗑
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
};

export default ProjectList;
