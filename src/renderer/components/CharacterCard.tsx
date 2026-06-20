import React, { useState, useEffect } from 'react';
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
    <div className="h-full flex flex-col bg-gray-900">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-300">
          {character ? '编辑角色' : '创建角色'}
        </h3>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-white transition-colors"
        >
          ✕
        </button>
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
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm
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
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm
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
            rows={3}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm
                       focus:outline-none focus:border-accent placeholder-gray-600 resize-none"
          />
        </div>

        {/* Personality */}
        <div>
          <label className="block text-xs text-gray-500 mb-1">性格</label>
          <textarea
            value={form.personality}
            onChange={(e) => handleChange('personality', e.target.value)}
            placeholder="性格层次：表层 / 深层 / 隐藏面..."
            rows={3}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm
                       focus:outline-none focus:border-accent placeholder-gray-600 resize-none"
          />
        </div>

        {/* Background */}
        <div>
          <label className="block text-xs text-gray-500 mb-1">背景故事</label>
          <textarea
            value={form.background}
            onChange={(e) => handleChange('background', e.target.value)}
            placeholder="出身、成长经历、关键事件、内心创伤..."
            rows={4}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm
                       focus:outline-none focus:border-accent placeholder-gray-600 resize-none"
          />
        </div>

        {/* Arc */}
        <div>
          <label className="block text-xs text-gray-500 mb-1">角色弧线</label>
          <textarea
            value={form.arc}
            onChange={(e) => handleChange('arc', e.target.value)}
            placeholder="角色的成长/改变轨迹：起点 → 转折 → 终点..."
            rows={3}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm
                       focus:outline-none focus:border-accent placeholder-gray-600 resize-none"
          />
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-2 border-t border-gray-700">
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
            className="px-6 py-2 text-sm bg-accent text-white rounded hover:bg-purple-600
                       disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            保存
          </button>
        </div>
      </form>
    </div>
  );
};

export default CharacterCard;
