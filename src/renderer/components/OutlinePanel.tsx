import React, { useState, useCallback, useEffect, useRef } from 'react';
import type { OutlineNode } from '../types';
import OutlineEditor, { type OutlineNode as EditorNode } from './OutlineEditor';

// ============================================================
// 大纲浮动面板
// - 左侧：树形节点列表
// - 右侧：选中节点的幕布式层级编辑区（支持 Tab 缩进）
// ============================================================

interface OutlinePanelProps {
  nodes: OutlineNode[];
  activeNodeId: string | null;
  onSelect: (id: string) => void;
  onCreate: (parentId: string | null, title: string) => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, title: string, summary: string) => void;
  loading: boolean;
}

// ── 辅助：把扁平节点按 parentId 构建成树 ──
interface TreeNode {
  node: OutlineNode;
  children: TreeNode[];
}

function buildTree(nodes: OutlineNode[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];
  for (const n of nodes) map.set(n.id, { node: n, children: [] });
  for (const n of nodes) {
    const tn = map.get(n.id)!;
    if (n.parentId && map.has(n.parentId)) {
      map.get(n.parentId)!.children.push(tn);
    } else {
      roots.push(tn);
    }
  }
  return roots;
}

// ── 转换函数: JSON ↔ EditorNode[] (树) ──
// 使用 JSON 格式保证多行文本不会因换行符而被错误分割
let _nid = 0;
function nodeGenId(): string { return 'op_nd_' + Date.now() + '_' + (++_nid); }

interface JsonOutlineNode {
  t: string;
  c?: JsonOutlineNode[];
}

// 将 JSON 解析为 EditorNode 树
function parseJsonTree(arr: JsonOutlineNode[]): EditorNode[] {
  return arr.map((item) => ({
    id: nodeGenId(),
    text: item.t || '',
    children: item.c ? parseJsonTree(item.c) : [],
  }));
}

// 将 EditorNode 树序列化为 JSON
function serializeTreeToJson(nodes: EditorNode[]): string {
  const convert = (list: EditorNode[]): JsonOutlineNode[] => list.map(n => {
    const obj: JsonOutlineNode = { t: n.text };
    if (n.children.length > 0) obj.c = convert(n.children);
    return obj;
  });
  return JSON.stringify(convert(nodes));
}

// 将 summary 解析为 EditorNode 树（兼容旧 tab 缩进格式）
function parseSummaryToTree(summary: string): EditorNode[] {
  if (!summary || !summary.trim()) return [];

  // 优先尝试 JSON 格式
  const trimmed = summary.trim();
  if (trimmed.startsWith('[')) {
    try {
      const arr = JSON.parse(trimmed);
      if (Array.isArray(arr)) return parseJsonTree(arr);
    } catch { /* 不是合法 JSON，回退到旧格式 */ }
  }

  // 向后兼容：旧的 tab 缩进纯文本格式
  const lines = summary.split('\n');
  const stack: { depth: number; node: EditorNode }[] = [];
  const roots: EditorNode[] = [];

  for (const line of lines) {
    const match = line.match(/^(\t*)(.*)$/);
    const depth = match ? Math.min(match[1].length, 6) : 0;
    const text = match ? (match[2] || '') : (line || '');

    const newNode: EditorNode = {
      id: nodeGenId(),
      text,
      children: [],
    };

    while (stack.length > 0 && stack[stack.length - 1].depth >= depth) {
      stack.pop();
    }

    if (stack.length === 0) {
      roots.push(newNode);
    } else {
      stack[stack.length - 1].node.children.push(newNode);
    }

    stack.push({ depth, node: newNode });
  }

  return roots;
}

// 将树序列化（统一使用 JSON 格式保证多行文本不丢失）
function serializeTreeToSummary(nodes: EditorNode[]): string {
  return serializeTreeToJson(nodes);
}

