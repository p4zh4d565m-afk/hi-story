import React, { useState } from 'react';
import type { ImportedChapter, ImportResult } from '../../main/importer';

interface ImportDialogProps {
  open: boolean;
  onClose: () => void;
  onImport: (result: ImportResult) => void;
}

const ImportDialog: React.FC<ImportDialogProps> = ({ open, onClose, onImport }) => {
  const [step, setStep] = useState<'select' | 'parsing' | 'preview'>('select');
  const [filePath, setFilePath] = useState<string | null>(null);
  const [parseResult, setParseResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedChapters, setSelectedChapters] = useState<Set<number>>(new Set());
  const [importing, setImporting] = useState(false);

  if (!open) return null;

  const handleSelectFile = async () => {
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

    const filtered: ImportResult = {
      ...parseResult,
      chapters: parseResult.chapters
        .filter(ch => selectedChapters.has(ch.sortOrder))
        .map((ch, i) => ({ ...ch, sortOrder: i })),
    };

    onImport(filtered);
    setImporting(false);
    handleClose();
  };

  const handleClose = () => {
    setStep('select');
    setFilePath(null);
    setParseResult(null);
    setError(null);
    setSelectedChapters(new Set());
    onClose();
  };

  const formatWordCount = (n: number) => {
    if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
    return n.toLocaleString();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-gray-800 rounded-lg shadow-2xl w-[560px] max-h-[90vh] overflow-hidden border border-gray-700 flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-700 flex items-center justify-between shrink-0">
          <h2 className="text-lg font-semibold text-white">
            {step === 'select' && '导入小说'}
            {step === 'parsing' && '解析中...'}
            {step === 'preview' && '预览导入'}
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
          {/* Step: Select file */}
          {step === 'select' && (
            <div className="text-center py-8">
              <p className="text-4xl mb-4">📥</p>
              <p className="text-gray-300 mb-2">导入小说文件</p>
              <p className="text-sm text-gray-500 mb-6">
                支持 TXT · EPUB · Markdown 格式
                <br />自动识别章节分割
              </p>
              <button
                onClick={handleSelectFile}
                className="px-6 py-3 bg-accent text-white rounded hover:bg-accent-hover transition-colors text-sm"
              >
                选择文件...
              </button>
              <p className="text-[10px] text-gray-600 mt-3">或 Ctrl+I</p>
              {error && (
                <p className="mt-4 text-sm text-red-400">{error}</p>
              )}
            </div>
          )}

          {/* Step: Parsing */}
          {step === 'parsing' && (
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

          {/* Step: Preview */}
          {step === 'preview' && parseResult && (
            <div className="space-y-4">
              {/* Book info */}
              <div className="bg-gray-900 rounded p-4 space-y-1">
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

              {/* Warnings */}
              {parseResult.warnings.length > 0 && (
                <div className="bg-yellow-900/30 border border-yellow-700/50 rounded p-3">
                  {parseResult.warnings.map((w, i) => (
                    <p key={i} className="text-yellow-400 text-xs">⚠ {w}</p>
                  ))}
                </div>
              )}

              {/* Chapter selection */}
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

                <div className="max-h-[300px] overflow-y-auto space-y-1 border border-gray-700 rounded bg-gray-900 p-2">
                  {parseResult.chapters.map((ch) => (
                    <label
                      key={ch.sortOrder}
                      className={`
                        flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-xs transition-colors
                        ${selectedChapters.has(ch.sortOrder)
                          ? 'bg-accent/20 text-white'
                          : 'text-gray-500 hover:bg-gray-800'
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
            </div>
          )}
        </div>

        {/* Footer actions */}
        {step === 'preview' && (
          <div className="px-6 py-4 border-t border-gray-700 flex justify-end gap-3 shrink-0">
            <button
              onClick={handleClose}
              className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleImport}
              disabled={selectedChapters.size === 0 || importing}
              className="px-6 py-2 text-sm bg-accent text-white rounded hover:bg-accent-hover
                         disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {importing
                ? '导入中...'
                : `导入 ${selectedChapters.size} 个章节`
              }
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ImportDialog;
