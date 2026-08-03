import React, { useState, useEffect, useCallback } from 'react';
import type { Foreshadowing } from '../types';

// ============================================================
// 伏笔追踪浮动面板
// - 卡片列表：已埋 → 待回收 → 已回收
// - 新建/编辑/删除伏笔
// - 关联章节、角色、大纲节点
// ============================================================

interface ForeshadowingPanelProps {
  /** 是否显示 */
  open: boolean;
  /** 项目 ID */
  projectId: string | null;
  /** 章节列表（用于关联选择） */
  chapters: Array<{ id: string; title: string }>;
  /** 角色列表 */
  characters: Array<{ id: string; name: string }>;
  /** 大纲节点 */
  outlineNodes: Array<{ id: string; title: string }>;
}

interface EditingForeshadowing {
  id?: string;
  title: string;
  description: string;
  status: 'planted' | 'pending' | 'resolved';
  plantedChapterId: string;
  resolvedChapterId: string;
  relatedCharacters: string[];
  relatedOutlineNodes: string[];
  note: string;
}

const emptyEdit: EditingForeshadowing = {
  title: '', description: '', status: 'planted',
  plantedChapterId: '', resolvedChapterId: '',
  relatedCharacters: [], relatedOutlineNodes: [],
  note: '',
};

const STATUS_LABELS: Record<string, string> = {
  planted: '已埋',
  pending: '待回收',
  resolved: '已回收',
};

const STATUS_ICONS: Record<string, string> = {
  planted: '🟡',
  pending: '🔴',
  resolved: '🟢',
};

