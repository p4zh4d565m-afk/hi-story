import React from 'react';
import type { Project } from '../types';
import RichEditor from './editor/RichEditor';

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
    <div className="h-full flex flex-col">
      {/* Chapter header */}
      <div className="px-6 py-3 border-b border-gray-700 bg-gray-800 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">{activeProject.name}</h2>
          <p className="text-xs text-gray-500">
            类型: {activeProject.typeTags.length > 0 ? activeProject.typeTags.join(' · ') : '未设置'}
          </p>
        </div>
        <div className="text-xs text-gray-500">
          风格: {activeProject.style || '未设置'}
        </div>
      </div>

      {/* Editor area */}
      <div className="flex-1 overflow-hidden">
        <RichEditor
          placeholder={`继续写「${activeProject.name}」...`}
          onUpdate={(html) => {
            // Will be wired to chapter persistence in Task 10
            console.log('Editor updated:', html.length, 'chars');
          }}
        />
      </div>
    </div>
  );
};

export default MainArea;
