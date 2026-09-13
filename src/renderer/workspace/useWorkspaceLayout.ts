// Workspace 布局 React hook（P3）
// 持有 WorkspaceLayoutV1 状态，动作（movePanel/closePanel/setActive）只更新内存态。
// 注意：本 hook 只管「归属」，不管「槽比例」（那是 react-resizable-panels 的 useDefaultLayout）。
// 面板归属**不持久化**（产品决定：重启清空），因此这里不再写 localStorage，避免「看起来会恢复」的残留 JSON。

import { useCallback, useState } from 'react';
import {
  DEFAULT_LAYOUT, type WorkspaceLayoutV1, type PanelId, type SlotId,
  movePanel as movePanelModel, closePanel as closePanelModel, setActive as setActiveModel, panelSlot,
} from './layout-model';

function loadInitial(): WorkspaceLayoutV1 {
  // 重启不恢复「打开的面板」：启动一律回默认（侧栏 left，right/bottom 空）。
  return DEFAULT_LAYOUT;
}

export function useWorkspaceLayout() {
  const [layout, setLayout] = useState<WorkspaceLayoutV1>(loadInitial);

  const persist = useCallback((next: WorkspaceLayoutV1) => {
    setLayout(next);
    // 面板归属不持久化，刻意不写 localStorage。只保留内存态。
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
