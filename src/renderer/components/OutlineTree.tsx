import React, { useState, useCallback } from 'react';
import type { OutlineNode } from '../types';
import ContextMenu from './ContextMenu';

interface OutlineTreeProps {
  nodes: OutlineNode[];
  activeNodeId: string | null;
  onSelect: (id: string) => void;
  onCreate: (parentId: string | null, title: string) => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, title: string, summary: string) => void;
  onReorder?: (nodeIds: string[]) => void;
  loading: boolean;
}

interface TreeNode {
  node: OutlineNode;
  children: TreeNode[];
}

const OutlineTree: React.FC<OutlineTreeProps> = ({
  nodes,
  activeNodeId,
  onSelect,
  onCreate,
  onDelete,
  onUpdate,
  loading,
}) => {
  const [isCreating, setIsCreating] = useState<{ parentId: string | null } | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editSummary, setEditSummary] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ visible: boolean; x: number; y: number; nodeId: string }>({
    visible: false, x: 0, y: 0, nodeId: '',
  });

  // Build tree structure from flat list
  const buildTree = useCallback((): TreeNode[] => {
    const map = new Map<string, TreeNode>();
    const roots: TreeNode[] = [];

    for (const node of nodes) {
      map.set(node.id, { node, children: [] });
    }

    for (const node of nodes) {
      const treeNode = map.get(node.id)!;
      if (node.parentId && map.has(node.parentId)) {
        map.get(node.parentId)!.children.push(treeNode);
      } else {
        roots.push(treeNode);
      }
    }

    return roots;
  }, [nodes]);

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleCreate = () => {
    if (!newTitle.trim()) return;
    const parentId = isCreating?.parentId ?? null;
    onCreate(parentId, newTitle.trim());
    setNewTitle('');
    setIsCreating(null);
    if (parentId) {
      setExpandedIds(prev => new Set(prev).add(parentId));
    }
  };

  const handleStartEdit = (node: OutlineNode) => {
    setEditingId(node.id);
    setEditTitle(node.title);
    setEditSummary(node.summary);
  };

  const handleSaveEdit = () => {
    if (editingId && editTitle.trim()) {
      onUpdate(editingId, editTitle.trim(), editSummary);
    }
    setEditingId(null);
  };

  const handleDragStart = (e: React.DragEvent, nodeId: string) => {
    e.dataTransfer.setData('text/plain', nodeId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, nodeId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverId(nodeId);
  };

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const draggedId = e.dataTransfer.getData('text/plain');
    if (draggedId !== targetId) {
      // Move dragged node under target node
      onUpdate(draggedId, undefined!, undefined!);
      // The actual reparenting would go through IPC
    }
    setDragOverId(null);
  };

  const handleNodeContextMenu = (e: React.MouseEvent, nodeId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ visible: true, x: e.clientX, y: e.clientY, nodeId });
  };

  const renderNode = (treeNode: TreeNode, depth: number = 0) => {
    const { node, children } = treeNode;
    const hasChildren = children.length > 0;
    const isExpanded = expandedIds.has(node.id);
    const isActive = node.id === activeNodeId;
    const isEditing = node.id === editingId;

    return (
      <div key={node.id}>
        <div
          className={`
            group flex items-center px-2 py-1.5 cursor-pointer text-xs
            ${isActive
              ? 'bg-sidebar-active border-l-2 border-accent text-white'
              : 'border-l-2 border-transparent hover:bg-sidebar-hover text-gray-400'
            }
            ${dragOverId === node.id ? 'bg-accent/20' : ''}
          `}
          style={{ paddingLeft: `${8 + depth * 16}px` }}
          onClick={() => onSelect(node.id)}
          onDoubleClick={() => handleStartEdit(node)}
          onContextMenu={(e) => handleNodeContextMenu(e, node.id)}
          draggable
          onDragStart={(e) => handleDragStart(e, node.id)}
          onDragOver={(e) => handleDragOver(e, node.id)}
          onDrop={(e) => handleDrop(e, node.id)}
          onDragEnd={() => setDragOverId(null)}
        >
          {/* Expand/collapse toggle */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleExpand(node.id);
            }}
            className="w-4 h-4 flex items-center justify-center text-gray-600 hover:text-white mr-0.5 flex-shrink-0"
          >
            {hasChildren
              ? (isExpanded ? '▼' : '▶')
              : <span className="text-gray-700">·</span>
            }
          </button>

          {/* Title / Edit */}
          {isEditing ? (
            <div className="flex-1 flex gap-1" onClick={(e) => e.stopPropagation()}>
              <input
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveEdit();
                  if (e.key === 'Escape') setEditingId(null);
                }}
                className="flex-1 px-1 py-0 bg-gray-700 border border-gray-600 rounded text-white text-xs
                           focus:outline-none focus:border-accent"
                autoFocus
              />
              <button
                onClick={handleSaveEdit}
                className="text-[10px] text-accent hover:text-white px-1"
              >
                ✓
              </button>
            </div>
          ) : (
            <span className="flex-1 truncate">
              {node.title}
              {node.summary && (
                <span className="text-gray-600 ml-1">— {node.summary.slice(0, 30)}{node.summary.length > 30 ? '...' : ''}</span>
              )}
            </span>
          )}

          {/* Actions (visible on hover) */}
          {!isEditing && (
            <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 ml-1 flex-shrink-0">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setIsCreating({ parentId: node.id });
                  setNewTitle('');
                  setExpandedIds(prev => new Set(prev).add(node.id));
                }}
                className="text-gray-600 hover:text-white text-xs px-0.5"
                title="添加子节点"
              >
                +
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(node.id);
                }}
                className="text-gray-600 hover:text-red-400 text-xs px-0.5"
                title="删除"
              >
                ×
              </button>
            </div>
          )}
        </div>

        {/* Inline create input */}
        {isCreating?.parentId === node.id && (
          <div
            className="flex items-center gap-1 px-2 py-1"
            style={{ paddingLeft: `${24 + (depth + 1) * 16}px` }}
          >
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate();
                if (e.key === 'Escape') { setIsCreating(null); setNewTitle(''); }
              }}
              placeholder="子节点标题..."
              className="flex-1 px-1.5 py-0.5 bg-gray-700 border border-gray-600 rounded text-white text-xs
                         focus:outline-none focus:border-accent placeholder-gray-500"
              autoFocus
            />
          </div>
        )}

        {/* Children */}
        {hasChildren && isExpanded && (
          <div>
            {children.map(child => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const tree = buildTree();

  return (
    <div className="py-1">
      <div className="px-4 py-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">大纲</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              setIsCreating({ parentId: null });
              setNewTitle('');
            }}
            className="text-xs text-gray-400 hover:text-white transition-colors"
            title="新建根节点"
          >
            + 新节点
          </button>
        </div>
      </div>

      {/* Root-level create input */}
      {isCreating?.parentId === null && (
        <div className="flex items-center gap-1 px-3 pb-2">
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate();
              if (e.key === 'Escape') { setIsCreating(null); setNewTitle(''); }
            }}
            placeholder="大纲节点标题..."
            className="flex-1 px-1.5 py-0.5 bg-gray-700 border border-gray-600 rounded text-white text-xs
                       focus:outline-none focus:border-accent placeholder-gray-500"
            autoFocus
          />
        </div>
      )}

      {loading && nodes.length === 0 && (
        <div className="px-4 py-4 text-center text-gray-500 text-xs">加载中...</div>
      )}

      {!loading && nodes.length === 0 && !isCreating && (
        <div className="px-4 py-4 text-center text-gray-500 text-xs">
          还没有大纲节点
          <br />
          点击上方按钮创建
        </div>
      )}

      <div>
        {tree.map(treeNode => renderNode(treeNode))}
      </div>

      {/* Context Menu */}
      <ContextMenu
        visible={contextMenu.visible}
        x={contextMenu.x}
        y={contextMenu.y}
        onClose={() => setContextMenu(p => ({ ...p, visible: false }))}
        items={[
          {
            label: '重命名',
            icon: '✏️',
            onClick: () => {
              const node = nodes.find(n => n.id === contextMenu.nodeId);
              if (node) handleStartEdit(node);
            },
          },
          {
            label: '添加子节点',
            icon: '➕',
            onClick: () => {
              setIsCreating({ parentId: contextMenu.nodeId });
              setNewTitle('');
              setExpandedIds(prev => new Set(prev).add(contextMenu.nodeId));
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

export default OutlineTree;
