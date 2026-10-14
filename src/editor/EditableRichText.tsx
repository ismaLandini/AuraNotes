import { useEffect, useRef } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import type { JSONContent } from '@tiptap/core';
import Placeholder from '@tiptap/extension-placeholder';
import { getExtensions } from './extensions';
import { pendingCaret, requestCaretAt, useActiveEditor } from './activeEditor';
import { insertImageFiles } from '../canvas/actions';
import { askText, useUI } from '../store/ui';
import { isMac } from '../shortcuts/registry';
import { registerPreFlush } from '../storage/autosave';

interface Props {
  initial: JSONContent;
  onChange: (doc: JSONContent) => void;
  /** 'escape' keeps the block selected; 'blur' means focus moved elsewhere (deselect). */
  onExit: (reason: 'escape' | 'blur') => void;
  placeholderPoint?: { x: number; y: number };
}

export async function promptLink(editor: import('@tiptap/core').Editor) {
  const prev = (editor.getAttributes('link').href as string | undefined) ?? '';
  const url = await askText({ title: 'Collegamento', label: 'Indirizzo (URL)', initial: prev, placeholder: 'https://…', confirmLabel: 'Applica' });
  if (url === null) return;
  const chain = editor.chain().focus().extendMarkRange('link');
  if (url.trim() === '') chain.unsetLink().run();
  else {
    const href = /^(https?:|mailto:|#|\/)/i.test(url.trim()) ? url.trim() : `https://${url.trim()}`;
    if (editor.state.selection.empty && !editor.isActive('link')) {
      editor.chain().focus().insertContent({ type: 'text', text: url.trim(), marks: [{ type: 'link', attrs: { href } }] }).run();
    } else chain.setLink({ href }).run();
  }
}

export function EditableRichText({ initial, onChange, onExit }: Props) {
  const changeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<JSONContent | null>(null);
  const onChangeRef = useRef(onChange);
  const onExitRef = useRef(onExit);
  /** Set once this editing session has ended, so a late blur does not end it twice. */
  const exited = useRef(false);
  onChangeRef.current = onChange;
  onExitRef.current = onExit;

  const flush = () => {
    if (changeTimer.current) clearTimeout(changeTimer.current);
    changeTimer.current = null;
    if (latest.current) {
      onChangeRef.current(latest.current);
      latest.current = null;
    }
  };

  // Saving (⌘S, autosave, closing the app) first takes the keystrokes not yet pushed to the page.
  useEffect(() => registerPreFlush(() => flush()), []); // eslint-disable-line react-hooks/exhaustive-deps

  const editor = useEditor({
    extensions: [...getExtensions(), Placeholder.configure({ placeholder: 'Scrivi qui…' })],
    content: initial,
    autofocus: false,
    editorProps: {
      attributes: { class: 'rich', spellcheck: 'true' },
      handleKeyDown: (view, event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          flush();
          exited.current = true;
          onExitRef.current('escape');
          return true;
        }
        const mod = isMac ? event.metaKey : event.ctrlKey;
        if (mod && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'k') {
          event.preventDefault();
          const ed = useActiveEditor.getState().editor;
          if (ed) void promptLink(ed);
          return true;
        }
        void view;
        return false;
      },
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
        if (files.length && !(event.clipboardData?.getData('text/plain') ?? '').trim()) {
          void insertImageFiles(files);
          return true;
        }
        return false;
      },
      handleClick: (_view, _pos, event) => {
        const a = (event.target as HTMLElement).closest('a');
        if (a && (isMac ? event.metaKey : event.ctrlKey)) {
          window.open(a.href, '_blank', 'noopener');
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: ed }) => {
      latest.current = ed.getJSON();
      if (changeTimer.current) clearTimeout(changeTimer.current);
      changeTimer.current = setTimeout(flush, 250);
    },
    onTransaction: () => {
      useActiveEditor.setState((s) => ({ tick: s.tick + 1 }));
    },
  });

  // Focus left the editor for something unrelated (sidebar, another dialog, a different
  // control): end the editing session so no stale "editing" state or outline remains.
  // Toolbars and popovers that act on the text are marked with data-keep-editing.
  useEffect(() => {
    if (!editor) return;
    const onBlur = () => {
      setTimeout(() => {
        if (editor.isDestroyed || exited.current) return;
        const a = document.activeElement as HTMLElement | null;
        if (a && editor.view.dom.contains(a)) return;
        if (a?.closest?.('[data-keep-editing]')) return;
        if (useUI.getState().prompt) return; // equation / link dialog working on this text
        if (!document.hasFocus()) return; // switching to another app keeps the session
        flush();
        exited.current = true;
        onExitRef.current('blur');
      }, 0);
    };
    editor.on('blur', onBlur);
    return () => {
      editor.off('blur', onBlur);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    useActiveEditor.getState().set(editor);
    // Focus synchronously (keys typed right after creating a block must reach the editor),
    // placing the caret where the user clicked, otherwise at the end.
    let placed = false;
    if (pendingCaret.x !== null && pendingCaret.y !== null) {
      try {
        const pos = editor.view.posAtCoords({ left: pendingCaret.x, top: pendingCaret.y });
        if (pos) {
          editor.commands.focus(pos.pos);
          placed = true;
        }
      } catch {
        /* view not measurable yet */
      }
    }
    if (!placed) editor.commands.focus('end');
    requestCaretAt(null, null);
    return () => {
      flush();
      if (useActiveEditor.getState().editor === editor) useActiveEditor.getState().set(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  return <EditorContent editor={editor} className="editor-host" />;
}
