import React, { useCallback, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Underline from '@tiptap/extension-underline';

interface ContextMenuState {
  open: boolean;
  x: number;
  y: number;
  selectedText: string;
}

interface RichEditorProps {
  content?: string;
  onUpdate?: (html: string) => void;
  placeholder?: string;
  editable?: boolean;
  /** Called when user wants to search selected text in inspiration panel */
  onSearchInInspiration?: (text: string) => void;
  /** Called when user wants AI to polish selected text */
  onAIPolish?: (text: string) => void;
  /** Called when user wants AI to continue writing from context */
  onAIContinue?: () => void;
}

const RichEditor: React.FC<RichEditorProps> = ({
  content = '',
  onUpdate,
  placeholder = '开始写作...',
  editable = true,
  onSearchInInspiration,
  onAIPolish,
  onAIContinue,
}) => {
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ open: false, x: 0, y: 0, selectedText: '' });
  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Placeholder.configure({
        placeholder,
      }),
    ],
    content,
    editable,
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      onUpdate?.(html);
    },
    editorProps: {
      attributes: {
        class: 'prose prose-invert max-w-none focus:outline-none min-h-[200px] px-8 py-6',
      },
    },
  });

  // ===== Smart formatting =====
  const handleSmartFormat = useCallback(() => {
    if (!editor) return;

    const doc = editor.state.doc;
    if (doc.childCount === 0) return;

    // Collect each direct child of the doc that is a block with non-empty text
    const paragraphs: string[] = [];
    doc.forEach((node) => {
      if (!node.isBlock) return;

      // Collect all text from this block node (handles inline marks like bold, italic)
      let text = '';
      node.descendants((child) => {
        if (child.isText) {
          text += child.text || '';
          return false;
        }
        if (child.type.name === 'hard_break') {
          // hard_break = Shift+Enter → treat as paragraph boundary
          const trimmed = text
            .replace(/^[　\s]+|[　\s]+$/g, '')  // trim full-width + ASCII whitespace
            .replace(/[　\s]+/g, ' ');           // collapse internal whitespace
          if (trimmed) paragraphs.push(trimmed);
          text = '';
          return false;
        }
        return true;
      });

      // Push remaining text from this block node
      const trimmed = text
        .replace(/^[　\s]+|[　\s]+$/g, '')
        .replace(/[　\s]+/g, ' ');
      if (trimmed) paragraphs.push(trimmed);
    });

    if (paragraphs.length === 0) return;

    const formattedHtml = paragraphs
      .map(p => `<p>${p}</p>`)
      .join('');

    editor.commands.setContent(formattedHtml, { emitUpdate: true });
  }, [editor]);

  // Handle right-click context menu on the editor container
  const handleEditorContextMenu = useCallback((e: React.MouseEvent) => {
    const selection = window.getSelection();
    const text = selection?.toString().trim() || '';
    if (text) {
      e.preventDefault();
      setContextMenu({
        open: true,
        x: e.clientX,
        y: e.clientY,
        selectedText: text,
      });
    }
  }, []);

  if (!editor) {
    return null;
  }

  // Close context menu when clicking elsewhere
  const handleCloseContextMenu = useCallback(() => {
    setContextMenu({ open: false, x: 0, y: 0, selectedText: '' });
  }, []);

  // Keyboard shortcut: Ctrl+Shift+J for AI continue
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'J') {
      e.preventDefault();
      onAIContinue?.();
    }
  }, [onAIContinue]);

  return (
    <>
      {/* Click-away backdrop for context menu */}
      {contextMenu.open && (
        <div className="fixed inset-0 z-50" onClick={handleCloseContextMenu} onContextMenu={(e) => { e.preventDefault(); handleCloseContextMenu(); }} />
      )}

      {/* Custom context menu */}
      {contextMenu.open && (
        <div
          className="fixed z-[100] w-56 bg-gray-800 border border-gray-600 rounded-lg shadow-2xl py-1.5 overflow-hidden"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <div className="px-3 py-1.5 text-[10px] text-gray-500 border-b border-gray-700 truncate">
            "{contextMenu.selectedText.slice(0, 30)}{contextMenu.selectedText.length > 30 ? '…' : ''}"
          </div>
          <button
            onClick={() => {
              handleCloseContextMenu();
              onSearchInInspiration?.(contextMenu.selectedText);
            }}
            className="w-full px-3 py-2 text-left text-xs text-gray-300 hover:bg-gray-700 flex items-center gap-2 transition-colors"
          >
            🔍 在灵感库中搜索
          </button>
          <button
            onClick={() => {
              handleCloseContextMenu();
              onAIPolish?.(contextMenu.selectedText);
            }}
            className="w-full px-3 py-2 text-left text-xs text-gray-300 hover:bg-gray-700 flex items-center gap-2 transition-colors"
          >
            ✨ AI 润色
          </button>
          <button
            onClick={() => {
              handleCloseContextMenu();
              onAIContinue?.();
            }}
            className="w-full px-3 py-2 text-left text-xs text-gray-300 hover:bg-gray-700 flex items-center gap-2 transition-colors"
          >
            🤖 AI 续写
          </button>
        </div>
      )}

      <div className="h-full flex flex-col" onKeyDown={handleKeyDown}>
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 px-4 py-2 border-b border-gray-700 bg-gray-800 flex-wrap">
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          active={editor.isActive('bold')}
          label="B"
          title="粗体 (Ctrl+B)"
        />
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          active={editor.isActive('italic')}
          label="I"
          title="斜体 (Ctrl+I)"
          italic
        />
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          active={editor.isActive('underline')}
          label="U"
          title="下划线 (Ctrl+U)"
          underline
        />
        <Divider />
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          active={editor.isActive('heading', { level: 1 })}
          label="H1"
          title="标题 1"
        />
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          active={editor.isActive('heading', { level: 2 })}
          label="H2"
          title="标题 2"
        />
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          active={editor.isActive('heading', { level: 3 })}
          label="H3"
          title="标题 3"
        />
        <Divider />
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          active={editor.isActive('bulletList')}
          label="•"
          title="无序列表"
        />
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          active={editor.isActive('orderedList')}
          label="1."
          title="有序列表"
        />
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          active={editor.isActive('blockquote')}
          label="❝"
          title="引用"
        />
        <Divider />
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          active={editor.isActive('codeBlock')}
          label="&lt;/&gt;"
          title="代码块"
        />
        <ToolbarButton
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          label="—"
          title="分隔线"
        />
        <Divider />
        <button
          onClick={handleSmartFormat}
          className="px-2 py-1 rounded text-[10px] text-gray-400 hover:bg-gray-700 hover:text-white transition-colors flex items-center gap-1"
          title="智能排版 — 自动按段落整理内容"
        >
          📐 排版
        </button>
      </div>

      {/* Editor content */}
      <div className="flex-1 overflow-y-auto bg-gray-900" onContextMenu={handleEditorContextMenu}>
        <EditorContent editor={editor} />
      </div>
    </div>
    </>
  );
};

// --- Toolbar sub-components ---

const ToolbarButton: React.FC<{
  onClick: () => void;
  active?: boolean;
  label: string;
  title: string;
  italic?: boolean;
  underline?: boolean;
}> = ({ onClick, active, label, title, italic, underline }) => (
  <button
    onClick={onClick}
    title={title}
    className={`
      w-8 h-8 rounded text-sm flex items-center justify-center transition-colors
      ${active ? 'bg-accent text-white' : 'text-gray-400 hover:bg-gray-700 hover:text-white'}
      ${italic ? 'italic' : ''}
      ${underline ? 'underline' : ''}
    `}
  >
    {label}
  </button>
);

const Divider: React.FC = () => (
  <div className="w-px h-5 bg-gray-700 mx-1" />
);

export default RichEditor;
