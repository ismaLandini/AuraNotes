import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRightToLine,
  ArrowUpToLine,
  Bold,
  ChevronDown,
  ChevronsDown,
  ChevronsUp,
  Code,
  CopyPlus,
  Eraser as ClearIcon,
  FileDown,
  Group,
  Highlighter,
  Home,
  ImagePlus,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Keyboard,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  ListTree,
  Lock,
  Minus,
  PenLine,
  Pilcrow,
  Quote,
  Redo2,
  RotateCcw,
  RotateCw,
  Search,
  Settings2,
  Sigma,
  SlidersHorizontal,
  SquareCode,
  Strikethrough,
  Subscript,
  Superscript,
  Table,
  TableCellsMerge,
  Trash2,
  Underline,
  Undo2,
  Ungroup,
  Unlock,
} from 'lucide-react';
import type { Editor, JSONContent } from '@tiptap/core';
import { useShallow } from 'zustand/react/shallow';
import { useActiveEditor } from '../editor/activeEditor';
import { HIGHLIGHT_COLORS, stripMathDelimiters } from '../editor/extensions';
import { unwrapMathInDoc } from '../editor/mathPaste';
import * as P from '../model/pageOps';
import { promptLink } from '../editor/EditableRichText';
import { TableMenu } from './TableMenu';
import { ParagraphPanel } from './ParagraphPanel';
import { useStore } from '../store/useStore';
import { askText, toast, useUI } from '../store/ui';
import type { CanvasItem, ConnectorItem, NoteContainerItem, TextItem } from '../types';
import {
  createTextBlock,
  deleteSelection,
  duplicateSelection,
  finishEditing,
  groupSelection,
  patchSelection,
  pickImageFiles,
  reorderSelection,
  rotateSelectedImages,
  toggleLockSelection,
  ungroupSelection,
} from '../canvas/actions';
import { insertionPoint } from '../canvas/viewport';
import { formatCombo, registerShortcuts } from '../shortcuts/registry';
import { isFreeImageContainer } from '../model/pageOps';

export const INK_COLORS = ['#1d1d1f', '#1f3a93', '#0a84ff', '#30a46c', '#e5484d', '#f76b15', '#8e4ec6', '#ffffff'];
export const TEXT_COLORS = ['#1d1d1f', '#6e6e73', '#e5484d', '#f76b15', '#c99a00', '#30a46c', '#0a84ff', '#8e4ec6'];
const STICKY_COLORS = ['#fff4b8', '#ffe0e9', '#dff3ff', '#e2f8e5', '#efe6ff', '#ffe8d1', '#f2f2f7'];
export const HL_INK = ['#ffd60a', '#9cf06b', '#7cd4ff', '#ff3b30', '#ffb35c', '#c4a6ff'];

const FONT_OPTIONS = [
  { label: 'Sistema', value: '' },
  { label: 'Serif', value: "'New York', 'Iowan Old Style', Georgia, serif" },
  { label: 'Monospazio', value: "'SF Mono', ui-monospace, Menlo, monospace" },
  { label: 'Avenir', value: "'Avenir Next', Avenir, sans-serif" },
  { label: 'Corsivo', value: "'Bradley Hand', 'Segoe Print', cursive" },
];
const PRESET_FONT_SIZES = ['6px', '7px', '8px', '9px', '10px', '11px', '13px', '15px', '17px', '20px', '24px', '30px', '36px'];

function normFont(f?: string | null): string {
  return (f ?? '').replace(/["']/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

export function applyBlockStyle(ed: Editor, style: 'p' | 1 | 2 | 3): void {
  let chain = ed.chain().focus();
  if (ed.isActive('listItem')) chain = chain.liftListItem('listItem');
  else if (ed.isActive('taskItem')) chain = chain.liftListItem('taskItem');
  if (ed.isActive('blockquote') && style !== 'p') chain = chain.unsetBlockquote();
  if (style === 'p') {
    const ok = chain.setParagraph().run();
    if (!ok) ed.chain().focus().clearNodes().run();
  } else {
    const ok = chain.setHeading({ level: style }).run();
    if (!ok) {
      ed.chain().focus().clearNodes().setHeading({ level: style }).run();
    }
  }
}

/**
 * Runs a command on the active TipTap editor, or activates/creates a text container
 * on the current page when the user clicks a top-toolbar formatting/insert button directly.
 */
export function runWithEditor(
  currentEditor: Editor | null | undefined,
  fn: (ed: Editor) => void,
  mode: 'format' | 'insert' = 'format',
): void {
  const live = currentEditor && !currentEditor.isDestroyed ? currentEditor : useActiveEditor.getState().editor;
  if (live && !live.isDestroyed) {
    fn(live);
    return;
  }
  const st = useStore.getState();
  const curPage = st.currentPage();
  if (!curPage) {
    toast('Apri o crea una pagina prima di usare questo strumento', 'error');
    return;
  }
  const selectedText = st.selection
    .map((id) => curPage.items[id])
    .find(
      (it): it is TextItem | NoteContainerItem =>
        !!it && (it.type === 'text' || it.type === 'container') && !it.locked && !isFreeImageContainer(it),
    );

  let selectExisting = false;
  let done = false;
  const unsub = useActiveEditor.subscribe((state) => {
    const mounted = state.editor;
    if (!done && mounted && !mounted.isDestroyed) {
      done = true;
      unsub();
      queueMicrotask(() => {
        if (mounted.isDestroyed) return;
        if (selectExisting) mounted.commands.selectAll();
        fn(mounted);
      });
    }
  });
  setTimeout(() => {
    if (!done) {
      done = true;
      unsub();
    }
  }, 1000);

  if (selectedText) {
    selectExisting = mode === 'format';
    st.setSelection([selectedText.id]);
    st.setEditing(selectedText.id);
  } else {
    if (st.tool !== 'select' && st.tool !== 'text') st.setTool('select');
    createTextBlock(insertionPoint(), { edit: true });
  }
}

export const ICON_SIZE = 16;
export const CHEV_SIZE = 12;

/** Keeps the editor selection when clicking toolbar controls, but allows form inputs to focus. */
export const keepFocus = (e: React.MouseEvent) => {
  const t = e.target as HTMLElement;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.closest('.paragraph-stepper-wrap'))) return;
  e.preventDefault();
};

export function Btn({
  onClick,
  active,
  title,
  children,
  disabled,
  testid,
}: {
  onClick: () => void;
  active?: boolean;
  title: string;
  children: ReactNode;
  disabled?: boolean;
  testid?: string;
}) {
  return (
    <button
      className={`rb-btn${active ? ' active' : ''}`}
      onMouseDown={keepFocus}
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      data-testid={testid}
    >
      {children}
    </button>
  );
}

function RibbonSection({
  label,
  children,
  className = '',
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`ribbon-section ${className}`} role="group" aria-label={label}>
      <div className="ribbon-section-content">{children}</div>
      <div className="ribbon-section-label">{label}</div>
    </div>
  );
}

