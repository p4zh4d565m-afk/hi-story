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
