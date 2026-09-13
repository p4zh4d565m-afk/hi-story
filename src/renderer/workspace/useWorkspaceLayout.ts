// Workspace 布局 React hook（P3）
// 持有 WorkspaceLayoutV1 状态，动作（movePanel/closePanel/setActive）更新状态并写回 localStorage。
// 注意：本 hook 只管「归属」，不管「槽比例」（那是 react-resizable-panels 的 useDefaultLayout）。

import { useCallback, useState } from 'react';
import {
  DEFAULT_LAYOUT, type WorkspaceLayoutV1, type PanelId, type SlotId,
  movePanel as movePanelModel, closePanel as closePanelModel, setActive as setActiveModel, panelSlot,
} from './layout-model';
import { LAYOUT_KEY, parseLayout, serializeLayout } from './layout-storage';

function loadInitial(): WorkspaceLayoutV1 {
  // 问题2：重启不恢复「打开的面板」，面板归属不持久化。启动一律回默认（侧栏 left，right/bottom 空）。
  return DEFAULT_LAYOUT;
}

export function useWorkspaceLayout() {
  const [layout, setLayout] = useState<WorkspaceLayoutV1>(loadInitial);

  const persist = useCallback((next: WorkspaceLayoutV1) => {
    setLayout(next);
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(LAYOUT_KEY, serializeLayout(next));
      } catch { /* 隐私模式等写失败时保持内存态 */ }
    }
  }, []);

  const movePanel = useCallback((panelId: PanelId, target: SlotId | 'floating' | 'center') => {
    setLayout((prev) => {
      const next = movePanelModel(prev, panelId, target);
      persist(next);
      return next;
    });
  }, [persist]);

  const closePanel = useCallback((panelId: PanelId) => {
    setLayout((prev) => {
      const next = closePanelModel(prev, panelId);
      persist(next);
      return next;
    });
  }, [persist]);

  const setActive = useCallback((slotId: SlotId, panelId: PanelId) => {
    setLayout((prev) => {
      const next = setActiveModel(prev, slotId, panelId);
      persist(next);
      return next;
    });
  }, [persist]);

  // 顶栏「打开或聚焦」：已在 right/bottom → setActive 聚焦（已 active 则空操作）；未打开 → 进默认槽。
  const openOrFocus = useCallback((panelId: PanelId, defaultSlot: SlotId) => {
    setLayout((prev) => {
      const slot = panelSlot(prev, panelId);
      if (slot === 'right' || slot === 'bottom') {
        const next = setActiveModel(prev, slot, panelId);
        persist(next);
        return next;
      }
      const next = movePanelModel(prev, panelId, defaultSlot);
      persist(next);
      return next;
    });
  }, [persist]);

  return { layout, movePanel, closePanel, setActive, openOrFocus };
}
