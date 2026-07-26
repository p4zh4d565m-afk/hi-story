import React, { useState } from 'react';
import type { CreateProjectInput } from '../types';

interface CreateProjectDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (input: CreateProjectInput) => void;
  creating: boolean;
}

const TYPE_TAG_OPTIONS = [
  '仙侠', '武侠', '玄幻', '奇幻', '科幻',
  '历史', '宫斗', '言情', '悬疑', '恐怖',
  '都市', '军事', '游戏', '轻小说', '其他',
];

const CreateProjectDialog: React.FC<CreateProjectDialogProps> = ({
  open,
  onClose,
  onCreate,
  creating,
}) => {
  const [name, setName] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [style, setStyle] = useState('');
  const [summary, setSummary] = useState('');

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onCreate({
      name: name.trim(),
      typeTags: selectedTags,
      style,
      summary,
    });
  };

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-float-800 rounded-lg shadow-2xl w-[480px] max-h-[90vh] overflow-y-auto border border-float-700">
        <div className="px-6 py-4 border-b border-float-700 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">创建新小说</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* 书名 */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">
              书名 <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="给你的故事起个名字..."
              className="w-full px-3 py-2 bg-float-900 border border-float-700 rounded text-white text-sm
                         focus:outline-none focus:border-accent placeholder-gray-600"
              autoFocus
            />
          </div>

          {/* 类型标签 */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">类型标签</label>
            <div className="flex flex-wrap gap-1.5">
              {TYPE_TAG_OPTIONS.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleTag(tag)}
                  className={`
                    px-2 py-1 rounded text-xs transition-colors
                    ${selectedTags.includes(tag)
                      ? 'bg-accent text-white'
                      : 'bg-float-700 text-gray-400 hover:bg-float-600'
                    }
                  `}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>

          {/* 风格 */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">风格</label>
            <input
              type="text"
              value={style}
              onChange={(e) => setStyle(e.target.value)}
              placeholder="如：古风、轻松、沉重..."
              className="w-full px-3 py-2 bg-float-900 border border-float-700 rounded text-white text-sm
                         focus:outline-none focus:border-accent placeholder-gray-600"
            />
          </div>

          {/* 简介 */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">简介</label>
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="简单介绍一下你想写的故事..."
              rows={3}
              className="w-full px-3 py-2 bg-float-900 border border-float-700 rounded text-white text-sm
                         focus:outline-none focus:border-accent placeholder-gray-600 resize-none"
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={!name.trim() || creating}
              className="px-6 py-2 text-sm bg-accent text-white rounded hover:bg-accent-hover
                         disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {creating ? '创建中...' : '创建'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreateProjectDialog;
