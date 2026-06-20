import React, { useState, useCallback } from 'react';
import type { SearchResult } from '../types/search';

interface InspirationPanelProps {
  open: boolean;
  onClose: () => void;
  onSendToChat?: (result: SearchResult) => void;
  onSaveAsMaterial?: (result: SearchResult) => void;
}

// Layer definitions
const LAYERS = [
  { name: 'public_domain', label: '📚 公版', dbLabel: '公版文学', description: '四大名著、唐诗宋词、古文观止、世界经典' },
  { name: 'history_military', label: '📜 历史', dbLabel: '历史军事', description: '史记、战国策、孙子兵法、希腊神话、十字军' },
  { name: 'myth_fantasy', label: '🦊 志怪', dbLabel: '神话志怪', description: '聊斋志异、山海经、克苏鲁、哥特、吸血鬼' },
  { name: 'dictionary', label: '📖 词典', dbLabel: '词典修辞', description: '成语(5万条)、古汉语字典、修辞手法大全' },
  { name: 'user', label: '👤 用户', dbLabel: '用户导入', description: '你收集的素材和灵感' },
];

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
  const [activeLayers, setActiveLayers] = useState<Set<string>>(
    new Set(LAYERS.map(l => l.name))
  );

  const handleSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) return;

    setIsSearching(true);
    try {
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
      // Show example data when backend is not available
      setResults(getPlaceholderResults(q));
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
      if (next.has(layerName)) next.delete(layerName); else next.add(layerName);
      return next;
    });
  };

  // Results grouped by layer
  const resultsByLayer = new Map<string, SearchResult[]>();
  for (const r of results) {
    if (!resultsByLayer.has(r.layer)) resultsByLayer.set(r.layer, []);
    resultsByLayer.get(r.layer)!.push(r);
  }

  if (!open) return null;

  return (
    <div className="h-full flex flex-col bg-gray-900 border-l border-gray-700">
      {/* Header */}
      <div className="px-3 py-2 border-b border-gray-700 flex items-center justify-between">
        <div>
          <h3 className="text-xs font-semibold text-gray-300 uppercase tracking-wide">灵感搜索</h3>
          <p className="text-[10px] text-gray-600 mt-0.5">跨 5 层文学数据库全文搜索</p>
        </div>
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
            placeholder="搜索成语、典故、名著片段..."
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
          {LAYERS.map(({ name, label, description }) => (
            <button
              key={name}
              onClick={() => toggleLayer(name)}
              className={`px-1.5 py-0.5 rounded text-[10px] transition-colors group relative
                ${activeLayers.has(name)
                  ? 'bg-accent/30 text-accent border border-accent/50'
                  : 'bg-gray-800 text-gray-500 border border-gray-700 hover:text-gray-300'
                }`}
              title={description}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Layer info - show when no search performed */}
      {!query && results.length === 0 && (
        <div className="p-3 border-b border-gray-800">
          <p className="text-[10px] text-gray-500 mb-2 uppercase">数据库覆盖</p>
          <div className="space-y-1.5">
            {LAYERS.map(layer => (
              <div key={layer.name} className="flex items-start gap-1.5">
                <span className="text-sm mt-0.5">{layer.label.slice(0, 2)}</span>
                <div>
                  <span className="text-[10px] text-gray-400 font-medium">{layer.dbLabel}</span>
                  <p className="text-[9px] text-gray-600 leading-tight">{layer.description}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 p-2 bg-accent/10 border border-accent/20 rounded">
            <p className="text-[9px] text-accent">💡 数据文件较大 (~500MB)，需要单独下载。<br />
              前往 <a href="https://github.com/hi-story/data" className="underline" target="_blank" rel="noreferrer">github.com/hi-story/data</a> 下载数据包，<br />
              解压到 <code className="text-[8px] bg-gray-800 px-1 rounded">%APPDATA%/hi-story/data/</code> 后即可搜索。</p>
          </div>
        </div>
      )}

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
            <p className="mt-1 text-gray-700">数据库可能还没有导入 → 下载数据包</p>
          </div>
        )}

        {!isSearching && !query && results.length > 0 && (
          <div className="px-4 py-8 text-center text-gray-600 text-xs">
            <p className="text-2xl mb-2">💡</p>
            <p>输入关键词搜索灵感</p>
            <p className="mt-1 text-gray-700">跨 5 层文学数据库全文搜索</p>
          </div>
        )}

        {/* Grouped results */}
        {Array.from(resultsByLayer.entries()).map(([layerName, layerResults]) => {
          const layerInfo = LAYERS.find(l => l.name === layerName);
          return (
            <div key={layerName} className="border-b border-gray-800">
              <div className="px-3 py-1.5 bg-gray-800/50 text-[10px] text-gray-500 sticky top-0 flex items-center gap-1">
                <span>{layerInfo?.label || layerName}</span>
                <span className="text-gray-700">({layerResults.length})</span>
              </div>
              {layerResults.map((result, idx) => {
                const resultId = `${layerName}-${idx}`;
                const isActive = resultId === activeResultId;
                return (
                  <div
                    key={resultId}
                    className={`px-3 py-2 cursor-pointer transition-colors ${isActive ? 'bg-sidebar-active' : 'hover:bg-gray-800/70'}`}
                    onClick={() => setActiveResultId(isActive ? null : resultId)}
                  >
                    <div className="text-xs text-gray-300 font-medium truncate">{result.title}</div>
                    <div className="text-[11px] text-gray-500 mt-0.5 line-clamp-2">{result.snippet}</div>
                    {result.source && (
                      <div className="text-[9px] text-gray-700 mt-0.5">{result.source}</div>
                    )}
                    {isActive && (
                      <div className="mt-2 flex items-center gap-2">
                        <button
                          onClick={(e) => { e.stopPropagation(); onSendToChat?.(result); }}
                          className="text-[10px] px-2 py-0.5 bg-accent/20 text-accent rounded hover:bg-accent/30 transition-colors"
                        >
                          💬 发到对话
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); onSaveAsMaterial?.(result); }}
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
          );
        })}
      </div>
    </div>
  );
};

/** Placeholder results when no data is loaded — shows what the search CAN do */
function getPlaceholderResults(query: string): SearchResult[] {
  return [
    {
      layer: 'dictionary',
      layerDisplay: '词典修辞', layerIcon: '📖',
      title: '「' + query + '」相关成语',
      content: '',
      snippet: '数据库尚未导入。下载数据包后即可搜索 5 万条成语、近义词、古汉语释义。',
      score: 0.5,
      source: '成语词典'
    },
    {
      layer: 'public_domain',
      layerDisplay: '公版文学', layerIcon: '📚',
      title: '在四大名著中搜索「' + query + '」',
      content: '',
      snippet: '包含红楼梦、三国演义、水浒传、西游记全文。唐诗宋词约5.5万首。',
      score: 0.4,
      source: '公版文学库'
    },
  ];
}

export default InspirationPanel;
