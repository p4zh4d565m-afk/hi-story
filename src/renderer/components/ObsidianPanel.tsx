import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ObsidianDocument, ObsidianDocumentKind, ObsidianScanResult, Project } from '../types';

interface ObsidianPanelProps {
  open: boolean;
  project: Project | null;
  result: ObsidianScanResult | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onSavePath: (path: string) => Promise<boolean>;
  onRefresh: () => void;
}

const KIND_LABELS: Record<ObsidianDocumentKind, string> = {
  character: '人物',
  world: '世界观',
  outline: '长期大纲',
};

const ObsidianPanel: React.FC<ObsidianPanelProps> = ({
  open, project, result, loading, error, onClose, onSavePath, onRefresh,
}) => {
  const [pathValue, setPathValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [kind, setKind] = useState<'all' | ObsidianDocumentKind>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const projectIdRef = useRef(project?.id);
  projectIdRef.current = project?.id;

  useEffect(() => {
    setPathValue(project?.obsidianPath || '');
    setSaving(false);
    setLocalError(null);
    setKind('all');
    setSelectedId(null);
  }, [project?.id, project?.obsidianPath]);

  const visibleDocuments = useMemo(() => (
    (result?.documents || []).filter(document => kind === 'all' || document.kind === kind)
  ), [kind, result?.documents]);
  const selectedDocument = visibleDocuments.find(document => document.id === selectedId)
    ?? visibleDocuments[0]
    ?? null;

  if (!open) return null;

  const chooseDirectory = async () => {
    const projectId = project?.id;
    if (!projectId) return;
    setLocalError(null);
    const response = await window.electronAPI.invoke('obsidian:chooseDirectory') as any;
    if (projectIdRef.current !== projectId) return;
    if (!response?.success) {
      setLocalError(response?.error || '目录选择失败');
      return;
    }
    if (response.data) setPathValue(response.data);
  };

  const savePath = async (nextPath = pathValue) => {
    const projectId = project?.id;
    if (!projectId) return;
    setSaving(true);
    setLocalError(null);
    try {
      const success = await onSavePath(nextPath.trim());
      if (projectIdRef.current !== projectId) return;
      if (!success) setLocalError('目录配置保存失败');
    } finally {
      if (projectIdRef.current === projectId) setSaving(false);
    }
  };

  const clearPath = async () => {
    setPathValue('');
    await savePath('');
  };

  const statusText = loading
    ? '正在读取 Obsidian 资料…'
    : result?.status === 'ready'
      ? `已读取 ${result.documents.length} 个 Markdown 文件`
      : result?.message || '尚未配置 Obsidian 目录';

  return (
    <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-8" onMouseDown={event => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className="w-full max-w-6xl h-[82vh] bg-float-900 border border-float-700 rounded-lg shadow-2xl flex flex-col overflow-hidden">
        <header className="px-5 py-3 border-b border-float-700 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-white">Obsidian 资料</h2>
            <p className="text-xs text-amber-300 mt-0.5">只读来源：hi-story 不会修改或创建 Obsidian 文件</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl" title="关闭">×</button>
        </header>

        <section className="px-5 py-3 border-b border-float-700 bg-float-800/40">
          <label className="block text-xs text-gray-400 mb-1">当前项目目录：{project?.name || '未选择项目'}</label>
          <div className="flex gap-2">
            <input
              value={pathValue}
              onChange={event => setPathValue(event.target.value)}
              placeholder="选择 Obsidian 仓库或小说项目目录"
              className="flex-1 px-3 py-2 bg-float-900 border border-float-700 rounded text-sm text-white focus:outline-none focus:border-accent"
            />
            <button onClick={chooseDirectory} disabled={!project} className="px-3 py-2 text-sm bg-float-700 rounded hover:bg-float-600 disabled:opacity-40">选择目录</button>
            <button onClick={() => savePath()} disabled={!project || saving} className="px-3 py-2 text-sm bg-accent rounded hover:bg-accent-hover disabled:opacity-40">{saving ? '保存中…' : '保存'}</button>
            <button onClick={clearPath} disabled={!project || saving || !project.obsidianPath} className="px-3 py-2 text-sm text-gray-400 hover:text-white disabled:opacity-40">清除</button>
            <button onClick={onRefresh} disabled={!project || loading} className="px-3 py-2 text-sm text-gray-300 hover:text-white disabled:opacity-40">刷新</button>
          </div>
          <p className={`text-xs mt-2 ${result?.status === 'missing' || error || localError ? 'text-red-300' : 'text-gray-400'}`}>
            {localError || error || statusText}
          </p>
          {!!result?.warnings.length && (
            <p className="text-xs text-amber-300 mt-1">已跳过 {result.warnings.length} 个损坏或不可读文件；其他资料仍可正常使用。</p>
          )}
        </section>

        <div className="flex-1 min-h-0 flex">
          <aside className="w-72 border-r border-float-700 flex flex-col">
            <div className="p-2 flex gap-1 border-b border-float-700">
              {([
                ['all', '全部'], ['character', '人物'], ['world', '世界观'], ['outline', '大纲'],
              ] as const).map(([value, label]) => (
                <button key={value} onClick={() => { setKind(value); setSelectedId(null); }} className={`px-2 py-1 rounded text-xs ${kind === value ? 'bg-accent text-white' : 'text-gray-400 hover:bg-float-700'}`}>{label}</button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto py-1">
              {visibleDocuments.map(document => (
                <button key={document.id} onClick={() => setSelectedId(document.id)} className={`w-full text-left px-3 py-2 border-l-2 ${selectedDocument?.id === document.id ? 'border-accent bg-float-700 text-white' : 'border-transparent text-gray-300 hover:bg-float-800'}`}>
                  <span className="block text-xs font-medium truncate">{document.name}</span>
                  <span className="block text-[10px] text-gray-500 truncate">{KIND_LABELS[document.kind]} · {document.relativePath}</span>
                </button>
              ))}
              {!loading && visibleDocuments.length === 0 && <p className="px-4 py-8 text-xs text-gray-500 text-center">没有可浏览的资料</p>}
            </div>
          </aside>

          <main className="flex-1 min-w-0 overflow-y-auto p-6">
            {selectedDocument ? <DocumentView document={selectedDocument} /> : (
              <div className="h-full flex items-center justify-center text-sm text-gray-500">选择左侧 Markdown 文件查看</div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
};

const DocumentView: React.FC<{ document: ObsidianDocument }> = ({ document }) => (
  <article>
    <div className="flex items-center gap-2 mb-1">
      <span className="px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 text-[10px]">来自 Obsidian · 只读</span>
      <span className="text-xs text-gray-500">{KIND_LABELS[document.kind]}</span>
    </div>
    <h3 className="text-xl font-semibold text-white mt-3">{document.name}</h3>
    <p className="text-xs text-gray-500 mt-1 mb-5">{document.relativePath}</p>
    <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-7 text-gray-200">{document.content || '（空文件）'}</pre>
  </article>
);

export default ObsidianPanel;
