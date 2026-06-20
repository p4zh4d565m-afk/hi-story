import React, { useState, useCallback } from 'react';
import type { SearchResult } from '../types/search';

interface InspirationPanelProps {
  open: boolean;
  onClose: () => void;
  /** Called when user wants to send a result to the AI chat */
  onSendToChat?: (result: SearchResult) => void;
  /** Called when user wants to save a result as material */
  onSaveAsMaterial?: (result: SearchResult) => void;
}

const InspirationPanel: React.FC<InspirationPanelProps> = ({
  open,
  onClose,
  onSendToChat,
  onSaveAsMaterial,
}) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [activeResultId, setActiveResultId] = useState<string | null>(null);
  const [activeLayers, setActiveLayers] = useState<Set<string>>(new Set(['public_domain', 'history_military', 'myth_fantasy', 'dictionary']));

  const handleSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) return;

    setIsSearching(true);
    try {
      // Search via IPC — the main process will use SearchEngine
      const result = await window.electronAPI.invoke('search:query', {
        query: q,
        layers: Array.from(activeLayers),
        maxResultsPerLayer: 10,
      }) as any;

      if (result.success && result.data) {
        setResults(result.data);
      } else {
        setResults([]);
      }
    } catch (err) {
      console.error('Search failed:', err);
    } finally {
      setIsSearching(false);
    }
  }, [query, activeLayers]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  };

  const toggleLayer = (layerName: string) => {
    setActiveLayers(prev => {
      const next = new Set(prev);
      if (next.has(layerName)) next.delete(layerName);
      else next.add(layerName);
      return next;
    });
  };

  if (!open) return null;

  // Group results by layer
  const resultsByLayer = new Map<string, SearchResult[]>();
  for (const r of results) {
    if (!resultsByLayer.has(r.layer)) resultsByLayer.set(r.layer, []);
    resultsByLayer.get(r.layer)!.push(r);
  }

  return (
    <div className="h-full flex flex-col bg-gray-900 border-l border-gray-700">
      {/* Header */}
      <div className="px-3 py-2 border-b border-gray-700 flex items-center justify-between">
        <h3 className="text-xs font-semibold text-gray-300 uppercase tracking-wide">灵感搜索</h3>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-white transition-colors text-sm"
          title="关闭 (Esc)"
        >
          ✕
        </button>
      </div>

      {/* Search bar */}
      <div className="px-3 py-2 border-b border-gray-700">
        <div className="flex gap-1">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="搜索灵感..."
            className="flex-1 px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-xs
                       focus:outline-none focus:border-accent placeholder-gray-600"
            autoFocus
          />
          <button
            onClick={handleSearch}
            disabled={isSearching || !query.trim()}
            className="px-3 py-1.5 bg-accent text-white text-xs rounded hover:bg-purple-600
                       disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isSearching ? '...' : '搜索'}
          </button>
        </div>

        {/* Layer toggles */}
        <div className="flex flex-wrap gap-1 mt-2">
          {[
            { name: 'public_domain', label: '📚 公版', dbLabel: '公版文学' },
            { name: 'history_military', label: '📜 历史', dbLabel: '历史军事' },
            { name: 'myth_fantasy', label: '🦊 志怪', dbLabel: '神话志怪' },
            { name: 'dictionary', label: '📖 词典', dbLabel: '词典修辞' },
            { name: 'user', label: '👤 用户', dbLabel: '用户导入' },
          ].map(({ name, label }) => (
            <button
              key={name}
              onClick={() => toggleLayer(name)}
              className={`
                px-1.5 py-0.5 rounded text-[10px] transition-colors
                ${activeLayers.has(name)
                  ? 'bg-accent/30 text-accent border border-accent/50'
                  : 'bg-gray-800 text-gray-500 border border-gray-700 hover:text-gray-300'
                }
              `}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {isSearching && (
          <div className="flex items-center justify-center py-8">
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        )}

        {!isSearching && query && results.length === 0 && (
          <div className="px-4 py-8 text-center text-gray-600 text-xs">
            <p className="text-lg mb-1">🔍</p>
            <p>没有找到相关结果</p>
            <p className="mt-1 text-gray-700">尝试其他关键词或扩大搜索范围</p>
          </div>
        )}

        {!isSearching && !query && (
          <div className="px-4 py-8 text-center text-gray-600 text-xs">
            <p className="text-2xl mb-2">💡</p>
            <p>输入关键词搜索灵感</p>
            <p className="mt-1 text-gray-700">跨 5 层文学数据库全文搜索</p>
          </div>
        )}

        {/* Grouped results */}
        {Array.from(resultsByLayer.entries()).map(([layerName, layerResults]) => (
          <div key={layerName} className="border-b border-gray-800">
            <div className="px-3 py-1.5 bg-gray-800/50 text-[10px] text-gray-500 uppercase tracking-wide sticky top-0">
              {layerResults[0]?.layerIcon} {layerResults[0]?.layerDisplay || layerName}
              <span className="ml-1 text-gray-700">({layerResults.length})</span>
            </div>
            {layerResults.map((result, idx) => {
              const resultId = `${layerName}-${idx}`;
              const isActive = resultId === activeResultId;
              return (
                <div
                  key={resultId}
                  className={`
                    px-3 py-2 cursor-pointer transition-colors
                    ${isActive ? 'bg-sidebar-active' : 'hover:bg-gray-800/70'}
                  `}
                  onClick={() => setActiveResultId(isActive ? null : resultId)}
                >
                  <div className="text-xs text-gray-300 font-medium truncate">
                    {result.title}
                  </div>
                  <div className="text-[11px] text-gray-500 mt-0.5 line-clamp-2">
                    {result.snippet}
                  </div>
                  {isActive && (
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onSendToChat?.(result);
                        }}
                        className="text-[10px] px-2 py-0.5 bg-accent/20 text-accent rounded hover:bg-accent/30 transition-colors"
                      >
                        💬 发到对话
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onSaveAsMaterial?.(result);
                        }}
                        className="text-[10px] px-2 py-0.5 bg-gray-700 text-gray-400 rounded hover:bg-gray-600 transition-colors"
                      >
                        📌 收藏
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
};

export default InspirationPanel;
