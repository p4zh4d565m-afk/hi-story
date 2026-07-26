import { useState, useCallback, useEffect, useRef } from 'react';

// ============================================================
// 回收站 Hook — 删除前保存快照，支持 Ctrl+Z / 按钮恢复
// ============================================================

export type TrashEntityType =
  | 'chapter'
  | 'character'
  | 'worldEntry'
  | 'outlineNode'
  | 'relation'
  | 'aiThread'
  | 'aiConfig'
  | 'material';

export interface TrashEntry {
  id: string;           // 回收站条目 ID
  entityType: TrashEntityType;
  entityId: string;     // 原实体 ID
  entityName: string;   // 显示名称
  projectId?: string;   // 关联项目 ID
  data: any;            // 完整实体数据
  deletedAt: string;    // ISO 时间戳
}

const STORAGE_KEY = 'hi-story-trash-bin';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 天

let _entryId = 0;
function genEntryId(): string {
  return 'trash_' + Date.now() + '_' + (++_entryId);
}

function loadEntries(): TrashEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveEntries(entries: TrashEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    const trimmed = entries.slice(-50);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed)); } catch {}
  }
}

export function useTrashBin(projectId?: string | null) {
  const [entries, setEntries] = useState<TrashEntry[]>(loadEntries);
  const [toastEntry, setToastEntry] = useState<TrashEntry | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 使用 ref 避免闭包陈旧问题
  const entriesRef = useRef<TrashEntry[]>(entries);

  // 同步 ref
  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  // 清理过期条目
  useEffect(() => {
    const now = Date.now();
    const filtered = entries.filter(e => now - new Date(e.deletedAt).getTime() < MAX_AGE_MS);
    if (filtered.length !== entries.length) {
      setEntries(filtered);
      saveEntries(filtered);
    }
  }, []);

  /** 添加到回收站 */
  const trashItem = useCallback((type: TrashEntityType, entityId: string, entityName: string, data: any, pId?: string) => {
    const entry: TrashEntry = {
      id: genEntryId(),
      entityType: type,
      entityId,
      entityName,
      projectId: pId || projectId || undefined,
      data,
      deletedAt: new Date().toISOString(),
    };
    // 使用函数式更新确保拿到最新值
    setEntries(prev => {
      const updated = [entry, ...prev].slice(0, 100);
      entriesRef.current = updated;
      saveEntries(updated);
      return updated;
    });

    // 显示 Toast
    setToastEntry(entry);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastEntry(null), 5000);

    return entry;
  }, [projectId]);

  /** 撤销最近一次删除（Ctrl+Z）- 使用 ref 确保获取最新值 */
  const undoLast = useCallback((): TrashEntry | null => {
    const current = entriesRef.current;
    if (current.length === 0) return null;
    const restored = current[0];
    const updated = current.slice(1);
    entriesRef.current = updated;
    setEntries(updated);
    saveEntries(updated);
    setToastEntry(null);
    return restored;
  }, []);

  /** 恢复指定条目 */
  const restoreItem = useCallback((entryId: string): TrashEntry | undefined => {
    const current = entriesRef.current;
    const entry = current.find(e => e.id === entryId);
    if (!entry) return undefined;
    const updated = current.filter(e => e.id !== entryId);
    entriesRef.current = updated;
    setEntries(updated);
    saveEntries(updated);
    return entry;
  }, []);

  /** 关闭 Toast */
  const dismissToast = useCallback(() => {
    setToastEntry(null);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, []);

  /** 获取当前项目的回收站条目 */
  const projectEntries = projectId
    ? entries.filter(e => !e.projectId || e.projectId === projectId)
    : entries;

  return {
    entries: projectEntries,
    toastEntry,
    trashItem,
    undoLast,
    restoreItem,
    dismissToast,
  } as const;
}

/** 获取实体类型的显示名称 */
export function getEntityTypeLabel(type: TrashEntityType): string {
  const map: Record<TrashEntityType, string> = {
    chapter: '章节',
    character: '角色',
    worldEntry: '世界观条目',
    outlineNode: '大纲节点',
    relation: '角色关系',
    aiThread: 'AI 对话',
    aiConfig: 'AI 配置',
    material: '素材',
  };
  return map[type] || type;
}