function RibbonRow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`ribbon-row ${className}`}>{children}</div>;
}

function RibbonDivider() {
  return <div className="ribbon-divider" aria-hidden="true" />;
}

export function Popover({
  trigger,
  title,
  testid,
  disabled,
  children,
}: {
  trigger: ReactNode;
  title: string;
  testid?: string;
  disabled?: boolean;
  children: (close: () => void) => ReactNode;
}) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const open = pos !== null && !disabled;
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || popRef.current?.contains(t)) return;
      setPos(null);
    };
    document.addEventListener('pointerdown', close, true);
    const off = registerShortcuts(
      [{ id: 'popover-esc', keys: ['escape'], label: 'Chiudi', category: 'Navigazione', scope: 'global', inModal: true, hidden: true, run: () => setPos(null) }],
      { prepend: true },
    );
    return () => {
      document.removeEventListener('pointerdown', close, true);
      off();
    };
  }, [open]);
  const toggle = () => {
    if (disabled) return;
    if (open) return setPos(null);
    const r = ref.current!.getBoundingClientRect();
    setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - 300)), top: r.bottom + 6 });
  };
  return (
    <div className="popover-wrap" ref={ref}>
      <button className={`rb-btn with-chev${open ? ' active' : ''}`} onMouseDown={keepFocus} onClick={toggle} title={title} aria-label={title} aria-expanded={open} disabled={disabled} data-testid={testid}>
        {trigger}
        <ChevronDown size={CHEV_SIZE} />
      </button>
      {open &&
        pos &&
        createPortal(
          <div ref={popRef} className="popover glass-strong" style={pos} onMouseDown={keepFocus} data-ui data-keep-editing>
            {children(() => setPos(null))}
          </div>,
          document.body,
        )}
    </div>
  );
}

