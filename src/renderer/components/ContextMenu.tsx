import React, { useEffect, useRef, useCallback } from 'react';

export interface MenuItem {
  label: string;
  icon?: string;
  danger?: boolean;
  onClick: () => void;
}

interface ContextMenuProps {
  items: MenuItem[];
  visible: boolean;
  x: number;
  y: number;
  onClose: () => void;
}

const ContextMenu: React.FC<ContextMenuProps> = ({ items, visible, x, y, onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null);

  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
      onClose();
    }
  }, [onClose]);

  useEffect(() => {
    if (visible) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEsc);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
        document.removeEventListener('keydown', handleEsc);
      };
    }
  }, [visible, handleClickOutside]);

  const handleEsc = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  if (!visible) return null;

  // Adjust position to avoid overflow
  const adjustedX = Math.min(x, window.innerWidth - 160);
  const adjustedY = Math.min(y, window.innerHeight - items.length * 36 - 8);

  return (
    <div
      ref={menuRef}
      className="fixed z-[9999] min-w-[140px] bg-gray-800 border border-gray-600 rounded-lg shadow-2xl py-1 overflow-hidden"
      style={{ left: adjustedX, top: adjustedY }}
    >
      {items.map((item, i) => (
        <button
          key={i}
          onClick={(e) => {
            e.stopPropagation();
            item.onClick();
            onClose();
          }}
          className={`
            w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors
            ${item.danger
              ? 'text-red-400 hover:bg-red-900/30 hover:text-red-300'
              : 'text-gray-300 hover:bg-gray-700 hover:text-white'
            }
          `}
        >
          {item.icon && <span className="text-xs">{item.icon}</span>}
          {item.label}
        </button>
      ))}
    </div>
  );
};

export default ContextMenu;
