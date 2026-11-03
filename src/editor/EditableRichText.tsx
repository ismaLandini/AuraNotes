import { useEffect, useRef } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import type { JSONContent } from '@tiptap/core';
import { Selection } from 'prosemirror-state';
import Placeholder from '@tiptap/extension-placeholder';
import { getExtensions } from './extensions';
import { pendingCaret, pendingFocusTarget, requestCaretAt, useActiveEditor } from './activeEditor';
import { importImageBlob } from '../storage/assets';
import { askText, useUI } from '../store/ui';
import { isMac } from '../shortcuts/registry';
import { registerPreFlush } from '../storage/autosave';
import { useStore } from '../store/useStore';
import { moveImageIntoContainer } from '../model/pageOps';
import { openPdfImportDialog } from '../components/PdfImportDialog';
import { isPdfFile } from '../canvas/actions';

interface Props {
  id?: string;
  initial: JSONContent;
  onChange: (doc: JSONContent) => void;
  /** 'escape' keeps the block selected; 'blur' means focus moved elsewhere; 'undo' means undo/redo triggered. */
  onExit: (reason: 'escape' | 'blur' | 'undo') => void;
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

export function EditableRichText({ id, initial, onChange, onExit }: Props) {
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
        if (mod && !event.altKey && (event.key.toLowerCase() === 'z' || (!isMac && event.key.toLowerCase() === 'y'))) {
          const isRedo = event.shiftKey || (!isMac && event.key.toLowerCase() === 'y');
          const ed = useActiveEditor.getState().editor;
          if (ed) {
            if (!isRedo) {
              if (ed.can().undo()) return false;
              event.preventDefault();
              flush();
              exited.current = true;
              onExitRef.current('undo');
              useStore.getState().undo();
              return true;
            } else {
              if (ed.can().redo()) return false;
              event.preventDefault();
              flush();
              exited.current = true;
              onExitRef.current('undo');
              useStore.getState().redo();
              return true;
            }
          }
        }
        void view;
        return false;
      },
      handlePaste: (view, event) => {
        const allFiles = Array.from(event.clipboardData?.files ?? []);
        const pdfFiles = allFiles.filter((f) => isPdfFile(f));
        if (pdfFiles.length > 0) {
          event.preventDefault();
          flush();
          openPdfImportDialog(pdfFiles[0], { containerId: id });
          return true;
        }
        const files = allFiles.filter((f) => f.type.startsWith('image/'));
        if (files.length && !(event.clipboardData?.getData('text/plain') ?? '').trim()) {
          event.preventDefault();
          void (async () => {
            const containerW = view.dom.clientWidth || 500;
            const maxW = Math.min(1850, Math.max(100, containerW - 24));
            for (const file of files) {
              const img = await importImageBlob(file);
              const scale = Math.min(1, maxW / img.width);
              const width = Math.max(80, Math.round(img.width * scale));
              const ed = useActiveEditor.getState().editor;
              if (ed && !ed.isDestroyed) {
                ed.chain().focus().setImageBlock({
                  assetId: img.assetId,
                  width,
                  naturalWidth: img.width,
                  naturalHeight: img.height,
                  mime: img.mime,
                  rotation: 0,
                  indent: 0,
                }).run();
              }
            }
          })();
          return true;
        }
        return false;
      },
      handleDrop: (view, event) => {
        const customData = event.dataTransfer?.getData('application/x-glassnote-image-block');
        if (customData) {
          try {
            const payload = JSON.parse(customData);
            if (payload?.attrs && id && payload.containerId && payload.containerId !== id) {
              event.preventDefault();
              const coords = { left: event.clientX, top: event.clientY };
              const dropPos = view.posAtCoords(coords);
              const insertIndex = dropPos ? view.state.doc.resolve(dropPos.pos).index(0) : undefined;
              useStore.getState().updatePage((cur) => {
                return moveImageIntoContainer(cur, payload.containerId, id, payload.attrs, insertIndex);
              });
              return true;
            }
          } catch (err) {
            console.error('Failed to parse dropped image block', err);
          }
        }

        const allDropped = Array.from(event.dataTransfer?.files ?? []);
        const pdfFiles = allDropped.filter((f) => isPdfFile(f));
        if (pdfFiles.length > 0) {
          event.preventDefault();
          const coords = { left: event.clientX, top: event.clientY };
          const dropPos = view.posAtCoords(coords);
          const insertIndex = dropPos ? view.state.doc.resolve(dropPos.pos).index(0) : undefined;
          flush();
          openPdfImportDialog(pdfFiles[0], { containerId: id, insertIndex });
          return true;
        }

        const files = allDropped.filter((f) => f.type.startsWith('image/'));
        if (files.length) {
          event.preventDefault();
          const coords = { left: event.clientX, top: event.clientY };
          const dropPos = view.posAtCoords(coords);
          void (async () => {
            const containerW = view.dom.clientWidth || 500;
            const maxW = Math.min(1850, Math.max(100, containerW - 24));
            for (const file of files) {
              const img = await importImageBlob(file);
              const scale = Math.min(1, maxW / img.width);
              const width = Math.max(80, Math.round(img.width * scale));
              const ed = useActiveEditor.getState().editor;
              if (ed && !ed.isDestroyed) {
                const chain = ed.chain().focus();
                if (dropPos) {
                  chain.insertContentAt(dropPos.pos, {
                    type: 'imageBlock',
                    attrs: {
                      assetId: img.assetId,
                      width,
                      naturalWidth: img.width,
                      naturalHeight: img.height,
                      mime: img.mime,
                      rotation: 0,
                      indent: 0,
                    },
                  }).run();
                } else {
                  chain.setImageBlock({
                    assetId: img.assetId,
                    width,
                    naturalWidth: img.width,
                    naturalHeight: img.height,
                    mime: img.mime,
                    rotation: 0,
                    indent: 0,
                  }).run();
                }
              }
            }
          })();
          return true;
        }
        return false;
      },
      handleClick: (_view, _pos, event) => {
        const wiki = (event.target as HTMLElement).closest('[data-wiki-link]');
        if (wiki && (isMac ? event.metaKey : event.ctrlKey)) {
          const target = wiki.getAttribute('data-wiki-link') ?? '';
          if (target) {
            flush();
            exited.current = true;
            onExitRef.current('blur');
            void useStore.getState().navigateWikiLink(target);
            return true;
          }
        }
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
    (editor.storage as Record<string, unknown>).containerId = id;
    useActiveEditor.getState().set(editor);
    // Focus synchronously (keys typed right after creating a block must reach the editor),
    // placing the caret where the user clicked, otherwise at the end.
    let placed = false;
    if (pendingFocusTarget.afterAssetId) {
      const targetAssetId = pendingFocusTarget.afterAssetId;
      pendingFocusTarget.afterAssetId = null;
      let targetPos: number | null = null;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'imageBlock' && node.attrs.assetId === targetAssetId) {
          targetPos = pos + node.nodeSize;
          return false;
        }
      });
      if (targetPos !== null) {
        try {
          const $pos = editor.state.doc.resolve(targetPos);
          const sel = Selection.near($pos, 1);
          if (sel) {
            editor.view.dispatch(editor.state.tr.setSelection(sel));
            editor.view.focus();
          } else {
            editor.commands.focus('end');
          }
        } catch {
          editor.commands.focus('end');
        }
        placed = true;
      }
    } else if (pendingCaret.x !== null && pendingCaret.y !== null) {
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
