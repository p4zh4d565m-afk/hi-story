import React, { useState, useCallback } from 'react';
import type { OutlineNode } from '../types';
import ContextMenu from './ContextMenu';

interface OutlineBoardProps {
  nodes: OutlineNode[];
  activeNodeId: string | null;
  onSelect: (id: string) => void;
  onCreate: (parentId: string | null, title: string) => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, title: string, summary: string) => void;
  loading: boolean;
}

interface Column {
  id: string;
  title: string;
  childNodes: OutlineNode[];
}

const DEFAULT_COLUMNS: Column[] = [
  { id: 'act1', title: '第一幕', childNodes: [] },
  { id: 'act2', title: '第二幕', childNodes: [] },
  { id: 'act3', title: '第三幕', childNodes: [] },
];

const OutlineBoard: React.FC<OutlineBoardProps> = ({
  nodes,
  activeNodeId,
  onSelect,
  onCreate,
  onDelete,
  onUpdate,
  loading,
}) => {
  // Root nodes serve as column headers; if none, use defaults
  const rootNodes = nodes.filter(n => !n.parentId);

  const columns: Column[] = rootNodes.length > 0
    ? rootNodes.map(r => ({
        id: r.id,
        title: r.title,
        childNodes: nodes.filter(n => n.parentId === r.id),
      }))
    : DEFAULT_COLUMNS;

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editSummary, setEditSummary] = useState('');
  const [addingToCol, setAddingToCol] = useState<string | null>(null);
  const [newCardTitle, setNewCardTitle] = useState('');

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ visible: boolean; x: number; y: number; nodeId: string }>({
    visible: false, x: 0, y: 0, nodeId: '',
  });

  const handleStartEdit = useCallback((node: OutlineNode) => {
    setEditingId(node.id);
    setEditTitle(node.title);
    setEditSummary(node.summary);
  }, []);

  const handleSaveEdit = useCallback(() => {
    if (editingId && editTitle.trim()) {
      onUpdate(editingId, editTitle.trim(), editSummary);
    }
    setEditingId(null);
  }, [editingId, editTitle, editSummary, onUpdate]);

  const handleAddCard = useCallback((colId: string) => {
    if (!newCardTitle.trim()) return;
    // If using default columns, create root node first
    const realParentId = columns.find(c => c.id === colId && rootNodes.length > 0) ? colId : null;
    onCreate(realParentId, newCardTitle.trim());
    setNewCardTitle('');
    setAddingToCol(null);
  }, [newCardTitle, onCreate, columns, rootNodes.length]);

  const handleCardContextMenu = useCallback((e: React.MouseEvent, nodeId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ visible: true, x: e.clientX, y: e.clientY, nodeId });
  }, []);

  if (loading && nodes.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-gray-500 text-xs">
        加载中...
      </div>
    );
  }

  return (
    <div className="py-1">
      {/* Header */}
      <div className="px-4 py-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          大纲看板
        </span>
        <button
          onClick={() => {
            onCreate(null, '新幕');
          }}
          className="text-xs text-gray-400 hover:text-white transition-colors"
          title="新建列（根节点）"
        >
          + 新幕
        </button>
      </div>

      {/* Board */}
      <div className="px-2 pb-2">
        {columns.length === 0 ? (
          <div className="py-4 text-center text-gray-500 text-xs">
            还没有大纲节点
            <br />点击「新幕」创建看板列
          </div>
        ) : (
          <div className="flex gap-2 overflow-x-auto pb-2">
            {columns.map((col) => (
              <div
                key={col.id}
                className="flex-shrink-0 w-[160px] bg-gray-800/50 rounded border border-gray-700/50"
              >
                {/* Column header */}
                <div className="px-3 py-2 border-b border-gray-700/50 flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-gray-300 truncate flex-1">
                    {col.title}
                  </span>
                  <div className="flex items-center gap-0.5 flex-shrink-0">
                    <button
                      onClick={() => { setAddingToCol(col.id); setNewCardTitle(''); }}
                      className="text-gray-500 hover:text-white text-[10px] px-0.5"
                      title="添加卡片"
                    >
                      +
                    </button>
                    {rootNodes.length > 0 && (
                      <button
                        onClick={() => onDelete(col.id)}
                        className="text-gray-500 hover:text-red-400 text-[10px] px-0.5"
                        title="删除列"
                      >
                        ×
                      </button>
                    )}
                  </div>
                </div>

                {/* Cards */}
                <div className="p-1.5 space-y-1 max-h-[400px] overflow-y-auto">
                  {col.childNodes.map((card) => (
                    <div
                      key={card.id}
                      onClick={() => onSelect(card.id)}
                      onDoubleClick={() => handleStartEdit(card)}
                      onContextMenu={(e) => handleCardContextMenu(e, card.id)}
                      className={`
                        px-2 py-1.5 rounded text-[11px] cursor-pointer transition-colors
                        ${card.id === activeNodeId
                          ? 'bg-accent/20 border border-accent/50 text-white'
                          : 'bg-gray-700/50 border border-transparent hover:border-gray-600 text-gray-300'
                        }
                      `}
                    >
                      {editingId === card.id ? (
                        <div onClick={(e) => e.stopPropagation()} className="space-y-1">
                          <input
                            type="text"
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveEdit();
                              if (e.key === 'Escape') setEditingId(null);
                            }}
                            className="w-full px-1 py-0.5 bg-gray-600 border border-gray-500 rounded text-white text-[11px]
                                       focus:outline-none focus:border-accent"
                            placeholder="标题"
                            autoFocus
                          />
                          <textarea
                            value={editSummary}
                            onChange={(e) => setEditSummary(e.target.value)}
                            rows={2}
                            className="w-full px-1 py-0.5 bg-gray-600 border border-gray-500 rounded text-white text-[10px]
                                       focus:outline-none focus:border-accent resize-none"
                            placeholder="摘要..."
                          />
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => setEditingId(null)}
                              className="text-[10px] text-gray-400 hover:text-white"
                            >
                              取消
                            </button>
                            <button
                              onClick={handleSaveEdit}
                              className="text-[10px] text-accent hover:text-accent-hover"
                            >
                              保存
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="font-medium truncate">{card.title}</div>
                          {card.summary && (
                            <div className="text-[10px] text-gray-500 mt-0.5 line-clamp-2">
                              {card.summary}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  ))}
                  {col.childNodes.length === 0 && (
                    <div className="text-[10px] text-gray-600 text-center py-3">
                      拖拽节点到此列
                    </div>
                  )}

                  {/* Add card input */}
                  {addingToCol === col.id && (
                    <div className="px-1 pb-1">
                      <input
                        type="text"
                        value={newCardTitle}
                        onChange={(e) => setNewCardTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleAddCard(col.id);
                          if (e.key === 'Escape') { setAddingToCol(null); setNewCardTitle(''); }
                        }}
                        placeholder="卡片标题..."
                        className="w-full px-1.5 py-1 bg-gray-600 border border-gray-500 rounded text-white text-[10px]
                                   focus:outline-none focus:border-accent placeholder-gray-500"
                        autoFocus
                      />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Context Menu */}
      <ContextMenu
        visible={contextMenu.visible}
        x={contextMenu.x}
        y={contextMenu.y}
        onClose={() => setContextMenu(p => ({ ...p, visible: false }))}
        items={[
          {
            label: '编辑',
            icon: '✏️',
            onClick: () => {
              const node = nodes.find(n => n.id === contextMenu.nodeId);
              if (node) handleStartEdit(node);
            },
          },
          {
            label: '删除',
            icon: '🗑️',
            danger: true,
            onClick: () => {
              if (confirm('确定要删除这个大纲节点吗？')) {
                onDelete(contextMenu.nodeId);
              }
            },
          },
        ]}
      />
    </div>
  );
};

export default OutlineBoard;
