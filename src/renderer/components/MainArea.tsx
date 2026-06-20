import React from 'react';
import type { Project } from '../types';

interface MainAreaProps {
  activeProject: Project | null;
}

const MainArea: React.FC<MainAreaProps> = ({ activeProject }) => {
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
    <div className="h-full flex flex-col items-center justify-center text-gray-400">
      <p className="text-2xl mb-2">📖 {activeProject.name}</p>
      <p className="text-sm text-gray-600">编辑器将在后续版本中上线</p>
    </div>
  );
};

export default MainArea;
