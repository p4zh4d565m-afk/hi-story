import React from 'react';

interface LayoutProps {
  sidebar: React.ReactNode;
  main: React.ReactNode;
  contextPanel?: React.ReactNode;
  showContextPanel?: boolean;
}

const Layout: React.FC<LayoutProps> = ({ sidebar, main, contextPanel, showContextPanel = true }) => {
  return (
    <div className="h-full flex bg-gray-900 text-gray-100">
      {/* 左侧导航栏 */}
      <aside className="w-[280px] flex-shrink-0 border-r border-gray-700 bg-sidebar">
        {sidebar}
      </aside>

      {/* 中间主区域 */}
      <main className="flex-1 min-w-0">
        {main}
      </main>

      {/* 右侧上下文面板 */}
      {showContextPanel && contextPanel && (
        <aside className="w-[320px] flex-shrink-0 border-l border-gray-700 bg-sidebar">
          {contextPanel}
        </aside>
      )}
    </div>
  );
};

export default Layout;
