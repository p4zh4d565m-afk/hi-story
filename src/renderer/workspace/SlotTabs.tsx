// SlotTabs：槽内多面板标签行（P3）
// panelIds.length > 1 时渲染标签；单面板不显示。切换调 setActive。

import React from 'react';
import type { PanelId, SlotId } from './layout-model';
import { PANEL_TITLES } from './layout-model';

export interface SlotTabsProps {
  slotId: SlotId;
  panelIds: PanelId[];
  activeId: PanelId | null;
  onSetActive: (slotId: SlotId, panelId: PanelId) => void;
}

const SlotTabs: React.FC<SlotTabsProps> = ({ slotId, panelIds, activeId, onSetActive }) => {
  if (panelIds.length <= 1) return null;
  return (
    <div className="shrink-0 flex border-b border-gray-700 bg-gray-800/50">
      {panelIds.map((id) => (
        <button
          key={id}
          onClick={() => onSetActive(slotId, id)}
          className={`px-2 py-1 text-[11px] border-r border-gray-700 transition-colors ${
            activeId === id ? 'bg-gray-700 text-gray-100' : 'text-gray-500 hover:text-gray-200'
          }`}
          title={PANEL_TITLES[id]}
        >
          {PANEL_TITLES[id]}
        </button>
      ))}
    </div>
  );
};

export default SlotTabs;
