// Workspace 布局模型（P3 纯函数）
// 管「面板归属哪个槽、槽内谁 active」，不碰槽的像素/百分比（那是 react-resizable-panels 的 useDefaultLayout）。
// 本轮只迁六个浮窗工具 + 灵感/参考/起名 + 侧栏；aiChat 仍留 P2 的 center 内侧列，movePanel 拒绝 aiChat。

export type SlotId = 'left' | 'right' | 'bottom';

export type PanelId =
  | 'sidebar'
  | 'aiChat'
  | 'inspiration'
  | 'reference'
  | 'namegen'
  | 'outline'
  | 'material'
  | 'foreshadowing'
  | 'aiWrite'
  | 'aiReview'
  | 'aiPolish'
  | 'mindmap';

export interface SlotState {
  panelIds: PanelId[];
  activeId: PanelId | null;
}

export interface WorkspaceLayoutV1 {
  version: 1;
  slots: Record<SlotId, SlotState>;
  floating: PanelId[];
}

export const DEFAULT_LAYOUT: WorkspaceLayoutV1 = {
  version: 1,
  slots: {
    left: { panelIds: ['sidebar'], activeId: 'sidebar' },
    right: { panelIds: [], activeId: null },
    bottom: { panelIds: [], activeId: null },
  },
  floating: [],
};

/** 打开面板时的默认槽（3+3 定案：大纲/素材/伏笔/灵感/参考/起名 → right；写章/审稿/润色 → bottom）。 */
export const DEFAULT_SLOT: Partial<Record<PanelId, SlotId>> = {
  outline: 'right',
  material: 'right',
  foreshadowing: 'right',
  inspiration: 'right',
  reference: 'right',
  namegen: 'right',
  aiWrite: 'bottom',
  aiReview: 'bottom',
  aiPolish: 'bottom',
};

/** 只能在 left 的面板。 */
const LEFT_ONLY: PanelId[] = ['sidebar'];

/** 允许 floating 的面板（仅导图）。 */
const FLOATING_ALLOWED: PanelId[] = ['mindmap'];

/** 固定归属、拒绝 movePanel 的面板：aiChat（P2 center 内侧列）+ 三个保活面板（P3 固定 bottom，走 display 开合不入归属模型）。 */
const FIXED_PANELS: PanelId[] = ['aiChat', 'aiWrite', 'aiReview', 'aiPolish'];

type Target = SlotId | 'floating' | 'center';

function clone(l: WorkspaceLayoutV1): WorkspaceLayoutV1 {
  return {
    version: 1,
    slots: {
      left: { panelIds: [...l.slots.left.panelIds], activeId: l.slots.left.activeId },
      right: { panelIds: [...l.slots.right.panelIds], activeId: l.slots.right.activeId },
      bottom: { panelIds: [...l.slots.bottom.panelIds], activeId: l.slots.bottom.activeId },
    },
    floating: [...l.floating],
  };
}

/** 从所有槽与 floating 中移除面板，返回移除后面板原来在哪（用于 activeId 补偿）。 */
function removePanel(l: WorkspaceLayoutV1, panelId: PanelId): void {
  (Object.keys(l.slots) as SlotId[]).forEach((s) => {
    const slot = l.slots[s];
    const i = slot.panelIds.indexOf(panelId);
    if (i >= 0) {
      slot.panelIds.splice(i, 1);
      if (slot.activeId === panelId) slot.activeId = slot.panelIds.length > 0 ? slot.panelIds[0] : null;
    }
  });
  const fi = l.floating.indexOf(panelId);
  if (fi >= 0) l.floating.splice(fi, 1);
}

/** 目标为 center 时落到 bottom（写作区/策划页不可被占）。 */
function resolveTarget(target: Target): Target {
  return target === 'center' ? 'bottom' : target;
}

export function movePanel(l: WorkspaceLayoutV1, panelId: PanelId, target: Target): WorkspaceLayoutV1 {
  // aiChat（P2 center 内侧列）+ 三个保活面板（固定 bottom，走 display 开合）都拒绝入槽/跨槽。
  if (FIXED_PANELS.includes(panelId)) return l;
  const resolved = resolveTarget(target);
  // sidebar 只能 left；导图之外不接受 floating。
  if (LEFT_ONLY.includes(panelId) && resolved !== 'left') return l;
  if (resolved === 'floating' && !FLOATING_ALLOWED.includes(panelId)) return l;

  const next = clone(l);
  removePanel(next, panelId);
  if (resolved === 'floating') {
    if (!next.floating.includes(panelId)) next.floating.push(panelId);
  } else {
    next.slots[resolved].panelIds.push(panelId);
    next.slots[resolved].activeId = panelId;
  }
  return next;
}

export function closePanel(l: WorkspaceLayoutV1, panelId: PanelId): WorkspaceLayoutV1 {
  const next = clone(l);
  removePanel(next, panelId);
  return next;
}

export function setActive(l: WorkspaceLayoutV1, slotId: SlotId, panelId: PanelId): WorkspaceLayoutV1 {
  if (!l.slots[slotId].panelIds.includes(panelId)) return l;
  const next = clone(l);
  next.slots[slotId].activeId = panelId;
  return next;
}

export function panelSlot(l: WorkspaceLayoutV1, panelId: PanelId): SlotId | 'floating' | null {
  for (const s of Object.keys(l.slots) as SlotId[]) {
    if (l.slots[s].panelIds.includes(panelId)) return s;
  }
  if (l.floating.includes(panelId)) return 'floating';
  return null;
}

export function isSlotVisible(l: WorkspaceLayoutV1, slotId: SlotId): boolean {
  return l.slots[slotId].panelIds.length > 0;
}

/** 面板标题（PanelChrome / SlotTabs 共用）。 */
export const PANEL_TITLES: Record<PanelId, string> = {
  sidebar: '侧栏',
  aiChat: 'AI 对话',
  inspiration: '🔍 灵感',
  reference: '📚 参考',
  namegen: '🧙 起名',
  outline: '📋 大纲',
  material: '📦 素材',
  foreshadowing: '🪢 伏笔',
  aiWrite: '🤖 AI 写章',
  aiReview: '🔍 AI 审稿',
  aiPolish: '✨ 润色',
  mindmap: '🧠 角色思维导图',
};
