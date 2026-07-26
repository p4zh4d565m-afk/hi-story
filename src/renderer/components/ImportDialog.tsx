import React, { useState } from 'react';
import type { ImportResult } from '../../main/importer';

interface ImportDocInfo {
  id: string;
  title: string;
  author: string | null;
  format: string;
  totalWords: number;
  createdAt: string;
}

interface ImportToRefResult {
  doc: ImportDocInfo;
  chapterCount: number;
  chunkCount: number;
  warnings: string[];
}

interface BatchItem {
  file: string;
  status: 'imported' | 'skipped' | 'error';
  title?: string;
  chunkCount?: number;
  existingTitle?: string;
  error?: string;
}

interface BatchResult {
  results: BatchItem[];
  summary: {
    total: number;
    imported: number;
    skipped: number;
    errors: number;
  };
}

interface ImportDialogProps {
  open: boolean;
  onClose: () => void;
  /** @deprecated 旧的导入到章节的回调，保留兼容 */
  onImport?: (result: ImportResult) => void;
  /** 新的导入到参考库的回调 */
  onImportToReference?: (result: ImportToRefResult) => void;
  /** 批量导入完成回调 */
  onBatchImportComplete?: (result: BatchResult) => void;
}

const ImportDialog: React.FC<ImportDialogProps> = ({ open, onClose, onImport, onImportToReference, onBatchImportComplete }) => {
  // ── 单文件导入状态 ──
  const [step, setStep] = useState<'select' | 'parsing' | 'preview'>('select');
  const [filePath, setFilePath] = useState<string | null>(null);
  const [parseResult, setParseResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedChapters, setSelectedChapters] = useState<Set<number>>(new Set());
  const [importing, setImporting] = useState(false);
  const [importTarget, setImportTarget] = useState<'reference' | 'chapters'>('reference');

  // ── 批量导入状态 ──
  const [batchMode, setBatchMode] = useState(false);
  const [batchFiles, setBatchFiles] = useState<string[]>([]);
  const [batchPreview, setBatchPreview] = useState<BatchItem[]>([]);
  const [batchConflictMode, setBatchConflictMode] = useState<'skip' | 'overwrite'>('skip');
  const [batchStep, setBatchStep] = useState<'idle' | 'parsing' | 'preview' | 'importing'>('idle');
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 });

  if (!open) return null;

  // ═══════════════════════════════════════
  // 单文件导入
  // ═══════════════════════════════════════

  const handleSelectFile = async () => {
    setBatchMode(false);
    setError(null);
    const res = await window.electronAPI.invoke('import:selectFile') as any;
    if (!res.success) {
      if (res.error !== 'User cancelled') setError(res.error);
      return;
    }

    const path = res.data as string;
    setFilePath(path);
    setStep('parsing');

    const parseRes = await window.electronAPI.invoke('import:parseFile', path) as any;
    if (!parseRes.success) {
      setError(parseRes.error || '解析失败');
      setStep('select');
      return;
    }

    const result = parseRes.data as ImportResult;
    setParseResult(result);
    setSelectedChapters(new Set(result.chapters.map(ch => ch.sortOrder)));
    setStep('preview');
  };

  // ═══════════════════════════════════════
  // 批量导入
  // ═══════════════════════════════════════

  const handleBatchSelectFiles = async () => {
    setBatchMode(true);
    setError(null);
    const res = await window.electronAPI.invoke('import:selectFiles') as any;
    if (!res.success) {
      if (res.error !== 'User cancelled') setError(res.error);
      return;
    }

    const files = res.data as string[];
    setBatchFiles(files);
    setBatchStep('parsing');

    // 逐个解析 — 解析阶段由前端调用 parseFile 来生成预览
    const preview: BatchItem[] = [];
    for (let i = 0; i < files.length; i++) {
      const fp = files[i];
      setBatchProgress({ current: i + 1, total: files.length });

      // 先查重
      const checkRes = await window.electronAPI.invoke('db:reference:findBySourceFile', fp) as any;
      if (checkRes.success && checkRes.data) {
        preview.push({
          file: fp,
          status: 'skipped',
          existingTitle: (checkRes.data as any).title || fp,
          title: (checkRes.data as any).title,
        });
        continue;
      }

      // 解析
      try {
        const parseRes = await window.electronAPI.invoke('import:parseFile', fp) as any;
        if (parseRes.success && parseRes.data) {
          const parsed = parseRes.data as ImportResult;
          preview.push({
            file: fp,
            status: 'imported',
            title: parsed.title,
            chunkCount: parsed.chapters.length,
          });
        } else {
          preview.push({
            file: fp,
            status: 'error',
            error: parseRes.error || '解析失败',
          });
        }
      } catch (err) {
        preview.push({
          file: fp,
          status: 'error',
          error: (err as Error).message,
        });
      }
    }

    setBatchPreview(preview);
    setBatchStep('preview');
  };

  const handleBatchImport = async () => {
    setBatchStep('importing');
    setBatchProgress({ current: 0, total: batchFiles.length });

    // 只传非 skipped 的文件路径 + 用户选的冲突模式
    const filesToImport = batchPreview
      .filter(p => p.status !== 'skipped' || batchConflictMode === 'overwrite')
      .map(p => p.file);

    // 也把 skipped 但用户选择覆盖的一起传
    const allFiles = batchFiles;
    const res = await window.electronAPI.invoke('import:batchToReference', allFiles, batchConflictMode) as any;

    if (res.success && res.data) {
      const result = res.data as BatchResult;
      setBatchProgress({ current: result.summary.total, total: result.summary.total });

      if (onBatchImportComplete) {
        onBatchImportComplete(result);
      }
      // 延迟关闭让用户看到完成状态
      setTimeout(() => handleClose(), 1000);
    } else {
      setError(res.error || '批量导入失败');
      setBatchStep('preview');
    }
  };

  // ═══════════════════════════════════════
  // 共用
  // ═══════════════════════════════════════

  const toggleChapter = (index: number) => {
    setSelectedChapters(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const toggleAll = () => {
    if (!parseResult) return;
    if (selectedChapters.size === parseResult.chapters.length) {
      setSelectedChapters(new Set());
    } else {
      setSelectedChapters(new Set(parseResult.chapters.map(ch => ch.sortOrder)));
    }
  };

  const handleImport = async () => {
    if (!parseResult) return;
    setImporting(true);

    if (importTarget === 'reference' && onImportToReference) {
      try {
        const refRes = await window.electronAPI.invoke('import:toReference', filePath) as any;
        if (refRes.success && refRes.data) {
          onImportToReference(refRes.data as ImportToRefResult);
        } else {
          setError(refRes.error || '导入参考库失败');
          setStep('select');
        }
      } catch (err) {
        setError((err as Error).message);
        setStep('select');
      }
    } else if (onImport) {
      const filtered: ImportResult = {
        ...parseResult,
        chapters: parseResult.chapters
          .filter(ch => selectedChapters.has(ch.sortOrder))
          .map((ch, i) => ({ ...ch, sortOrder: i })),
      };
      onImport(filtered);
      handleClose();
    }

    setImporting(false);
    if (importTarget === 'reference') {
      handleClose();
    }
  };

  const handleClose = () => {
    setStep('select');
    setFilePath(null);
    setParseResult(null);
    setError(null);
    setSelectedChapters(new Set());
    setImportTarget('reference');
    setBatchMode(false);
    setBatchFiles([]);
    setBatchPreview([]);
    setBatchConflictMode('skip');
    setBatchStep('idle');
    setBatchProgress({ current: 0, total: 0 });
    onClose();
  };

  const formatWordCount = (n: number) => {
    if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
    return n.toLocaleString();
  };

  // 批量预览统计
  const newCount = batchPreview.filter(p => p.status !== 'skipped').length;
  const skipCount = batchPreview.filter(p => p.status === 'skipped').length;
  const errCount = batchPreview.filter(p => p.status === 'error').length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-float-800 rounded-lg shadow-2xl w-[600px] max-h-[90vh] overflow-hidden border border-float-700 flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-float-700 flex items-center justify-between shrink-0">
          <h2 className="text-lg font-semibold text-white">
            {!batchMode && step === 'select' && '导入小说到参考库'}
            {!batchMode && step === 'parsing' && '解析中...'}
            {!batchMode && step === 'preview' && '预览导入'}
            {batchMode && batchStep === 'idle' && '导入小说到参考库'}
            {batchMode && batchStep === 'parsing' && `解析中… ${batchProgress.current}/${batchProgress.total}`}
            {batchMode && batchStep === 'preview' && `📂 批量导入 — ${batchFiles.length} 个文件`}
            {batchMode && batchStep === 'importing' && `导入中… ${batchProgress.current}/${batchProgress.total}`}
          </h2>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* ═══════ 初始选择页 ═══════ */}
          {((!batchMode && step === 'select') || (batchMode && batchStep === 'idle')) && (
            <div className="text-center py-8">
              <p className="text-4xl mb-4">📥</p>
              <p className="text-gray-300 mb-2">导入小说到参考知识库</p>
              <p className="text-sm text-gray-500 mb-2">
                支持 TXT · EPUB · Markdown 格式
                <br />自动识别章节分割
              </p>
              <p className="text-xs text-gray-600 mb-6 bg-float-900 rounded p-2 inline-block">
                📚 导入后将存入全局参考库<br />
                ✍️ 写作时自动匹配相似段落<br />
                🔍 支持手动搜索参考库
              </p>
              <div className="flex justify-center gap-3">
                <button
                  onClick={handleSelectFile}
                  className="px-6 py-3 bg-accent text-white rounded hover:bg-accent-hover transition-colors text-sm"
                >
                  选择单个文件...
                </button>
                <button
                  onClick={handleBatchSelectFiles}
                  className="px-6 py-3 bg-float-700 text-gray-300 rounded hover:bg-float-600 transition-colors text-sm border border-float-600"
                >
                  📂 批量选择...
                </button>
              </div>
              <p className="text-[10px] text-gray-600 mt-3">或 Ctrl+I 打开单文件导入</p>
              {error && (
                <p className="mt-4 text-sm text-red-400">{error}</p>
              )}
            </div>
          )}

          {/* ═══════ 单文件：解析中 ═══════ */}
          {!batchMode && step === 'parsing' && (
            <div className="text-center py-8">
              <div className="inline-block w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin mb-4" />
              <p className="text-gray-400 text-sm">正在解析文件...</p>
              {filePath && (
                <p className="text-gray-600 text-xs mt-1 truncate">
                  {filePath}
                </p>
              )}
            </div>
          )}

          {/* ═══════ 批量：解析中 ═══════ */}
          {batchMode && batchStep === 'parsing' && (
            <div className="text-center py-8">
              <div className="inline-block w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin mb-4" />
              <p className="text-gray-400 text-sm">
                正在解析 {batchProgress.current}/{batchProgress.total} 个文件...
              </p>
            </div>
          )}

          {/* ═══════ 单文件：预览 ═══════ */}
          {!batchMode && step === 'preview' && parseResult && (
            <div className="space-y-4">
              <div className="bg-float-900 rounded p-4 space-y-1">
                <h3 className="text-white font-semibold">{parseResult.title}</h3>
                {parseResult.author && (
                  <p className="text-gray-400 text-sm">作者：{parseResult.author}</p>
                )}
                <div className="flex items-center gap-4 text-xs text-gray-500">
                  <span>格式：{parseResult.format.toUpperCase()}</span>
                  <span>总字数：{formatWordCount(parseResult.totalWords)}</span>
                  <span>检测到 {parseResult.chapters.length} 个章节</span>
                </div>
              </div>

              <div className="bg-float-900 rounded p-3">
                <p className="text-xs text-gray-400 mb-2">导入目标：</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setImportTarget('reference')}
                    className={`flex-1 px-3 py-2 rounded text-xs transition-colors ${
                      importTarget === 'reference'
                        ? 'bg-accent/20 border border-accent text-accent'
                        : 'bg-float-800 border border-float-700 text-gray-400 hover:text-white'
                    }`}
                  >
                    📚 参考知识库（推荐）
                  </button>
                  <button
                    onClick={() => setImportTarget('chapters')}
                    className={`flex-1 px-3 py-2 rounded text-xs transition-colors ${
                      importTarget === 'chapters'
                        ? 'bg-accent/20 border border-accent text-accent'
                        : 'bg-float-800 border border-float-700 text-gray-400 hover:text-white'
                    }`}
                  >
                    📑 当前项目章节
                  </button>
                </div>
              </div>

              {parseResult.warnings.length > 0 && (
                <div className="bg-yellow-900/30 border border-yellow-700/50 rounded p-3">
                  {parseResult.warnings.map((w, i) => (
                    <p key={i} className="text-yellow-400 text-xs">⚠ {w}</p>
                  ))}
                </div>
              )}

              {importTarget === 'chapters' && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-gray-300">
                      选择章节 ({selectedChapters.size}/{parseResult.chapters.length})
                    </span>
                    <button
                      onClick={toggleAll}
                      className="text-xs text-gray-400 hover:text-white transition-colors"
                    >
                      {selectedChapters.size === parseResult.chapters.length ? '取消全选' : '全选'}
                    </button>
                  </div>

                  <div className="max-h-[300px] overflow-y-auto space-y-1 border border-float-700 rounded bg-float-900 p-2">
                    {parseResult.chapters.map((ch) => (
                      <label
                        key={ch.sortOrder}
                        className={`
                          flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-xs transition-colors
                          ${selectedChapters.has(ch.sortOrder)
                            ? 'bg-accent/20 text-white'
                            : 'text-gray-500 hover:bg-float-800'
                          }
                        `}
                      >
                        <input
                          type="checkbox"
                          checked={selectedChapters.has(ch.sortOrder)}
                          onChange={() => toggleChapter(ch.sortOrder)}
                          className="accent-accent"
                        />
                        <span className="w-6 text-gray-500 text-right">{ch.sortOrder + 1}</span>
                        <span className="flex-1 truncate">{ch.title}</span>
                        <span className="text-gray-600">
                          {formatWordCount(
                            ch.content.replace(/<[^>]*>/g, '').replace(/\s+/g, '').length
                          )}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ═══════ 批量：预览 ═══════ */}
          {batchMode && batchStep === 'preview' && (
            <div className="space-y-4">
              {/* 新文件列表 */}
              {newCount > 0 && (
                <div>
                  <div className="text-xs text-green-400 font-semibold mb-2">
                    ✅ 新文件 ({newCount})
                  </div>
                  <div className="space-y-1 max-h-[200px] overflow-y-auto">
                    {batchPreview.filter(p => p.status !== 'skipped' && p.status !== 'error').map((p, i) => (
                      <div key={i} className="flex items-center gap-3 px-3 py-2 bg-float-900 rounded text-xs">
                        <span className="text-green-400">+</span>
                        <span className="text-gray-300 flex-1 truncate">{p.title || p.file}</span>
                        {p.chunkCount && <span className="text-gray-600">{p.chunkCount} 章</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 错误文件 */}
              {errCount > 0 && (
                <div>
                  <div className="text-xs text-red-400 font-semibold mb-2">
                    ❌ 解析失败 ({errCount})
                  </div>
                  <div className="space-y-1 max-h-[150px] overflow-y-auto">
                    {batchPreview.filter(p => p.status === 'error').map((p, i) => (
                      <div key={i} className="flex items-center gap-2 px-3 py-1.5 bg-red-900/20 rounded text-xs">
                        <span className="text-red-400">✕</span>
                        <span className="text-gray-400 truncate flex-1">{p.file}</span>
                        <span className="text-red-300">{p.error}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 已存在文件 */}
              {skipCount > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-xs text-yellow-400 font-semibold">
                      ⚠️ 已存在 ({skipCount})
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => setBatchConflictMode('skip')}
                        className={`px-2 py-0.5 rounded text-[10px] transition-colors ${
                          batchConflictMode === 'skip'
                            ? 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30'
                            : 'bg-float-800 text-gray-500 border border-float-700'
                        }`}
                      >
                        跳过重复
                      </button>
                      <button
                        onClick={() => setBatchConflictMode('overwrite')}
                        className={`px-2 py-0.5 rounded text-[10px] transition-colors ${
                          batchConflictMode === 'overwrite'
                            ? 'bg-orange-500/20 text-orange-300 border border-orange-500/30'
                            : 'bg-float-800 text-gray-500 border border-float-700'
                        }`}
                      >
                        覆盖重复
                      </button>
                    </div>
                  </div>
                  <div className="space-y-1 max-h-[150px] overflow-y-auto">
                    {batchPreview.filter(p => p.status === 'skipped').map((p, i) => (
                      <div key={i} className="flex items-center gap-3 px-3 py-2 bg-float-900 rounded text-xs">
                        <span className="text-yellow-400">
                          {batchConflictMode === 'skip' ? '⏭' : '🔄'}
                        </span>
                        <span className="text-gray-400 flex-1 truncate">{p.existingTitle || p.title || p.file}</span>
                        <span className="text-gray-600">已在库中</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 统计摘要 */}
              <div className="bg-float-900 rounded p-3 text-xs text-gray-500">
                {batchConflictMode === 'skip'
                  ? `将导入 ${newCount} 个新文件，${skipCount > 0 ? `跳过 ${skipCount} 个重复文件` : ''}`
                  : `将导入 ${newCount + skipCount} 个文件（含 ${skipCount} 个覆盖）`
                }
              </div>
            </div>
          )}

          {/* ═══════ 批量：导入中 ═══════ */}
          {batchMode && batchStep === 'importing' && (
            <div className="text-center py-8">
              <div className="inline-block w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin mb-4" />
              <p className="text-green-400 text-sm">
                正在导入参考库...
              </p>
            </div>
          )}
        </div>

        {/* Footer actions */}
        {((!batchMode && step === 'preview') || (batchMode && batchStep === 'preview')) && (
          <div className="px-6 py-4 border-t border-float-700 flex justify-end gap-3 shrink-0">
            <button
              onClick={handleClose}
              className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
            >
              取消
            </button>
            {batchMode ? (
              <button
                onClick={handleBatchImport}
                disabled={newCount === 0 && (batchConflictMode === 'skip' || skipCount === 0)}
                className="px-6 py-2 text-sm bg-accent text-white rounded hover:bg-accent-hover
                           disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                确认导入 ({batchConflictMode === 'skip' ? newCount : newCount + skipCount} 个文件)
              </button>
            ) : (
              <button
                onClick={handleImport}
                disabled={importTarget === 'chapters' && selectedChapters.size === 0 || importing}
                className="px-6 py-2 text-sm bg-accent text-white rounded hover:bg-accent-hover
                           disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {importing
                  ? '导入中...'
                  : importTarget === 'reference'
                    ? '导入到参考库'
                    : `导入 ${selectedChapters.size} 个章节`
                }
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ImportDialog;
export type { ImportToRefResult, BatchItem, BatchResult };
