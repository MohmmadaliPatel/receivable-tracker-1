'use client';

import { EditorContent, useEditor } from '@tiptap/react';
import Highlight from '@tiptap/extension-highlight';
import Link from '@tiptap/extension-link';
import StarterKit from '@tiptap/starter-kit';
import { forwardRef, useEffect, useImperativeHandle } from 'react';

export type EmailHtmlEditorHandle = { insertAtCursor: (text: string) => void };

type Props = {
  value: string;
  onChange: (html: string) => void;
  disabled?: boolean;
  /** Extra class on outer wrapper */
  className?: string;
};

export const EmailHtmlEditor = forwardRef<EmailHtmlEditorHandle, Props>(function EmailHtmlEditor(
  { value, onChange, disabled, className = '' },
  ref
) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
      }),
      Highlight.configure({ multicolor: false }),
      Link.configure({ openOnClick: false, autolink: true, defaultProtocol: 'https' }),
    ],
    content: value,
    editable: !disabled,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          'prose prose-sm max-w-none min-h-[220px] px-3 py-2 focus:outline-none [&_a]:text-blue-700 [&_a]:underline',
      },
    },
    onUpdate: ({ editor: ed }) => {
      onChange(ed.getHTML());
    },
  });

  useImperativeHandle(
    ref,
    () => ({
      insertAtCursor: (text: string) => {
        if (!editor || disabled) return;
        editor.chain().focus().insertContent(text).run();
      },
    }),
    [editor, disabled]
  );

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!disabled);
  }, [editor, disabled]);

  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    if (value !== current) {
      editor.commands.setContent(value, { emitUpdate: false });
    }
  }, [value, editor]);

  if (!editor) {
    return <div className="h-[240px] rounded-lg border border-gray-200 bg-gray-50 animate-pulse" />;
  }

  return (
    <div className={className}>
      <div className="flex flex-wrap gap-1 border border-gray-200 border-b-0 rounded-t-xl bg-gray-50 px-2 py-1.5">
        <ToolbarBtn
          label="Bold"
          disabled={disabled}
          active={editor.isActive('bold')}
          onClick={() => editor.chain().focus().toggleBold().run()}
        />
        <ToolbarBtn
          label="Italic"
          disabled={disabled}
          active={editor.isActive('italic')}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        />
        <ToolbarBtn
          label="Highlight"
          disabled={disabled}
          active={editor.isActive('highlight')}
          onClick={() => editor.chain().focus().toggleHighlight().run()}
        />
        <span className="w-px h-6 bg-gray-200 mx-0.5 self-center" />
        <ToolbarBtn
          label="H2"
          disabled={disabled}
          active={editor.isActive('heading', { level: 2 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        />
        <ToolbarBtn
          label="Bullet list"
          disabled={disabled}
          active={editor.isActive('bulletList')}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        />
        <ToolbarBtn
          label="Ordered list"
          disabled={disabled}
          active={editor.isActive('orderedList')}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        />
      </div>
      <EditorContent editor={editor} className="rounded-b-xl border border-gray-200 bg-white overflow-auto" />
    </div>
  );
});

function ToolbarBtn({
  label,
  onClick,
  active,
  disabled,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`px-2 py-1 rounded-md text-xs font-medium border transition-colors ${
        active
          ? 'bg-neutral-900 text-white border-neutral-900'
          : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
      } disabled:opacity-50`}
    >
      {label}
    </button>
  );
}
