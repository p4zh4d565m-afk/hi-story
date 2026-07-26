import React, { useState, useEffect, useRef } from 'react';
import type { Character, Chapter, WorldEntry } from '../types';
import OutlineEditor, { type OutlineNode } from './OutlineEditor';

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
  });
  const [outline, setOutline] = useState<OutlineNode[]>([]);
  const [saving, setSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  // 用于防止重复加载
  const loadedCharacterId = useRef<string | null>(null);

  useEffect(() => {
    if (character && open) {
      // 只在打开不同角色时重新加载
      if (loadedCharacterId.current !== character.id) {
        loadedCharacterId.current = character.id;
        setForm({
          name: character.name === '新角色' ? '' : character.name,
          aliases: character.aliases || '',
        });
        try {
          const parsed = JSON.parse(character.profileOutline || '[]');
          setOutline(Array.isArray(parsed) && parsed.length > 0 ? parsed : [{ id: 'root', text: '', children: [] }]);
        } catch {
          setOutline([{ id: 'root', text: '', children: [] }]);
        }
        setTimeout(() => nameRef.current?.focus(), 100);
      }
    }
    if (!open) {
      loadedCharacterId.current = null;
    }
  }, [character?.id, open]);

  if (!character) return null;
  if (!open) return null;

  const handleChange = (field: string, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const profileOutline = JSON.stringify(outline);
      await onSave({ id: character.id, name: form.name, aliases: form.aliases, profileOutline });
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
      <div className="bg-float-800 rounded-lg shadow-2xl w-[520px] max-h-[90vh] overflow-hidden border border-float-700 flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-float-700 flex items-center justify-between shrink-0">
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
              className="w-full px-3 py-2.5 bg-float-900 border border-float-700 rounded text-white text-sm
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
              className="w-full px-3 py-2.5 bg-float-900 border border-float-700 rounded text-white text-sm
                         focus:outline-none focus:border-accent placeholder-gray-600"
            />
          </div>

          {/* ── 幕布式层级大纲编辑器 ── */}
          <div>
            <label className="block text-sm text-gray-400 mb-2">
              📋 角色档案大纲
              <span className="text-gray-600 text-[10px] ml-2">
                Tab 缩进 · Enter 新建 · Alt+Enter 换行 · ↑↓ 移动
              </span>
            </label>
            <div className="bg-float-900 rounded-lg border border-float-700 p-3 min-h-[200px] max-h-[320px] overflow-y-auto">
              <OutlineEditor
                nodes={outline}
                onChange={setOutline}
                placeholder="输入第一级标题（如：性格特征），然后 Enter 新建下一项…"
              />
            </div>
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
              <div className="max-h-[120px] overflow-y-auto space-y-0.5 bg-float-900 rounded p-2 border border-float-700">
                {chapters.map((ch, i) => (
                  <label
                    key={ch.id}
                    className="flex items-center gap-2 px-2 py-1 rounded hover:bg-float-800 cursor-pointer text-xs text-gray-300 transition-colors"
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
              <div className="max-h-[120px] overflow-y-auto space-y-0.5 bg-float-900 rounded p-2 border border-float-700">
                {worldEntries.map((entry) => (
                  <label
                    key={entry.id}
                    className="flex items-center gap-2 px-2 py-1 rounded hover:bg-float-800 cursor-pointer text-xs text-gray-300 transition-colors"
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
        <div className="px-6 py-4 border-t border-float-700 flex justify-between shrink-0">
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
