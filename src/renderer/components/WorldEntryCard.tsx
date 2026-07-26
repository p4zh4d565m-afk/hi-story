import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { WorldEntry } from '../types';

interface WorldEntryCardProps {
  entry: WorldEntry | null;
  onSave: (data: Partial<WorldEntry>) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

interface WorldEntryFormData {
  name: string;
  category: WorldEntry['category'];
  description: string;
}

const CATEGORIES: { value: WorldEntry['category']; label: string; icon: string }[] = [
  { value: 'place', label: '地点', icon: '🌍' },
  { value: 'faction', label: '势力', icon: '🏛️' },
  { value: 'race', label: '种族', icon: '🧬' },
  { value: 'law', label: '律法', icon: '⚖️' },
  { value: 'history', label: '历史', icon: '📜' },
  { value: 'culture', label: '文化', icon: '🎭' },
];

const WorldEntryCard: React.FC<WorldEntryCardProps> = ({ entry, onSave, onDelete, onClose }) => {
  const [form, setForm] = useState<WorldEntryFormData>({
    name: '',
    category: 'place',
    description: '',
  });

  // ===== Resize state =====
  const [panelWidth, setPanelWidth] = useState(360);
  const isResizing = useRef(false);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(360);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    resizeStartX.current = e.clientX;
    resizeStartWidth.current = panelWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    let activated = false;
    let offset = 0;
    const deadZone = 5;

    const handleMouseMove = (ev: MouseEvent) => {
      if (!isResizing.current) return;
      const deltaX = ev.clientX - resizeStartX.current;

      if (!activated) {
        if (Math.abs(deltaX) < deadZone) return;
        activated = true;
        offset = deltaX > 0 ? deadZone : -deadZone;
      }

      const effectiveDelta = deltaX - offset;
      const newWidth = Math.max(280, Math.min(800, resizeStartWidth.current - effectiveDelta));
      setPanelWidth(newWidth);
    };

    const handleMouseUp = () => {
      isResizing.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [panelWidth]);

  useEffect(() => {
    if (entry) {
      setForm({
        name: entry.name,
        category: entry.category,
        description: entry.description,
      });
    }
  }, [entry?.id]);

  const handleChange = (field: keyof WorldEntryFormData, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    onSave({ id: entry?.id, ...form });
  };

  const handleDelete = () => {
    if (entry && confirm(`确定要删除「${entry.name}」吗？`)) {
      onDelete(entry.id);
    }
  };

  return (
    <div className="h-full flex" style={{ width: panelWidth }}>
      {/* Resize handle (left edge) */}
      <div
        className="w-1.5 hover:w-2 cursor-col-resize bg-transparent hover:bg-accent/40 transition-all flex-shrink-0"
        onMouseDown={handleResizeStart}
        title="拖拽调整宽度"
      />

      {/* Content */}
      <div className="flex-1 flex flex-col bg-context-900 min-w-0">
        {/* Header */}
        <div className="px-4 py-3 border-b border-context-700 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-300">
            {entry ? '编辑世界观' : '创建世界观条目'}
          </h3>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-gray-600">{panelWidth}px</span>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white transition-colors"
            >
              ✕
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Category — shown as icon selector */}
          <div>
            <label className="block text-xs text-gray-500 mb-1.5">分类</label>
            <div className="grid grid-cols-3 gap-1.5">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.value}
                  type="button"
                  onClick={() => handleChange('category', cat.value)}
                  className={`
                    flex items-center justify-center gap-1 px-2 py-1.5 rounded text-xs transition-colors
                    ${form.category === cat.value
                      ? 'bg-accent/20 border border-accent/50 text-white'
                      : 'bg-context-800 border border-context-700 text-gray-400 hover:border-gray-500'
                    }
                  `}
                >
                  <span>{cat.icon}</span>
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          {/* Name */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">
              名称 <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => handleChange('name', e.target.value)}
              placeholder="条目名称"
              className="w-full px-3 py-2 bg-context-800 border border-context-700 rounded text-white text-sm
                         focus:outline-none focus:border-accent placeholder-gray-600"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">详细描述</label>
            <textarea
              value={form.description}
              onChange={(e) => handleChange('description', e.target.value)}
              placeholder="详细描述这个世界观条目的内容..."
              rows={Math.max(6, Math.floor(panelWidth / 50))}
              className="w-full px-3 py-2 bg-context-800 border border-context-700 rounded text-white text-sm
                         focus:outline-none focus:border-accent placeholder-gray-600 resize-y"
              style={{ minHeight: '120px' }}
            />
          </div>

          {/* Actions */}
          <div className="flex justify-between items-center pt-2 border-t border-context-700">
            <div>
              {entry && (
                <button
                  type="button"
                  onClick={handleDelete}
                  className="px-3 py-2 text-sm text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded transition-colors"
                >
                  🗑️ 删除
                </button>
              )}
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={!form.name.trim()}
                className="px-6 py-2 text-sm bg-accent text-white rounded hover:bg-accent-hover
                           disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                保存
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export default WorldEntryCard;
