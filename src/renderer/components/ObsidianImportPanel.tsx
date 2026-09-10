import React, { useEffect, useRef, useState } from 'react';
import type {
  ObsidianImportCandidate, ObsidianImportPrepareResult, ObsidianImportSummary, Project,
  ObsidianImportSlot, ImportLayerChoices, StoryOption,
} from '../types';
import { createObsidianImportGuard } from '../services/obsidian-import-guard';

interface ObsidianImportPanelProps {
  project: Project | null;
  open: boolean;
  onClose: () => void;
  onImported: (summary: ObsidianImportSummary) => Promise<void>;
}

const SLOT_LABELS: Record<ObsidianImportSlot, string> = {
  master: '总纲', volume: '分卷纲', chapter: '章纲', character: '人物', world: '世界观',
};

const ObsidianImportPanel: React.FC<ObsidianImportPanelProps> = ({ project, open, onClose, onImported }) => {
  const [prepareResult, setPrepareResult] = useState<ObsidianImportPrepareResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const [operationId, setOperationId] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [layerChoices, setLayerChoices] = useState<ImportLayerChoices>({
    master: { action: 'keep', unlockLocked: false },
    volumes: { action: 'keep', unlockLocked: false },
    chapters: { action: 'keep', unlockLocked: false },
  });
  const [storyOptionDraft, setStoryOptionDraft] = useState<StoryOption | undefined>(undefined);
  const projectIdRef = useRef(project?.id ?? null);
  projectIdRef.current = project?.id ?? null;

  const guardRef = useRef(createObsidianImportGuard({
    invoke: (channel, ...args) => (window as any).electronAPI.invoke(channel, ...args),
    onApply: (_pid, result) => {
      setPrepareResult(result);
      // 无已确认故事方向时预填导入方案
      if (!result.target.hasConfirmedStoryOption && result.candidates.some(c => c.slots.includes('master'))) {
        setStoryOptionDraft(prev => prev ?? {
          title: project?.name ?? '', logline: '', targetReader: '', corePromise: '',
          protagonist: '', centralConflict: '', differentiator: '', endingDirection: '',
        });
      }
    },
    onError: (_pid, err) => setError((err as Error).message),
    onLoadingChange: (_pid, loading) => setLoading(loading),
  }));

  useEffect(() => {
    if (open && project?.id) {
      setError(null);
      setPrepareResult(null);
      setSelectedPath(null);
      setOperationId(null);
      guardRef.current.prepare(project.id);
    } else {
      guardRef.current.invalidate();
    }
    return () => guardRef.current.invalidate();
  }, [open, project?.id]);

  if (!open) return null;

  const candidates: ObsidianImportCandidate[] = prepareResult?.candidates ?? [];
  const selected: ObsidianImportCandidate | null = candidates.find(c => c.relativePath === selectedPath) ?? candidates[0] ?? null;

  const generateOperationId = () => {
    const id = crypto.randomUUID();
    setOperationId(id);
    return id;
  };

  const commit = async () => {
    if (!project || !prepareResult) return;
    const opId = operationId ?? generateOperationId();
    setCommitting(true);
    setError(null);
    const selections = prepareResult.candidates
      .filter(c => c.slots.length > 0 || c.drafts.master || c.drafts.volumes.length || c.drafts.chapters.length || c.drafts.characters.length || c.drafts.worlds.length)
      .map(c => ({ relativePath: c.relativePath, hash: c.hash, slots: c.slots, drafts: c.drafts }));
    const summary = await guardRef.current.commit({
      projectId: project.id, operationId: opId, selections, layerChoices, storyOptionDraft,
    });
    if (summary) {
      await onImported(summary);
      onClose();
    }
    setCommitting(false);
  };

  const setSlot = (candidate: ObsidianImportCandidate, slot: ObsidianImportSlot, enabled: boolean) => {
    // 手动指定槽位后触发主进程 reparse
    const nextSlots = enabled ? [...new Set([...candidate.slots, slot])] : candidate.slots.filter(s => s !== slot);
    guardRef.current.reparse({
      projectId: project!.id, relativePath: candidate.relativePath, hash: candidate.hash,
      slots: nextSlots as ObsidianImportSlot[], defaultVolumeIndex: null,
    }).then(result => {
      if (result) {
        setPrepareResult(prev => prev ? {
          ...prev,
          candidates: prev.candidates.map(c => c.relativePath === candidate.relativePath ? { ...c, slots: nextSlots as ObsidianImportSlot[], drafts: result.drafts, issues: result.issues } : c),
        } : prev);
      }
    });
  };

  return (
    <div className="fixed inset-0 z-[110] bg-black/60 flex items-center justify-center p-8" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-6xl h-[85vh] bg-float-900 border border-float-700 rounded-lg shadow-2xl flex flex-col overflow-hidden">
        <header className="px-5 py-3 border-b border-float-700 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-white">从 Obsidian 导入策划</h2>
            <p className="text-xs text-amber-300 mt-0.5">单向只读导入，不修改 Obsidian 文件</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl">×</button>
        </header>

        {loading && <p className="px-5 py-3 text-sm text-gray-400">正在扫描 Obsidian 目录…</p>}
        {error && <p className="px-5 py-3 text-sm text-red-300">{error}</p>}

        {prepareResult && !loading && (
          <div className="flex-1 min-h-0 flex">
            {/* 左：文件列表 */}
            <aside className="w-72 border-r border-float-700 flex flex-col">
              <div className="p-2 text-xs text-gray-500">候选文件（{candidates.length}）</div>
              <div className="flex-1 overflow-y-auto">
                {candidates.map(c => (
                  <button key={c.relativePath} onClick={() => setSelectedPath(c.relativePath)}
                    className={`w-full text-left px-3 py-2 border-l-2 ${selected?.relativePath === c.relativePath ? 'border-accent bg-float-700' : 'border-transparent hover:bg-float-800'}`}>
                    <span className="block text-xs font-medium text-gray-200 truncate">{c.name}</span>
                    <span className="block text-[10px] text-gray-500">{c.kind} · {c.slots.map(s => SLOT_LABELS[s]).join('、') || '未分类'}</span>
                  </button>
                ))}
              </div>
            </aside>

            {/* 右：详情 */}
            <main className="flex-1 min-w-0 overflow-y-auto p-5">
              {selected ? (
                <div>
                  <h3 className="text-sm font-semibold text-white mb-2">{selected.name}</h3>
                  <p className="text-xs text-gray-500 mb-4">{selected.relativePath}</p>
                  {selected.issues.length > 0 && (
                    <div className="mb-4 space-y-1">
                      {selected.issues.map((issue, i) => (
                        <p key={i} className={`text-xs ${issue.severity === 'blocking' ? 'text-red-300' : 'text-amber-300'}`}>
                          {issue.severity === 'blocking' ? '⛔' : '⚠'} {issue.message}
                        </p>
                      ))}
                    </div>
                  )}
                  {/* 槽位勾选（手动指定触发 reparse） */}
                  <div className="mb-4">
                    <p className="text-xs text-gray-500 mb-1">槽位（修改后主进程重新解析）</p>
                    <div className="flex gap-2 flex-wrap">
                      {(['master', 'volume', 'chapter', 'character', 'world'] as ObsidianImportSlot[]).map(slot => (
                        <label key={slot} className="text-xs text-gray-300 flex items-center gap-1">
                          <input type="checkbox" checked={selected.slots.includes(slot)} onChange={e => setSlot(selected, slot, e.target.checked)} />
                          {SLOT_LABELS[slot]}
                        </label>
                      ))}
                    </div>
                  </div>
                  {/* 草稿展示（只读，展示解析结果供确认） */}
                  {selected.drafts.master && <p className="text-xs text-gray-400 mb-1">总纲已解析：{selected.drafts.master.phases?.length ?? 0} 个阶段</p>}
                  {selected.drafts.volumes.length > 0 && <p className="text-xs text-gray-400 mb-1">分卷纲已解析：{selected.drafts.volumes.length} 卷</p>}
                  {selected.drafts.chapters.length > 0 && <p className="text-xs text-gray-400 mb-1">章纲已解析：{selected.drafts.chapters.length} 章</p>}
                  {selected.drafts.characters.length > 0 && <p className="text-xs text-gray-400 mb-1">人物已解析：{selected.drafts.characters.map(c => c.name).join('、')}</p>}
                  {selected.drafts.worlds.length > 0 && <p className="text-xs text-gray-400 mb-1">世界观已解析：{selected.drafts.worlds.map(w => w.name).join('、')}</p>}
                </div>
              ) : (
                <p className="text-sm text-gray-500">选择左侧文件查看解析结果</p>
              )}
            </main>
          </div>
        )}

        {/* 底部操作 */}
        <footer className="px-5 py-3 border-t border-float-700 flex items-center justify-between">
          <div className="flex gap-2">
            {(['master', 'volumes', 'chapters'] as const).map(layer => (
              <select key={layer} value={layerChoices[layer].action}
                onChange={e => setLayerChoices(prev => ({ ...prev, [layer]: { ...prev[layer], action: e.target.value as any } }))}
                className="px-2 py-1 bg-float-900 border border-float-700 rounded text-xs text-gray-200">
                <option value="keep">{SLOT_LABELS[layer]}：保留</option>
                <option value="fill">{SLOT_LABELS[layer]}：填空</option>
                <option value="replace">{SLOT_LABELS[layer]}：替换</option>
                <option value="clear">{SLOT_LABELS[layer]}：清空</option>
              </select>
            ))}
          </div>
          <button onClick={commit} disabled={committing || loading || !prepareResult}
            className="px-4 py-2 rounded bg-accent text-xs text-white hover:bg-accent-hover disabled:opacity-40">
            {committing ? '导入中…' : '确认导入'}
          </button>
        </footer>
      </div>
    </div>
  );
};

export default ObsidianImportPanel;
