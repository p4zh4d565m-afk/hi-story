import React, { createContext, useContext, useState, useCallback, useRef, useEffect, useMemo } from 'react';

// ============================================================
// Word/Excel 风格命令模式撤销系统
// 核心：每个操作入栈，Ctrl+Z 弹出逆操作执行，Ctrl+Y 重做
// 对比旧回收站：
//   1. 单例 Context（不是多实例互相覆盖）
//   2. restore() 保留原始 ID（不是 create 新 UUID）
//   3. 覆盖所有操作（删除、创建、重命名），不只是删除
// ============================================================

export interface UndoCommand {
  id: string;
  /** 显示标签，如 "删除章节「第一章」" */
  label: string;
  /** 逆操作（撤销时执行） */
  undo: () => Promise<void>;
  /** 重做原操作（Ctrl+Y 时执行） */
  redo: () => Promise<void>;
}

interface UndoContextValue {
  /** 推入撤销栈 */
  pushUndo: (cmd: UndoCommand) => void;
  /** 执行撤销，返回执行的命令 */
  undo: () => Promise<UndoCommand | null>;
  /** 执行重做，返回执行的命令 */
  redo: () => Promise<UndoCommand | null>;
  /** 撤销栈是否为空 */
  canUndo: boolean;
  /** Toast 中显示的标签 */
  toastLabel: string | null;
  /** 关闭 Toast */
  dismissToast: () => void;
}

const UndoContext = createContext<UndoContextValue>({
  pushUndo: () => {},
  undo: async () => null,
  redo: async () => null,
  canUndo: false,
  toastLabel: null,
  dismissToast: () => {},
});

export function useUndo() {
  return useContext(UndoContext);
}

let _cmdId = 0;
export function genCmdId(): string {
  return 'undo_' + Date.now() + '_' + (++_cmdId);
}

export const UndoProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [undoStack, setUndoStack] = useState<UndoCommand[]>([]);
  const [redoStack, setRedoStack] = useState<UndoCommand[]>([]);
  const [toastLabel, setToastLabel] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ref 避免 stale closure
  const undoStackRef = useRef(undoStack);
  const redoStackRef = useRef(redoStack);
  useEffect(() => { undoStackRef.current = undoStack; }, [undoStack]);
  useEffect(() => { redoStackRef.current = redoStack; }, [redoStack]);

  const pushUndo = useCallback((cmd: UndoCommand) => {
    setUndoStack(prev => {
      const next = [cmd, ...prev].slice(0, 100);
      undoStackRef.current = next;
      return next;
    });
    setRedoStack([]); redoStackRef.current = [];
    // Toast
    setToastLabel(cmd.label);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastLabel(null), 5000);
  }, []);

  const undo = useCallback(async (): Promise<UndoCommand | null> => {
    const stack = undoStackRef.current;
    if (stack.length === 0) return null;
    const cmd = stack[0];
    try {
      await cmd.undo();
    } catch (err) {
      console.error('撤销失败:', err);
      return null;
    }
    const next = stack.slice(1);
    undoStackRef.current = next;
    setUndoStack(next);
    setRedoStack(prev => { const r = [cmd, ...prev]; redoStackRef.current = r; return r; });
    setToastLabel(`已撤销: ${cmd.label}`);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastLabel(null), 3000);
    return cmd;
  }, []);

  const redo = useCallback(async (): Promise<UndoCommand | null> => {
    const stack = redoStackRef.current;
    if (stack.length === 0) return null;
    const cmd = stack[0];
    try {
      await cmd.redo();
    } catch (err) {
      console.error('重做失败:', err);
      return null;
    }
    const next = stack.slice(1);
    redoStackRef.current = next;
    setRedoStack(next);
    setUndoStack(prev => { const r = [cmd, ...prev]; undoStackRef.current = r; return r; });
    setToastLabel(`已重做: ${cmd.label}`);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastLabel(null), 3000);
    return cmd;
  }, []);

  const dismissToast = useCallback(() => {
    setToastLabel(null);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, []);

  const canUndo = undoStack.length > 0;

  // 使用 useMemo 避免 context value 每次渲染都重新创建，防止全树重渲染
  const value = useMemo(() => ({
    pushUndo, undo, redo, canUndo, toastLabel, dismissToast,
  }), [pushUndo, undo, redo, canUndo, toastLabel, dismissToast]);

  return (
    <UndoContext.Provider value={value}>
      {children}
    </UndoContext.Provider>
  );
};
