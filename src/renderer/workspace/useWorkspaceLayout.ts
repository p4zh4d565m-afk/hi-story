// Workspace 布局 React hook（P3）
// 持有 WorkspaceLayoutV1 状态，动作（movePanel/closePanel/setActive）更新状态并写回 localStorage。
// 注意：本 hook 只管「归属」，不管「槽比例」（那是 react-resizable-panels 的 useDefaultLayout）。

import { useCallback, useState } from 'react';
import {
  DEFAULT_LAYOUT, type WorkspaceLayoutV1, type PanelId, type SlotId,
  movePanel as movePanelModel, closePanel as closePanelModel, setActive as setActiveModel,
} from './layout-model';
import { LAYOUT_KEY, parseLayout, serializeLayout } from './layout-storage';

function loadInitial(): WorkspaceLayoutV1 {
  if (typeof localStorage === 'undefined') return DEFAULT_LAYOUT;
  try {
    return parseLayout(localStorage.getItem(LAYOUT_KEY));
  } catch {
    return DEFAULT_LAYOUT;
  }
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

  return { layout, movePanel, closePanel, setActive };
}
