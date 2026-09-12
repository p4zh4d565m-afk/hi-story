import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Group, Panel, Separator, useDefaultLayout, usePanelRef } from 'react-resizable-panels';
import { clampFloatingRect } from '../workspace/floating-rect';
import { PANEL_WIDTHS_KEY, parsePanelWidths, PANEL_WIDTH_LIMITS } from '../workspace/panel-widths';
import { splitOpenFlags, horizontalPanelIds, centerPanelIds, verticalPanelIds, RAIL_PX, BOTTOM_MIN_PX } from '../workspace/split-flags';
import { applyTheme, loadTheme, persistTheme, type ThemeName } from '../theme/theme';
import { type WorkspaceLayoutV1, type PanelId, type SlotId, isSlotVisible, PANEL_TITLES } from '../workspace/layout-model';
import SlotTabs from '../workspace/SlotTabs';

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
  mindmapOpen: boolean;
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
  // ===== P3 布局模型 =====
  layout: WorkspaceLayoutV1;
  onMovePanel: (panelId: PanelId, target: SlotId | 'floating' | 'center') => void;
  onClosePanel: (panelId: PanelId) => void;
  onSetActive: (slotId: SlotId, panelId: PanelId) => void;
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

/** 槽内渲染：SlotTabs + 当前 active 面板（PanelChrome 包着）。保活面板永远挂载（display:none 包着）。 */
const SlotView: React.FC<{
  slotId: SlotId;
  slot: WorkspaceLayoutV1['slots'][SlotId];
  panelContent: Record<PanelId, React.ReactNode>;
  onClosePanel: (panelId: PanelId) => void;
  onSetActive: (slotId: SlotId, panelId: PanelId) => void;
  onDragStart: (panelId: PanelId) => void;
  onDrop: (panelId: PanelId, target: SlotId) => void;
}> = ({ slotId, slot, panelContent, onClosePanel, onSetActive, onDragStart, onDrop }) => {
  const activeId = slot.activeId;
  return (
    <div
      className="h-full w-full flex flex-col min-h-0"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const pid = e.dataTransfer.getData('text/plain') as PanelId;
        if (pid) onDrop(pid, slotId);
      }}
    >
      <SlotTabs
        slotId={slotId}
        panelIds={slot.panelIds}
        activeId={activeId}
        onSetActive={onSetActive}
        onDragStart={slot.panelIds.length > 0 ? onDragStart : undefined}
      />
      {/* 槽内面板：全挂载、display 切显隐，切标签不丢内部 state；关闭（从 panelIds 移除）才卸载 */}
      {slot.panelIds.map((pid) => (
        <div
          key={pid}
          className="flex-1 min-h-0"
          style={{ display: activeId === pid ? 'block' : 'none' }}
        >
          {panelContent[pid]}
        </div>
      ))}
    </div>
  );
};

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
  layout, onMovePanel, onClosePanel, onSetActive,
}) => {
  const initialWidths = useMemo(() => parsePanelWidths(
    typeof localStorage === 'undefined' ? null : localStorage.getItem(PANEL_WIDTHS_KEY),
  ), []);
  const [theme, setTheme] = useState<ThemeName>(loadTheme);

  // 拖拽中的面板（HTML5 drag；onDragEnd 不显式清空也行，drop 后 movePanel 会更新 layout，但保留一个状态以便可能的视觉反馈）
  const [draggingPanel, setDraggingPanel] = useState<PanelId | null>(null);

  // panelId → 实际 ReactNode（只含「进槽」的查阅类面板；写章/审稿/润色已回浮动窗、sidebar/aiChat/mindmap 走各自渲染路径，不在此）
  const panelContent = useMemo<Record<PanelId, React.ReactNode>>(() => ({
    sidebar,
    aiChat,
    inspiration: inspirationPanel,
    reference: referencePanel,
    namegen: namegenPanel,
    outline: outlinePanel,
    material: materialPanel,
    foreshadowing: foreshadowingPanel,
    mindmap: mindmapPanel,
  }), [sidebar, aiChat, inspirationPanel, referencePanel, namegenPanel, outlinePanel, materialPanel, foreshadowingPanel, mindmapPanel]);

  // ===== P2：分隔条换库，比例用 useDefaultLayout 持久化；P0 像素只作首次 defaultSize 种子（L3，不双写）=====
  const leftRef = usePanelRef();
  const bottomRef = usePanelRef();

  // 槽展开判断：right 由 layout 决定（P3 后灵感/参考/起名走 movePanel），ai 仍由 panelState。
  // 侧栏始终挂载走 collapse，不参与 flags.left（侧栏 Panel 恒在，只折叠）。
  const rightVisible = isSlotVisible(layout, 'right');
  // bottom 可见 = 有面板（写章/审稿/润色已回浮动窗，不走 layout，bottom 只剩拖进去的查阅类面板）。
  const bottomVisible = isSlotVisible(layout, 'bottom');
  const aiVisible = panelState.aiLevel !== 'off' && panelState.aiChatOpen && !panelState.aiChatMinimized;
  // 供 horizontalPanelIds/centerPanelIds 纯函数用的 flags（left 恒 true，因为侧栏 Panel 始终挂载）
  const flags = useMemo(() => ({ left: true, ai: aiVisible, rightAux: rightVisible }), [aiVisible, rightVisible]);

  // 面板是否已打开（在任一槽里），供顶栏按钮 active 高亮
  const isPanelOpen = useCallback((pid: PanelId): boolean => {
    return (Object.keys(layout.slots) as SlotId[]).some((s) => layout.slots[s].panelIds.includes(pid));
  }, [layout]);

  // 条件渲染的 panel 组合会变（AI/右栏开关），useDefaultLayout 必须按「当前组合」传 panelIds，
  // 否则刷新后持久化的 layout（含 right/AI）对不上当前渲染的 panel 数，defaultLayout 整体作废 → 回 defaultSize。
  // 推导抽到 split-flags 的纯函数，单测锁四种组合。
  const hPanelIds = useMemo<string[]>(() => horizontalPanelIds(flags), [flags]);
  const vPanelIds = useMemo<string[]>(() => verticalPanelIds(), []);
  const cPanelIds = useMemo<string[]>(() => centerPanelIds(flags), [flags]);

  const { defaultLayout: hLayout, onLayoutChanged: onHLayout } = useDefaultLayout({
    id: 'hi-story-split-h',
    panelIds: hPanelIds,
    storage: typeof localStorage === 'undefined' ? undefined : localStorage,
  });
  const { defaultLayout: vLayout, onLayoutChanged: onVLayout } = useDefaultLayout({
    id: 'hi-story-split-v',
    panelIds: vPanelIds,
    storage: typeof localStorage === 'undefined' ? undefined : localStorage,
  });
  const { defaultLayout: cLayout, onLayoutChanged: onCLayout } = useDefaultLayout({
    id: 'hi-story-split-center',
    panelIds: cPanelIds,
    storage: typeof localStorage === 'undefined' ? undefined : localStorage,
  });

  // 双向同步 sidebarOpen ↔ Panel collapse：点 ☰ 要真 collapse Panel（否则只是内容 hidden，宽度没变）。
  // 防循环靠「状态已是目标值时 onResize 不再 toggle」，expand/collapse 触发的 onResize 不会二次 toggle。
  useEffect(() => {
    if (panelState.sidebarOpen) leftRef.current?.expand();
    else leftRef.current?.collapse();
  }, [panelState.sidebarOpen, leftRef]);

  // 库先动、状态没跟上时（拖过 minSize 折叠 / 从轨拖出展开）同步回 sidebarOpen，对称处理两个方向
  const onSidebarResize = useCallback((size: { asPercentage: number; inPixels: number }) => {
    const collapsed = size.inPixels <= RAIL_PX;
    if (panelState.sidebarOpen === collapsed) {
      onToggleSidebar();
    }
  }, [panelState.sidebarOpen, onToggleSidebar]);

  // bottom 槽双向同步：有面板才展开（resize 到合理高度，expand() 只到 minSize=120 太矮）、挂条、生效 minSize；
  // 无面板 collapse 到 0 + 不挂条（保住三个 AI 实例不卸）。
  useEffect(() => {
    if (bottomVisible) {
      if (bottomRef.current?.isCollapsed()) {
        bottomRef.current?.resize('40%');
      }
    } else {
      bottomRef.current?.collapse();
    }
  }, [bottomVisible, bottomRef]);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

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

      const vp = { width: window.innerWidth, height: window.innerHeight };
      if (d.type === 'move') {
        setRect(clampFloatingRect({ x: r.x + dx, y: r.y + dy, w: r.w, h: r.h }, vp, MIN_FLOAT_W, MIN_FLOAT_H));
      } else {
        let { x, y, w, h } = r;
        if (d.edge.includes('e')) w = Math.max(MIN_FLOAT_W, r.w + dx);
        if (d.edge.includes('w')) { const nw = Math.max(MIN_FLOAT_W, r.w - dx); x = r.x + r.w - nw; w = nw; }
        if (d.edge.includes('s')) h = Math.max(MIN_FLOAT_H, r.h + dy);
        if (d.edge.includes('n')) { const nh = Math.max(MIN_FLOAT_H, r.h - dy); y = r.y + r.h - nh; h = nh; }
        setRect(clampFloatingRect({ x, y, w, h }, vp, MIN_FLOAT_W, MIN_FLOAT_H));
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

  useEffect(() => {
    const onResize = () => {
      const vp = { width: window.innerWidth, height: window.innerHeight };
      const clamp = (rect: { x: number; y: number; w: number; h: number }) =>
        clampFloatingRect(rect, vp, MIN_FLOAT_W, MIN_FLOAT_H);
      setMindmapRect(clamp);
      setMaterialRect(clamp);
      setOutlineRect(clamp);
      setForeshadowingRect(clamp);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

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
    <div className="h-full bg-gray-950 text-gray-100 relative overflow-hidden">
      <Group
        id="hi-story-split-h"
        orientation="horizontal"
        className="h-full w-full"
        defaultLayout={hLayout}
        onLayoutChanged={onHLayout}
      >
        {/* ===== SIDEBAR（左，始终挂载，可折叠成 24px 轨）===== */}
        <Panel
          id="left"
          panelRef={leftRef}
          collapsible
          collapsedSize={RAIL_PX}
          minSize={PANEL_WIDTH_LIMITS.sidebar.min}
          maxSize={PANEL_WIDTH_LIMITS.sidebar.max}
          defaultSize={initialWidths.sidebar}
          onResize={onSidebarResize}
        >
          <div className="h-full w-full relative overflow-hidden" style={{ fontSize: `${uiZoom * 100}%` }}>
            <aside className="h-full w-full border-r border-sidebar-700 bg-sidebar-900" hidden={!panelState.sidebarOpen}>
              {sidebar}
            </aside>
            {!panelState.sidebarOpen && (
              <button
                onClick={onToggleSidebar}
                className="absolute inset-0 flex items-center justify-center bg-sidebar-900 border-r border-sidebar-700 text-gray-400 hover:text-gray-100"
                title="展开侧栏"
              >
                ☰
              </button>
            )}
          </div>
        </Panel>
        <Separator className="w-1.5 bg-transparent hover:bg-accent/50" />
        <Panel id="center" minSize={360}>
          <Group
            id="hi-story-split-v"
            orientation="vertical"
            className="h-full w-full"
            defaultLayout={vLayout}
            onLayoutChanged={onVLayout}
          >
            <Panel id="main" minSize={200}>
              {/* ===== MAIN WRITING AREA ===== */}
              <main className="h-full flex flex-col min-h-0">
        {/* Top toolbar (UI domain zoom) */}
        <div className="flex items-center gap-1 px-2 py-1 bg-editor-800 border-b border-editor-700 flex-wrap"
          style={{ fontSize: `${uiZoom * 100}%` }}>
          {/* Sidebar toggle */}
          <button onClick={onToggleSidebar}
            className={`px-2 py-1 rounded text-xs transition-colors ${panelState.sidebarOpen ? 'text-gray-400 hover:text-gray-100' : 'text-accent bg-accent/10'}`}
            title="切换侧栏">
            ☰
          </button>

          <div className="flex bg-editor-700 rounded overflow-hidden ml-1">
            <button onClick={() => onSetWorkspaceMode('planning')}
              className={`px-3 py-1 text-xs transition-colors ${workspaceMode === 'planning' ? 'bg-accent text-white' : 'text-gray-400 hover:text-gray-100'}`}
              title="从创意生成故事方案、大纲和章纲">
              🧭 策划
            </button>
            <button onClick={() => onSetWorkspaceMode('writing')}
              className={`px-3 py-1 text-xs transition-colors ${workspaceMode === 'writing' ? 'bg-accent text-white' : 'text-gray-400 hover:text-gray-100'}`}
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
            <button
              onClick={() => {
                const next = theme === 'dark' ? 'light' : 'dark';
                applyTheme(next);
                persistTheme(next);
                setTheme(next);
              }}
              className="px-2 py-1 rounded text-xs text-gray-400 hover:text-gray-100 hover:bg-editor-700"
              title="切换浅色/深色主题"
            >
              {theme === 'dark' ? '☀️ 浅色' : '🌙 深色'}
            </button>
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
                    : 'text-gray-400 hover:text-gray-100'
                }`}
                title={title}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Inspiration toggle */}
          <button onClick={onToggleInspiration}
            className={`px-2 py-1 rounded text-xs transition-colors ${isPanelOpen('inspiration') ? 'text-accent bg-accent/10' : 'text-gray-400 hover:text-gray-100'}`}
            title="灵感搜索 (Ctrl+Shift+I)">
            🔍 灵感
          </button>

          {/* Outline toggle */}
          <button onClick={onToggleOutline}
            className={`px-2 py-1 rounded text-xs transition-colors ${isPanelOpen('outline') ? 'text-accent bg-accent/10' : 'text-gray-400 hover:text-gray-100'}`}
            title="大纲面板">
            📋 大纲
          </button>

          {/* Mindmap toggle */}
          <button onClick={onToggleMindmap}
            className={`px-2 py-1 rounded text-xs transition-colors ${panelState.mindmapOpen ? 'text-accent bg-accent/10' : 'text-gray-400 hover:text-gray-100'}`}
            title="角色思维导图">
            🧠 导图
          </button>


          {/* Material panel toggle */}
          <button onClick={onToggleMaterial}
            className={`px-2 py-1 rounded text-xs transition-colors ${isPanelOpen('material') ? 'text-accent bg-accent/10' : 'text-gray-400 hover:text-gray-100'}`}
            title="素材管理">
            📦 素材
          </button>

          {/* Reference toggle — 参考库匹配面板 */}
          <button onClick={onToggleReference}
            className={`px-2 py-1 rounded text-xs transition-colors ${isPanelOpen('reference') ? 'text-accent bg-accent/10' : 'text-gray-400 hover:text-gray-100'}`}
            title="参考匹配">
            📚 参考
          </button>

          {/* Name Generator toggle — 起名助手 */}
          <button onClick={onToggleNamegen}
            className={`px-2 py-1 rounded text-xs transition-colors ${isPanelOpen('namegen') ? 'text-accent bg-accent/10' : 'text-gray-400 hover:text-gray-100'}`}
            title="起名助手">
            🧙 起名
          </button>

          {/* AI Write toggle — AI 写章 */}
          <button onClick={onToggleAiWrite}
            className={`px-2 py-1 rounded text-xs transition-colors ${panelState.aiWriteOpen ? 'text-accent bg-accent/10' : 'text-gray-400 hover:text-gray-100'}`}
            title="AI 写章 (Ctrl+Shift+W)">
            🤖 写章
          </button>

          {/* AI Review toggle — AI 审稿 */}
          <button onClick={onToggleAiReview}
            className={`px-2 py-1 rounded text-xs transition-colors ${panelState.aiReviewOpen ? 'text-accent bg-accent/10' : 'text-gray-400 hover:text-gray-100'}`}
            title="AI 审稿 (Ctrl+Shift+R)">
            🔍 审稿
          </button>

          {/* AI Polish toggle — 去 AI 味润色 */}
          <button onClick={onToggleAiPolish}
            className={`px-2 py-1 rounded text-xs transition-colors ${panelState.aiPolishOpen ? 'text-accent bg-accent/10' : 'text-gray-400 hover:text-gray-100'}`}
            title="去 AI 味润色">
            ✨ 润色
          </button>

          {/* Foreshadowing toggle — 伏笔追踪 */}
          <button onClick={onToggleForeshadowing}
            className={`px-2 py-1 rounded text-xs transition-colors ${isPanelOpen('foreshadowing') ? 'text-accent bg-accent/10' : 'text-gray-400 hover:text-gray-100'}`}
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
              className={`px-2 py-1 rounded text-xs transition-colors ml-1 ${panelState.aiChatOpen ? 'text-accent bg-accent/10' : 'text-gray-400 hover:text-gray-100'}`}
              title="AI 对话">
              💬 AI
            </button>
          )
          )}
        </div>

        {/* Content area — 写作/策划 与 AI 对话用横向 Group（AI 关闭=卸载列，L1） */}
        <Group
          id="hi-story-split-center"
          orientation="horizontal"
          className="flex-1 min-h-0"
          defaultLayout={cLayout}
          onLayoutChanged={onCLayout}
        >
          {/* 策划与写作共用主区域，数据保持在同一个小说项目中 */}
          <Panel id="editor" minSize={280}>
            <div className="h-full w-full overflow-hidden">
              {/* 保留编辑器及待保存内容，切换页面时自动保存仍可继续执行。 */}
              <div className="h-full" hidden={workspaceMode !== 'writing'}>{writingArea}</div>
              {workspaceMode === 'planning' && planningArea}
            </div>
          </Panel>

          {flags.ai && <Separator className="w-1.5 bg-transparent hover:bg-accent/50" />}
          {flags.ai && (
            <Panel
              id="ai"
              minSize={PANEL_WIDTH_LIMITS.aiChat.min}
              maxSize={PANEL_WIDTH_LIMITS.aiChat.max}
              defaultSize={initialWidths.aiChat}
            >
              <aside className="h-full w-full border-l border-aichat-700 bg-aichat-900 overflow-hidden">
                <div className="h-full relative zoom-container" style={{ fontSize: `${panelsZoom * 100}%` }}>
                  {/* Minimize button — positioned below the AI header so it doesn't cover ⚙️ */}
                  <button onClick={onMinimizeAiChat}
                    className="absolute top-2 left-2 w-6 h-6 rounded bg-aichat-700 text-gray-400 hover:text-gray-100 hover:bg-aichat-600 text-xs z-10"
                    title="最小化 AI 对话">
                    _
                  </button>
                  {aiChat}
                </div>
              </aside>
            </Panel>
          )}
        </Group>
      </main>
            </Panel>
            {bottomVisible && <Separator className="h-1.5 bg-transparent hover:bg-accent/50" />}
            <Panel
              id="bottom"
              panelRef={bottomRef}
              collapsible
              collapsedSize={0}
              minSize={bottomVisible ? BOTTOM_MIN_PX : 0}
              defaultSize={0}
            >
              <SlotView
                slotId="bottom"
                slot={layout.slots.bottom}
                panelContent={panelContent}
                onClosePanel={onClosePanel}
                onSetActive={onSetActive}
                onDragStart={(pid) => setDraggingPanel(pid)}
                onDrop={(pid, target) => { onMovePanel(pid, target); setDraggingPanel(null); }}
              />
            </Panel>
          </Group>
        </Panel>
        {rightVisible && <Separator className="w-1.5 bg-transparent hover:bg-accent/50" />}
        {rightVisible && (
          <Panel
            id="right"
            minSize={PANEL_WIDTH_LIMITS.insp.min}
            maxSize={PANEL_WIDTH_LIMITS.insp.max}
            defaultSize={initialWidths.insp}
          >
            <SlotView
              slotId="right"
              slot={layout.slots.right}
              panelContent={panelContent}
              onClosePanel={onClosePanel}
              onSetActive={onSetActive}
              onDragStart={(pid) => setDraggingPanel(pid)}
              onDrop={(pid, target) => { onMovePanel(pid, target); setDraggingPanel(null); }}
            />
          </Panel>
        )}
      </Group>

      {/* ===== 浮动 AI 面板（保活：display:none 不卸载，生成中的流不断）===== */}
      <div style={{ display: panelState.aiWriteOpen ? 'block' : 'none' }}>
        {aiWritePanel}
      </div>
      <div style={{ display: panelState.aiReviewOpen ? 'block' : 'none' }}>
        {aiReviewPanel}
      </div>
      <div style={{ display: panelState.aiPolishOpen ? 'block' : 'none' }}>
        {aiPolishPanel}
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
              <button onClick={onToggleMindmap} className="text-gray-500 hover:text-gray-100 text-xs">✕</button>
            </div>
            <div className="flex-1 overflow-hidden p-2">
              {mindmapPanel}
            </div>
            {/* 边缘调整大小手柄（8 方向） */}
            {renderResizeHandles('mindmap', mindmapRect)}
          </div>
        </div>
      )}

    </div>
  );
};

export default DockLayout;
