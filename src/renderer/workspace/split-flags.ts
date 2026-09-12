// 槽展开判断（P2 纯函数）
// 决定哪些槽该在 Group 里渲染为真实 Panel、哪些该卸载/折叠。
// 注意：P2 只有侧栏做「24px 边轨」；AI 关闭/最小化、右栏关闭仍是卸载（与今天一致）。

export const RAIL_PX = 24;
export const BOTTOM_MIN_PX = 120;

export interface SplitOpenFlags {
  left: boolean;
  ai: boolean;
  rightAux: boolean;
}

export function isAiChatVisible(state: {
  aiChatOpen: boolean;
  aiChatMinimized: boolean;
  aiLevel: 'off' | 'assist';
}): boolean {
  return state.aiLevel !== 'off' && state.aiChatOpen && !state.aiChatMinimized;
}

export function isRightAuxOpen(state: {
  inspirationOpen: boolean;
  referenceOpen: boolean;
  namegenOpen: boolean;
}): boolean {
  return state.inspirationOpen || state.referenceOpen || state.namegenOpen;
}

export function splitOpenFlags(state: {
  sidebarOpen: boolean;
  aiChatOpen: boolean;
  aiChatMinimized: boolean;
  aiLevel: 'off' | 'assist';
  inspirationOpen: boolean;
  referenceOpen: boolean;
  namegenOpen: boolean;
}): SplitOpenFlags {
  return {
    left: state.sidebarOpen,
    ai: isAiChatVisible(state),
    rightAux: isRightAuxOpen(state),
  };
}

// ===== P2 修复（30c08f1）的回归锚点：条件渲染 panel 的 panelIds =====
// useDefaultLayout 必须按「当前渲染的 panel 组合」传 panelIds，否则刷新后持久化 layout
// 对不上当前 panel 数、整体作废回 defaultSize。这里把三组 panelIds 的推导抽成纯函数，
// 便于单测锁「有/无右栏、有/无 AI」四种组合，避免 P3 改 Group 时再犯。

/** 外层横向 Group（h）的 panel 序列：right 是否渲染取决于右栏辅助是否打开。 */
export function horizontalPanelIds(flags: SplitOpenFlags): string[] {
  return flags.rightAux ? ['left', 'center', 'right'] : ['left', 'center'];
}

/** center 内横向 Group 的 panel 序列：AI 是否渲染取决于 AI 是否可见。 */
export function centerPanelIds(flags: SplitOpenFlags): string[] {
  return flags.ai ? ['editor', 'ai'] : ['editor'];
}

/** center 纵向 Group（v）的 panel 序列：main + bottom 恒在（bottom 始终挂载、默认折叠）。 */
export function verticalPanelIds(): string[] {
  return ['main', 'bottom'];
}
