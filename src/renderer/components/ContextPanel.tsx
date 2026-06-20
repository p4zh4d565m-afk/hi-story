import React from 'react';
import type { Project } from '../types';

interface ContextPanelProps {
  activeProject: Project | null;
}

const ContextPanel: React.FC<ContextPanelProps> = ({ activeProject }) => {
  if (!activeProject) {
    return (
      <div className="h-full flex items-center justify-center text-gray-600 text-sm">
        <p>选择一个项目查看上下文</p>
      </div>
    );
  }

  return (
    <div className="h-full p-4 overflow-y-auto">
      <h3 className="text-sm font-semibold text-gray-300 mb-3 uppercase tracking-wide">
        项目信息
      </h3>

      <dl className="space-y-3 text-sm">
        <div>
          <dt className="text-gray-500">书名</dt>
          <dd className="text-gray-200">{activeProject.name}</dd>
        </div>
        {activeProject.typeTags.length > 0 && (
          <div>
            <dt className="text-gray-500">类型</dt>
            <dd className="flex flex-wrap gap-1 mt-0.5">
              {activeProject.typeTags.map((tag) => (
                <span
                  key={tag}
                  className="px-1.5 py-0.5 rounded text-xs bg-gray-700 text-gray-300"
                >
                  {tag}
                </span>
              ))}
            </dd>
          </div>
        )}
        {activeProject.style && (
          <div>
            <dt className="text-gray-500">风格</dt>
            <dd className="text-gray-200">{activeProject.style}</dd>
          </div>
        )}
        {activeProject.summary && (
          <div>
            <dt className="text-gray-500">简介</dt>
            <dd className="text-gray-200 text-xs leading-relaxed mt-0.5">
              {activeProject.summary}
            </dd>
          </div>
        )}
        <div>
          <dt className="text-gray-500">创建时间</dt>
          <dd className="text-gray-400 text-xs">
            {new Date(activeProject.createdAt).toLocaleDateString('zh-CN')}
          </dd>
        </div>
      </dl>
    </div>
  );
};

export default ContextPanel;
