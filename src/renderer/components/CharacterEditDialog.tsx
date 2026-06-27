import React, { useState, useEffect, useRef } from 'react';
import type { Character, Chapter, WorldEntry } from '../types';

interface CharacterEditDialogProps {
  open: boolean;
  character: Character | null;
  chapters: Chapter[];  // All chapters in the project
  worldEntries: WorldEntry[];  // All world entries for association
  appearances: string[]; // Chapter IDs where this character appears
  worldAssociations: string[];  // World entry IDs this character is associated with
  onSave: (data: Partial<Character>) => void;
  onDelete: (id: string) => void;
  onToggleAppearance: (chapterId: string) => void;
  onToggleWorldAssociation: (worldEntryId: string) => void;
  onClose: () => void;
}

const CharacterEditDialog: React.FC<CharacterEditDialogProps> = ({
  open,
  character,
  chapters,
  worldEntries,
  appearances,
  worldAssociations,
  onSave,
  onDelete,
  onToggleAppearance,
  onToggleWorldAssociation,
  onClose,
}) => {
  const [form, setForm] = useState({
    name: '',
    aliases: '',
    appearance: '',
    personality: '',
    background: '',
    arc: '',
  });
  const [saving, setSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (character) {
      setForm({
        name: character.name === '新角色' ? '' : character.name,
        aliases: character.aliases || '',
        appearance: character.appearance || '',
        personality: character.personality || '',
        background: character.background || '',
        arc: character.arc || '',
      });
      // Auto-focus name field after render
      setTimeout(() => nameRef.current?.focus(), 100);
    }
  }, [character?.id, open]);

  if (!open || !character) return null;

  const handleChange = (field: string, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      await onSave({ id: character.id, ...form });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    if (character && confirm(`确定要删除角色「${character.name}」吗？此操作不可撤销。`)) {
      onDelete(character.id);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-gray-800 rounded-lg shadow-2xl w-[520px] max-h-[90vh] overflow-hidden border border-gray-700 flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-700 flex items-center justify-between shrink-0">
          <h2 className="text-lg font-semibold text-white">
            {character.name === '新角色' ? '创建角色' : '编辑角色'}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors text-lg"
          >
            ✕
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">
              姓名 <span className="text-red-400">*</span>
            </label>
            <input
              ref={nameRef}
              type="text"
              value={form.name}
              onChange={(e) => handleChange('name', e.target.value)}
              placeholder="角色姓名"
              className="w-full px-3 py-2.5 bg-gray-900 border border-gray-700 rounded text-white text-sm
                         focus:outline-none focus:border-accent placeholder-gray-600"
            />
          </div>

          {/* Aliases */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">别名 / 称号</label>
            <input
              type="text"
              value={form.aliases}
              onChange={(e) => handleChange('aliases', e.target.value)}
              placeholder="如：剑圣、北境之王、小师妹..."
              className="w-full px-3 py-2.5 bg-gray-900 border border-gray-700 rounded text-white text-sm
                         focus:outline-none focus:border-accent placeholder-gray-600"
            />
          </div>

          {/* Appearance */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">外貌特征</label>
            <textarea
              value={form.appearance}
              onChange={(e) => handleChange('appearance', e.target.value)}
              placeholder="容貌、体型、穿着、标志性特征、年龄感..."
              rows={3}
              className="w-full px-3 py-2.5 bg-gray-900 border border-gray-700 rounded text-white text-sm
                         focus:outline-none focus:border-accent placeholder-gray-600 resize-y"
            />
          </div>

          {/* Personality */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">性格特征</label>
            <textarea
              value={form.personality}
              onChange={(e) => handleChange('personality', e.target.value)}
              placeholder="性格标签、行为模式、内在动机、弱点、说话风格..."
              rows={3}
              className="w-full px-3 py-2.5 bg-gray-900 border border-gray-700 rounded text-white text-sm
                         focus:outline-none focus:border-accent placeholder-gray-600 resize-y"
            />
          </div>

          {/* Background */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">背景故事</label>
            <textarea
              value={form.background}
              onChange={(e) => handleChange('background', e.target.value)}
              placeholder="出身、成长经历、关键事件、内心创伤、人生目标..."
              rows={4}
              className="w-full px-3 py-2.5 bg-gray-900 border border-gray-700 rounded text-white text-sm
                         focus:outline-none focus:border-accent placeholder-gray-600 resize-y"
            />
          </div>

          {/* Arc */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">角色弧线</label>
            <textarea
              value={form.arc}
              onChange={(e) => handleChange('arc', e.target.value)}
              placeholder="角色的成长轨迹：起点 → 转折事件 → 最终状态..."
              rows={3}
              className="w-full px-3 py-2.5 bg-gray-900 border border-gray-700 rounded text-white text-sm
                         focus:outline-none focus:border-accent placeholder-gray-600 resize-y"
            />
          </div>

          {/* Chapter Appearances */}
          {chapters.length > 0 && (
            <div>
              <label className="block text-sm text-gray-400 mb-1">
                出场章节
                <span className="text-gray-600 text-[10px] ml-2">
                  ({appearances.length} 个章节)
                </span>
              </label>
              <div className="max-h-[120px] overflow-y-auto space-y-0.5 bg-gray-900 rounded p-2 border border-gray-700">
                {chapters.map((ch, i) => (
                  <label
                    key={ch.id}
                    className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-800 cursor-pointer text-xs text-gray-300 transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={appearances.includes(ch.id)}
                      onChange={() => onToggleAppearance(ch.id)}
                      className="accent-accent rounded"
                    />
                    <span className="text-gray-600 w-5">{i + 1}.</span>
                    <span className="flex-1 truncate">{ch.title}</span>
                    <span className="text-gray-600 text-[10px]">{ch.wordCount.toLocaleString()}字</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* World Entry Associations */}
          {worldEntries.length > 0 && (
            <div>
              <label className="block text-sm text-gray-400 mb-1">
                所属势力/地点
                <span className="text-gray-600 text-[10px] ml-2">
                  ({worldAssociations.length} 个关联)
                </span>
              </label>
              <div className="max-h-[120px] overflow-y-auto space-y-0.5 bg-gray-900 rounded p-2 border border-gray-700">
                {worldEntries.map((entry) => (
                  <label
                    key={entry.id}
                    className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-800 cursor-pointer text-xs text-gray-300 transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={worldAssociations.includes(entry.id)}
                      onChange={() => onToggleWorldAssociation(entry.id)}
                      className="accent-accent rounded"
                    />
                    <span className="text-gray-600 text-[10px]">
                      {entry.category === 'place' && '🌍'}
                      {entry.category === 'faction' && '🏛️'}
                      {entry.category === 'race' && '🧬'}
                      {entry.category === 'law' && '⚖️'}
                      {entry.category === 'history' && '📜'}
                      {entry.category === 'culture' && '🎭'}
                    </span>
                    <span className="flex-1 truncate">{entry.name}</span>
                    <span className="text-gray-600 text-[10px]">{entry.category}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </form>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-700 flex justify-between shrink-0">
          <button
            type="button"
            onClick={handleDelete}
            className="px-4 py-2 text-sm text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded transition-colors"
          >
            🗑️ 删除角色
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
            >
              取消
            </button>
            <span className="text-[10px] text-gray-600">
              {form.name ? '已填写基本信息' : '请至少输入姓名'}
            </span>
            <button
              onClick={handleSubmit}
              disabled={!form.name.trim() || saving}
              className="px-6 py-2 text-sm bg-accent text-white rounded hover:bg-accent-hover
                         disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? '保存中...' : '保存角色'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CharacterEditDialog;
