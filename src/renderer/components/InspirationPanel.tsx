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
  { name: 'public_domain', label: '📚 公版', dbLabel: '公版文学', description: '四大名著、唐诗宋词5.5万首、古文观止、世界经典小说' },
  { name: 'history_military', label: '📜 历史', dbLabel: '历史军事', description: '史记、战国策、孙子兵法、希腊神话、十字军、拿破仑' },
  { name: 'myth_fantasy', label: '🦊 志怪', dbLabel: '神话志怪', description: '聊斋志异、山海经、克苏鲁、哥特文学、吸血鬼传说' },
  { name: 'dictionary', label: '📖 词典', dbLabel: '词典修辞', description: '成语词典(5万条)、近义词反义词、修辞手法大全' },
  { name: 'user', label: '👤 用户', dbLabel: '用户导入', description: '你收集的素材、灵感碎片和在线小说' },
];

// Knowledge base that the AI already knows (for reference)
const AI_KNOWLEDGE = [
  '🏛️ 史记、资治通鉴精选',
  '⚔️ 孙子兵法、三十六计',
  '📜 唐诗宋词约5.5万首',
  '📚 四大名著原文',
  '🦊 聊斋志异、山海经',
  '🇬🇷 希腊神话、北欧神话',
  '🐙 克苏鲁神话体系',
  '📖 成语词典(5万条)',
  '🎭 修辞手法大全',
  '🏰 亚瑟王传奇、中世纪战争',
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
  const [showHowToUse, setShowHowToUse] = useState(true);

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
      setResults([]);
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
          <h3 className="text-xs font-semibold text-gray-300 uppercase tracking-wide">灵感与知识库</h3>
          <p className="text-[10px] text-gray-600 mt-0.5">文学、历史、神话、成语词典</p>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors text-sm" title="关闭 (Esc)">✕</button>
      </div>

      {/* How to use section */}
      {showHowToUse && (
        <div className="p-3 border-b border-gray-700">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] text-gray-500 uppercase">💡 文学数据库怎么用？</p>
            <button onClick={() => setShowHowToUse(false)} className="text-gray-600 hover:text-white text-[10px]">收起</button>
          </div>
          <div className="space-y-2 text-[10px] text-gray-400 leading-relaxed">
            <p>
              <span className="text-accent font-medium">方式一：直接问 AI</span><br />
              在 💬 AI 对话中提问，比如：<br />
              <span className="text-gray-500">&quot;破釜沉舟出自哪里？&quot; → AI 会引用《史记·项羽本纪》原文</span><br />
              <span className="text-gray-500">&quot;给我讲讲北欧神话的世界树&quot; → AI 会讲述 Yggdrasil 的完整故事</span>
            </p>
            <p className="mt-2">
              <span className="text-accent font-medium">方式二：在这里搜索</span><br />
              输入关键词搜索本地数据库（需要先下载数据包 ~500MB）<br />
              <span className="text-gray-500">&quot;形容女子美貌的成语&quot; → 找到词典中的相关条目</span>
            </p>
            <p className="mt-2">
              <span className="text-accent font-medium">方式三：选中文字搜</span><br />
              编辑器中选中文字 → 右键或 Ctrl+Shift+I → 自动搜索
            </p>
          </div>
        </div>
      )}

      {/* What AI knows */}
      {!showHowToUse && (
        <div className="p-3 border-b border-gray-700">
          <p className="text-[10px] text-gray-500 mb-2 uppercase">🧠 AI 已掌握的知识（无需下载）</p>
          <div className="flex flex-wrap gap-1">
            {AI_KNOWLEDGE.map(item => (
              <span key={item} className="px-1.5 py-0.5 bg-gray-800 border border-gray-700 rounded text-[9px] text-gray-400">{item}</span>
            ))}
          </div>
        </div>
      )}

      {/* 5 layers */}
      <div className="p-3 border-b border-gray-800">
        <p className="text-[10px] text-gray-500 mb-2 uppercase">📦 本地数据库 (需下载)</p>
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
      </div>

      {/* Search bar */}
      <div className="px-3 py-2 border-b border-gray-700">
        <div className="flex gap-1">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="搜索数据库..."
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
              className={`px-1.5 py-0.5 rounded text-[10px] transition-colors
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
            <p className="mt-1 text-gray-700">试试问 AI？AI 掌握大量文学知识</p>
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
                    {result.source && <div className="text-[9px] text-gray-700 mt-0.5">{result.source}</div>}
                    {isActive && (
                      <div className="mt-2 flex items-center gap-2">
                        <button
                          onClick={(e) => { e.stopPropagation(); onSendToChat?.(result); }}
                          className="text-[10px] px-2 py-0.5 bg-accent/20 text-accent rounded hover:bg-accent/30 transition-colors"
                        >💬 发到对话</button>
                        <button
                          onClick={(e) => { e.stopPropagation(); onSaveAsMaterial?.(result); }}
                          className="text-[10px] px-2 py-0.5 bg-gray-700 text-gray-400 rounded hover:bg-gray-600 transition-colors"
                        >📌 收藏</button>
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

export default InspirationPanel;