const OutlinePanel: React.FC<OutlinePanelProps> = ({
  nodes,
  activeNodeId,
  onSelect,
  onCreate,
  onDelete,
  onUpdate,
  loading,
}) => {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);
  const [outlineNodes, setOutlineNodes] = useState<EditorNode[]>([]);
  const nodesDirty = useRef(false);
  const [selectedId, setSelectedId] = useState<string | null>(activeNodeId);
  const outlineNodesRef = useRef(outlineNodes);
  const onUpdateRef = useRef(onUpdate);
  const nodesRef = useRef(nodes);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── 左右分隔线拖拽 ──
  const [leftWidth, setLeftWidth] = useState(45); // 左侧节点列表宽度的百分比
  const dividerResizing = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleDividerStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dividerResizing.current = true;
    const startX = e.clientX;
    const startW = leftWidth;
    const containerEl = containerRef.current;
    if (!containerEl) return;
    const containerW = containerEl.getBoundingClientRect().width;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: MouseEvent) => {
      if (!dividerResizing.current) return;
      const dx = ev.clientX - startX;
      const newPercent = Math.max(20, Math.min(70, startW + (dx / containerW) * 100));
      setLeftWidth(newPercent);
    };
    const onUp = () => {
      dividerResizing.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [leftWidth]);

  // 保持 ref 同步，避免闭包过期
  useEffect(() => { outlineNodesRef.current = outlineNodes; }, [outlineNodes]);
  useEffect(() => { onUpdateRef.current = onUpdate; }, [onUpdate]);
  useEffect(() => { nodesRef.current = nodes; }, [nodes]);

  // ── 保存当前节点到数据库 ──
  const flushSave = useCallback(() => {
    if (!nodesDirty.current) return;
    const nodeId = selectedId;
    if (!nodeId) return;
    const node = nodesRef.current.find(n => n.id === nodeId);
    if (!node) return;
    const summary = serializeTreeToSummary(outlineNodesRef.current);
    if (summary !== (node.summary || '')) {
      onUpdateRef.current(node.id, node.title, summary);
    }
    nodesDirty.current = false;
  }, [selectedId]);

  // ── 自动保存：2 秒防抖 ──
  useEffect(() => {
    if (!nodesDirty.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      flushSave();
    }, 2000);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [outlineNodes, flushSave]);

  // ── 组件卸载时立即保存 ──
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      // 卸载时如果还有脏数据，立即保存
      if (nodesDirty.current && selectedId) {
        const node = nodesRef.current.find(n => n.id === selectedId);
        if (node) {
          const summary = serializeTreeToSummary(outlineNodesRef.current);
          if (summary !== (node.summary || '')) {
            onUpdateRef.current(node.id, node.title, summary);
          }
        }
      }
    };
  }, [selectedId]);

  const tree = buildTree(nodes);
  const activeNode = nodes.find(n => n.id === selectedId) || null;

  // 同步外部 activeNodeId
  useEffect(() => {
    if (activeNodeId) {
      setSelectedId(activeNodeId);
      // 展开祖先链
      const expandAncestors = (id: string) => {
        const node = nodes.find(n => n.id === id);
        if (node?.parentId) {
          setExpandedIds(prev => new Set(prev).add(node.parentId!));
          expandAncestors(node.parentId);
        }
      };
      expandAncestors(activeNodeId);
    }
  }, [activeNodeId]);

  // 选中节点时加载 summary 并解析为树
  useEffect(() => {
    if (activeNode) {
      const tree = parseSummaryToTree(activeNode.summary || '');
      setOutlineNodes(tree.length > 0 ? tree : [{ id: nodeGenId(), text: '', children: [] }]);
      nodesDirty.current = false;
    }
  }, [selectedId]);

  // 节点切换前保存当前节点内容
  const prevSelectedId = useRef(selectedId);
  useEffect(() => {
    if (prevSelectedId.current && prevSelectedId.current !== selectedId && nodesDirty.current) {
      const prevNode = nodes.find(n => n.id === prevSelectedId.current);
      if (prevNode) {
        const summary = serializeTreeToSummary(outlineNodes);
        if (summary !== (prevNode.summary || '')) {
          onUpdate(prevNode.id, prevNode.title, summary);
        }
      }
      nodesDirty.current = false;
    }
    prevSelectedId.current = selectedId;
  }, [selectedId, outlineNodes, nodes, onUpdate]);

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const handleSelect = useCallback((id: string) => {
    setSelectedId(id);
    onSelect(id);
  }, [onSelect]);

  const handleStartRename = (node: OutlineNode) => {
    setRenamingId(node.id);
    setRenameText(node.title);
  };

  // 进入改名时强制聚焦并全选，确保「出现即能输入」
  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  const handleSaveRename = (id: string) => {
    if (renameText.trim()) {
      const node = nodes.find(n => n.id === id);
      if (node) onUpdate(id, renameText.trim(), node.summary);
    }
    setRenamingId(null);
  };

  // 保存摘要 (树 → tab 文本)
  const handleSaveNodes = useCallback((nodes: EditorNode[]) => {
    if (activeNode) {
      const summary = serializeTreeToSummary(nodes);
      if (summary !== (activeNode.summary || '')) {
        onUpdate(activeNode.id, activeNode.title, summary);
      }
    }
    nodesDirty.current = false;
  }, [activeNode, onUpdate]);

  const handleCreateRoot = () => {
    onCreate(null, '新节点');
  };

  // 创建子节点
  const handleCreateChild = (parentId: string) => {
    onCreate(parentId, '新子节点');
    setExpandedIds(prev => new Set(prev).add(parentId));
  };

  const renderNode = (treeNode: TreeNode, depth: number = 0): React.ReactNode => {
    const { node, children } = treeNode;
    const hasChildren = children.length > 0;
    const isExpanded = expandedIds.has(node.id);
    const isSelected = node.id === selectedId;
    const isRenaming = node.id === renamingId;

    return (
      <div key={node.id} className="select-none">
        <div
          className={`
            group flex items-center gap-0.5 px-2 py-1 cursor-pointer text-xs border-l-2 transition-colors
            ${isSelected
              ? 'bg-accent/20 border-accent text-white'
              : 'border-transparent hover:bg-float-800/70 text-gray-400'
            }
          `}
          style={{ paddingLeft: `${6 + depth * 14}px` }}
          onClick={() => handleSelect(node.id)}
          onDoubleClick={() => {
            // 仅在非编辑态触发改名，避免双击冒泡重置已输入的内容
            if (renamingId !== node.id) handleStartRename(node);
          }}
        >
          {/* 展开/折叠 */}
          <button
            onClick={(e) => { e.stopPropagation(); toggleExpand(node.id); }}
            className="w-4 h-4 flex items-center justify-center text-gray-600 hover:text-white flex-shrink-0 text-[10px]"
          >
            {hasChildren ? (isExpanded ? '▾' : '▸') : <span className="text-gray-700">·</span>}
          </button>

          {/* 标题/重命名 */}
          {isRenaming ? (
            <input
              ref={renameInputRef}
              type="text"
              value={renameText}
              onChange={e => setRenameText(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleSaveRename(node.id);
                if (e.key === 'Escape') setRenamingId(null);
              }}
              onBlur={() => handleSaveRename(node.id)}
              className="flex-1 px-1 py-0 bg-float-700 border border-float-600 rounded text-white text-xs
                         focus:outline-none focus:border-accent"
              autoFocus
              onClick={e => e.stopPropagation()}
              onDoubleClick={e => e.stopPropagation()}
            />
          ) : (
            <span className="flex-1 truncate text-xs">{node.title}</span>
          )}

          {/* 操作按钮 */}
          <div className="hidden group-hover:flex items-center gap-0.5 flex-shrink-0">
            <button
              onClick={(e) => { e.stopPropagation(); handleCreateChild(node.id); }}
              className="text-gray-600 hover:text-white text-[10px] px-0.5"
              title="添加子节点"
            >
              +
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); if (confirm('删除此节点？')) onDelete(node.id); }}
              className="text-gray-600 hover:text-red-400 text-[10px] px-0.5"
              title="删除"
            >
              ×
            </button>
          </div>
        </div>

        {/* 子节点 */}
        {hasChildren && isExpanded && children.map(child => renderNode(child, depth + 1))}
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col bg-float-900">
      {/* 顶栏 */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-float-700 shrink-0">
        <span className="text-xs text-gray-400">
          📋 大纲
          <span className="text-gray-600 ml-1">({nodes.length} 节点)</span>
        </span>
        <button
          onClick={handleCreateRoot}
          className="text-[10px] text-accent hover:text-white transition-colors"
        >
          + 新节点
        </button>
      </div>

      {/* 主体 */}
      {loading && nodes.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-gray-600 text-xs">加载中...</div>
      ) : (
        <div className="flex-1 flex overflow-hidden" ref={containerRef}>
          {/* ── 左侧：节点列表 ── */}
          <div className="overflow-y-auto py-1" style={{ width: `${leftWidth}%` }}>
            {nodes.length === 0 ? (
              <div className="px-4 py-6 text-center text-gray-600 text-xs">
                还没有大纲节点
                <br />
                <button onClick={handleCreateRoot} className="text-accent hover:text-white mt-1">
                  点击创建第一个节点
                </button>
              </div>
            ) : (
              tree.map(tn => renderNode(tn))
            )}
          </div>

          {/* ── 可拖拽分隔线 ── */}
          <div
            className="w-1.5 hover:w-2 bg-transparent hover:bg-accent/50 transition-all flex-shrink-0 cursor-col-resize z-10"
            onMouseDown={handleDividerStart}
            title="拖拽调整面板宽度"
          />

          {/* ── 右侧：幕布式层级编辑区 ── */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {activeNode ? (
              <>
                <div className="px-3 py-2 border-b border-gray-800 flex items-center justify-between shrink-0">
                  <span className="text-[11px] font-semibold text-gray-300 truncate">
                    ✏️ {activeNode.title}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        // 排版：将每个节点中多段文字拆成独立兄弟节点（只按空行拆分）
                        if (outlineNodes.length === 0) return;
                        const newNodes: EditorNode[] = [];
                        for (const node of outlineNodes) {
                          // 按空行（连续两个以上换行）拆分段落
                          const parts = node.text.split(/\n\s*\n/);
                          const nonEmpty = parts
                            .map(p => p.replace(/[\t ]+/g, ' ').trim())
                            .filter(p => p.length > 0);
                          if (nonEmpty.length === 0) {
                            // 空文本节点保留
                            if (node.children.length > 0 || newNodes.length === 0) {
                              newNodes.push({ ...node, text: node.text.trim() });
                            }
                          } else {
                            // 首段继承当前节点 ID（保留子节点）
                            newNodes.push({ ...node, text: nonEmpty[0] });
                            // 后续段落作为新兄弟节点插入
                            for (let i = 1; i < nonEmpty.length; i++) {
                              newNodes.push({ id: nodeGenId(), text: nonEmpty[i], children: [] });
                            }
                          }
                        }
                        setOutlineNodes(newNodes);
                        nodesDirty.current = true;
                      }}
                      className="text-[10px] text-accent hover:text-accent-hover transition-colors"
                      title="按段落拆分 — 将多段文字拆成独立节点，去掉多余空行"
                    >
                      📐 排版
                    </button>
                    <span className="text-[9px] text-gray-600">
                      Tab 缩进 · Enter 新建节点 · Alt+Enter 换行
                    </span>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto px-3 py-2">
                  <OutlineEditor
                    nodes={outlineNodes}
                    onChange={(newNodes) => {
                      setOutlineNodes(newNodes);
                      nodesDirty.current = true;
                    }}
                    placeholder="输入内容…"
                  />
                </div>
                <div className="px-3 py-1.5 border-t border-gray-800 flex items-center justify-between shrink-0">
                  <span className="text-[9px] text-gray-600">
                    {nodesDirty.current ? '✦ 修改未保存（切换节点自动保存）' : '自动保存'}
                  </span>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-gray-600 text-xs text-center">
                <div>
                  <p className="text-lg mb-1">📖</p>
                  <p>选择一个大纲节点</p>
                  <p className="text-gray-700 mt-0.5">Tab 缩进 · Enter 新建 · Alt+Enter 换行</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default OutlinePanel;
