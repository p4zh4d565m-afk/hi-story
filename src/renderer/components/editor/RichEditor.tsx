import React, { useCallback, useState, useEffect, forwardRef, useImperativeHandle } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Underline from '@tiptap/extension-underline';

/** 文本选区范围（ProseMirror 文档坐标） */
export interface TextRange {
  from: number;
  to: number;
}

/** RichEditor 对外暴露的命令句柄 */
export interface RichEditorHandle {
  /** 整章替换内容（触发 onUpdate 走自动保存） */
  setContent: (html: string) => void;
  /** 替换指定选区文本 */
  replaceSelection: (range: TextRange, html: string) => void;
}

interface ContextMenuState {
  open: boolean;
  x: number;
  y: number;
  selectedText: string;
  /** 选中文本在文档中的坐标范围，用于润色后回填 */
  range?: TextRange;
}

interface RichEditorProps {
  content?: string;
  onUpdate?: (html: string) => void;
  placeholder?: string;
  editable?: boolean;
  /** Called when user wants to search selected text in inspiration panel */
  onSearchInInspiration?: (text: string) => void;
  /** Called when user wants to search selected text in reference panel via AI ranking */
  onSearchInReference?: (text: string) => void;
  /** Called when user wants AI to polish selected text（附选区范围，用于回填） */
  onAIPolish?: (text: string, range?: TextRange) => void;
  /** Called when user wants AI to continue writing from context */
  onAIContinue?: () => void;
  /** 编辑器字号预设: 0=小 1=中 2=大 3=特大 */
  fontSizePreset?: 0 | 1 | 2 | 3;
  /** 编辑器字号变更回调 */
  onSetFontSize?: (preset: 0 | 1 | 2 | 3) => void;
}

/** 字号 CSS 类映射 */
const FONT_SIZE_CLASSES = ['prose-font-s', 'prose-font-m', 'prose-font-l', 'prose-font-xl'] as const;
const FONT_SIZE_LABELS = ['小 14px', '中 16px', '大 18px', '特大 20px'];

const RichEditor = forwardRef<RichEditorHandle, RichEditorProps>(({
  content = '',
  onUpdate,
  placeholder = '开始写作...',
  editable = true,
  onSearchInInspiration,
  onSearchInReference,
  onAIPolish,
  onAIContinue,
  fontSizePreset = 1,
  onSetFontSize,
}, ref) => {
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
        class: `prose prose-invert max-w-none focus:outline-none min-h-[200px] px-8 py-6 ${FONT_SIZE_CLASSES[fontSizePreset]}`,
      },
    },
  });
  // 编辑器创建后不再重建，但 fontSizePreset 变化时需更新 attributes.class
  const fontSizeClass = FONT_SIZE_CLASSES[fontSizePreset];
  useEffect(() => {
    if (!editor) return;
    const el = editor.view.dom;
    // 移除旧的字号类，添加新的
    el.classList.remove(...FONT_SIZE_CLASSES);
    el.classList.add(fontSizeClass);
  }, [editor, fontSizeClass]);

  // 对外暴露整章替换 / 选区替换命令（供润色写回使用）
  useImperativeHandle(ref, () => ({
    setContent: (html: string) => {
      editor?.commands.setContent(html, { emitUpdate: true });
    },
    replaceSelection: (range: TextRange, html: string) => {
      editor?.chain().focus().setTextSelection({ from: range.from, to: range.to }).deleteSelection().insertContent(html).run();
    },
  }), [editor]);

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
    if (text && editor) {
      e.preventDefault();
      // 捕获 ProseMirror 选区坐标，用于润色后精准回填
      const { from, to } = editor.state.selection;
      const range = to > from ? { from, to } : undefined;
      setContextMenu({
        open: true,
        x: e.clientX,
        y: e.clientY,
        selectedText: text,
        range,
      });
    }
  }, [editor]);

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
              onSearchInReference?.(contextMenu.selectedText);
            }}
            className="w-full px-3 py-2 text-left text-xs text-gray-300 hover:bg-gray-700 flex items-center gap-2 transition-colors"
          >
            🔍 检索相似句
          </button>
          <button
            onClick={() => {
              handleCloseContextMenu();
              onAIPolish?.(contextMenu.selectedText, contextMenu.range);
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
      <div className="flex items-center gap-0.5 px-4 py-2 border-b border-editor-700 bg-editor-800 flex-wrap">
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
          className="px-2 py-1 rounded text-[10px] text-gray-400 hover:bg-editor-700 hover:text-gray-100 transition-colors flex items-center gap-1"
          title="智能排版 — 自动按段落整理内容"
        >
          📐 排版
        </button>
        <Divider />
        {/* 编辑器字号选择 */}
        <select
          value={fontSizePreset}
          onChange={(e) => onSetFontSize?.(Number(e.target.value) as 0|1|2|3)}
          className="bg-editor-700 border border-editor-600 rounded text-[10px] text-gray-400 px-1.5 py-1 focus:outline-none focus:border-accent cursor-pointer"
          title="编辑器字号"
        >
          {FONT_SIZE_LABELS.map((label, i) => (
            <option key={i} value={i}>{label}</option>
          ))}
        </select>
      </div>

      {/* Editor content */}
      <div className="flex-1 overflow-y-auto bg-editor-900" onContextMenu={handleEditorContextMenu}>
        <EditorContent editor={editor} />
      </div>
    </div>
    </>
  );
});

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
      ${active ? 'bg-accent text-white' : 'text-gray-400 hover:bg-editor-700 hover:text-gray-100'}
      ${italic ? 'italic' : ''}
      ${underline ? 'underline' : ''}
    `}
  >
    {label}
  </button>
);

const Divider: React.FC = () => (
  <div className="w-px h-5 bg-editor-700 mx-1" />
);

export default RichEditor;
