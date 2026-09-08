import React, { useState, useRef, useCallback, useEffect } from 'react';

// ============================================================
// 可拖拽面板布局
// - 侧栏: 左侧，可折叠
// - 中间: 写作区
// - AI 对话: 右侧或浮动，可最小化
// - 灵感面板: 右侧，可关闭
// - 角色思维导图: 右下浮动
// - 大纲: 浮动面板
// - 字体缩放: 三个域 — editor(编辑器)/panels(面板)/ui(界面)
// ============================================================

// 字体缩放预设值
const PANEL_ZOOM_VALUES = [0.85, 1.0, 1.15, 1.3];
const UI_ZOOM_VALUES = [0.9, 1.0, 1.1, 1.2];
const PRESET_LABELS = ['小', '中', '大', '特大'];

interface PanelState {
  sidebarOpen: boolean;
  aiChatOpen: boolean;
  aiChatMinimized: boolean;
  inspirationOpen: boolean;
  mindmapOpen: boolean;
  materialOpen: boolean;
  outlineOpen: boolean;
  referenceOpen: boolean;
  namegenOpen: boolean;
  aiWriteOpen: boolean;
  aiReviewOpen: boolean;
  aiPolishOpen: boolean;
  foreshadowingOpen: boolean;
  aiLevel: 'off' | 'assist';  // AI participation level
}

type FontSizePreset = 0 | 1 | 2 | 3;
interface FontSizes { editor: FontSizePreset; panels: FontSizePreset; ui: FontSizePreset; }

interface DockLayoutProps {
  sidebar: React.ReactNode;
  writingArea: React.ReactNode;
  planningArea: React.ReactNode;
  aiChat: React.ReactNode;
  inspirationPanel: React.ReactNode;
  mindmapPanel: React.ReactNode;
  materialPanel: React.ReactNode;
  outlinePanel: React.ReactNode;
  referencePanel: React.ReactNode;
  namegenPanel: React.ReactNode;
  aiWritePanel: React.ReactNode;
  aiReviewPanel: React.ReactNode;
  aiPolishPanel: React.ReactNode;
  foreshadowingPanel: React.ReactNode;
  panelState: PanelState;
  onToggleSidebar: () => void;
  onToggleAiChat: () => void;
  onMinimizeAiChat: () => void;
  onToggleInspiration: () => void;
  onToggleMindmap: () => void;
  onToggleMaterial: () => void;
  onToggleOutline: () => void;
  onToggleReference: () => void;
  onToggleNamegen: () => void;
  onToggleAiWrite: () => void;
  onToggleAiReview: () => void;
  onToggleAiPolish: () => void;
  onToggleForeshadowing: () => void;
  onSetAiLevel: (level: 'off' | 'assist') => void;
  workspaceMode: 'planning' | 'writing';
  onSetWorkspaceMode: (mode: 'planning' | 'writing') => void;
  fontSizes: FontSizes;
  onSetFontSize: (domain: keyof FontSizes, preset: FontSizePreset) => void;
}

/** 小字号下拉选择器（面板/界面） */
const FontSizeSelect: React.FC<{
  value: number; onChange: (v: number) => void; title?: string;
}> = ({ value, onChange, title }) => (
  <select
    value={value}
    onChange={(e) => onChange(Number(e.target.value))}
    className="bg-editor-700 border border-editor-600 rounded text-[10px] text-gray-400 px-1 py-0.5 focus:outline-none focus:border-accent cursor-pointer"
    title={title}
  >
    {PRESET_LABELS.map((l, i) => (
      <option key={i} value={i}>{l}</option>
    ))}
  </select>
);

