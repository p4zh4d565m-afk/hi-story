import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { Character } from '../types';

interface CharacterCardProps {
  character: Character | null;
  onSave: (data: Partial<Character>) => void;
  onClose: () => void;
}

interface CharacterFormData {
  name: string;
  aliases: string;
  appearance: string;
  personality: string;
  background: string;
  arc: string;
}

const CharacterCard: React.FC<CharacterCardProps> = ({ character, onSave, onClose }) => {
  const [form, setForm] = useState<CharacterFormData>({
    name: '',
    aliases: '',
    appearance: '',
    personality: '',
    background: '',
    arc: '',
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

      // Dead zone: don't activate until mouse moves past 5px threshold
      if (!activated) {
        if (Math.abs(deltaX) < deadZone) return;
        activated = true;
        offset = deltaX > 0 ? deadZone : -deadZone;
      }

      const effectiveDelta = deltaX - offset;
      // Resize from the left (panel is on the right side)
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
    if (character) {
      setForm({
        name: character.name,
        aliases: character.aliases,
        appearance: character.appearance,
        personality: character.personality,
        background: character.background,
        arc: character.arc,
      });
    }
  }, [character?.id]);

  const handleChange = (field: keyof CharacterFormData, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    onSave(form);
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
            {character ? '编辑角色' : '创建角色'}
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
          {/* Name */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">
              姓名 <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => handleChange('name', e.target.value)}
              placeholder="角色姓名"
              className="w-full px-3 py-2 bg-context-800 border border-context-700 rounded text-white text-sm
                         focus:outline-none focus:border-accent placeholder-gray-600"
            />
          </div>

          {/* Aliases */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">别名/称号</label>
            <input
              type="text"
              value={form.aliases}
              onChange={(e) => handleChange('aliases', e.target.value)}
              placeholder="如：剑圣、北境之王、小师妹..."
              className="w-full px-3 py-2 bg-context-800 border border-context-700 rounded text-white text-sm
                         focus:outline-none focus:border-accent placeholder-gray-600"
            />
          </div>

          {/* Appearance */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">外貌</label>
            <textarea
              value={form.appearance}
              onChange={(e) => handleChange('appearance', e.target.value)}
              placeholder="容貌、体型、穿着、标志性特征..."
              rows={Math.max(3, Math.floor(panelWidth / 80))}
              className="w-full px-3 py-2 bg-context-800 border border-context-700 rounded text-white text-sm
                         focus:outline-none focus:border-accent placeholder-gray-600 resize-y"
              style={{ minHeight: '60px' }}
            />
          </div>

          {/* Personality */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">性格</label>
            <textarea
              value={form.personality}
              onChange={(e) => handleChange('personality', e.target.value)}
              placeholder="性格层次：表层 / 深层 / 隐藏面..."
              rows={Math.max(3, Math.floor(panelWidth / 80))}
              className="w-full px-3 py-2 bg-context-800 border border-context-700 rounded text-white text-sm
                         focus:outline-none focus:border-accent placeholder-gray-600 resize-y"
              style={{ minHeight: '60px' }}
            />
          </div>

          {/* Background */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">背景故事</label>
            <textarea
              value={form.background}
              onChange={(e) => handleChange('background', e.target.value)}
              placeholder="出身、成长经历、关键事件、内心创伤..."
              rows={Math.max(4, Math.floor(panelWidth / 60))}
              className="w-full px-3 py-2 bg-context-800 border border-context-700 rounded text-white text-sm
                         focus:outline-none focus:border-accent placeholder-gray-600 resize-y"
              style={{ minHeight: '80px' }}
            />
          </div>

          {/* Arc */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">角色弧线</label>
            <textarea
              value={form.arc}
              onChange={(e) => handleChange('arc', e.target.value)}
              placeholder="角色的成长/改变轨迹：起点 → 转折 → 终点..."
              rows={Math.max(3, Math.floor(panelWidth / 80))}
              className="w-full px-3 py-2 bg-context-800 border border-context-700 rounded text-white text-sm
                         focus:outline-none focus:border-accent placeholder-gray-600 resize-y"
              style={{ minHeight: '60px' }}
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2 border-t border-context-700">
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
        </form>
      </div>
    </div>
  );
};

export default CharacterCard;
