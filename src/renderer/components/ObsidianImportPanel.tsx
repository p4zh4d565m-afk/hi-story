import React, { useEffect, useMemo, useRef, useState } from 'react';
import type {
  ObsidianImportCandidate, ObsidianImportPrepareResult, ObsidianImportSummary, Project,
  ObsidianImportSlot, ImportLayerChoices, StoryOption, ImportCharacterOverride, ImportWorldOverride,
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

const WORLD_CATEGORIES = ['place', 'faction', 'race', 'law', 'history', 'culture'] as const;
const WORLD_CATEGORY_LABELS: Record<string, string> = {
  place: '地点', faction: '势力', race: '种族', law: '法则', history: '历史', culture: '文化',
};

const LAYER_LABELS = { master: '总纲', volumes: '分卷纲', chapters: '章纲' } as const;

const ObsidianImportPanel: React.FC<ObsidianImportPanelProps> = ({ project, open, onClose, onImported }) => {
  const [prepareResult, setPrepareResult] = useState<ObsidianImportPrepareResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const [operationId, setOperationId] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  // 候选选中集合（relativePath）
  const [selectedSet, setSelectedSet] = useState<Set<string>>(new Set());
  // 每个候选的章纲默认卷归属
  const [volumeAssign, setVolumeAssign] = useState<Record<string, number | null>>({});
  // 人物/世界观 overrides（按 relativePath + sourceName）
  const [charOverrides, setCharOverrides] = useState<Record<string, ImportCharacterOverride[]>>({});
  const [worldOverrides, setWorldOverrides] = useState<Record<string, ImportWorldOverride[]>>({});
  const [layerChoices, setLayerChoices] = useState<ImportLayerChoices>({
    master: { action: 'keep', unlockLocked: false },
    volumes: { action: 'keep', unlockLocked: false },
    chapters: { action: 'keep', unlockLocked: false },
  });
  const [storyOptionDraft, setStoryOptionDraft] = useState<StoryOption | null>(null);

  const guardRef = useRef(createObsidianImportGuard({
    invoke: (channel, ...args) => (window as any).electronAPI.invoke(channel, ...args),
    onApply: (_pid, result) => {
      setPrepareResult(result);
      // 初始化选中集合：有有效槽位的候选默认选中
      const initial = new Set<string>();
      for (const c of result.candidates) {
        if (c.slots.length > 0) initial.add(c.relativePath);
      }
      setSelectedSet(initial);
      // 初始化 overrides 与卷归属
      const chars: Record<string, ImportCharacterOverride[]> = {};
      const worlds: Record<string, ImportWorldOverride[]> = {};
      const vols: Record<string, number | null> = {};
      for (const c of result.candidates) {
        chars[c.relativePath] = c.drafts.characters.map(ch => ({ sourceName: ch.sourceName, name: ch.name, overwrite: false }));
        worlds[c.relativePath] = c.drafts.worlds.map(w => ({ sourceName: w.sourceName, name: w.name, category: w.category as any, overwrite: false }));
        vols[c.relativePath] = null;
      }
      setCharOverrides(chars);
      setWorldOverrides(worlds);
      setVolumeAssign(vols);
      // 无已确认故事方向且将导入总纲时，预填故事方向表单
      if (!result.target.hasConfirmedStoryOption && result.candidates.some(c => c.slots.includes('master'))) {
        const master = result.candidates.find(c => c.slots.includes('master'))?.drafts.master;
        setStoryOptionDraft({
          title: project?.name ?? '', logline: master?.premise ?? '', targetReader: '',
          corePromise: master?.storyPromises?.[0] ?? '', protagonist: '', centralConflict: master?.centralConflict ?? '',
          differentiator: '', endingDirection: master?.ending ?? '',
        });
      } else {
        setStoryOptionDraft(null);
      }
    },
    onError: (_pid, err) => setError((err as Error).message),
    onLoadingChange: (_pid, loading) => setLoading(loading),
  }));

  // 打开或项目变化时重置全部状态
  useEffect(() => {
    setError(null);
    setPrepareResult(null);
    setSelectedPath(null);
    setOperationId(null);
    setSelectedSet(new Set());
    setVolumeAssign({});
    setCharOverrides({});
    setWorldOverrides({});
    setLayerChoices({
      master: { action: 'keep', unlockLocked: false },
      volumes: { action: 'keep', unlockLocked: false },
      chapters: { action: 'keep', unlockLocked: false },
    });
    setStoryOptionDraft(null);
    setCommitting(false);
    if (open && project?.id) {
      guardRef.current.prepare(project.id);
    } else {
      guardRef.current.invalidate();
    }
    return () => guardRef.current.invalidate();
  }, [open, project?.id]);

  const candidates: ObsidianImportCandidate[] = prepareResult?.candidates ?? [];
  const selectedCandidate: ObsidianImportCandidate | null = candidates.find(c => c.relativePath === selectedPath) ?? candidates[0] ?? null;

  // 汇总统计
  const stats = useMemo(() => {
    let create = 0; let update = 0; let skip = 0;
    for (const c of candidates) {
      if (!selectedSet.has(c.relativePath)) continue;
      for (const ch of (charOverrides[c.relativePath] ?? [])) {
        const matched = prepareResult?.target.characters.some(t => t.normalizedName === ch.sourceName.normalize('NFKC').trim().toLowerCase());
        if (matched) { ch.overwrite ? update++ : skip++; } else create++;
      }
      for (const w of (worldOverrides[c.relativePath] ?? [])) {
        const matched = prepareResult?.target.worlds.some(t => t.normalizedName === w.sourceName.normalize('NFKC').trim().toLowerCase());
        if (matched) { w.overwrite ? update++ : skip++; } else create++;
      }
    }
    return { create, update, skip };
  }, [candidates, selectedSet, charOverrides, worldOverrides, prepareResult]);

  // 阻塞原因汇总
  const blockReasons: string[] = [];
  const hasSelected = selectedSet.size > 0 || ['master', 'volumes', 'chapters'].some(l => layerChoices[l as keyof ImportLayerChoices].action !== 'keep');
  if (!hasSelected) blockReasons.push('未选择任何候选且三层均为保留');
  for (const c of candidates) {
    if (!selectedSet.has(c.relativePath)) continue;
    const blocking = c.issues.filter(i => i.severity === 'blocking');
    if (blocking.length) blockReasons.push(`${c.name}：${blocking.map(i => i.message).join('；')}`);
    for (const w of (worldOverrides[c.relativePath] ?? [])) {
      if (!w.category) blockReasons.push(`${c.name}：世界观「${w.sourceName}」未选分类`);
    }
  }
  for (const c of candidates) {
    if (!selectedSet.has(c.relativePath)) continue;
    const unassigned = c.drafts.chapters.filter(ch => ch.volumeIndex === null && (volumeAssign[c.relativePath] ?? null) === null);
    if (unassigned.length) blockReasons.push(`${c.name}：${unassigned.length} 章未分配卷`);
  }
  // 锁定层解锁确认
  const target = prepareResult?.target;
  if (target) {
    const lockedReplace = (l: keyof ImportLayerChoices) => target.layers[l === 'master' ? 'master' : l === 'volumes' ? 'volumes' : 'chapters'].status === 'locked' && (layerChoices[l].action === 'replace' || layerChoices[l].action === 'clear') && !layerChoices[l].unlockLocked;
    if (lockedReplace('master')) blockReasons.push('总纲已锁定，替换/清空需确认解锁');
    if (lockedReplace('volumes')) blockReasons.push('分卷纲已锁定，替换/清空需确认解锁');
    if (lockedReplace('chapters')) blockReasons.push('章纲已锁定，替换/清空需确认解锁');
  }

  const canCommit = !loading && !committing && !!prepareResult && blockReasons.length === 0;

  const generateOperationId = () => {
    const id = crypto.randomUUID();
    setOperationId(id);
    return id;
  };

  const editStory = (field: keyof StoryOption, value: string) => {
    guardRef.current.markEdited();
    setStoryOptionDraft(prev => prev ? { ...prev, [field]: value } : prev);
  };

  const commit = async () => {
    if (!project || !prepareResult || !canCommit) return;
    const opId = operationId ?? generateOperationId();
    setCommitting(true);
    setError(null);
    try {
      const selections = candidates
        .filter(c => selectedSet.has(c.relativePath))
        .map(c => ({
          relativePath: c.relativePath,
          hash: c.hash,
          slots: c.slots,
          defaultVolumeIndex: volumeAssign[c.relativePath] ?? null,
          characterOverrides: charOverrides[c.relativePath] ?? [],
          worldOverrides: worldOverrides[c.relativePath] ?? [],
        }));
      const summary = await guardRef.current.commit({
        projectId: project.id, operationId: opId, selections, layerChoices, storyOptionDraft: storyOptionDraft ?? undefined,
      });
      if (summary) {
        // 写库已成功，刷新失败也不能伪装成导入失败并再次写入
        try {
          await onImported(summary);
          onClose();
        } catch (refreshError) {
          setError('导入已写入，但界面刷新失败，请重新加载');
        }
      }
    } finally {
      setCommitting(false);
    }
  };

  if (!open) return null;

  const setSlot = (candidate: ObsidianImportCandidate, slot: ObsidianImportSlot, enabled: boolean) => {
    const nextSlots = enabled ? [...new Set([...candidate.slots, slot])] : candidate.slots.filter(s => s !== slot);
    guardRef.current.markEdited();
    guardRef.current.reparse({
      projectId: project!.id, relativePath: candidate.relativePath, hash: candidate.hash,
      slots: nextSlots as ObsidianImportSlot[], defaultVolumeIndex: volumeAssign[candidate.relativePath] ?? null,
    }).then(result => {
      if (result) {
        setPrepareResult(prev => prev ? {
          ...prev,
          candidates: prev.candidates.map(c => c.relativePath === candidate.relativePath ? { ...c, slots: nextSlots as ObsidianImportSlot[], drafts: result.drafts, issues: result.issues } : c),
        } : prev);
      }
    });
  };

  const setVolumeFor = (candidate: ObsidianImportCandidate, index: number | null) => {
    setVolumeAssign(prev => ({ ...prev, [candidate.relativePath]: index }));
    guardRef.current.markEdited();
    guardRef.current.reparse({
      projectId: project!.id, relativePath: candidate.relativePath, hash: candidate.hash,
      slots: candidate.slots, defaultVolumeIndex: index,
    }).then(result => {
      if (result) {
        setPrepareResult(prev => prev ? {
          ...prev,
          candidates: prev.candidates.map(c => c.relativePath === candidate.relativePath ? { ...c, drafts: result.drafts, issues: result.issues } : c),
        } : prev);
      }
    });
  };

  const renderFields = (candidate: ObsidianImportCandidate) => {
    const d = candidate.drafts;
    return (
      <div className="space-y-3">
        {d.master && (
          <div className="rounded border border-float-700 p-3">
            <p className="text-xs font-semibold text-gray-200 mb-2">总纲</p>
            <Field label="前提" value={d.master.premise} />
            <Field label="结局" value={d.master.ending} />
            <Field label="核心冲突" value={d.master.centralConflict} />
            <Field label="人物弧" value={d.master.protagonistArc} />
            <Field label="结构模型" value={d.master.structureModel} />
            <p className="text-[11px] text-gray-500 mt-2">阶段 {d.master.phases.length} 个 · 副线 {d.master.subplots.length} 条 · 承诺 {d.master.storyPromises.length} 条</p>
          </div>
        )}
        {d.volumes.length > 0 && (
          <div className="rounded border border-float-700 p-3">
            <p className="text-xs font-semibold text-gray-200 mb-2">分卷纲（{d.volumes.length}）</p>
            {d.volumes.map((v, i) => (
              <div key={i} className="mb-2">
                <p className="text-xs text-gray-300">{v.title}（{v.chapterRange}）</p>
                <p className="text-[11px] text-gray-500">目标：{v.volumeGoal || '—'}</p>
              </div>
            ))}
          </div>
        )}
        {d.chapters.length > 0 && (
          <div className="rounded border border-float-700 p-3">
            <p className="text-xs font-semibold text-gray-200 mb-2">章纲（{d.chapters.length}）</p>
            <div className="space-y-1">
              {d.chapters.slice(0, 20).map((ch, i) => (
                <p key={i} className="text-[11px] text-gray-400">
                  卷{ch.volumeIndex ?? '?'} 第{ch.chapterNumber ?? '?'}章 {ch.title}：{ch.centralConflict || '—'}
                </p>
              ))}
              {d.chapters.length > 20 && <p className="text-[11px] text-gray-600">…还有 {d.chapters.length - 20} 章</p>}
            </div>
          </div>
        )}
        {d.characters.length > 0 && (
          <div className="rounded border border-float-700 p-3">
            <p className="text-xs font-semibold text-gray-200 mb-2">人物（{d.characters.length}）</p>
            {d.characters.map((ch, i) => {
              const ov = charOverrides[candidate.relativePath]?.[i];
              const matched = prepareResult?.target.characters.some(t => t.normalizedName === ch.sourceName.normalize('NFKC').trim().toLowerCase());
              return (
                <div key={i} className="mb-2 flex items-center gap-2">
                  <input value={ov?.name ?? ch.name} onChange={e => {
                    guardRef.current.markEdited();
                    const arr = [...(charOverrides[candidate.relativePath] ?? [])];
                    arr[i] = { ...arr[i], name: e.target.value };
                    setCharOverrides(prev => ({ ...prev, [candidate.relativePath]: arr }));
                  }} className="flex-1 px-2 py-1 bg-float-900 border border-float-700 rounded text-xs text-gray-200" />
                  {matched && (
                    <label className="flex items-center gap-1 text-[11px] text-gray-400">
                      <input type="checkbox" checked={ov?.overwrite ?? false} onChange={e => {
                        guardRef.current.markEdited();
                        const arr = [...(charOverrides[candidate.relativePath] ?? [])];
                        arr[i] = { ...arr[i], overwrite: e.target.checked };
                        setCharOverrides(prev => ({ ...prev, [candidate.relativePath]: arr }));
                      }} />
                      覆盖同名
                    </label>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {d.worlds.length > 0 && (
          <div className="rounded border border-float-700 p-3">
            <p className="text-xs font-semibold text-gray-200 mb-2">世界观（{d.worlds.length}）</p>
            {d.worlds.map((w, i) => {
              const ov = worldOverrides[candidate.relativePath]?.[i];
              const matched = prepareResult?.target.worlds.some(t => t.normalizedName === w.sourceName.normalize('NFKC').trim().toLowerCase());
              return (
                <div key={i} className="mb-2 space-y-1">
                  <input value={ov?.name ?? w.name} onChange={e => {
                    guardRef.current.markEdited();
                    const arr = [...(worldOverrides[candidate.relativePath] ?? [])];
                    arr[i] = { ...arr[i], name: e.target.value };
                    setWorldOverrides(prev => ({ ...prev, [candidate.relativePath]: arr }));
                  }} className="w-full px-2 py-1 bg-float-900 border border-float-700 rounded text-xs text-gray-200" />
                  <div className="flex items-center gap-2">
                    <select value={ov?.category ?? ''} onChange={e => {
                      guardRef.current.markEdited();
                      const arr = [...(worldOverrides[candidate.relativePath] ?? [])];
                      arr[i] = { ...arr[i], category: e.target.value as any };
                      setWorldOverrides(prev => ({ ...prev, [candidate.relativePath]: arr }));
                    }} className="flex-1 px-2 py-1 bg-float-900 border border-float-700 rounded text-xs text-gray-200">
                      <option value="">选择分类…</option>
                      {WORLD_CATEGORIES.map(cat => <option key={cat} value={cat}>{WORLD_CATEGORY_LABELS[cat]}</option>)}
                    </select>
                    {matched && (
                      <label className="flex items-center gap-1 text-[11px] text-gray-400">
                        <input type="checkbox" checked={ov?.overwrite ?? false} onChange={e => {
                          guardRef.current.markEdited();
                          const arr = [...(worldOverrides[candidate.relativePath] ?? [])];
                          arr[i] = { ...arr[i], overwrite: e.target.checked };
                          setWorldOverrides(prev => ({ ...prev, [candidate.relativePath]: arr }));
                        }} />
                        覆盖同名
                      </label>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[110] bg-black/60 flex items-center justify-center p-8" onMouseDown={e => { if (e.target === e.currentTarget && !committing) onClose(); }}>
      <div className="w-full max-w-6xl h-[85vh] bg-float-900 border border-float-700 rounded-lg shadow-2xl flex flex-col overflow-hidden">
        <header className="px-5 py-3 border-b border-float-700 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-white">从 Obsidian 导入策划</h2>
            <p className="text-xs text-amber-300 mt-0.5">单向只读导入，不修改 Obsidian 文件</p>
          </div>
          <button onClick={onClose} disabled={committing} className="text-gray-400 hover:text-white text-xl disabled:opacity-40">×</button>
        </header>

        {loading && <p className="px-5 py-3 text-sm text-gray-400">正在扫描 Obsidian 目录…</p>}
        {error && <p className="px-5 py-3 text-sm text-red-300">{error}</p>}

        {prepareResult && !loading && (
          <div className="flex-1 min-h-0 flex">
            <aside className="w-72 border-r border-float-700 flex flex-col">
              <div className="p-2 text-xs text-gray-500">候选文件（{candidates.length}）</div>
              <div className="flex-1 overflow-y-auto">
                {candidates.map(c => (
                  <div key={c.relativePath} className={`border-l-2 ${selectedCandidate?.relativePath === c.relativePath ? 'border-accent bg-float-700' : 'border-transparent hover:bg-float-800'}`}>
                    <label className="flex items-start gap-2 px-3 py-2 cursor-pointer" onClick={() => setSelectedPath(c.relativePath)}>
                      <input type="checkbox" checked={selectedSet.has(c.relativePath)} disabled={committing}
                        onChange={e => { guardRef.current.markEdited(); setSelectedSet(prev => { const next = new Set(prev); e.target.checked ? next.add(c.relativePath) : next.delete(c.relativePath); return next; }); }} />
                      <span className="flex-1 min-w-0">
                        <span className="block text-xs font-medium text-gray-200 truncate">{c.name}</span>
                        <span className="block text-[10px] text-gray-500">{c.kind} · {c.slots.map(s => SLOT_LABELS[s]).join('、') || '未分类'}</span>
                      </span>
                    </label>
                  </div>
                ))}
              </div>
            </aside>

            <main className="flex-1 min-w-0 overflow-y-auto p-5">
              {selectedCandidate ? (
                <div>
                  <h3 className="text-sm font-semibold text-white mb-2">{selectedCandidate.name}</h3>
                  <p className="text-xs text-gray-500 mb-4">{selectedCandidate.relativePath}</p>
                  {selectedCandidate.issues.length > 0 && (
                    <div className="mb-4 space-y-1">
                      {selectedCandidate.issues.map((issue, i) => (
                        <p key={i} className={`text-xs ${issue.severity === 'blocking' ? 'text-red-300' : 'text-amber-300'}`}>
                          {issue.severity === 'blocking' ? '⛔' : '⚠'} {issue.message}
                        </p>
                      ))}
                    </div>
                  )}
                  {/* 槽位勾选 */}
                  <div className="mb-4">
                    <p className="text-xs text-gray-500 mb-1">槽位</p>
                    <div className="flex gap-2 flex-wrap">
                      {(['master', 'volume', 'chapter', 'character', 'world'] as ObsidianImportSlot[]).map(slot => (
                        <label key={slot} className="text-xs text-gray-300 flex items-center gap-1">
                          <input type="checkbox" disabled={committing} checked={selectedCandidate.slots.includes(slot)} onChange={e => setSlot(selectedCandidate, slot, e.target.checked)} />
                          {SLOT_LABELS[slot]}
                        </label>
                      ))}
                    </div>
                  </div>
                  {/* 章纲卷归属 */}
                  {selectedCandidate.slots.includes('chapter') && selectedCandidate.drafts.chapters.some(ch => ch.volumeIndex === null) && (
                    <div className="mb-4">
                      <p className="text-xs text-gray-500 mb-1">未分配章纲的默认卷归属</p>
                      <select value={volumeAssign[selectedCandidate.relativePath] ?? ''} disabled={committing}
                        onChange={e => setVolumeFor(selectedCandidate, e.target.value === '' ? null : Number(e.target.value))}
                        className="px-2 py-1 bg-float-900 border border-float-700 rounded text-xs text-gray-200">
                        <option value="">选择卷…</option>
                        {(() => {
                          const vols = selectedCandidate.drafts.volumes;
                          if (vols.length === 0) return <option value="" disabled>本次无分卷纲</option>;
                          return vols.map((v, i) => <option key={i} value={i}>第 {i + 1} 卷</option>);
                        })()}
                      </select>
                    </div>
                  )}
                  {renderFields(selectedCandidate)}
                </div>
              ) : (
                <p className="text-sm text-gray-500">选择左侧文件查看解析结果</p>
              )}
            </main>
          </div>
        )}

        <footer className="px-5 py-3 border-t border-float-700 flex flex-col gap-2">
          {/* 故事方向表单 */}
          {storyOptionDraft && (
            <div className="rounded border border-float-700 p-3">
              <p className="text-xs font-semibold text-gray-200 mb-2">Obsidian 导入方案（自动构造故事方向）</p>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[11px] text-gray-400">标题<input value={storyOptionDraft.title} onChange={e => editStory('title', e.target.value)} className="w-full mt-0.5 px-2 py-1 bg-float-900 border border-float-700 rounded text-xs text-gray-200" /></label>
                <label className="text-[11px] text-gray-400">一句话<input value={storyOptionDraft.logline} onChange={e => editStory('logline', e.target.value)} className="w-full mt-0.5 px-2 py-1 bg-float-900 border border-float-700 rounded text-xs text-gray-200" /></label>
                <label className="text-[11px] text-gray-400">核心体验<input value={storyOptionDraft.corePromise} onChange={e => editStory('corePromise', e.target.value)} className="w-full mt-0.5 px-2 py-1 bg-float-900 border border-float-700 rounded text-xs text-gray-200" /></label>
                <label className="text-[11px] text-gray-400">主要冲突<input value={storyOptionDraft.centralConflict} onChange={e => editStory('centralConflict', e.target.value)} className="w-full mt-0.5 px-2 py-1 bg-float-900 border border-float-700 rounded text-xs text-gray-200" /></label>
                <label className="text-[11px] text-gray-400">结局方向<input value={storyOptionDraft.endingDirection} onChange={e => editStory('endingDirection', e.target.value)} className="w-full mt-0.5 px-2 py-1 bg-float-900 border border-float-700 rounded text-xs text-gray-200" /></label>
                <label className="text-[11px] text-gray-400">主角（可空）<input value={storyOptionDraft.protagonist} onChange={e => editStory('protagonist', e.target.value)} className="w-full mt-0.5 px-2 py-1 bg-float-900 border border-float-700 rounded text-xs text-gray-200" /></label>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            {(Object.keys(LAYER_LABELS) as Array<keyof ImportLayerChoices>).map(layer => (
              <label key={layer} className="flex items-center gap-1">
                <select value={layerChoices[layer].action} disabled={committing}
                  onChange={e => { guardRef.current.markEdited(); setLayerChoices(prev => ({ ...prev, [layer]: { ...prev[layer], action: e.target.value as any } })); }}
                  className="px-2 py-1 bg-float-900 border border-float-700 rounded text-xs text-gray-200">
                  <option value="keep">{LAYER_LABELS[layer]}：保留</option>
                  <option value="fill">{LAYER_LABELS[layer]}：填空</option>
                  <option value="replace">{LAYER_LABELS[layer]}：替换</option>
                  <option value="clear">{LAYER_LABELS[layer]}：清空</option>
                </select>
                {(target?.layers[layer === 'master' ? 'master' : layer === 'volumes' ? 'volumes' : 'chapters'].status === 'locked') && (layerChoices[layer].action === 'replace' || layerChoices[layer].action === 'clear') && (
                  <span className="flex items-center gap-1 text-[11px] text-amber-300">
                    <input type="checkbox" checked={layerChoices[layer].unlockLocked} onChange={e => { guardRef.current.markEdited(); setLayerChoices(prev => ({ ...prev, [layer]: { ...prev[layer], unlockLocked: e.target.checked } })); }} />
                    解锁
                  </span>
                )}
              </label>
            ))}
          </div>

          {blockReasons.length > 0 && (
            <div className="text-[11px] text-red-300 space-y-0.5">
              {blockReasons.map((r, i) => <p key={i}>⛔ {r}</p>)}
            </div>
          )}

          <div className="flex items-center justify-between">
            <p className="text-[11px] text-gray-500">预计：新建 {stats.create} · 覆盖 {stats.update} · 跳过 {stats.skip}</p>
            <button onClick={commit} disabled={!canCommit}
              className="px-4 py-2 rounded bg-accent text-xs text-white hover:bg-accent-hover disabled:opacity-40">
              {committing ? '导入中…' : '确认导入'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
};

const Field: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <p className="text-[11px] text-gray-400 mb-1">{label}：{value || '—'}</p>
);

export default ObsidianImportPanel;
