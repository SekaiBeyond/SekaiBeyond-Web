import { useEffect } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';

interface RichTextEditorProps {
    value: string;
    onChange: (html: string) => void;
    placeholder?: string;
    isEnglish?: boolean;
}

export function RichTextEditor({value, onChange, placeholder, isEnglish = true}: RichTextEditorProps) {
    const editor = useEditor({
        extensions: [StarterKit],
        content: value,
        // SPA-only app — TipTap's default DOM render is fine without the SSR shim.
        immediatelyRender: true,
        editorProps: {
            attributes: {
                class: 'rte-content',
                'data-placeholder': placeholder ?? '',
            },
        },
        onUpdate: ({editor: ed}) => {
            // Emit empty string for an empty doc so consumer dirty-checks work
            // — TipTap returns "<p></p>" otherwise, which looks non-empty.
            const html = ed.isEmpty ? '' : ed.getHTML();
            onChange(html);
        },
    });

    // Resync only when the external value diverges from what TipTap rendered
    // (e.g. parent toggled away to raw-HTML mode and edited it). Skipping the
    // equality check would clobber the editor on every parent re-render and
    // wreck the undo stack.
    useEffect(() => {
        if (!editor) return;
        const current = editor.isEmpty ? '' : editor.getHTML();
        if (value !== current) {
            editor.commands.setContent(value || '', {emitUpdate: false});
        }
    }, [editor, value]);

    if (!editor) return null;

    const btn = (label: string, active: boolean, onClick: () => void, title?: string) => (
        <button
            type="button"
            className={`rte-tool-btn${active ? ' rte-tool-btn-active' : ''}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={onClick}
            title={title ?? label}
        >
            {label}
        </button>
    );

    return (
        <div className="rte-wrap">
            <div className="rte-toolbar">
                {btn('B', editor.isActive('bold'),
                    () => editor.chain().focus().toggleBold().run(),
                    isEnglish ? 'Bold' : '加粗')}
                {btn('I', editor.isActive('italic'),
                    () => editor.chain().focus().toggleItalic().run(),
                    isEnglish ? 'Italic' : '斜体')}
                {btn('S', editor.isActive('strike'),
                    () => editor.chain().focus().toggleStrike().run(),
                    isEnglish ? 'Strikethrough' : '删除线')}
                <span className="rte-tool-sep"/>
                {btn('H2', editor.isActive('heading', {level: 2}),
                    () => editor.chain().focus().toggleHeading({level: 2}).run(),
                    isEnglish ? 'Heading 2' : '二级标题')}
                {btn('H3', editor.isActive('heading', {level: 3}),
                    () => editor.chain().focus().toggleHeading({level: 3}).run(),
                    isEnglish ? 'Heading 3' : '三级标题')}
                <span className="rte-tool-sep"/>
                {btn('• List', editor.isActive('bulletList'),
                    () => editor.chain().focus().toggleBulletList().run(),
                    isEnglish ? 'Bullet list' : '项目列表')}
                {btn('1. List', editor.isActive('orderedList'),
                    () => editor.chain().focus().toggleOrderedList().run(),
                    isEnglish ? 'Numbered list' : '编号列表')}
                {btn('"', editor.isActive('blockquote'),
                    () => editor.chain().focus().toggleBlockquote().run(),
                    isEnglish ? 'Quote' : '引用')}
                <span className="rte-tool-sep"/>
                {btn(isEnglish ? 'Clear' : '清除', false,
                    () => editor.chain().focus().clearNodes().unsetAllMarks().run(),
                    isEnglish ? 'Clear formatting' : '清除格式')}
                <span className="rte-tool-sep"/>
                {btn('↶', false, () => editor.chain().focus().undo().run(),
                    isEnglish ? 'Undo' : '撤销')}
                {btn('↷', false, () => editor.chain().focus().redo().run(),
                    isEnglish ? 'Redo' : '重做')}
            </div>
            <EditorContent editor={editor}/>
        </div>
    );
}