const DockLayout: React.FC<DockLayoutProps> = ({
  sidebar, writingArea, planningArea, aiChat, contextPanel, inspirationPanel, mindmapPanel,
  materialPanel, outlinePanel, referencePanel, namegenPanel,
  aiWritePanel, aiReviewPanel, aiPolishPanel, foreshadowingPanel,
  panelState, onToggleSidebar, onToggleAiChat, onMinimizeAiChat, onToggleInspiration, onToggleMindmap,
  onToggleMaterial, onToggleOutline, onToggleReference, onToggleNamegen,
  onToggleAiWrite, onToggleAiReview, onToggleAiPolish, onToggleForeshadowing,
  onSetAiLevel,
  workspaceMode, onSetWorkspaceMode,
  fontSizes, onSetFontSize,
}) => {
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [aiChatWidth, setAiChatWidth] = useState(380);
  const [inspWidth, setInspWidth] = useState(360);

  // 当前缩放值（通过 fontSize 实现，避免 CSS zoom 干扰输入框）
  const panelsZoom = PANEL_ZOOM_VALUES[fontSizes.panels];
  const uiZoom = UI_ZOOM_VALUES[fontSizes.ui];

  // ===== 浮动面板位置和尺寸（支持拖拽移动 + 边缘调整大小）=====
  const getInitialMindmapRect = () => {
    const w = 500, h = Math.max(300, window.innerHeight - 96);
    return { x: Math.max(0, window.innerWidth - w - 40), y: 48, w, h };
  };
  const getInitialMaterialRect = () => {
    const w = Math.max(500, window.innerWidth - 160), h = Math.max(400, window.innerHeight - 96);
    return { x: 120, y: 104, w, h };
  };
  const getInitialOutlineRect = () => {
    const w = Math.max(600, window.innerWidth - 300), h = Math.max(400, window.innerHeight - 120);
    return { x: Math.max(50, (window.innerWidth - w) / 2), y: 60, w, h };
  };
  const getInitialForeshadowingRect = () => {
    const w = Math.max(720, window.innerWidth - 400), h = Math.max(500, window.innerHeight - 120);
    return { x: Math.max(80, (window.innerWidth - w) / 2), y: 50, w, h };
  };

  const [mindmapRect, setMindmapRect] = useState(getInitialMindmapRect);
  const [materialRect, setMaterialRect] = useState(getInitialMaterialRect);
  const [outlineRect, setOutlineRect] = useState(getInitialOutlineRect);
  const [foreshadowingRect, setForeshadowingRect] = useState(getInitialForeshadowingRect);

  // 浮动面板拖拽/调整大小统一管理
  interface FloatingDrag {
    panel: 'mindmap' | 'material' | 'outline' | 'foreshadowing';
    type: 'move' | 'resize';
    edge: string; // n, s, e, w, ne, nw, se, sw
    startMouseX: number; startMouseY: number;
    startRect: { x: number; y: number; w: number; h: number };
  }
  const floatingDragRef = useRef<FloatingDrag | null>(null);
  const MIN_FLOAT_W = 300, MIN_FLOAT_H = 200;

  // 光标映射
  const RESIZE_CURSORS: Record<string, string> = {
    n: 'n-resize', s: 's-resize', e: 'e-resize', w: 'w-resize',
    ne: 'ne-resize', nw: 'nw-resize', se: 'se-resize', sw: 'sw-resize',
  };

  // 启动浮动面板拖拽/调整大小
  const startFloatingDrag = (
    panel: FloatingDrag['panel'], type: FloatingDrag['type'], edge: string,
    rect: { x: number; y: number; w: number; h: number }, e: React.MouseEvent,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const cursor = type === 'move' ? 'move' : (RESIZE_CURSORS[edge] || 'default');
    document.body.style.cursor = cursor;
    document.body.style.userSelect = 'none';
    floatingDragRef.current = { panel, type, edge, startMouseX: e.clientX, startMouseY: e.clientY, startRect: { ...rect } };
  };

  // 统一的鼠标移动/释放处理（浮动面板）
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = floatingDragRef.current;
      if (!d) return;

      const dx = e.clientX - d.startMouseX;
      const dy = e.clientY - d.startMouseY;
      const r = d.startRect;

      const setRect = d.panel === 'mindmap' ? setMindmapRect : d.panel === 'material' ? setMaterialRect : d.panel === 'outline' ? setOutlineRect : setForeshadowingRect;

      if (d.type === 'move') {
        setRect({ x: r.x + dx, y: r.y + dy, w: r.w, h: r.h });
      } else {
        let { x, y, w, h } = r;
        if (d.edge.includes('e')) w = Math.max(MIN_FLOAT_W, r.w + dx);
        if (d.edge.includes('w')) { const nw = Math.max(MIN_FLOAT_W, r.w - dx); x = r.x + r.w - nw; w = nw; }
        if (d.edge.includes('s')) h = Math.max(MIN_FLOAT_H, r.h + dy);
        if (d.edge.includes('n')) { const nh = Math.max(MIN_FLOAT_H, r.h - dy); y = r.y + r.h - nh; h = nh; }
        setRect({ x, y, w, h });
      }
    };

    const onUp = () => {
      if (floatingDragRef.current) {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        floatingDragRef.current = null;
      }
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, []);

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
  const handleInspResize = useResize(inspWidth, setInspWidth, 300, 600, 'left');

  // ── 渲染浮动面板的 8 方向调整大小手柄 ──
  // 注意：手柄缩小范围避免覆盖标题栏，标题栏 z-index 设为更高
  const EDGE_BAR_STYLE: React.CSSProperties = { position: 'absolute', zIndex: 5, pointerEvents: 'auto' };
  const EDGES: { edge: string; style: React.CSSProperties }[] = [
    { edge: 'n',  style: { top: 0, left: 8, right: 8, height: 4, cursor: 'n-resize' } },
    { edge: 's',  style: { bottom: 0, left: 8, right: 8, height: 4, cursor: 's-resize' } },
    { edge: 'w',  style: { left: 0, top: 8, bottom: 8, width: 4, cursor: 'w-resize' } },
    { edge: 'e',  style: { right: 0, top: 8, bottom: 8, width: 4, cursor: 'e-resize' } },
    { edge: 'nw', style: { top: 0, left: 0, width: 10, height: 10, cursor: 'nw-resize' } },
    { edge: 'ne', style: { top: 0, right: 0, width: 10, height: 10, cursor: 'ne-resize' } },
    { edge: 'sw', style: { bottom: 0, left: 0, width: 10, height: 10, cursor: 'sw-resize' } },
    { edge: 'se', style: { bottom: 0, right: 0, width: 10, height: 10, cursor: 'se-resize' } },
  ];

  const renderResizeHandles = (
    panel: FloatingDrag['panel'],
    rect: { x: number; y: number; w: number; h: number },
  ) => (
    <>
      {EDGES.map(({ edge, style }) => (
        <div
          key={edge}
          style={{ ...EDGE_BAR_STYLE, ...style }}
          onMouseDown={e => startFloatingDrag(panel, 'resize', edge, rect, e)}
        />
      ))}
    </>
  );

  return (
    <div className="h-full flex bg-gray-950 text-gray-100 relative overflow-hidden">
      {/* ===== SIDEBAR ===== */}
      {panelState.sidebarOpen && (
        <>
          <aside className="flex-shrink-0 border-r border-sidebar-700 bg-sidebar-900 overflow-hidden"
            style={{ width: sidebarWidth, fontSize: `${uiZoom * 100}%` }}>
            {sidebar}
          </aside>
          <div className="w-1.5 hover:w-2 cursor-col-resize bg-transparent hover:bg-accent/50 flex-shrink-0 z-10"
            onMouseDown={handleSidebarResize} title="拖拽调整侧栏宽度" />
        </>
      )}

      {/* ===== MAIN WRITING AREA ===== */}
      <main className="flex-1 min-w-0 flex flex-col">
        {/* Top toolbar (UI domain zoom) */}
        <div className="flex items-center gap-1 px-2 py-1 bg-editor-800 border-b border-editor-700"
          style={{ fontSize: `${uiZoom * 100}%` }}>
          {/* Sidebar toggle */}
          <button onClick={onToggleSidebar}
            className={`px-2 py-1 rounded text-xs transition-colors ${panelState.sidebarOpen ? 'text-gray-400 hover:text-white' : 'text-accent bg-accent/10'}`}
            title="切换侧栏">
            ☰
          </button>

          <div className="flex bg-editor-700 rounded overflow-hidden ml-1">
            <button onClick={() => onSetWorkspaceMode('planning')}
              className={`px-3 py-1 text-xs transition-colors ${workspaceMode === 'planning' ? 'bg-accent text-white' : 'text-gray-400 hover:text-white'}`}
              title="从创意生成故事方案、大纲和章纲">
              🧭 策划
            </button>
            <button onClick={() => onSetWorkspaceMode('writing')}
              className={`px-3 py-1 text-xs transition-colors ${workspaceMode === 'writing' ? 'bg-accent text-white' : 'text-gray-400 hover:text-white'}`}
              title="自己写作或使用 AI 起草、续写">
              ✍️ 写作
            </button>
          </div>

          <div className="flex-1" />

          {/* ── 字体缩放控件 ── */}
          <div className="flex items-center gap-1 mr-1">
            <span className="text-[10px] text-gray-500" title="面板字体">📋面板</span>
            <FontSizeSelect value={fontSizes.panels}
              onChange={(v) => onSetFontSize('panels', v as FontSizePreset)} title="面板字体" />
            <span className="text-[10px] text-gray-500 ml-1" title="界面字体">🖥界面</span>
            <FontSizeSelect value={fontSizes.ui}
              onChange={(v) => onSetFontSize('ui', v as FontSizePreset)} title="界面字体" />
          </div>

          {/* AI participation level */}
          <div className="flex bg-editor-700 rounded overflow-hidden">
            {([
              { level: 'off' as const, label: '🖊️ 纯写', title: '零参与 — 纯编辑器模式' },
              { level: 'assist' as const, label: '✨ 辅助', title: '辅助参与 — AI润色/建议' },
            ]).map(({ level, label, title }) => (
              <button
                key={level}
                onClick={() => onSetAiLevel(level)}
                className={`px-2 py-1 text-[10px] transition-colors ${
                  panelState.aiLevel === level
                    ? 'bg-accent text-white'
                    : 'text-gray-400 hover:text-white'
                }`}
                title={title}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Inspiration toggle */}
          <button onClick={onToggleInspiration}
            className={`px-2 py-1 rounded text-xs transition-colors ${panelState.inspirationOpen ? 'text-accent bg-accent/10' : 'text-gray-400 hover:text-white'}`}
            title="灵感搜索 (Ctrl+Shift+I)">
            🔍 灵感
          </button>

          {/* Outline toggle */}
          <button onClick={onToggleOutline}
            className={`px-2 py-1 rounded text-xs transition-colors ${panelState.outlineOpen ? 'text-accent bg-accent/10' : 'text-gray-400 hover:text-white'}`}
            title="大纲面板">
            📋 大纲
          </button>

          {/* Mindmap toggle */}
          <button onClick={onToggleMindmap}
            className={`px-2 py-1 rounded text-xs transition-colors ${panelState.mindmapOpen ? 'text-accent bg-accent/10' : 'text-gray-400 hover:text-white'}`}
            title="角色思维导图">
            🧠 导图
          </button>


          {/* Material panel toggle */}
          <button onClick={onToggleMaterial}
            className={`px-2 py-1 rounded text-xs transition-colors ${panelState.materialOpen ? 'text-accent bg-accent/10' : 'text-gray-400 hover:text-white'}`}
            title="素材管理">
            📦 素材
          </button>

          {/* Reference toggle — 参考库匹配面板 */}
          <button onClick={onToggleReference}
            className={`px-2 py-1 rounded text-xs transition-colors ${panelState.referenceOpen ? 'text-accent bg-accent/10' : 'text-gray-400 hover:text-white'}`}
            title="参考匹配">
            📚 参考
          </button>

          {/* Name Generator toggle — 起名助手 */}
          <button onClick={onToggleNamegen}
            className={`px-2 py-1 rounded text-xs transition-colors ${panelState.namegenOpen ? 'text-accent bg-accent/10' : 'text-gray-400 hover:text-white'}`}
            title="起名助手">
            🧙 起名
          </button>

          {/* AI Write toggle — AI 写章 */}
          <button onClick={onToggleAiWrite}
            className={`px-2 py-1 rounded text-xs transition-colors ${panelState.aiWriteOpen ? 'text-accent bg-accent/10' : 'text-gray-400 hover:text-white'}`}
            title="AI 写章 (Ctrl+Shift+W)">
            🤖 写章
          </button>

          {/* AI Review toggle — AI 审稿 */}
          <button onClick={onToggleAiReview}
            className={`px-2 py-1 rounded text-xs transition-colors ${panelState.aiReviewOpen ? 'text-accent bg-accent/10' : 'text-gray-400 hover:text-white'}`}
            title="AI 审稿 (Ctrl+Shift+R)">
            🔍 审稿
          </button>

          {/* AI Polish toggle — 去 AI 味润色 */}
          <button onClick={onToggleAiPolish}
            className={`px-2 py-1 rounded text-xs transition-colors ${panelState.aiPolishOpen ? 'text-accent bg-accent/10' : 'text-gray-400 hover:text-white'}`}
            title="去 AI 味润色">
            ✨ 润色
          </button>

          {/* Foreshadowing toggle — 伏笔追踪 */}
          <button onClick={onToggleForeshadowing}
            className={`px-2 py-1 rounded text-xs transition-colors ${panelState.foreshadowingOpen ? 'text-accent bg-accent/10' : 'text-gray-400 hover:text-white'}`}
            title="伏笔追踪 (Ctrl+Shift+F)">
            🪢 伏笔
          </button>

          {/* AI Chat toggle — hidden when aiLevel is 'off' */}
          {panelState.aiLevel !== 'off' && (
            panelState.aiChatMinimized ? (
            <button onClick={() => onMinimizeAiChat()}
              className="ml-1 w-10 h-10 rounded-full bg-accent text-white text-lg shadow-lg hover:bg-accent-hover flex items-center justify-center fixed bottom-4 right-4 z-50 animate-pulse"
              title="展开 AI 对话">
              💬
            </button>
          ) : (
            <button onClick={onToggleAiChat}
              className={`px-2 py-1 rounded text-xs transition-colors ml-1 ${panelState.aiChatOpen ? 'text-accent bg-accent/10' : 'text-gray-400 hover:text-white'}`}
              title="AI 对话">
              💬 AI
            </button>
          )
          )}
        </div>

        {/* Content area */}
        <div className="flex-1 flex overflow-hidden">
          {/* 策划与写作共用主区域，数据保持在同一个小说项目中 */}
          <div className="flex-1 min-w-0 overflow-hidden">
            {/* 保留编辑器及待保存内容，切换页面时自动保存仍可继续执行。 */}
            <div className="h-full" hidden={workspaceMode !== 'writing'}>{writingArea}</div>
            {workspaceMode === 'planning' && planningArea}
          </div>

          {/* AI Chat panel (dockable, resizable) — hidden when aiLevel is 'off' */}
          {panelState.aiChatOpen && !panelState.aiChatMinimized && panelState.aiLevel !== 'off' && (
            <>
              <div className="w-1.5 hover:w-2 cursor-col-resize bg-transparent hover:bg-accent/50 flex-shrink-0 z-10"
                onMouseDown={handleAiChatResize} title="拖拽调整 AI 对话宽度" />
              <aside className="flex-shrink-0 border-l border-aichat-700 bg-aichat-900 overflow-hidden" style={{ width: aiChatWidth }}>
                <div className="h-full relative zoom-container" style={{ fontSize: `${panelsZoom * 100}%` }}>
                  {/* Minimize button — positioned below the AI header so it doesn't cover ⚙️ */}
                  <button onClick={onMinimizeAiChat}
                    className="absolute top-2 left-2 w-6 h-6 rounded bg-aichat-700 text-gray-400 hover:text-white hover:bg-aichat-600 text-xs z-10"
                    title="最小化 AI 对话">
                    _
                  </button>
                  {aiChat}
                </div>
              </aside>
            </>
          )}
        </div>
      </main>

      {/* ===== RIGHT SIDE PANELS (stacked) ===== */}
      <div className="flex-shrink-0 flex">
        {/* Inspiration panel */}
        {panelState.inspirationOpen && (
          <>
            <div className="w-1.5 hover:w-2 cursor-col-resize bg-transparent hover:bg-accent/50 flex-shrink-0 z-10"
              onMouseDown={handleInspResize} title="拖拽调整宽度" />
            <aside className="flex-shrink-0 border-l border-inspiration-700 bg-inspiration-900 overflow-hidden" style={{ width: inspWidth }}>
              <div style={{ fontSize: `${panelsZoom * 100}%`, height: '100%' }}>
                {inspirationPanel}
              </div>
            </aside>
          </>
        )}

        {/* Reference panel — 参考库匹配 */}
        {panelState.referenceOpen && (
          <>
            <div className="w-1.5 hover:w-2 cursor-col-resize bg-transparent hover:bg-accent/50 flex-shrink-0 z-10"
              onMouseDown={handleInspResize} title="拖拽调整宽度" />
            <aside className="flex-shrink-0 border-l border-context-700 bg-context-900 overflow-hidden" style={{ width: inspWidth }}>
              <div style={{ fontSize: `${panelsZoom * 100}%`, height: '100%' }}>
                {referencePanel}
              </div>
            </aside>
          </>
        )}

        {/* Name Generator panel — 起名助手 */}
        {panelState.namegenOpen && (
          <>
            <div className="w-1.5 hover:w-2 cursor-col-resize bg-transparent hover:bg-accent/50 flex-shrink-0 z-10"
              onMouseDown={handleInspResize} title="拖拽调整宽度" />
            <aside className="flex-shrink-0 border-l border-float-700 bg-float-900 overflow-hidden" style={{ width: inspWidth }}>
              <div style={{ fontSize: `${panelsZoom * 100}%`, height: '100%' }}>
                {namegenPanel}
              </div>
            </aside>
          </>
        )}
      </div>

      {/* ===== FLOATING MINDMAP ===== */}
      {panelState.mindmapOpen && (
        <div className="fixed inset-0 z-40 pointer-events-none">
          <div
            className="absolute pointer-events-auto bg-float-900 border border-float-700 rounded-lg shadow-2xl overflow-hidden flex flex-col"
            style={{
              left: mindmapRect.x, top: mindmapRect.y,
              width: mindmapRect.w, height: mindmapRect.h,
            }}
          >
            {/* 标题栏（拖拽移动）— z-index 高于 resize 手柄 */}
            <div
              className="px-3 py-2 bg-float-800 border-b border-float-700 flex items-center justify-between cursor-move select-none relative z-10"
              onMouseDown={e => startFloatingDrag('mindmap', 'move', '', mindmapRect, e)}
            >
              <span className="text-xs text-gray-400">🧠 角色思维导图</span>
              <button onClick={onToggleMindmap} className="text-gray-500 hover:text-white text-xs">✕</button>
            </div>
            <div className="flex-1 overflow-hidden p-2">
              {mindmapPanel}
            </div>
            {/* 边缘调整大小手柄（8 方向） */}
            {renderResizeHandles('mindmap', mindmapRect)}
          </div>
        </div>
      )}

      {/* ===== FLOATING MATERIAL PANEL ===== */}
      {panelState.materialOpen && (
        <div className="fixed inset-0 z-40 pointer-events-none">
          <div
            className="absolute pointer-events-auto bg-float-900 border border-float-700 rounded-lg shadow-2xl overflow-hidden flex flex-col"
            style={{
              left: materialRect.x, top: materialRect.y,
              width: materialRect.w, height: materialRect.h,
            }}
          >
            <div
              className="px-3 py-2 bg-float-800 border-b border-float-700 flex items-center justify-between cursor-move select-none"
              onMouseDown={e => startFloatingDrag('material', 'move', '', materialRect, e)}
            >
              <span className="text-xs text-gray-400">📦 素材管理</span>
              <button onClick={onToggleMaterial} className="text-gray-500 hover:text-white text-xs">✕</button>
            </div>
            <div className="flex-1 overflow-hidden" style={{ fontSize: `${panelsZoom * 100}%` }}>
              {materialPanel}
            </div>
            {renderResizeHandles('material', materialRect)}
          </div>
        </div>
      )}

      {/* ===== FLOATING OUTLINE PANEL ===== */}
      {panelState.outlineOpen && (
        <div className="fixed inset-0 z-40 pointer-events-none">
          <div
            className="absolute pointer-events-auto bg-float-900 border border-float-700 rounded-lg shadow-2xl overflow-hidden flex flex-col"
            style={{
              left: outlineRect.x, top: outlineRect.y,
              width: outlineRect.w, height: outlineRect.h,
            }}
          >
            <div
              className="px-3 py-2 bg-float-800 border-b border-float-700 flex items-center justify-between cursor-move select-none"
              onMouseDown={e => startFloatingDrag('outline', 'move', '', outlineRect, e)}
            >
              <span className="text-xs text-gray-400">📋 大纲面板</span>
              <button onClick={onToggleOutline} className="text-gray-500 hover:text-white text-xs">✕</button>
            </div>
            <div className="flex-1 overflow-hidden outline-panel-container" style={{ fontSize: `${panelsZoom * 100}%` }}>
              {outlinePanel}
            </div>
            {renderResizeHandles('outline', outlineRect)}
          </div>
        </div>
      )}

      {/* ===== FLOATING AI WRITE PANEL ===== */}
      <div style={{ display: panelState.aiWriteOpen ? 'block' : 'none' }}>
        {aiWritePanel}
      </div>

      {/* ===== FLOATING AI REVIEW PANEL ===== */}
      <div style={{ display: panelState.aiReviewOpen ? 'block' : 'none' }}>
        {aiReviewPanel}
      </div>

      {/* ===== FLOATING AI POLISH PANEL ===== */}
      <div style={{ display: panelState.aiPolishOpen ? 'block' : 'none' }}>
        {aiPolishPanel}
      </div>

      {/* ===== FLOATING FORESHADOWING PANEL ===== */}
      {panelState.foreshadowingOpen && (
        <div className="fixed inset-0 z-40 pointer-events-none">
          <div
            className="absolute pointer-events-auto bg-float-900 border border-float-700 rounded-lg shadow-2xl overflow-hidden flex flex-col"
            style={{
              left: foreshadowingRect.x, top: foreshadowingRect.y,
              width: foreshadowingRect.w, height: foreshadowingRect.h,
            }}
          >
            <div
              className="px-3 py-2 bg-float-800 border-b border-float-700 flex items-center justify-between cursor-move select-none"
              onMouseDown={e => startFloatingDrag('foreshadowing', 'move', '', foreshadowingRect, e)}
            >
              <span className="text-xs text-gray-400">🪢 伏笔追踪</span>
              <button onClick={onToggleForeshadowing} className="text-gray-500 hover:text-white text-xs">✕</button>
            </div>
            <div className="flex-1 overflow-hidden" style={{ fontSize: `${panelsZoom * 100}%` }}>
              {foreshadowingPanel}
            </div>
            {renderResizeHandles('foreshadowing', foreshadowingRect)}
          </div>
        </div>
      )}
    </div>
  );
};

export default DockLayout;