const ForeshadowingPanel: React.FC<ForeshadowingPanelProps> = ({
  open, projectId, chapters, characters, outlineNodes,
}) => {
  const [foreshadowings, setForeshadowings] = useState<Foreshadowing[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<'all' | 'planted' | 'pending' | 'resolved'>('all');
  const [editing, setEditing] = useState<EditingForeshadowing | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ===== 加载 =====
  const loadForeshadowings = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const res = await window.electronAPI.invoke('db:foreshadowing:findByProject', projectId) as any;
      if (res.success) setForeshadowings(res.data || []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (open && projectId) loadForeshadowings();
  }, [open, projectId, loadForeshadowings]);

  // ===== 创建/更新 =====
  const handleSave = useCallback(async () => {
    if (!editing || !projectId) return;
    if (!editing.title.trim()) { setError('请输入伏笔标题'); return; }
    setSaving(true);
    setError(null);
    try {
      if (editing.id) {
        await window.electronAPI.invoke('db:foreshadowing:update', editing.id, {
          title: editing.title,
          description: editing.description,
          status: editing.status,
          plantedChapterId: editing.plantedChapterId || null,
          resolvedChapterId: editing.resolvedChapterId || null,
          relatedCharacters: editing.relatedCharacters,
          relatedOutlineNodes: editing.relatedOutlineNodes,
          note: editing.note,
        });
      } else {
        await window.electronAPI.invoke('db:foreshadowing:create', {
          projectId,
          title: editing.title,
          description: editing.description,
          status: editing.status,
          plantedChapterId: editing.plantedChapterId || null,
          relatedCharacters: editing.relatedCharacters,
          relatedOutlineNodes: editing.relatedOutlineNodes,
          note: editing.note,
        });
      }
      setEditing(null);
      await loadForeshadowings();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }, [editing, projectId, loadForeshadowings]);

  // ===== 删除 =====
  const handleDelete = useCallback(async (id: string) => {
    if (!confirm('确定删除此伏笔？')) return;
    try {
      await window.electronAPI.invoke('db:foreshadowing:remove', id);
      await loadForeshadowings();
    } catch (e) {
      setError((e as Error).message);
    }
  }, [loadForeshadowings]);

  // ===== 改变状态 =====
  const handleStatusChange = useCallback(async (id: string, status: string) => {
    try {
      await window.electronAPI.invoke('db:foreshadowing:updateStatus', id, status);
      await loadForeshadowings();
    } catch (e) {
      setError((e as Error).message);
    }
  }, [loadForeshadowings]);

  const filtered = filter === 'all'
    ? foreshadowings
    : foreshadowings.filter(f => f.status === filter);

  if (!open) return null;

  return (
    <div className="h-full flex flex-col bg-gray-950 relative">
      {/* ── 顶部操作栏 ── */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 shrink-0">
        <button
          onClick={() => setEditing({ ...emptyEdit })}
          className="px-3 py-1.5 bg-accent text-white text-xs rounded hover:bg-accent-hover transition-colors"
        >
          + 新伏笔
        </button>
        {/* ── 筛选 tabs ── */}
        <div className="flex items-center gap-1">
          {(['all', 'planted', 'pending', 'resolved'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setFilter(tab)}
              className={`px-2.5 py-1 rounded text-[11px] transition-colors ${
                filter === tab ? 'bg-accent/20 text-accent' : 'text-gray-500 hover:text-white'
              }`}
            >
              {tab === 'all' ? `全部 (${foreshadowings.length})` : `${STATUS_ICONS[tab]} ${STATUS_LABELS[tab]}`}
            </button>
          ))}
        </div>
      </div>

        {/* ── 主体 ── */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-sm">
          {error && (
            <div className="p-2 bg-red-900/30 border border-red-800 rounded text-xs text-red-400">{error}</div>
          )}

          {loading ? (
            <div className="text-center py-8 text-xs text-gray-600">加载中...</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-8 text-xs text-gray-600">
              <p>暂无伏笔</p>
              <p className="mt-1">点击"+ 新伏笔"创建第一个</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map(f => {
                const plantedCh = chapters.find(c => c.id === f.planted_chapter_id);
                const resolvedCh = chapters.find(c => c.id === f.resolved_chapter_id);
                const relChars = (() => { try { return JSON.parse(f.related_characters); } catch { return []; } })();
                return (
                  <div
                    key={f.id}
                    className={`p-3 rounded border text-[11px] ${
                      f.status === 'planted' ? 'bg-yellow-900/10 border-yellow-800/30' :
                      f.status === 'pending' ? 'bg-red-900/10 border-red-800/30' :
                      'bg-green-900/10 border-green-800/30'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span>{STATUS_ICONS[f.status]}</span>
                      <span className="font-semibold text-gray-200 flex-1">{f.title}</span>
                      <span className="text-[9px] text-gray-600">{STATUS_LABELS[f.status]}</span>
                    </div>
                    {f.description && (
                      <p className="text-gray-400 mb-1">{f.description}</p>
                    )}
                    <div className="flex items-center gap-3 text-[10px] text-gray-500">
                      {plantedCh && <span>埋于：{plantedCh.title}</span>}
                      {resolvedCh && <span>回收于：{resolvedCh.title}</span>}
                      {relChars.length > 0 && (
                        <span>
                          关联：{relChars.map((cid: string) => characters.find(c => c.id === cid)?.name || cid).join('、')}
                        </span>
                      )}
                    </div>
                    {f.note && (
                      <p className="text-[10px] text-gray-600 mt-1">💬 {f.note}</p>
                    )}
                    {/* 操作按钮 */}
                    <div className="flex items-center gap-2 mt-2 pt-2 border-t border-gray-800/50">
                      {f.status === 'planted' && (
                        <button
                          onClick={() => handleStatusChange(f.id, 'pending')}
                          className="text-[10px] text-yellow-400 hover:text-yellow-300"
                        >
                          → 待回收
                        </button>
                      )}
                      {f.status === 'pending' && (
                        <button
                          onClick={() => handleStatusChange(f.id, 'resolved')}
                          className="text-[10px] text-green-400 hover:text-green-300"
                        >
                          → 已回收
                        </button>
                      )}
                      <button
                        onClick={() => setEditing({
                          id: f.id, title: f.title, description: f.description,
                          status: f.status, plantedChapterId: f.planted_chapter_id || '',
                          resolvedChapterId: f.resolved_chapter_id || '',
                          relatedCharacters: relChars,
                          relatedOutlineNodes: (() => { try { return JSON.parse(f.related_outline_nodes); } catch { return []; } })(),
                          note: f.note,
                        })}
                        className="text-[10px] text-gray-500 hover:text-white"
                      >
                        编辑
                      </button>
                      <button
                        onClick={() => handleDelete(f.id)}
                        className="text-[10px] text-red-400 hover:text-red-300"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── 编辑浮层 ── */}
        {editing && (
          <div className="absolute inset-0 bg-gray-950/95 flex flex-col z-10">
            <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 shrink-0">
              <span className="text-xs font-semibold text-gray-300">
                {editing.id ? '编辑伏笔' : '新建伏笔'}
              </span>
              <button onClick={() => setEditing(null)} className="text-gray-500 hover:text-white">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3 text-xs">
              <div>
                <label className="text-[10px] text-gray-400 block mb-1">标题 *</label>
                <input
                  type="text" value={editing.title}
                  onChange={e => setEditing(p => ({ ...p, title: e.target.value }))}
                  placeholder="例如：主角师父的真实身份"
                  className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-gray-200 focus:outline-none focus:border-accent placeholder-gray-600"
                />
              </div>
              <div>
                <label className="text-[10px] text-gray-400 block mb-1">描述</label>
                <textarea
                  value={editing.description} rows={2}
                  onChange={e => setEditing(p => ({ ...p, description: e.target.value }))}
                  placeholder="伏笔的详细内容..."
                  className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-gray-200 resize-none focus:outline-none focus:border-accent placeholder-gray-600"
                />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-[10px] text-gray-400 block mb-1">状态</label>
                  <select
                    value={editing.status}
                    onChange={e => setEditing(p => ({ ...p, status: e.target.value as any }))}
                    className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-gray-200 focus:outline-none focus:border-accent"
                  >
                    <option value="planted">🟡 已埋</option>
                    <option value="pending">🔴 待回收</option>
                    <option value="resolved">🟢 已回收</option>
                  </select>
                </div>
                <div className="flex-1">
                  <label className="text-[10px] text-gray-400 block mb-1">埋设章节</label>
                  <select
                    value={editing.plantedChapterId}
                    onChange={e => setEditing(p => ({ ...p, plantedChapterId: e.target.value }))}
                    className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-gray-200 focus:outline-none focus:border-accent"
                  >
                    <option value="">(不关联)</option>
                    {chapters.map(c => (
                      <option key={c.id} value={c.id}>{c.title}</option>
                    ))}
                  </select>
                </div>
              </div>
              {editing.status === 'resolved' && (
                <div>
                  <label className="text-[10px] text-gray-400 block mb-1">回收章节</label>
                  <select
                    value={editing.resolvedChapterId}
                    onChange={e => setEditing(p => ({ ...p, resolvedChapterId: e.target.value }))}
                    className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-gray-200 focus:outline-none focus:border-accent"
                  >
                    <option value="">(不关联)</option>
                    {chapters.map(c => (
                      <option key={c.id} value={c.id}>{c.title}</option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="text-[10px] text-gray-400 block mb-1">关联角色（多选）</label>
                <div className="flex flex-wrap gap-1.5 max-h-[100px] overflow-y-auto">
                  {characters.map(ch => (
                    <label key={ch.id} className="flex items-center gap-1 text-[10px] text-gray-400 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editing.relatedCharacters.includes(ch.id)}
                        onChange={e => {
                          setEditing(p => ({
                            ...p,
                            relatedCharacters: e.target.checked
                              ? [...p.relatedCharacters, ch.id]
                              : p.relatedCharacters.filter(id => id !== ch.id),
                          }));
                        }}
                        className="accent-accent"
                      />
                      {ch.name}
                    </label>
                  ))}
                  {characters.length === 0 && <span className="text-gray-600">暂无角色</span>}
                </div>
              </div>
              <div>
                <label className="text-[10px] text-gray-400 block mb-1">笔记</label>
                <textarea
                  value={editing.note} rows={2}
                  onChange={e => setEditing(p => ({ ...p, note: e.target.value }))}
                  placeholder="补充说明..."
                  className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-gray-200 resize-none focus:outline-none focus:border-accent placeholder-gray-600"
                />
              </div>
            </div>
            <div className="flex items-center gap-2 px-4 py-3 border-t border-gray-800 shrink-0">
              <button
                onClick={handleSave}
                disabled={saving || !editing.title.trim()}
                className="px-4 py-1.5 bg-accent text-white text-xs rounded hover:bg-accent-hover disabled:opacity-40 transition-colors"
              >
                {saving ? '保存中...' : '💾 保存'}
              </button>
              <button
                onClick={() => setEditing(null)}
                className="px-3 py-1.5 text-gray-500 text-xs hover:text-white transition-colors"
              >
                取消
              </button>
            </div>
          </div>
        )}
    </div>
  );
};

export default ForeshadowingPanel;
