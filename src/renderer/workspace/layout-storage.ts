// Workspace 布局持久化（P3）
// 注意：2026-09-13 产品决定「面板归属不持久化、重启清空」，useWorkspaceLayout 已不再读写本文件。
// 本文件暂为死代码保留：parseLayout 的「剥掉旧 bottom 残留三面板」单测仍防旧数据回归，
// 未来若重新启用归属持久化，从这里恢复。坏数据静默回默认，不弹错、不写回。

import {
  DEFAULT_LAYOUT, type WorkspaceLayoutV1, type PanelId, type SlotId,
} from './layout-model';

export const LAYOUT_KEY = 'hi-story-workspace-v1';

const KNOWN_PANEL_IDS: PanelId[] = [
  'sidebar', 'aiChat', 'inspiration', 'reference', 'namegen',
  'outline', 'material', 'foreshadowing', 'mindmap',
];

function sanitizeSlot(slot: unknown, fallback: WorkspaceLayoutV1['slots'][SlotId]): WorkspaceLayoutV1['slots'][SlotId] {
  if (!slot || typeof slot !== 'object') return { panelIds: [...fallback.panelIds], activeId: fallback.activeId };
  const s = slot as { panelIds?: unknown; activeId?: unknown };
  const panelIds = Array.isArray(s.panelIds)
    ? s.panelIds.filter((id): id is PanelId => typeof id === 'string' && (KNOWN_PANEL_IDS as string[]).includes(id))
    : [...fallback.panelIds];
  const activeId = typeof s.activeId === 'string' && panelIds.includes(s.activeId as PanelId) ? (s.activeId as PanelId) : (panelIds.length > 0 ? panelIds[0] : null);
  return { panelIds, activeId };
}

export function parseLayout(raw: string | null): WorkspaceLayoutV1 {
  if (!raw) return DEFAULT_LAYOUT;
  try {
    const parsed = JSON.parse(raw) as Partial<WorkspaceLayoutV1>;
    if (!parsed || parsed.version !== 1 || !parsed.slots) return DEFAULT_LAYOUT;
    const slots = parsed.slots as Record<string, unknown>;
    return {
      version: 1,
      slots: {
        left: sanitizeSlot(slots.left, DEFAULT_LAYOUT.slots.left),
        right: sanitizeSlot(slots.right, DEFAULT_LAYOUT.slots.right),
        bottom: sanitizeSlot(slots.bottom, DEFAULT_LAYOUT.slots.bottom),
      },
      floating: Array.isArray(parsed.floating)
        ? parsed.floating.filter((id): id is PanelId => id === 'mindmap')
        : [],
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export function serializeLayout(layout: WorkspaceLayoutV1): string {
  return JSON.stringify(layout);
}
