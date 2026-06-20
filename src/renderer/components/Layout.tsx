import React, { useState, useRef, useCallback } from 'react';

interface LayoutProps {
  sidebar: React.ReactNode;
  main: React.ReactNode;
  contextPanel?: React.ReactNode;
  showContextPanel?: boolean;
}

const Layout: React.FC<LayoutProps> = ({ sidebar, main, contextPanel, showContextPanel = true }) => {
  // ===== Sidebar resize =====
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const sidebarResizing = useRef(false);

  const handleSidebarResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    sidebarResizing.current = true;
    const startX = e.clientX;
    const startW = sidebarWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: MouseEvent) => {
      if (!sidebarResizing.current) return;
      const w = Math.max(220, Math.min(400, startW + (ev.clientX - startX)));
      setSidebarWidth(w);
    };
    const onUp = () => {
      sidebarResizing.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [sidebarWidth]);

  // ===== Context panel resize =====
  const [contextWidth, setContextWidth] = useState(320);
  const contextResizing = useRef(false);

  const handleContextResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    contextResizing.current = true;
    const startX = e.clientX;
    const startW = contextWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: MouseEvent) => {
      if (!contextResizing.current) return;
      // Context panel is on the right, resize by dragging left handle
      const w = Math.max(240, Math.min(600, startW - (ev.clientX - startX)));
      setContextWidth(w);
    };
    const onUp = () => {
      contextResizing.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [contextWidth]);

  return (
    <div className="h-full flex bg-gray-900 text-gray-100">
      {/* 左侧导航栏 */}
      <aside className="flex-shrink-0 border-r border-gray-700 bg-sidebar" style={{ width: sidebarWidth }}>
        {sidebar}
      </aside>

      {/* Sidebar resize handle */}
      <div
        className="w-1.5 hover:w-2 cursor-col-resize bg-transparent hover:bg-accent/50 transition-all flex-shrink-0 z-10"
        onMouseDown={handleSidebarResizeStart}
        title="拖拽调整侧栏宽度"
      />

      {/* 中间主区域 */}
      <main className="flex-1 min-w-0">
        {main}
      </main>

      {/* 右侧上下文面板 */}
      {showContextPanel && contextPanel && (
        <>
          {/* Context panel resize handle */}
          <div
            className="w-1.5 hover:w-2 cursor-col-resize bg-transparent hover:bg-accent/50 transition-all flex-shrink-0 z-10"
            onMouseDown={handleContextResizeStart}
            title="拖拽调整面板宽度"
          />
          <aside className="flex-shrink-0 border-l border-gray-700 bg-sidebar" style={{ width: contextWidth }}>
            {contextPanel}
          </aside>
        </>
      )}
    </div>
  );
};

export default Layout;
