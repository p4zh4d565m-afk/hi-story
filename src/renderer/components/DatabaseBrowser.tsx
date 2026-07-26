/**
 * 数据库浏览器
 * - 在 Electron 原生菜单"数据库"中打开
 * - 按书名列出所有参考文档
 * - 区分"用户导入"和"系统开放"两种来源
 * - 点击书名查看具体内容条目
 */

import React, { useState, useEffect, useCallback } from 'react';
import type { DatabaseBook, DatabaseBookDetail } from '../../main/ipc/database.ipc';

interface DatabaseBrowserProps {
  open: boolean;
  onClose: () => void;
}

// 分类层的中文名和图标映射
const LAYER_META: Record<string, { icon: string; label: string }> = {
  public_domain: { icon: '📚', label: '公版文学' },
  history_military: { icon: '📜', label: '历史军事' },
  myth_fantasy: { icon: '🦊', label: '神话志怪' },
  dictionary: { icon: '📖', label: '词典修辞' },
  user: { icon: '👤', label: '用户素材' },
};

const DatabaseBrowser: React.FC<DatabaseBrowserProps> = ({ open, onClose }) => {
  const [books, setBooks] = useState<DatabaseBook[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterSource, setFilterSource] = useState<'all' | 'user_imported' | 'open_library'>('all');
  const [selectedBook, setSelectedBook] = useState<DatabaseBook | null>(null);
  const [bookDetail, setBookDetail] = useState<DatabaseBookDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // 加载书籍列表
  const loadBooks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await window.electronAPI.invoke('db:browser:listAll') as any;
      if (res.success && res.data) {
        setBooks(res.data);
      }
    } catch (err) {
      console.error('加载数据库列表失败:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      loadBooks();
      setSelectedBook(null);
      setBookDetail(null);
    }
  }, [open, loadBooks]);

  // 点击书名查看详情
  const handleSelectBook = useCallback(async (book: DatabaseBook) => {
    setSelectedBook(book);
    setDetailLoading(true);
    setDetailError(null);
    try {
      const res = await window.electronAPI.invoke('db:browser:getDetail', book.id) as any;
      if (res.success && res.data) {
        setBookDetail(res.data);
      } else {
        setDetailError(res.error || '加载详情失败');
      }
    } catch (err) {
      setDetailError((err as Error).message);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  // 删除用户导入的书籍
  const handleDelete = useCallback(async (bookId: string) => {
    if (!confirm('确定要删除这本参考书吗？此操作不可撤销。')) return;
    try {
      const res = await window.electronAPI.invoke('db:browser:delete', bookId) as any;
      if (res.success) {
        setBooks(prev => prev.filter(b => b.id !== bookId));
        if (selectedBook?.id === bookId) {
          setSelectedBook(null);
          setBookDetail(null);
        }
      } else {
        alert(res.error || '删除失败');
      }
    } catch (err) {
      alert((err as Error).message);
    }
  }, [selectedBook]);

  if (!open) return null;

  // 筛选和搜索
  const filteredBooks = books.filter(b => {
    if (filterSource !== 'all' && b.source !== filterSource) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      return b.title.toLowerCase().includes(q)
        || (b.author?.toLowerCase().includes(q));
    }
    return true;
  });

  // 按来源分组
  const userBooks = filteredBooks.filter(b => b.source === 'user_imported');
  const openBooks = filteredBooks.filter(b => b.source === 'open_library');

  // 格式化数字
  const fmtNum = (n: number) => {
    if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
    return n.toLocaleString();
  };

  // 格式化字节大小
  const fmtChars = (n: number) => {
    if (n >= 10000) return `${(n / 10000).toFixed(1)}万字`;
    return `${n}字`;
  };

  // 截断文本
  const truncate = (text: string, max: number) => {
    if (text.length <= max) return text;
    return text.slice(0, max) + '…';
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-gray-900 rounded-lg shadow-2xl w-[800px] max-h-[85vh] overflow-hidden border border-gray-700 flex flex-col">
        {/* Header */}
        <div className="px-5 py-3 border-b border-gray-700 flex items-center justify-between shrink-0 bg-gray-800/50">
          <div>
            <h2 className="text-base font-semibold text-white">🗄️ 参考数据库</h2>
            <p className="text-[10px] text-gray-500 mt-0.5">
              共 {books.length} 本书 ·
              {books.filter(b => b.source === 'user_imported').length} 本用户导入 ·
              {books.filter(b => b.source === 'open_library').length} 本系统开放
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors text-lg leading-none px-1"
            title="关闭 (Esc)"
          >
            ✕
          </button>
        </div>

        {/* Filter bar */}
        <div className="px-4 py-2 border-b border-gray-700/50 flex items-center gap-3 bg-gray-800/30">
          <div className="flex gap-1">
            {([
              { key: 'all', label: '全部' },
              { key: 'user_imported', label: '👤 用户导入' },
              { key: 'open_library', label: '📚 系统开放' },
            ] as const).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setFilterSource(key)}
                className={`px-2.5 py-1 rounded text-[11px] transition-colors ${
                  filterSource === key
                    ? 'bg-accent/20 text-accent border border-accent/30'
                    : 'text-gray-400 hover:text-white hover:bg-gray-800'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex-1" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="🔍 搜索书名或作者..."
            className="px-2.5 py-1 bg-gray-800 border border-gray-700 rounded text-white text-[11px]
                       focus:outline-none focus:border-accent placeholder-gray-600 w-48"
          />
          <button
            onClick={loadBooks}
            disabled={loading}
            className="text-gray-400 hover:text-white text-[11px] disabled:opacity-50"
            title="刷新"
          >
            {loading ? '⏳' : '🔄'}
          </button>
        </div>

        {/* Body: two-column layout */}
        <div className="flex-1 flex overflow-hidden min-h-0">
          {/* Left: book list */}
          <div className="w-[360px] flex-shrink-0 border-r border-gray-700/50 overflow-y-auto">
            {loading && books.length === 0 && (
              <div className="flex items-center justify-center py-16 text-gray-500 text-xs">
                <div className="text-center">
                  <div className="inline-block w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin mb-2" />
                  <p>加载中...</p>
                </div>
              </div>
            )}

            {!loading && filteredBooks.length === 0 && (
              <div className="py-16 text-center text-gray-500 text-xs">
                <p className="text-lg mb-2">📭</p>
                <p>暂无书籍</p>
              </div>
            )}

            {/* 用户导入的书籍 */}
            {userBooks.length > 0 && (
              <div>
                <div className="px-3 py-2 text-[10px] text-gray-500 font-semibold uppercase sticky top-0 bg-gray-900/95 backdrop-blur z-10">
                  👤 用户导入 ({userBooks.length})
                </div>
                {userBooks.map(book => (
                  <div
                    key={book.id}
                    className={`px-3 py-2.5 border-b border-gray-700/30 cursor-pointer hover:bg-gray-800/50 transition-colors ${
                      selectedBook?.id === book.id ? 'bg-accent/10 border-l-2 border-l-accent' : ''
                    }`}
                    onClick={() => handleSelectBook(book)}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-200 font-medium truncate flex-1">
                        📖 {book.title}
                      </span>
                      <span className="text-[9px] text-gray-600 flex-shrink-0">
                        {book.format?.toUpperCase()}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-[10px] text-gray-500">
                      {book.author && <span>✍ {book.author}</span>}
                      <span>{fmtNum(book.totalWords)} 字</span>
                      <span>· {book.totalEntries} 块</span>
                    </div>
                    {book.createdAt && (
                      <p className="text-[9px] text-gray-600 mt-0.5">
                        导入: {new Date(book.createdAt).toLocaleDateString('zh-CN')}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* 系统开放的书籍 */}
            {openBooks.length > 0 && (
              <div>
                <div className="px-3 py-2 text-[10px] text-gray-500 font-semibold uppercase sticky top-0 bg-gray-900/95 backdrop-blur z-10">
                  📚 系统开放 ({openBooks.length})
                </div>
                {openBooks.map(book => {
                  const layerMeta = LAYER_META[book.sourceLayer || ''] || { icon: '📖', label: book.sourceLayer };
                  return (
                    <div
                      key={book.id}
                      className={`px-3 py-2.5 border-b border-gray-700/30 cursor-pointer hover:bg-gray-800/50 transition-colors ${
                        selectedBook?.id === book.id ? 'bg-accent/10 border-l-2 border-l-accent' : ''
                      }`}
                      onClick={() => handleSelectBook(book)}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-200 font-medium truncate flex-1">
                          📖 {book.title}
                        </span>
                        <span className="text-[9px] text-gray-600 bg-gray-800 px-1.5 py-0.5 rounded flex-shrink-0">
                          {layerMeta.icon} {layerMeta.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-[10px] text-gray-500">
                        <span>{fmtChars(book.totalWords)}</span>
                        <span>· {book.totalEntries} 条目</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right: detail view */}
          <div className="flex-1 overflow-y-auto min-w-0">
            {!selectedBook && (
              <div className="py-16 text-center text-gray-600 text-xs">
                <p className="text-3xl mb-3">📖</p>
                <p>选择左侧书名查看详情</p>
                <p className="mt-1 text-gray-700">书籍内容将以条目形式展示</p>
              </div>
            )}

            {selectedBook && (
              <div>
                {/* Book info header */}
                <div className="px-4 py-3 border-b border-gray-700/50 bg-gray-800/30">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-white">{selectedBook.title}</h3>
                    <span className={`text-[10px] px-2 py-0.5 rounded ${
                      selectedBook.source === 'user_imported'
                        ? 'bg-blue-900/30 text-blue-400 border border-blue-800/50'
                        : 'bg-green-900/30 text-green-400 border border-green-800/50'
                    }`}>
                      {selectedBook.source === 'user_imported' ? '👤 用户导入' : '📚 系统开放'}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-1.5 text-[10px] text-gray-500">
                    {selectedBook.author && <span>✍ {selectedBook.author}</span>}
                    {selectedBook.sourceLayer && (
                      <span>{LAYER_META[selectedBook.sourceLayer]?.icon} {LAYER_META[selectedBook.sourceLayer]?.label}</span>
                    )}
                    <span>{fmtNum(selectedBook.totalWords)} 字</span>
                    <span>· {selectedBook.totalEntries} 条目</span>
                    {selectedBook.createdAt && (
                      <span>· {new Date(selectedBook.createdAt).toLocaleDateString('zh-CN')}</span>
                    )}
                  </div>
                  {/* 删除用户导入的书籍 */}
                  {selectedBook.source === 'user_imported' && (
                    <button
                      onClick={() => handleDelete(selectedBook.id)}
                      className="mt-2 text-[10px] text-red-400 hover:text-red-300 hover:bg-red-900/20 px-2 py-0.5 rounded transition-colors"
                    >
                      🗑️ 删除此书
                    </button>
                  )}
                </div>

                {/* Entries */}
                {detailLoading && (
                  <div className="flex items-center justify-center py-12">
                    <div className="inline-block w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                  </div>
                )}

                {detailError && (
                  <div className="px-4 py-8 text-center text-red-400 text-xs">
                    <p>{detailError}</p>
                  </div>
                )}

                {!detailLoading && !detailError && bookDetail?.entries.map((entry, i) => (
                  <div
                    key={entry.id}
                    className={`px-4 py-3 border-b border-gray-700/30 ${
                      i % 2 === 0 ? 'bg-gray-800/10' : ''
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[9px] text-gray-600 font-mono bg-gray-800 px-1 py-0.5 rounded flex-shrink-0">
                        #{i + 1}
                      </span>
                      {entry.wordCount > 0 && (
                        <span className="text-[9px] text-gray-600">{entry.wordCount} 字</span>
                      )}
                      {entry.sourceUrl && (
                        <a
                          href={entry.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[9px] text-accent hover:underline ml-auto"
                          onClick={(e) => e.stopPropagation()}
                        >
                          🔗 来源
                        </a>
                      )}
                    </div>
                    <p className="text-[11px] text-gray-300 leading-relaxed whitespace-pre-wrap">
                      {truncate(entry.content, 800)}
                    </p>
                    {entry.tags && entry.tags.length > 0 && (
                      <div className="flex gap-1 mt-1.5 flex-wrap">
                        {entry.tags.map((tag, ti) => (
                          <span key={ti} className="text-[9px] text-gray-600 bg-gray-800 px-1.5 py-0.5 rounded">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-1.5 border-t border-gray-700 text-[9px] text-gray-600 flex items-center justify-between shrink-0 bg-gray-800/30">
          <span>📚 参考数据库浏览器</span>
          <span>Ctrl+D 快捷键打开</span>
        </div>
      </div>
    </div>
  );
};

export default DatabaseBrowser;
