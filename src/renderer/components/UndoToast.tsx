import React, { useEffect, useState, useRef } from 'react';

interface UndoToastProps {
  label: string | null;
  onUndo: () => void;
  onDismiss: () => void;
}

const UndoToast: React.FC<UndoToastProps> = ({ label, onUndo, onDismiss }) => {
  const [visible, setVisible] = useState(false);
  const keyRef = useRef(0);

  useEffect(() => {
    if (!label) return;
    keyRef.current++;
    setVisible(true);
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(onDismiss, 300); // 等待动画结束后关闭
    }, 5000);
    return () => clearTimeout(timer);
  }, [label]); // 每次 label 变化重新计时

  if (!label || !visible) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50" style={{ animation: 'slideUp 0.3s ease-out' }}>
      <div className="flex items-center gap-3 px-4 py-3 bg-gray-800 border border-gray-600 rounded-lg shadow-xl max-w-md">
        <span className="text-xs text-gray-300 flex-1">
          {label}
        </span>
        <button
          onClick={() => { onUndo(); setVisible(false); onDismiss(); }}
          className="text-xs font-bold text-accent-blue hover:underline transition-colors flex-shrink-0"
        >
          撤销
        </button>
        <button
          onClick={() => { setVisible(false); setTimeout(onDismiss, 300); }}
          className="text-gray-500 hover:text-gray-300 text-xs flex-shrink-0"
        >
          ✕
        </button>
      </div>
    </div>
  );
};

export default UndoToast;
