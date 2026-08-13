import React, { useCallback, useEffect, useRef, useState } from 'react';

// ============================================================
// 幕布式可折叠层级大纲编辑器
// - Tab: 缩进（成为上一行子节点）
// - Shift+Tab / ArrowLeft: 减少缩进
// - Enter: 新建同级节点
// - Backspace (空行): 删除当前节点
// - ↑↓: 上下移动
// - 点击圆点: 折叠/展开子节点
// ============================================================

export interface OutlineNode {
  id: string;
  text: string;
  children: OutlineNode[];
}

interface OutlineEditorProps {
  nodes: OutlineNode[];
  onChange: (nodes: OutlineNode[]) => void;
  placeholder?: string;
}

let _nodeId = 0;
function genId(): string {
  return 'ol_' + Date.now() + '_' + (++_nodeId);
}

const INDENT = 24; // 每级缩进像素

const OutlineEditor: React.FC<OutlineEditorProps> = ({ nodes, onChange, placeholder }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const focusRef = useRef<{ id: string; cursor: number } | null>(null);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());

  // 深度遍历找到节点 (必须在 toggleCollapse 和 clearDescendantCollapse 之前声明)
  const findNode = useCallback((list: OutlineNode[], id: string): OutlineNode | null => {
    for (const n of list) {
      if (n.id === id) return n;
      const found = findNode(n.children, id);
      if (found) return found;
    }
    return null;
  }, []);

  const toggleCollapse = useCallback((id: string) => {
    setCollapsedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  // 删除所有后代节点的折叠状态（当父节点被折叠时，子节点折叠状态应清除）
  const clearDescendantCollapse = useCallback((list: OutlineNode[], targetId: string) => {
    const target = findNode(list, targetId);
    if (!target) return;
    setCollapsedIds(prev => {
      const next = new Set(prev);
      const walk = (n: OutlineNode) => {
        next.delete(n.id);
        n.children.forEach(walk);
      };
      target.children.forEach(walk);
      return next;
    });
  }, [findNode]);

  // 深度遍历找到父列表和索引
  const findParent = useCallback((list: OutlineNode[], id: string): { parent: OutlineNode[]; idx: number } | null => {
    for (let i = 0; i < list.length; i++) {
      if (list[i].id === id) return { parent: list, idx: i };
      const found = findParent(list[i].children, id);
      if (found) return found;
    }
    return null;
  }, []);

  const deepClone = (list: OutlineNode[]): OutlineNode[] =>
    JSON.parse(JSON.stringify(list));

  const update = (newNodes: OutlineNode[]) => {
    onChange(newNodes);
  };

  const handleKeyDown = (e: React.KeyboardEvent, nodeId: string, text: string, cursorPos: number) => {
    const list = deepClone(nodes);

    // Tab: 缩进
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      const fp = findParent(list, nodeId);
      if (!fp || fp.idx === 0) return;
      const prevSibling = fp.parent[fp.idx - 1];
      const [removed] = fp.parent.splice(fp.idx, 1);
      prevSibling.children.push(removed);
      // 确保父节点展开
      setCollapsedIds(prev => { const n = new Set(prev); n.delete(prevSibling.id); return n; });
      update(list);
      focusRef.current = { id: nodeId, cursor: cursorPos };
      return;
    }

    // Shift+Tab: 减少缩进
    if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault();
      const fp = findParent(list, nodeId);
      if (!fp) return;

      const findParentNode = (items: OutlineNode[], childList: OutlineNode[]): { parentNode: OutlineNode; siblings: OutlineNode[] } | null => {
        for (const item of items) {
          if (item.children === childList) return { parentNode: item, siblings: items };
          const found = findParentNode(item.children, childList);
          if (found) return found;
        }
        return null;
      };

      const result = findParentNode(list, fp.parent);
      if (!result) return;

      const [removed] = fp.parent.splice(fp.idx, 1);
      const parentIdx = result.siblings.findIndex(n => n.id === result.parentNode.id);
      result.siblings.splice(parentIdx + 1, 0, removed);

      update(list);
      focusRef.current = { id: nodeId, cursor: cursorPos };
      return;
    }

    // ArrowLeft: 有子节点且展开 → 折叠；否则减少缩进
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const curNode = findNode(list, nodeId);
      if (curNode && curNode.children.length > 0 && !collapsedIds.has(nodeId)) {
        toggleCollapse(nodeId);
        focusRef.current = { id: nodeId, cursor: cursorPos };
        return;
      }
      // 减少缩进
      const fp = findParent(list, nodeId);
      if (!fp) return;
      const findParentNode = (items: OutlineNode[], childList: OutlineNode[]): { parentNode: OutlineNode; siblings: OutlineNode[] } | null => {
        for (const item of items) {
          if (item.children === childList) return { parentNode: item, siblings: items };
          const found = findParentNode(item.children, childList);
          if (found) return found;
        }
        return null;
      };
      const result = findParentNode(list, fp.parent);
      if (!result) return;
      const [removed] = fp.parent.splice(fp.idx, 1);
      const parentIdx = result.siblings.findIndex(n => n.id === result.parentNode.id);
      result.siblings.splice(parentIdx + 1, 0, removed);
      update(list);
      focusRef.current = { id: nodeId, cursor: cursorPos };
      return;
    }

    // ArrowRight: 折叠状态且有子节点 → 展开
    if (e.key === 'ArrowRight') {
      const curNode = findNode(list, nodeId);
      if (curNode && curNode.children.length > 0 && collapsedIds.has(nodeId)) {
        e.preventDefault();
        toggleCollapse(nodeId);
        focusRef.current = { id: nodeId, cursor: cursorPos };
        return;
      }
    }

    // Enter: 新建节点
    if (e.key === 'Enter') {
      e.preventDefault();
      const fp = findParent(list, nodeId);
      if (!fp) return;
      const newNode: OutlineNode = { id: genId(), text: '', children: [] };
      fp.parent.splice(fp.idx + 1, 0, newNode);
      update(list);
      focusRef.current = { id: newNode.id, cursor: 0 };
      return;
    }

    // Backspace on empty: 删除节点
    if (e.key === 'Backspace' && text === '') {
      e.preventDefault();
      const fp = findParent(list, nodeId);
      if (!fp || fp.parent.length <= 1) return;
      const node = fp.parent[fp.idx];
      const toInsert = node.children;
      fp.parent.splice(fp.idx, 1, ...toInsert);
      const prevId = fp.idx > 0 ? fp.parent[fp.idx - 1].id : fp.parent[0]?.id;
      update(list);
      if (prevId) focusRef.current = { id: prevId, cursor: 0 };
      return;
    }

    // Arrow Up
    if (e.key === 'ArrowUp') {
      const flat: { id: string }[] = [];
      const walk = (items: OutlineNode[]) => {
        items.forEach(n => { flat.push({ id: n.id }); walk(n.children); });
      };
      walk(list);
      const curIdx = flat.findIndex(f => f.id === nodeId);
      if (curIdx > 0) {
        e.preventDefault();
        focusRef.current = { id: flat[curIdx - 1].id, cursor: 0 };
      }
      return;
    }

    // Arrow Down
    if (e.key === 'ArrowDown') {
      const flat: { id: string }[] = [];
      const walk = (items: OutlineNode[]) => {
        items.forEach(n => { flat.push({ id: n.id }); walk(n.children); });
      };
      walk(list);
      const curIdx = flat.findIndex(f => f.id === nodeId);
      if (curIdx < flat.length - 1) {
        e.preventDefault();
        focusRef.current = { id: flat[curIdx + 1].id, cursor: 0 };
      }
      return;
    }
  };

  // 每次渲染后自动调整 textarea 高度（React ref 回调在 DOM 提交后运行）
  // 这样可以保证在 React 更新 value 之后再测量高度，避免 rows={1} 的限制
  const autoResize = useCallback((el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }, []);

  // 仅对当前正在编辑的 textarea 实时调整高度，并保持光标在视野内
  const resizeActive = useCallback((el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
    // 确保光标所在底部不因高度增长而滚出视野
    requestAnimationFrame(() => {
      el.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    });
  }, []);

  // 恢复焦点
  useEffect(() => {
    if (focusRef.current && containerRef.current) {
      const el = containerRef.current.querySelector(`[data-node-id="${focusRef.current.id}"]`) as HTMLTextAreaElement | null;
      if (el) {
        el.focus();
        el.setSelectionRange(focusRef.current.cursor, focusRef.current.cursor);
        autoResize(el);
      }
      focusRef.current = null;
    }
  });

  const depthColors = ['#5EC49A', '#5BAFD4', '#E8917A', '#F5C26B', '#A78BFA', '#F472B6'];

  // 判断某个节点在当前渲染中是否可见（未被祖先折叠）
  const isNodeVisible = useCallback((ancestorIds: string[]): boolean => {
    return ancestorIds.every(id => !collapsedIds.has(id));
  }, [collapsedIds]);

  const renderNodes = (items: OutlineNode[], depth: number, visibleAncestors: string[] = []): React.ReactNode[] => {
    return items.map((node) => {
      const hasChildren = node.children.length > 0;
      const allVisible = isNodeVisible(visibleAncestors);
      const isCollapsed = collapsedIds.has(node.id);
      const toggleIcon = !hasChildren ? '·' : (isCollapsed ? '▶' : '▼');
      const newAncestors = [...visibleAncestors, node.id];

      return [
        // 只有祖先全部展开时才渲染当前行
        ...(allVisible ? [
          <div key={node.id} className="flex items-start group" style={{ paddingLeft: depth * INDENT }}>
            {/* 折叠/展开按钮 */}
            {hasChildren ? (
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  toggleCollapse(node.id);
                }}
                className="mt-[9px] mr-2 w-4 h-4 flex items-center justify-center rounded-full flex-shrink-0 text-[10px] cursor-pointer hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                title={isCollapsed ? '展开子项' : '折叠子项'}
              >
                <span style={{ color: depthColors[Math.min(depth, depthColors.length - 1)] }}>
                  {toggleIcon}
                </span>
              </button>
            ) : (
              <span className="mt-[9px] mr-2 w-4 h-4 flex items-center justify-center flex-shrink-0 text-[10px] text-gray-600 cursor-default">
                ·
              </span>
            )}
            <textarea
              ref={(el) => { autoResize(el); }}
              data-node-id={node.id}
              value={node.text}
              rows={1}
              placeholder={depth === 0 && items.indexOf(node) === 0 && node.text === '' ? (placeholder || '开始描写角色...') : ''}
              onChange={(e) => {
                resizeActive(e.currentTarget);
                const list = deepClone(nodes);
                const n = findNode(list, node.id);
                if (n) n.text = e.target.value;
                update(list);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
                  // 纯 Enter：不换行，创建新节点
                  e.preventDefault();
                  const fp = findParent(deepClone(nodes), node.id);
                  if (!fp) return;
                  const list = deepClone(nodes);
                  const fp2 = findParent(list, node.id);
                  if (!fp2) return;
                  const newNode: OutlineNode = { id: genId(), text: '', children: [] };
                  fp2.parent.splice(fp2.idx + 1, 0, newNode);
                  update(list);
                  focusRef.current = { id: newNode.id, cursor: 0 };
                  return;
                }
                if (e.key === 'Enter' && (e.shiftKey || e.altKey)) {
                  // Shift+Enter 或 Alt+Enter：在节点内换行
                  return; // 不拦截，让 textarea 自然换行
                }
                const input = e.currentTarget;
                handleKeyDown(e, node.id, input.value, input.selectionStart || 0);
              }}
              className="flex-1 px-2 py-1.5 bg-transparent border border-transparent hover:border-float-700 focus:border-accent focus:bg-float-900/50 rounded text-sm text-gray-200 outline-none placeholder-gray-600 transition-colors resize-none overflow-hidden"
            />
            {/* 删除按钮 — 悬停时显示 */}
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                const list = deepClone(nodes);
                const fp = findParent(list, node.id);
                if (!fp) return;
                // 把当前节点的子节点提到父列表
                const childrenToPromote = fp.parent[fp.idx].children;
                fp.parent.splice(fp.idx, 1, ...childrenToPromote);
                update(list);
              }}
              className="mt-[9px] ml-1 w-4 h-4 flex items-center justify-center rounded flex-shrink-0 text-[10px] text-gray-600 hover:text-red-400 hover:bg-red-900/20 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
              title="删除此节点（子节点上移）"
            >
              ×
            </button>
          </div>
        ] : []),
        // 子节点：只有当前节点未折叠时才渲染
        ...(isCollapsed ? [] : renderNodes(node.children, depth + 1, newAncestors)),
      ];
    });
  };

  return (
    <div ref={containerRef} className="outline-editor space-y-0.5 py-1">
      {nodes.length === 0 ? (
        <div
          className="text-gray-600 text-sm text-center py-4 cursor-pointer hover:text-gray-400"
          onClick={() => update([{ id: genId(), text: '', children: [] }])}
        >
          点击开始编辑角色大纲…
        </div>
      ) : (
        renderNodes(nodes, 0)
      )}
    </div>
  );
};

export default OutlineEditor;
