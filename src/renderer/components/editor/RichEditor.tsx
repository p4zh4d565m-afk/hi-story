import React from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Underline from '@tiptap/extension-underline';

interface RichEditorProps {
  content?: string;
  onUpdate?: (html: string) => void;
  placeholder?: string;
  editable?: boolean;
}

const RichEditor: React.FC<RichEditorProps> = ({
  content = '',
  onUpdate,
  placeholder = '开始写作...',
  editable = true,
}) => {
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

  if (!editor) {
    return null;
  }

  return (
    <div className="h-full flex flex-col">
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
      </div>

      {/* Editor content */}
      <div className="flex-1 overflow-y-auto bg-gray-900">
        <EditorContent editor={editor} />
      </div>
    </div>
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
