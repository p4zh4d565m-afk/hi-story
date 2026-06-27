import React, { useState } from 'react';
import type { Character } from '../types';
import type { CharacterRelation } from './MindMap';

interface RelationEditDialogProps {
  open: boolean;
  sourceId: string;
  targetId: string;
  existingRelation?: CharacterRelation;
  characters: Character[];
  onSave: (sourceId: string, targetId: string, relationType: string, existingId?: string) => void;
  onDelete: (relationId: string) => void;
  onClose: () => void;
}

const RELATION_TYPES = [
  '父母', '子女', '配偶', '恋人', '兄弟姐妹',
  '师徒', '朋友', '盟友', '仇敌', '情敌',
  '上下级', '其他',
];

const RELATION_ICONS: Record<string, string> = {
  '父母': '👨‍👧', '子女': '👶', '配偶': '💍', '恋人': '💕', '兄弟姐妹': '👫',
  '师徒': '🎓', '朋友': '🤝', '盟友': '🛡️', '仇敌': '⚔️', '情敌': '💔',
  '上下级': '📋', '其他': '🔗',
};

const RelationEditDialog: React.FC<RelationEditDialogProps> = ({
  open,
  sourceId,
  targetId,
  existingRelation,
  characters,
  onSave,
  onDelete,
  onClose,
}) => {
  const [relationType, setRelationType] = useState(existingRelation?.relationType || '');
  const [customType, setCustomType] = useState('');
  const [saving, setSaving] = useState(false);

  const sourceChar = characters.find(c => c.id === sourceId);
  const targetChar = characters.find(c => c.id === targetId);

  if (!open) return null;

  const effectiveType = relationType === '其他' ? customType : relationType;

  const handleSubmit = async () => {
    if (!effectiveType.trim()) return;
    setSaving(true);
    try {
      await onSave(sourceId, targetId, effectiveType.trim(), existingRelation?.id);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (existingRelation?.id) {
      await onDelete(existingRelation.id);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-gray-800 rounded-lg shadow-2xl w-[400px] max-h-[90vh] overflow-hidden border border-gray-700">
        {/* Header */}
        <div className="px-5 py-3 border-b border-gray-700 flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">
            {existingRelation ? '编辑角色关系' : '创建角色关系'}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {/* Source → Target */}
          <div className="flex items-center justify-center gap-3">
            <div className="text-center">
              <div className="w-14 h-14 rounded-full bg-accent/20 border-2 border-accent flex items-center justify-center mx-auto">
                <span className="text-xl">👤</span>
              </div>
              <p className="text-xs text-white mt-1 font-semibold">
                {sourceChar?.name || '未知角色'}
              </p>
            </div>

            <div className="flex flex-col items-center">
              <span className="text-2xl">→</span>
              <span className="text-[10px] text-gray-500 mt-0.5">
                {existingRelation?.relationType || '关系'}
              </span>
            </div>

            <div className="text-center">
              <div className="w-14 h-14 rounded-full bg-accent/20 border-2 border-accent flex items-center justify-center mx-auto">
                <span className="text-xl">👤</span>
              </div>
              <p className="text-xs text-white mt-1 font-semibold">
                {targetChar?.name || '未知角色'}
              </p>
            </div>
          </div>

          {/* Relation type picker */}
          <div>
            <label className="block text-xs text-gray-400 mb-2">
              关系类型 <span className="text-red-400">*</span>
            </label>
            <div className="grid grid-cols-4 gap-1.5">
              {RELATION_TYPES.map(type => (
                <button
                  key={type}
                  type="button"
                  onClick={() => { setRelationType(type); setCustomType(''); }}
                  className={`
                    px-2 py-2 rounded text-xs text-center transition-colors
                    ${relationType === type
                      ? 'bg-accent text-white ring-1 ring-accent'
                      : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                    }
                  `}
                >
                  <span className="block text-sm mb-0.5">{RELATION_ICONS[type] || '🔗'}</span>
                  {type}
                </button>
              ))}
            </div>
          </div>

          {/* Custom input for "其他" */}
          {relationType === '其他' && (
            <div>
              <label className="block text-xs text-gray-400 mb-1">自定义关系</label>
              <input
                type="text"
                value={customType}
                onChange={(e) => setCustomType(e.target.value)}
                placeholder="输入关系名称..."
                className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-white text-sm
                           focus:outline-none focus:border-accent placeholder-gray-600"
                autoFocus
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-700 flex justify-between items-center">
          {existingRelation ? (
            <button
              onClick={handleDelete}
              className="px-3 py-1.5 text-xs text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded transition-colors"
            >
              🗑 删除关系
            </button>
          ) : (
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs text-gray-400 hover:text-white transition-colors"
            >
              取消
            </button>
          )}
          <button
            onClick={handleSubmit}
            disabled={!effectiveType.trim() || saving}
            className="px-4 py-1.5 text-sm bg-accent text-white rounded hover:bg-accent-hover
                       disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? '保存中...' : existingRelation ? '更新关系' : '创建关系'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default RelationEditDialog;
