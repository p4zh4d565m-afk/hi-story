// PanelChrome：统一的面板外壳（P3）
// 提供标题栏（拖拽手柄）、关闭按钮；内容区填满剩余空间。
// 功能面板只渲染内容，不再自带标题栏/绝对定位。保活由父级（display:none）负责，本组件不卸载。

import React from 'react';
import type { PanelId } from './layout-model';
import { PANEL_TITLES } from './layout-model';

export interface PanelChromeProps {
  panelId: PanelId;
  onClose: (panelId: PanelId) => void;
  children: React.ReactNode;
}

const PanelChrome: React.FC<PanelChromeProps> = ({ panelId, onClose, children }) => (
  <div className="h-full w-full flex flex-col min-h-0">
    <div
      className="shrink-0 px-3 py-2 border-b border-gray-700 flex items-center justify-between select-none"
    >
      <span className="text-xs text-gray-400">{PANEL_TITLES[panelId]}</span>
      <button
        onClick={() => onClose(panelId)}
        className="text-gray-500 hover:text-gray-100 text-xs leading-none"
        title="关闭面板"
      >
        ✕
      </button>
    </div>
    <div className="flex-1 min-h-0 overflow-hidden">
      {children}
    </div>
  </div>
);

export default PanelChrome;