export function Swatches({
  colors,
  value,
  onPick,
  allowCustom = true,
  allowNone,
}: {
  colors: string[];
  value?: string | null;
  onPick: (c: string | null, isCustom?: boolean) => void;
  allowCustom?: boolean;
  allowNone?: string;
}) {
  return (
    <div className="swatches">
      {allowNone && <button className={`swatch none${!value ? ' active' : ''}`} onMouseDown={keepFocus} onClick={() => onPick(null, false)} title={allowNone} aria-label={allowNone} />}
      {colors.map((c) => (
        <button
          key={c}
          className={`swatch${value?.toLowerCase() === c.toLowerCase() ? ' active' : ''}`}
          style={{ background: c }}
          onMouseDown={keepFocus}
          onClick={() => onPick(c, false)}
          title={c}
          aria-label={`Colore ${c}`}
        />
      ))}
      {allowCustom && (
        <label className="swatch custom" title="Colore personalizzato">
          <input type="color" value={value && value.startsWith('#') && value.length === 7 ? value : '#000000'} onChange={(e) => onPick(e.target.value, true)} aria-label="Colore personalizzato" />
        </label>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------- text formatting (Word-style stacked ribbon)

function FormatBar({ editor }: { editor?: Editor | null }) {
  useActiveEditor((s) => s.tick); // re-render on every transaction
  const c = () => (editor ? editor.chain().focus() : null);
  const hasPage = useStore((s) => !!s.pageId);
  const level = editor ? ([1, 2, 3] as const).find((l) => editor.isActive('heading', { level: l })) : undefined;
  const ts = editor ? (editor.getAttributes('textStyle') as { fontSize?: string; fontFamily?: string; color?: string }) : {};
  const inTable = !!editor?.isActive('table');
  const inCode = !!editor?.isActive('codeBlock');
  const codeLang = (editor ? (editor.getAttributes('codeBlock').language as string | null) : null) ?? '';

  const insertMath = async (display: boolean) => {
    const activeEd = editor && !editor.isDestroyed ? editor : useActiveEditor.getState().editor;
    if (!activeEd || activeEd.isDestroyed) {
      const page = useStore.getState().currentPage();
      if (!page) {
        toast('Apri o crea una pagina prima di inserire un’equazione', 'error');
        return;
      }
      const latex = await askText({
        title: display ? 'Equazione (blocco)' : 'Equazione in linea',
        label: 'LaTeX',
        initial: '',
        placeholder: '\\frac{a}{b}',
        mathPreview: true,
        multiline: display,
        confirmLabel: 'Inserisci',
      });
      const clean = latex ? stripMathDelimiters(latex).trim() : '';
      if (!clean) return;
      const mathNode: JSONContent = {
        type: display ? 'mathBlock' : 'mathInline',
        attrs: { latex: clean },
      };
      const doc: JSONContent = {
        type: 'doc',
        content: display ? [mathNode, { type: 'paragraph' }] : [{ type: 'paragraph', content: [mathNode] }],
      };
      createTextBlock(insertionPoint(), { doc, edit: true });
      return;
    }

    const sel = activeEd.state.doc.textBetween(activeEd.state.selection.from, activeEd.state.selection.to, ' ');
    const latex = await askText({
      title: display ? 'Equazione (blocco)' : 'Equazione in linea',
      label: 'LaTeX',
      initial: stripMathDelimiters(sel),
      placeholder: '\\frac{a}{b}',
      mathPreview: true,
      multiline: display,
      keepEditing: true,
      confirmLabel: 'Inserisci',
    });
    const targetEd = !activeEd.isDestroyed ? activeEd : useActiveEditor.getState().editor;
    if (targetEd && !targetEd.isDestroyed) {
      const clean = latex ? stripMathDelimiters(latex).trim() : '';
      if (clean) {
        targetEd.chain().focus().insertMath(clean, display).run();
      } else {
        targetEd.commands.focus();
      }
      requestAnimationFrame(() => {
        if (!targetEd.isDestroyed) targetEd.commands.focus();
      });
    }
  };

  const unwrapMathFormatting = () => {
    const activeEd = editor && !editor.isDestroyed ? editor : useActiveEditor.getState().editor;
    if (activeEd && !activeEd.isDestroyed) {
      const ok = activeEd.chain().focus().unwrapMath().run();
      if (!ok) {
        toast('Seleziona o posiziona il cursore su un’equazione', 'info');
      }
      requestAnimationFrame(() => {
        if (!activeEd.isDestroyed) activeEd.commands.focus();
      });
      return;
    }
    const st = useStore.getState();
    const curPage = st.currentPage();
    if (!curPage || st.selection.length === 0) {
      toast('Seleziona un testo o un’equazione prima di rimuovere la formattazione matematica', 'info');
      return;
    }
    const patches: Record<string, { doc: JSONContent }> = {};
    for (const id of st.selection) {
      const it = curPage.items[id];
      if (!it || (it.type !== 'text' && it.type !== 'container')) continue;
      const { doc, changed } = unwrapMathInDoc(it.doc);
      if (changed) patches[id] = { doc };
    }
    if (Object.keys(patches).length === 0) {
      toast('Nessuna equazione trovata nella selezione', 'info');
      return;
    }
    st.updatePage((p) => P.updateItems(p, patches), true);
  };

  const insertSymbol = (sym: string) => {
    const activeEd = editor && !editor.isDestroyed ? editor : useActiveEditor.getState().editor;
    if (activeEd && !activeEd.isDestroyed) {
      activeEd.chain().focus().insertContent(sym).run();
      return;
    }
    const page = useStore.getState().currentPage();
    if (!page) {
      toast('Apri o crea una pagina prima di inserire un simbolo', 'error');
      return;
    }
    createTextBlock(insertionPoint(), {
      doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: sym }] }] },
      edit: true,
    });
  };

  const matchedFont = ts.fontFamily
    ? (FONT_OPTIONS.find((o) => o.value && normFont(o.value) === normFont(ts.fontFamily))?.value ?? ts.fontFamily)
    : '';
  const hasCustomFont = Boolean(ts.fontFamily && !FONT_OPTIONS.some((o) => o.value && normFont(o.value) === normFont(ts.fontFamily)));
  const hasCustomSize = Boolean(ts.fontSize && !PRESET_FONT_SIZES.includes(ts.fontSize));
  const noPage = !hasPage && !editor;

  return (
    <div className="format-bar" data-testid="format-bar">
      {/* 2. Carattere */}
      <RibbonSection label="Carattere">
        <RibbonRow>
          <select
            className="rb-select"
            value={matchedFont}
            onChange={(e) => {
              const val = e.target.value;
              runWithEditor(editor, (ed) => {
                if (val) ed.chain().focus().setFontFamily(val).run();
                else ed.chain().focus().unsetFontFamily().run();
              });
            }}
            aria-label="Carattere"
            title="Carattere"
            disabled={noPage}
          >
            {FONT_OPTIONS.map((opt) => (
              <option key={opt.label} value={opt.value}>
                {opt.label}
              </option>
            ))}
            {hasCustomFont && ts.fontFamily && (
              <option value={ts.fontFamily}>{ts.fontFamily.split(',')[0].replace(/["']/g, '').trim()}</option>
            )}
          </select>
          <select
            className="rb-select narrow"
            value={ts.fontSize ?? ''}
            onChange={(e) => {
              const val = e.target.value;
              runWithEditor(editor, (ed) => {
                if (val) ed.chain().focus().setFontSize(val).run();
                else ed.chain().focus().unsetFontSize().run();
              });
            }}
            aria-label="Dimensione carattere"
            title="Dimensione carattere"
            disabled={noPage}
          >
            <option value="">Auto</option>
            {PRESET_FONT_SIZES.map((s) => (
              <option key={s} value={s}>
                {parseInt(s, 10)}
              </option>
            ))}
            {hasCustomSize && ts.fontSize && (
              <option value={ts.fontSize}>{parseInt(ts.fontSize, 10) || ts.fontSize}</option>
            )}
          </select>
          <Btn
            onClick={() =>
              runWithEditor(editor, (ed) => {
                const chain = ed.chain().focus();
                if (ed.isActive('subscript')) chain.unsetSubscript();
                chain.toggleSuperscript().run();
              })
            }
            active={!!editor?.isActive('superscript')}
            title={`Apice (${formatCombo('mod+.')})`}
            disabled={noPage}
          >
            <Superscript size={ICON_SIZE} />
          </Btn>
          <Btn
            onClick={() =>
              runWithEditor(editor, (ed) => {
                const chain = ed.chain().focus();
                if (ed.isActive('superscript')) chain.unsetSuperscript();
                chain.toggleSubscript().run();
              })
            }
            active={!!editor?.isActive('subscript')}
            title={`Pedice (${formatCombo('mod+,')})`}
            disabled={noPage}
          >
            <Subscript size={ICON_SIZE} />
          </Btn>
          <Btn
            onClick={() =>
              runWithEditor(editor, (ed) => {
                ed.chain().focus().unsetAllMarks().clearNodes().resetParagraphFormat().run();
              })
            }
            title="Cancella formattazione"
            disabled={noPage}
          >
            <ClearIcon size={ICON_SIZE} />
          </Btn>
        </RibbonRow>
        <RibbonRow>
          <Btn onClick={() => runWithEditor(editor, (ed) => ed.chain().focus().toggleBold().run())} active={!!editor?.isActive('bold')} title={`Grassetto (${formatCombo('mod+b')})`} testid="fmt-bold" disabled={noPage}>
            <Bold size={ICON_SIZE} />
          </Btn>
          <Btn onClick={() => runWithEditor(editor, (ed) => ed.chain().focus().toggleItalic().run())} active={!!editor?.isActive('italic')} title={`Corsivo (${formatCombo('mod+i')})`} disabled={noPage}>
            <Italic size={ICON_SIZE} />
          </Btn>
          <Btn onClick={() => runWithEditor(editor, (ed) => ed.chain().focus().toggleUnderline().run())} active={!!editor?.isActive('underline')} title={`Sottolineato (${formatCombo('mod+u')})`} disabled={noPage}>
            <Underline size={ICON_SIZE} />
          </Btn>
          <Btn onClick={() => runWithEditor(editor, (ed) => ed.chain().focus().toggleStrike().run())} active={!!editor?.isActive('strike')} title={`Barrato (${formatCombo('mod+shift+x')})`} disabled={noPage}>
            <Strikethrough size={ICON_SIZE} />
          </Btn>
          <Popover title="Colore testo" disabled={noPage} trigger={<span className="color-a" style={{ borderColor: ts.color && ts.color.toLowerCase() !== '#1d1d1f' ? ts.color : '#67b2ff' }}>A</span>}>
            {(close) => (
              <Swatches
                colors={TEXT_COLORS}
                value={ts.color}
                allowNone="Colore predefinito"
                onPick={(col, isCustom) => {
                  runWithEditor(editor, (ed) => {
                    if (col) ed.chain().focus().setColor(col).run();
                    else ed.chain().focus().unsetColor().run();
                  });
                  if (!isCustom) close();
                }}
              />
            )}
          </Popover>
          <Popover title="Evidenziazione" disabled={noPage} trigger={<Highlighter size={ICON_SIZE} />}>
            {(close) => (
              <Swatches
                colors={HIGHLIGHT_COLORS}
                value={(editor ? (editor.getAttributes('highlight').color as string) : null) ?? null}
                allowNone="Nessuna evidenziazione"
                onPick={(col, isCustom) => {
                  runWithEditor(editor, (ed) => {
                    if (col) ed.chain().focus().setHighlight({ color: col }).run();
                    else ed.chain().focus().unsetHighlight().run();
                  });
                  if (!isCustom) close();
                }}
              />
            )}
          </Popover>
          <Btn onClick={() => runWithEditor(editor, (ed) => ed.chain().focus().toggleCode().run())} active={!!editor?.isActive('code')} title={`Codice in linea (${formatCombo('mod+e')})`} disabled={noPage}>
            <Code size={ICON_SIZE} />
          </Btn>
        </RibbonRow>
      </RibbonSection>

      <RibbonDivider />

      {/* 3. Paragrafo */}
      <RibbonSection label="Paragrafo">
        <RibbonRow>
          <select
            className="rb-select"
            value={level ? `h${level}` : 'p'}
            onChange={(e) => {
              const v = e.target.value;
              const targetStyle: 'p' | 1 | 2 | 3 = v === 'p' ? 'p' : (Number(v[1]) as 1 | 2 | 3);
              runWithEditor(editor, (ed) => applyBlockStyle(ed, targetStyle));
            }}
            aria-label="Stile paragrafo"
            title="Stile paragrafo"
            disabled={noPage}
          >
            <option value="p">Testo</option>
            <option value="h1">Titolo 1</option>
            <option value="h2">Titolo 2</option>
            <option value="h3">Titolo 3</option>
          </select>
          <Popover
            title="Allineamento"
            disabled={noPage}
            trigger={
              editor?.isActive({ textAlign: 'center' }) ? (
                <AlignCenter size={ICON_SIZE} />
              ) : editor?.isActive({ textAlign: 'right' }) ? (
                <AlignRight size={ICON_SIZE} />
              ) : editor?.isActive({ textAlign: 'justify' }) ? (
                <AlignJustify size={ICON_SIZE} />
              ) : (
                <AlignLeft size={ICON_SIZE} />
              )
            }
          >
            {(close) => (
              <div className="ribbon-group">
                <Btn onClick={() => (runWithEditor(editor, (ed) => ed.chain().focus().setTextAlign('left').run()), close())} active={!!editor?.isActive({ textAlign: 'left' })} title="Allinea a sinistra">
                  <AlignLeft size={ICON_SIZE} />
                </Btn>
                <Btn onClick={() => (runWithEditor(editor, (ed) => ed.chain().focus().setTextAlign('center').run()), close())} active={!!editor?.isActive({ textAlign: 'center' })} title="Centra">
                  <AlignCenter size={ICON_SIZE} />
                </Btn>
                <Btn onClick={() => (runWithEditor(editor, (ed) => ed.chain().focus().setTextAlign('right').run()), close())} active={!!editor?.isActive({ textAlign: 'right' })} title="Allinea a destra">
                  <AlignRight size={ICON_SIZE} />
                </Btn>
                <Btn onClick={() => (runWithEditor(editor, (ed) => ed.chain().focus().setTextAlign('justify').run()), close())} active={!!editor?.isActive({ textAlign: 'justify' })} title="Giustifica">
                  <AlignJustify size={ICON_SIZE} />
                </Btn>
              </div>
            )}
          </Popover>
          <Popover
            title="Formattazione paragrafo"
            disabled={noPage}
            trigger={
              <>
                <Pilcrow size={ICON_SIZE} />
                <span className="rb-compact-label">Paragrafo</span>
              </>
            }
          >
            {(close) => <ParagraphPanel editor={editor} close={close} />}
          </Popover>
        </RibbonRow>
        <RibbonRow>
          <Btn onClick={() => runWithEditor(editor, (ed) => ed.chain().focus().toggleBulletList().run())} active={!!editor?.isActive('bulletList')} title={`Elenco puntato (${formatCombo('mod+shift+8')})`} disabled={noPage}>
            <List size={ICON_SIZE} />
          </Btn>
          <Btn onClick={() => runWithEditor(editor, (ed) => ed.chain().focus().toggleOrderedList().run())} active={!!editor?.isActive('orderedList')} title={`Elenco numerato (${formatCombo('mod+shift+7')})`} disabled={noPage}>
            <ListOrdered size={ICON_SIZE} />
          </Btn>
          <Btn onClick={() => runWithEditor(editor, (ed) => ed.chain().focus().toggleTaskList().run())} active={!!editor?.isActive('taskList')} title={`Lista di controllo (${formatCombo('mod+shift+9')})`} disabled={noPage}>
            <ListChecks size={ICON_SIZE} />
          </Btn>
          <Btn onClick={() => runWithEditor(editor, (ed) => ed.chain().focus().outdent().run())} title="Riduci rientro (⇧⇥)" disabled={noPage}>
            <IndentDecrease size={ICON_SIZE} />
          </Btn>
          <Btn onClick={() => runWithEditor(editor, (ed) => ed.chain().focus().indent().run())} title="Aumenta rientro (⇥)" disabled={noPage}>
            <IndentIncrease size={ICON_SIZE} />
          </Btn>
          <Btn onClick={() => runWithEditor(editor, (ed) => ed.chain().focus().toggleBlockquote().run())} active={!!editor?.isActive('blockquote')} title={`Citazione (${formatCombo('mod+shift+b')} nel testo)`} disabled={noPage}>
            <Quote size={ICON_SIZE} />
          </Btn>
          <Btn onClick={() => runWithEditor(editor, (ed) => ed.chain().focus().setHorizontalRule().run(), 'insert')} title="Linea divisoria" disabled={noPage}>
            <Minus size={ICON_SIZE} />
          </Btn>
        </RibbonRow>
      </RibbonSection>

      <RibbonDivider />

      {/* 4. Inserisci */}
      <RibbonSection label="Inserisci">
        <RibbonRow>
          <Btn onClick={() => void pickImageFiles()} disabled={!hasPage} title="Inserisci immagine">
            <ImagePlus size={ICON_SIZE} />
            <span className="rb-compact-label">Immagine</span>
          </Btn>
          <Popover
            title="Tabella"
            disabled={noPage}
            trigger={
              <>
                <Table size={ICON_SIZE} />
                <span className="rb-compact-label">Tabella</span>
              </>
            }
          >
            {(close) => <TableMenu editor={editor} close={close} />}
          </Popover>
          {inTable && (
            <>
              <Btn onClick={() => c()?.addRowAfter().run()} title="Aggiungi riga sotto">
                <ArrowDownToLine size={ICON_SIZE} />
                <span className="rb-compact-label">+ Riga</span>
              </Btn>
              <Btn onClick={() => c()?.addColumnAfter().run()} title="Aggiungi colonna a destra">
                <ArrowRightToLine size={ICON_SIZE} />
                <span className="rb-compact-label">+ Col</span>
              </Btn>
              <Btn onClick={() => c()?.mergeOrSplit().run()} title="Unisci o dividi le celle">
                <TableCellsMerge size={ICON_SIZE} />
                <span className="rb-compact-label">Unisci</span>
              </Btn>
            </>
          )}
        </RibbonRow>
        <RibbonRow>
          <Popover
            title="Equazione"
            disabled={noPage}
            trigger={
              <>
                <Sigma size={ICON_SIZE} />
                <span className="rb-compact-label">Equazione</span>
              </>
            }
          >
            {(close) => (
              <div className="menu-col">
                <button className="menu-item" onClick={() => (close(), void insertMath(false))}>
                  Equazione in linea
                </button>
                <button className="menu-item" onClick={() => (close(), void insertMath(true))}>
                  Equazione a blocco
                </button>
                <button className="menu-item" onClick={() => (close(), unwrapMathFormatting())}>
                  Rimuovi formattazione matematica
                </button>
                <div className="menu-hint">Simboli rapidi</div>
                <div className="symbol-grid">
                  {['α', 'β', 'γ', 'δ', 'ε', 'θ', 'λ', 'μ', 'π', 'σ', 'φ', 'ω', 'Δ', 'Σ', 'Ω', '∞', '≈', '≠', '≤', '≥', '±', '×', '÷', '→', '⇒', '⇔', '∀', '∃', '∈', '∉', '⊂', '∪', '∩', '∫', '∂', '√', '∇', '°'].map((s) => (
                    <button
                      key={s}
                      className="sym"
                      onClick={() => {
                        if (!editor || editor.isDestroyed) close();
                        insertSymbol(s);
                      }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </Popover>
          <Btn onClick={() => runWithEditor(editor, (ed) => void promptLink(ed), 'insert')} active={!!editor?.isActive('link')} title={`Collegamento (${formatCombo('mod+k')})`} disabled={noPage}>
            <Link2 size={ICON_SIZE} />
            <span className="rb-compact-label">Link</span>
          </Btn>
          <Popover
            title="Link a pagina ([[…]])"
            disabled={noPage}
            trigger={
              <>
                <span className="wiki-bracket-icon" aria-hidden>[[</span>
                <span className="rb-compact-label">Pagina</span>
              </>
            }
          >
            {(close) => (
              <div className="menu-col" style={{ minWidth: 210, maxHeight: 260, overflowY: 'auto' }}>
                <div className="menu-hint">Collega a una pagina ([[Titolo]])</div>
                {Object.values(useStore.getState().workspace.pages)
                  .filter((p) => p.id !== useStore.getState().pageId)
                  .slice(0, 20)
                  .map((p) => (
                    <button
                      key={p.id}
                      className="menu-item"
                      onClick={() => {
                        close();
                        runWithEditor(editor, (ed) => ed.chain().focus().insertContent(`[[${p.title}]]`).run(), 'insert');
                      }}
                    >
                      {p.title}
                    </button>
                  ))}
                <button
                  className="menu-item"
                  onClick={() => {
                    close();
                    void askText({
                      title: 'Link a pagina ([[…]])',
                      label: 'Titolo della pagina da collegare (o creare al clic)',
                      initial: '',
                      placeholder: 'Es. Teorema di Bayes',
                      keepEditing: true,
                      confirmLabel: 'Inserisci',
                    }).then((title) => {
                      if (!title?.trim()) {
                        const active = useActiveEditor.getState().editor;
                        if (active && !active.isDestroyed) active.commands.focus();
                        return;
                      }
                      runWithEditor(editor, (ed) => ed.chain().focus().insertContent(`[[${title.trim()}]]`).run(), 'insert');
                    });
                  }}
                >
                  + Nuova o altra pagina…
                </button>
              </div>
            )}
          </Popover>
          <Btn onClick={() => runWithEditor(editor, (ed) => ed.chain().focus().toggleCodeBlock().run())} active={inCode} title={`Blocco di codice (${formatCombo('mod+alt+c')})`} disabled={noPage}>
            <SquareCode size={ICON_SIZE} />
            <span className="rb-compact-label">Codice</span>
          </Btn>
          {inCode && (
            <select
              className="rb-select narrow"
              value={codeLang}
              onChange={(e) => c()?.updateAttributes('codeBlock', { language: e.target.value || null }).run()}
              aria-label="Linguaggio"
              title="Linguaggio"
            >
              <option value="">Auto</option>
              {['python', 'javascript', 'typescript', 'java', 'c', 'cpp', 'sql', 'matlab', 'r', 'bash', 'json', 'xml', 'css'].map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          )}
        </RibbonRow>
      </RibbonSection>
    </div>
  );
}

// --------------------------------------------------------------------------- width slider (shared with dock tool options)

export function WidthSlider({ value, min, max, step, onChange }: { value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <label className="width-slider" title="Spessore">
      <span className="width-dot" style={{ width: Math.min(16, Math.max(3, value)), height: Math.min(16, Math.max(3, value)) }} />
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label="Spessore tratto" />
      <span className="width-val">{value}</span>
    </label>
  );
}

// --------------------------------------------------------------------------- selection actions (Word-style stacked)

function SelectionActions({ items }: { items: CanvasItem[] }) {
  const allLocked = items.every((i) => i.locked);
  const images = items.filter((i) => i.type === 'image' || isFreeImageContainer(i));
  const inked = items.filter((i) => i.type === 'stroke' || i.type === 'shape' || i.type === 'connector');
  const allHighlighters = inked.length > 0 && inked.every((i) => i.type === 'stroke' && i.tool === 'highlighter');
  const connectors = items.filter((i): i is ConnectorItem => i.type === 'connector');
  const stickies = items.filter((i) => (i.type === 'text' || i.type === 'container') && i.variant === 'sticky');
  const boxes = items.filter((i) => i.type === 'shape' && (i.kind === 'rect' || i.kind === 'ellipse'));
  const first = inked[0] as (CanvasItem & { color?: string; width?: number }) | undefined;

  return (
    <div className="format-bar" data-testid="selection-actions">
      <RibbonSection label="Selezione & Disposizione">
        <RibbonRow>
          <span className="rb-label">
            {items.length === 1 ? labelFor(items[0]) : items.every((i) => i.groupId && i.groupId === items[0].groupId) ? `Gruppo (${items.length})` : `${items.length} oggetti`}
          </span>
          <Btn onClick={duplicateSelection} title={`Duplica (${formatCombo('mod+d')})`}>
            <CopyPlus size={ICON_SIZE} />
            <span className="rb-compact-label">Duplica</span>
          </Btn>
          <Btn onClick={deleteSelection} title="Elimina (⌫)" testid="delete-selection">
            <Trash2 size={ICON_SIZE} />
            <span className="rb-compact-label">Elimina</span>
          </Btn>
          <Btn onClick={toggleLockSelection} active={allLocked} title={`${allLocked ? 'Sblocca' : 'Blocca'} (${formatCombo('mod+shift+l')})`}>
            {allLocked ? <Lock size={ICON_SIZE} /> : <Unlock size={ICON_SIZE} />}
          </Btn>
          {items.length > 1 && !items.every((i) => i.groupId && i.groupId === items[0].groupId) && (
            <Btn onClick={groupSelection} title={`Raggruppa (${formatCombo('mod+g')})`} testid="group">
              <Group size={ICON_SIZE} />
            </Btn>
          )}
          {items.some((i) => i.groupId) && (
            <Btn onClick={ungroupSelection} title={`Separa gruppo (${formatCombo('mod+shift+g')})`} testid="ungroup">
              <Ungroup size={ICON_SIZE} />
            </Btn>
          )}
        </RibbonRow>
        <RibbonRow>
          <Btn onClick={() => reorderSelection('front')} title={`Porta in primo piano (${formatCombo('mod+shift+up')})`}>
            <ChevronsUp size={ICON_SIZE} />
          </Btn>
          <Btn onClick={() => reorderSelection('forward')} title={`Porta avanti (${formatCombo('mod+up')})`}>
            <ArrowUpToLine size={ICON_SIZE} />
          </Btn>
          <Btn onClick={() => reorderSelection('backward')} title={`Porta indietro (${formatCombo('mod+down')})`}>
            <ArrowDownToLine size={ICON_SIZE} />
          </Btn>
          <Btn onClick={() => reorderSelection('back')} title={`Porta in fondo (${formatCombo('mod+shift+down')})`}>
            <ChevronsDown size={ICON_SIZE} />
          </Btn>
          {images.length > 0 && (
            <>
              <Btn onClick={() => rotateSelectedImages(-90)} title="Ruota a sinistra">
                <RotateCcw size={ICON_SIZE} />
              </Btn>
              <Btn onClick={() => rotateSelectedImages(90)} title="Ruota a destra">
                <RotateCw size={ICON_SIZE} />
              </Btn>
              <Btn onClick={() => useStore.getState().setTool('pen')} title="Annota l’immagine con la penna">
                <PenLine size={ICON_SIZE} />
                <span className="rb-compact-label">Annota</span>
              </Btn>
            </>
          )}
          {inked.length > 0 && (
            <>
              <Swatches
                colors={allHighlighters ? HL_INK : INK_COLORS}
                value={first?.color}
                onPick={(c) => c && patchSelection((it) => ('color' in it ? { color: c } : null))}
              />
              <WidthSlider
                value={first?.width ?? 2}
                min={allHighlighters ? 6 : 0.5}
                max={40}
                step={allHighlighters ? 1 : 0.5}
                onChange={(v) => patchSelection((it) => (it.type === 'stroke' || it.type === 'shape' || it.type === 'connector' ? { width: v } : null))}
              />
            </>
          )}
          {boxes.length > 0 && (
            <Swatches
              colors={['#ffe066', '#a5d8ff', '#b2f2bb', '#ffc9de']}
              value={(boxes[0] as { fill: string | null }).fill}
              allowNone="Nessun riempimento"
              allowCustom={false}
              onPick={(c) => patchSelection((it) => (it.type === 'shape' ? { fill: c } : null))}
            />
          )}
          {connectors.length > 0 && (
            <>
              <select
                className="rb-select"
                value={connectors[0].arrow}
                onChange={(e) => patchSelection((it) => (it.type === 'connector' ? { arrow: e.target.value as ConnectorItem['arrow'] } : null))}
                aria-label="Punte"
              >
                <option value="none">Senza punta</option>
                <option value="end">Freccia</option>
                <option value="both">Doppia freccia</option>
              </select>
              <select
                className="rb-select"
                value={connectors[0].layer}
                onChange={(e) => patchSelection((it) => (it.type === 'connector' ? { layer: e.target.value as ConnectorItem['layer'] } : null))}
                aria-label="Livello"
              >
                <option value="back">Dietro</option>
                <option value="front">Davanti</option>
              </select>
            </>
          )}
          {stickies.length > 0 && (
            <Swatches
              colors={STICKY_COLORS}
              value={(stickies[0] as { bg?: string }).bg}
              allowCustom={false}
              onPick={(c) => c && patchSelection((it) => ((it.type === 'text' || it.type === 'container') && it.variant === 'sticky' ? { bg: c } : null))}
            />
          )}
        </RibbonRow>
      </RibbonSection>
    </div>
  );
}

function labelFor(it: CanvasItem): string {
  switch (it.type) {
    case 'text':
    case 'container':
      if (it.type === 'container' && it.freeImage) return 'Immagine';
      return it.variant === 'sticky' ? 'Nota adesiva' : 'Contenitore note';
    case 'image':
      return 'Immagine';
    case 'stroke':
      return it.tool === 'highlighter' ? 'Evidenziatura' : 'Tratto a mano';
    case 'shape':
      return { line: 'Linea', arrow: 'Freccia', 'double-arrow': 'Doppia freccia', rect: 'Rettangolo', ellipse: 'Ellisse' }[it.kind];
    case 'connector':
      return 'Connettore';
  }
}

export function RibbonUtilities() {
  const ui = useUI();
  const hasPage = useStore((s) => !!s.pageId);

  return (
    <div className="ribbon-utilities" data-ui role="group" aria-label="Strumenti">
      <div className="ribbon-section-content">
        <Popover
          title="Strumenti"
          testid="ribbon-utilities-btn"
          trigger={<SlidersHorizontal size={18} />}
        >
          {(close) => (
            <div className="menu-col" style={{ minWidth: 220 }}>
              <button
                className="menu-item"
                onClick={() => {
                  close();
                  ui.set({ searchOpen: true });
                }}
                title={`Cerca (${formatCombo('mod+k')})`}
                aria-label="Cerca"
              >
                <Search size={ICON_SIZE} />
                <span>Cerca</span>
                <span className="menu-chev">{formatCombo('mod+k')}</span>
              </button>
              <button
                className={`menu-item${ui.outlineOpen ? ' active' : ''}`}
                onClick={() => {
                  close();
                  ui.set({ outlineOpen: !ui.outlineOpen });
                }}
                disabled={!hasPage}
                title={`Indice della pagina (${formatCombo('mod+shift+o')})`}
                aria-label="Indice della pagina"
                data-testid="toggle-outline"
              >
                <ListTree size={ICON_SIZE} />
                <span>Indice della pagina</span>
                <span className="menu-chev">{formatCombo('mod+shift+o')}</span>
              </button>
              <button
                className="menu-item"
                onClick={() => {
                  close();
                  ui.set({ exportOpen: true });
                }}
                disabled={!hasPage}
                title={`Stampa / Esporta PDF (${formatCombo('mod+p')})`}
                aria-label="Esporta PDF"
                data-testid="open-export"
              >
                <FileDown size={ICON_SIZE} />
                <span>Esporta PDF</span>
                <span className="menu-chev">{formatCombo('mod+p')}</span>
              </button>
              <button
                className="menu-item"
                onClick={() => {
                  close();
                  ui.set({ shortcutsOpen: true });
                }}
                title={`Scorciatoie (${formatCombo('mod+/')})`}
                aria-label="Scorciatoie da tastiera"
              >
                <Keyboard size={ICON_SIZE} />
                <span>Scorciatoie da tastiera</span>
                <span className="menu-chev">{formatCombo('mod+/')}</span>
              </button>
              <button
                className="menu-item"
                onClick={() => {
                  close();
                  ui.set({ settingsOpen: true });
                }}
                title="Impostazioni"
                aria-label="Impostazioni"
              >
                <Settings2 size={ICON_SIZE} />
                <span>Impostazioni</span>
              </button>
            </div>
          )}
        </Popover>
      </div>
      <div className="ribbon-section-label">Strumenti</div>
    </div>
  );
}

function RibbonModificaSection({ editor }: { editor?: Editor | null }) {
  useActiveEditor((s) => s.tick);
  const canUndoStore = useStore((s) => !!s.pageId && (s.history[s.pageId]?.past.length ?? 0) > 0);
  const canRedoStore = useStore((s) => !!s.pageId && (s.history[s.pageId]?.future.length ?? 0) > 0);
  const canUndoEditor = Boolean(editor && !editor.isDestroyed && editor.can().undo());
  const canRedoEditor = Boolean(editor && !editor.isDestroyed && editor.can().redo());
  const canUndo = canUndoEditor || canUndoStore;
  const canRedo = canRedoEditor || canRedoStore;
  const undo = () => {
    if (editor && !editor.isDestroyed && editor.can().undo()) {
      editor.chain().focus().undo().run();
      return;
    }
    const editingId = useStore.getState().editingId;
    if (editingId) finishEditing(editingId);
    useStore.getState().undo();
  };
  const redo = () => {
    if (editor && !editor.isDestroyed && editor.can().redo()) {
      editor.chain().focus().redo().run();
      return;
    }
    const editingId = useStore.getState().editingId;
    if (editingId) finishEditing(editingId);
    useStore.getState().redo();
  };
  return (
    <>
      <RibbonSection label="Modifica" className="ribbon-modifica-section">
        <RibbonRow>
          <Btn onClick={undo} title={`Annulla (${formatCombo('mod+z')})`} disabled={!canUndo}>
            <Undo2 size={ICON_SIZE} />
          </Btn>
        </RibbonRow>
        <RibbonRow>
          <Btn onClick={redo} title={`Ripeti (${formatCombo('mod+shift+z')})`} disabled={!canRedo}>
            <Redo2 size={ICON_SIZE} />
          </Btn>
        </RibbonRow>
      </RibbonSection>
      <RibbonDivider />
    </>
  );
}

function RibbonHomeSection() {
  const canGoBack = useUI((s) => s.navHistory.length > 0);
  const goHome = () => {
    const st = useStore.getState();
    if (st.editingId) finishEditing(st.editingId);
    useUI.getState().set({ homeOpen: true, homeTab: 'notebooks', homeNotebookId: null, homeSectionId: null });
  };
  const goBack = () => {
    const st = useStore.getState();
    if (st.editingId) finishEditing(st.editingId);
    void st.goBack();
  };
  return (
    <>
      <RibbonSection label="Home" className="ribbon-home-section">
        <RibbonRow>
          <Btn onClick={goHome} title="Schermata iniziale (Quaderni)" testid="ribbon-home-btn">
            <Home size={18} />
          </Btn>
        </RibbonRow>
        <RibbonRow>
          <Btn onClick={goBack} disabled={!canGoBack} title="Torna alla schermata precedente" testid="ribbon-back-btn">
            <ArrowLeft size={18} />
          </Btn>
        </RibbonRow>
      </RibbonSection>
      <RibbonDivider />
    </>
  );
}

export function Ribbon() {
  const editor = useActiveEditor((s) => s.editor);
  const editingId = useStore((s) => s.editingId);
  const tool = useStore((s) => s.tool);
  const hasPage = useStore((s) => !!s.pageId);
  const selected = useStore(
    useShallow((s) => {
      const p = s.pageId ? s.pages[s.pageId] : undefined;
      return p ? s.selection.map((id) => p.items[id]).filter(Boolean) : [];
    }),
  );
  const ref = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState({ over: false, start: true, end: false });
  useEffect(() => {
    const ribbonEl = ref.current;
    if (!ribbonEl) return;
    const el = ribbonEl.querySelector('.ribbon-tools') as HTMLElement | null;
    if (!el) return;

    const update = () =>
      setOverflow({
        over: el.scrollWidth > el.clientWidth + 2,
        start: el.scrollLeft <= 2,
        end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2,
      });

    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update, { passive: true });

    // Only horizontal trackpad swipe/scroll (deltaX) scrolls the middle sections horizontally;
    // vertical wheel/scroll NEVER scrolls the toolbar and NEVER bubbles to or moves the canvas.
    const onWheel = (e: WheelEvent) => {
      e.stopPropagation();
      e.preventDefault();
      if (el.scrollWidth > el.clientWidth && e.deltaX !== 0) {
        const mult = e.deltaMode === 1 ? 28 : (e.deltaMode === 2 ? el.clientWidth : 1);
        el.scrollLeft += e.deltaX * mult;
        update();
      }
    };

    ribbonEl.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      ro.disconnect();
      el.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      ribbonEl.removeEventListener('wheel', onWheel);
    };
  }, [editingId, tool, selected.length, hasPage]);

  let content: ReactNode;
  if (editor && editingId) {
    content = <FormatBar editor={editor} />;
  } else if (tool === 'select' && selected.length && selected[0].type !== 'text' && (selected[0].type !== 'container' || isFreeImageContainer(selected[0]))) {
    content = <SelectionActions items={selected} />;
  } else {
    content = <FormatBar editor={editor ?? null} />;
  }

  const ribbonClasses = `ribbon glass${overflow.over ? ' overflowing' : ''}${overflow.start ? ' at-start' : ''}${overflow.end ? ' at-end' : ''}`;

  if (!hasPage) {
    return (
      <div
        ref={ref}
        className={ribbonClasses}
        data-ui
        data-keep-editing
        role="toolbar"
        aria-label="Opzioni di scrittura"
      >
        <div className="ribbon-fixed-left">
          <RibbonHomeSection />
          <RibbonModificaSection editor={null} />
        </div>
        <div className="ribbon-tools">
          <FormatBar editor={null} />
        </div>
        <RibbonUtilities />
      </div>
    );
  }

  return (
    <div ref={ref} className={ribbonClasses} data-ui data-keep-editing role="toolbar" aria-label="Opzioni contestuali">
      <div className="ribbon-fixed-left">
        <RibbonHomeSection />
        <RibbonModificaSection editor={editor ?? null} />
      </div>
      <div className="ribbon-tools">
        {content}
      </div>
      <RibbonUtilities />
    </div>
  );
}
