import React, { useState, useEffect, useCallback } from 'react';
import type { Material } from '../types';
import type { SearchResult } from '../types/search';

interface MaterialPanelProps {
  open: boolean;
  projectId: string | null;
  onClose: () => void;
  /** External search result to save as material */
  pendingSave?: SearchResult | null;
  onSaved?: () => void;
}

const MaterialPanel: React.FC<MaterialPanelProps> = ({
  open,
  projectId,
  onClose,
  pendingSave,
  onSaved,
}) => {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ title: '', content: '', tagsInput: '' });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [searchText, setSearchText] = useState('');
  const [selectedMaterial, setSelectedMaterial] = useState<Material | null>(null);

  // Load materials
  const loadMaterials = useCallback(async () => {
    setLoading(true);
    try {
      let res: any;
      if (projectId) {
        res = await window.electronAPI.invoke('db:material:findByProject', projectId) as any;
      } else {
        res = await window.electronAPI.invoke('db:material:findGlobal') as any;
      }
      if (res.success && res.data) {
        setMaterials(res.data);
      }
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [projectId]);

  useEffect(() => {
    if (open) loadMaterials();
    if (!open) setSelectedMaterial(null);
  }, [open, loadMaterials]);

  // Handle pending save from inspiration search
  useEffect(() => {
    if (pendingSave && open) {
      handleCreateFromSearch(pendingSave);
    }
  }, [pendingSave]);

  const handleCreateFromSearch = async (result: SearchResult) => {
    try {
      const res = await window.electronAPI.invoke('db:material:create', {
        projectId: projectId || null,
        title: result.title,
        content: `${result.snippet}\n\n${result.content || ''}`,
        sourceLayer: result.layer,
        url: result.source || null,
        tags: [result.layer, result.layerDisplay],
      }) as any;
      if (res.success) {
        setMaterials(prev => [res.data, ...prev]);
        onSaved?.();
      }
    } catch (err) { console.error(err); }
  };

  const handleSave = async () => {
    if (!editForm.title.trim()) return;
    try {
      if (editingId) {
        const res = await window.electronAPI.invoke('db:material:update', editingId, {
          title: editForm.title,
          content: editForm.content,
          tags: editForm.tagsInput.split(',').map(t => t.trim()).filter(Boolean),
        }) as any;
        if (res.success) {
          setMaterials(prev => prev.map(m => m.id === editingId ? res.data : m));
        }
      } else {
        const res = await window.electronAPI.invoke('db:material:create', {
          projectId: projectId || null,
          title: editForm.title,
          content: editForm.content,
          tags: editForm.tagsInput.split(',').map(t => t.trim()).filter(Boolean),
        }) as any;
        if (res.success) {
          setMaterials(prev => [res.data, ...prev]);
        }
      }
      setEditing(false);
      setEditingId(null);
    } catch (err) { console.error(err); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确认删除此素材？')) return;
    await window.electronAPI.invoke('db:material:remove', id);
    setMaterials(prev => prev.filter(m => m.id !== id));
    if (selectedMaterial?.id === id) setSelectedMaterial(null);
  };

  const startEdit = (m?: Material) => {
    if (m) {
      setEditForm({ title: m.title, content: m.content, tagsInput: m.tags.join(', ') });
      setEditingId(m.id);
    } else {
      setEditForm({ title: '', content: '', tagsInput: '' });
      setEditingId(null);
    }
    setEditing(true);
  };

  const filtered = searchText.trim()
    ? materials.filter(m =>
        m.title.includes(searchText) ||
        m.content.includes(searchText) ||
        m.tags.some(t => t.includes(searchText)))
    : materials;

  if (!open) return null;

  return (
    <div className="h-full flex flex-col bg-float-900">
      {/* Header */}
      <div className="px-3 py-2 border-b border-float-700 flex items-center justify-between">
        <div>
          <h3 className="text-xs font-semibold text-gray-300 uppercase tracking-wide">📦 素材管理</h3>
          <p className="text-[10px] text-gray-600 mt-0.5">{materials.length} 条素材</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => startEdit()}
            className="text-xs text-accent hover:text-white transition-colors">
            +添加
          </button>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-sm">✕</button>
        </div>
      </div>

      {/* Search bar */}
      <div className="px-3 py-2 border-b border-gray-800">
        <input
          type="text"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder="搜索素材..."
          className="w-full px-2 py-1 bg-float-800 border border-float-700 rounded text-white text-xs
                     focus:outline-none focus:border-accent placeholder-gray-600"
        />
      </div>

      {/* Edit form */}
      {editing && (
        <div className="p-3 border-b border-float-700 bg-float-800/50 space-y-2">
          <input
            type="text"
            value={editForm.title}
            onChange={(e) => setEditForm(f => ({ ...f, title: e.target.value }))}
            placeholder="标题"
            className="w-full px-2 py-1 bg-float-700 border border-float-600 rounded text-white text-xs
                       focus:outline-none focus:border-accent placeholder-gray-500"
            autoFocus
          />
          <textarea
            value={editForm.content}
            onChange={(e) => setEditForm(f => ({ ...f, content: e.target.value }))}
            placeholder="内容..."
            rows={4}
            className="w-full px-2 py-1 bg-float-700 border border-float-600 rounded text-white text-xs
                       focus:outline-none focus:border-accent placeholder-gray-500 resize-none"
          />
          <input
            type="text"
            value={editForm.tagsInput}
            onChange={(e) => setEditForm(f => ({ ...f, tagsInput: e.target.value }))}
            placeholder="标签，用逗号分隔"
            className="w-full px-2 py-1 bg-float-700 border border-float-600 rounded text-white text-xs
                       focus:outline-none focus:border-accent placeholder-gray-500"
          />
          <div className="flex items-center gap-2">
            <button onClick={handleSave}
              className="px-3 py-1 text-xs bg-accent text-white rounded hover:bg-accent-hover">
              保存
            </button>
            <button onClick={() => { setEditing(false); setEditingId(null); }}
              className="px-2 py-1 text-xs text-gray-400 hover:text-white">
              取消
            </button>
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-8">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce" />
            <span className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
            <span className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
        </div>
      )}

      {/* Material list */}
      <div className="flex-1 overflow-y-auto">
        {!loading && filtered.length === 0 && (
          <div className="px-4 py-8 text-center text-gray-600 text-xs">
            <p className="text-lg mb-1">📦</p>
            <p>{searchText ? '没有匹配的素材' : '还没有收集素材'}</p>
            <p className="mt-1">在灵感搜索中点击 📌 收藏</p>
            <p>或点 +添加 手动录入</p>
          </div>
        )}

        {filtered.map(m => (
          <div
            key={m.id}
            className={`px-3 py-2 border-b border-gray-800 cursor-pointer transition-colors
              ${selectedMaterial?.id === m.id ? 'bg-sidebar-active' : 'hover:bg-float-800/70'}`}
            onClick={() => setSelectedMaterial(selectedMaterial?.id === m.id ? null : m)}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-300 font-medium truncate flex-1">{m.title}</span>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button onClick={(e) => { e.stopPropagation(); startEdit(m); }}
                  className="text-gray-600 hover:text-white text-[10px]">✏️</button>
                <button onClick={(e) => { e.stopPropagation(); handleDelete(m.id); }}
                  className="text-gray-600 hover:text-red-400 text-[10px]">🗑</button>
              </div>
            </div>
            {selectedMaterial?.id === m.id && (
              <div className="mt-2 space-y-1">
                <p className="text-[11px] text-gray-400 whitespace-pre-wrap line-clamp-6">{m.content}</p>
                <div className="flex flex-wrap gap-1 mt-1">
                  {m.tags.map(tag => (
                    <span key={tag} className="px-1 py-0.5 bg-float-700 rounded text-[9px] text-gray-400">{tag}</span>
                  ))}
                </div>
                <div className="text-[9px] text-gray-600">
                  {new Date(m.createdAt).toLocaleString('zh-CN')}
                  {m.url && <a href={m.url} target="_blank" className="ml-2 text-accent hover:underline" rel="noreferrer">来源 ↗</a>}
                </div>
              </div>
            )}
            {selectedMaterial?.id !== m.id && (
              <div className="flex items-center gap-1 mt-0.5">
                {m.tags.slice(0, 3).map(tag => (
                  <span key={tag} className="px-1 py-0.5 bg-float-800 rounded text-[8px] text-gray-500">{tag}</span>
                ))}
                {m.tags.length > 3 && <span className="text-[8px] text-gray-600">+{m.tags.length - 3}</span>}
                <span className="text-[9px] text-gray-600 ml-auto">{new Date(m.createdAt).toLocaleDateString('zh-CN')}</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default MaterialPanel;
