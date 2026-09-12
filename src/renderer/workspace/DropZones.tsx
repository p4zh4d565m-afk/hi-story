// DropZones：拖拽停靠预览（P3）
// 拖拽面板标题时，left/right/bottom/center（映射 bottom）四边高亮；释放调 movePanel。
// 本组件只负责渲染与命中判断，不持 layout 状态。

import React from 'react';
import type { PanelId, SlotId } from './layout-model';

export type DropTarget = SlotId | 'center';

export interface DropZonesProps {
  draggingPanel: PanelId | null;
  onDrop: (panelId: PanelId, target: DropTarget) => void;
}

const ZONES: Array<{ target: DropTarget; style: React.CSSProperties; label: string }> = [
  { target: 'left', style: { left: 0, top: 0, bottom: 0, width: '12%' }, label: 'left' },
  { target: 'right', style: { right: 0, top: 0, bottom: 0, width: '12%' }, label: 'right' },
  { target: 'bottom', style: { left: 0, right: 0, bottom: 0, height: '14%' }, label: 'bottom' },
  { target: 'center', style: { left: '12%', right: '12%', top: 0, bottom: 0 }, label: '中心（落入下方）' },
];

const DropZones: React.FC<DropZonesProps> = ({ draggingPanel, onDrop }) => {
  if (!draggingPanel) return null;
  return (
    <div className="fixed inset-0 z-40 pointer-events-none">
      {ZONES.map(({ target, style, label }) => (
        <div
          key={target}
          className="absolute border-2 border-accent bg-accent/20 pointer-events-auto flex items-center justify-center"
          style={style}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            onDrop(draggingPanel, target);
          }}
        >
          <span className="text-xs text-gray-100 bg-gray-900/70 px-2 py-1 rounded">{label}</span>
        </div>
      ))}
    </div>
  );
};

export default DropZones;
