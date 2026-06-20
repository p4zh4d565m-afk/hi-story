import React, { useState, useRef, useCallback, useEffect } from 'react';

// ============================================================
// 可拖拽面板布局
// - 侧栏: 左侧，可折叠
// - 中间: 写作区
// - AI 对话: 右侧或浮动，可最小化
// - 上下文面板: 右侧，可关闭
// - 灵感面板: 右侧，可关闭
// - 角色思维导图: 右下浮动
// ============================================================

interface PanelState {
  sidebarOpen: boolean;
  aiChatOpen: boolean;
  aiChatMinimized: boolean;
  contextOpen: boolean;
  inspirationOpen: boolean;
  mindmapOpen: boolean;
}

interface DockLayoutProps {
  sidebar: React.ReactNode;
  writingArea: React.ReactNode;
  aiChat: React.ReactNode;
  contextPanel: React.ReactNode;
  inspirationPanel: React.ReactNode;
  mindmapPanel: React.ReactNode;
  panelState: PanelState;
  onToggleSidebar: () => void;
  onToggleAiChat: () => void;
  onMinimizeAiChat: () => void;
  onToggleContext: () => void;
  onToggleInspiration: () => void;
  onToggleMindmap: () => void;
}

const DockLayout: React.FC<DockLayoutProps> = ({
  sidebar, writingArea, aiChat, contextPanel, inspirationPanel, mindmapPanel,
  panelState, onToggleSidebar, onToggleAiChat, onMinimizeAiChat, onToggleContext, onToggleInspiration, onToggleMindmap,
}) => {
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [aiChatWidth, setAiChatWidth] = useState(380);
  const [contextWidth, setContextWidth] = useState(320);
  const [inspWidth, setInspWidth] = useState(360);

  // ===== Draggable resize =====
  const useResize = (initialWidth: number, setWidth: (w: number) => void, min: number, max: number, dir: 'left' | 'right' = 'right') => {
    const resizing = useRef(false);
    const startX = useRef(0);
    const startW = useRef(initialWidth);

    const onDown = useCallback((e: React.MouseEvent) => {
      e.preventDefault();
      resizing.current = true;
      startX.current = e.clientX;
      startW.current = initialWidth;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const onMove = (ev: MouseEvent) => {
        if (!resizing.current) return;
        const delta = ev.clientX - startX.current;
        const newW = dir === 'right'
          ? Math.max(min, Math.min(max, startW.current + delta))
          : Math.max(min, Math.min(max, startW.current - delta));
        setWidth(newW);
      };
      const onUp = () => {
        resizing.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    }, [initialWidth, min, max, dir]);

    return onDown;
  };

  const handleSidebarResize = useResize(sidebarWidth, setSidebarWidth, 200, 420, 'right');
  const handleAiChatResize = useResize(aiChatWidth, setAiChatWidth, 300, 700, 'left');
  const handleContextResize = useResize(contextWidth, setContextWidth, 240, 600, 'left');
  const handleInspResize = useResize(inspWidth, setInspWidth, 300, 600, 'left');

  return (
    <div className="h-full flex bg-gray-900 text-gray-100 relative overflow-hidden">
      {/* ===== SIDEBAR ===== */}
      {panelState.sidebarOpen && (
        <>
          <aside className="flex-shrink-0 border-r border-gray-700 bg-sidebar overflow-hidden" style={{ width: sidebarWidth }}>
            {sidebar}
          </aside>
          <div className="w-1.5 hover:w-2 cursor-col-resize bg-transparent hover:bg-accent/50 flex-shrink-0 z-10"
            onMouseDown={handleSidebarResize} title="拖拽调整侧栏宽度" />
        </>
      )}

      {/* ===== MAIN WRITING AREA ===== */}
      <main className="flex-1 min-w-0 flex flex-col">
        {/* Top toolbar */}
        <div className="flex items-center gap-1 px-2 py-1 bg-gray-800 border-b border-gray-700">
          {/* Sidebar toggle */}
          <button onClick={onToggleSidebar}
            className={`px-2 py-1 rounded text-xs transition-colors ${panelState.sidebarOpen ? 'text-gray-400 hover:text-white' : 'text-accent bg-accent/10'}`}
            title="切换侧栏">
            ☰
          </button>

          <div className="flex-1" />

          {/* Inspiration toggle */}
          <button onClick={onToggleInspiration}
            className={`px-2 py-1 rounded text-xs transition-colors ${panelState.inspirationOpen ? 'text-accent bg-accent/10' : 'text-gray-400 hover:text-white'}`}
            title="灵感搜索 (Ctrl+Shift+I)">
            🔍 灵感
          </button>

          {/* Mindmap toggle */}
          <button onClick={onToggleMindmap}
            className={`px-2 py-1 rounded text-xs transition-colors ${panelState.mindmapOpen ? 'text-accent bg-accent/10' : 'text-gray-400 hover:text-white'}`}
            title="角色思维导图">
            🧠 导图
          </button>

          {/* Context toggle */}
          <button onClick={onToggleContext}
            className={`px-2 py-1 rounded text-xs transition-colors ${panelState.contextOpen ? 'text-accent bg-accent/10' : 'text-gray-400 hover:text-white'}`}
            title="上下文面板">
            📋 详情
          </button>

          {/* AI Chat toggle (minimized = floating button) */}
          {panelState.aiChatMinimized ? (
            <button onClick={() => onMinimizeAiChat()}
              className="ml-1 w-10 h-10 rounded-full bg-accent text-white text-lg shadow-lg hover:bg-purple-600 flex items-center justify-center fixed bottom-4 right-4 z-50 animate-pulse"
              title="展开 AI 对话">
              💬
            </button>
          ) : (
            <button onClick={onToggleAiChat}
              className={`px-2 py-1 rounded text-xs transition-colors ml-1 ${panelState.aiChatOpen ? 'text-accent bg-accent/10' : 'text-gray-400 hover:text-white'}`}
              title="AI 对话">
              💬 AI
            </button>
          )}
        </div>

        {/* Content area */}
        <div className="flex-1 flex overflow-hidden">
          {/* Writing */}
          <div className="flex-1 min-w-0 overflow-hidden">
            {writingArea}
          </div>

          {/* AI Chat panel (dockable, resizable) */}
          {panelState.aiChatOpen && !panelState.aiChatMinimized && (
            <>
              <div className="w-1.5 hover:w-2 cursor-col-resize bg-transparent hover:bg-accent/50 flex-shrink-0 z-10"
                onMouseDown={handleAiChatResize} title="拖拽调整 AI 对话宽度" />
              <aside className="flex-shrink-0 border-l border-gray-700 bg-gray-900 overflow-hidden" style={{ width: aiChatWidth }}>
                <div className="h-full relative">
                  {aiChat}
                  {/* Minimize button */}
                  <button onClick={onMinimizeAiChat}
                    className="absolute top-2 right-2 w-6 h-6 rounded bg-gray-700 text-gray-400 hover:text-white hover:bg-gray-600 text-xs z-10"
                    title="最小化 AI 对话">
                    _
                  </button>
                </div>
              </aside>
            </>
          )}
        </div>
      </main>

      {/* ===== RIGHT SIDE PANELS (stacked) ===== */}
      <div className="flex-shrink-0 flex">
        {/* Context panel */}
        {panelState.contextOpen && (
          <>
            <div className="w-1.5 hover:w-2 cursor-col-resize bg-transparent hover:bg-accent/50 flex-shrink-0 z-10"
              onMouseDown={handleContextResize} title="拖拽调整面板宽度" />
            <aside className="flex-shrink-0 border-l border-gray-700 bg-sidebar overflow-hidden" style={{ width: contextWidth }}>
              {contextPanel}
            </aside>
          </>
        )}

        {/* Inspiration panel */}
        {panelState.inspirationOpen && (
          <>
            <div className="w-1.5 hover:w-2 cursor-col-resize bg-transparent hover:bg-accent/50 flex-shrink-0 z-10"
              onMouseDown={handleInspResize} title="拖拽调整宽度" />
            <aside className="flex-shrink-0 border-l border-gray-700 bg-sidebar overflow-hidden" style={{ width: inspWidth }}>
              {inspirationPanel}
            </aside>
          </>
        )}
      </div>

      {/* ===== FLOATING MINDMAP ===== */}
      {panelState.mindmapOpen && (
        <div className="fixed inset-0 z-40 pointer-events-none">
          <div className="absolute top-12 right-4 bottom-4 w-[500px] pointer-events-auto bg-gray-900 border border-gray-700 rounded-lg shadow-2xl overflow-hidden flex flex-col"
            style={{ resize: 'both', minWidth: 350, minHeight: 300 }}>
            <div className="px-3 py-2 bg-gray-800 border-b border-gray-700 flex items-center justify-between cursor-move">
              <span className="text-xs text-gray-400">🧠 角色思维导图</span>
              <button onClick={onToggleMindmap} className="text-gray-500 hover:text-white text-xs">✕</button>
            </div>
            <div className="flex-1 overflow-auto p-2">
              {mindmapPanel}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DockLayout;
