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
import { useSettings } from '../store/settings';
import { askText, toast, useUI } from '../store/ui';
import type { CanvasItem, ConnectorItem, Tool } from '../types';
import {
  createTextBlock,
  deleteSelection,
  duplicateSelection,
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
const HL_INK = ['#ffd60a', '#9cf06b', '#7cd4ff', '#ff8fb8', '#ffb35c', '#c4a6ff'];

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

export function Popover({ trigger, title, testid, children }: { trigger: ReactNode; title: string; testid?: string; children: (close: () => void) => ReactNode }) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const open = pos !== null;
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
    if (open) return setPos(null);
    const r = ref.current!.getBoundingClientRect();
    setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - 300)), top: r.bottom + 6 });
  };
  return (
    <div className="popover-wrap" ref={ref}>
      <button className={`rb-btn with-chev${open ? ' active' : ''}`} onMouseDown={keepFocus} onClick={toggle} title={title} aria-label={title} aria-expanded={open} data-testid={testid}>
        {trigger}
        <ChevronDown size={CHEV_SIZE} />
      </button>
      {pos &&
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
  onPick: (c: string | null) => void;
  allowCustom?: boolean;
  allowNone?: string;
}) {
  return (
    <div className="swatches">
      {allowNone && <button className={`swatch none${!value ? ' active' : ''}`} onMouseDown={keepFocus} onClick={() => onPick(null)} title={allowNone} aria-label={allowNone} />}
      {colors.map((c) => (
        <button
          key={c}
          className={`swatch${value?.toLowerCase() === c.toLowerCase() ? ' active' : ''}`}
          style={{ background: c }}
          onMouseDown={keepFocus}
          onClick={() => onPick(c)}
          title={c}
          aria-label={`Colore ${c}`}
        />
      ))}
      {allowCustom && (
        <label className="swatch custom" title="Colore personalizzato">
          <input type="color" value={value && value.startsWith('#') && value.length === 7 ? value : '#000000'} onChange={(e) => onPick(e.target.value)} aria-label="Colore personalizzato" />
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

  return (
    <div className="format-bar" data-testid="format-bar">
      {/* 2. Carattere */}
      <RibbonSection label="Carattere">
        <RibbonRow>
          <select
            className="rb-select"
            value={ts.fontFamily ?? ''}
            onChange={(e) => (e.target.value ? c()?.setFontFamily(e.target.value).run() : c()?.unsetFontFamily().run())}
            aria-label="Carattere"
            title="Carattere"
            disabled={!editor}
          >
            <option value="">Sistema</option>
            <option value="'New York', 'Iowan Old Style', Georgia, serif">Serif</option>
            <option value="'SF Mono', ui-monospace, Menlo, monospace">Monospazio</option>
            <option value="'Avenir Next', Avenir, sans-serif">Avenir</option>
            <option value="'Bradley Hand', 'Segoe Print', cursive">Corsivo</option>
          </select>
          <select
            className="rb-select narrow"
            value={ts.fontSize ?? ''}
            onChange={(e) => (e.target.value ? c()?.setFontSize(e.target.value).run() : c()?.unsetFontSize().run())}
            aria-label="Dimensione carattere"
            title="Dimensione carattere"
            disabled={!editor}
          >
            <option value="">Auto</option>
            {['11px', '13px', '15px', '17px', '20px', '24px', '30px', '36px'].map((s) => (
              <option key={s} value={s}>
                {parseInt(s, 10)}
              </option>
            ))}
          </select>
          <Btn onClick={() => c()?.toggleSuperscript().run()} active={!!editor?.isActive('superscript')} title={`Apice (${formatCombo('mod+.')})`} disabled={!editor}>
            <Superscript size={ICON_SIZE} />
          </Btn>
          <Btn onClick={() => c()?.toggleSubscript().run()} active={!!editor?.isActive('subscript')} title={`Pedice (${formatCombo('mod+,')})`} disabled={!editor}>
            <Subscript size={ICON_SIZE} />
          </Btn>
          <Btn onClick={() => c()?.unsetAllMarks().clearNodes().run()} title="Cancella formattazione" disabled={!editor}>
            <ClearIcon size={ICON_SIZE} />
          </Btn>
        </RibbonRow>
        <RibbonRow>
          <Btn onClick={() => c()?.toggleBold().run()} active={!!editor?.isActive('bold')} title={`Grassetto (${formatCombo('mod+b')})`} testid="fmt-bold" disabled={!editor}>
            <Bold size={ICON_SIZE} />
          </Btn>
          <Btn onClick={() => c()?.toggleItalic().run()} active={!!editor?.isActive('italic')} title={`Corsivo (${formatCombo('mod+i')})`} disabled={!editor}>
            <Italic size={ICON_SIZE} />
          </Btn>
          <Btn onClick={() => c()?.toggleUnderline().run()} active={!!editor?.isActive('underline')} title={`Sottolineato (${formatCombo('mod+u')})`} disabled={!editor}>
            <Underline size={ICON_SIZE} />
          </Btn>
          <Btn onClick={() => c()?.toggleStrike().run()} active={!!editor?.isActive('strike')} title={`Barrato (${formatCombo('mod+shift+x')})`} disabled={!editor}>
            <Strikethrough size={ICON_SIZE} />
          </Btn>
          <Popover title="Colore testo" trigger={<span className="color-a" style={{ borderColor: ts.color && ts.color.toLowerCase() !== '#1d1d1f' ? ts.color : '#67b2ff' }}>A</span>}>
            {(close) => (
              <Swatches
                colors={TEXT_COLORS}
                value={ts.color}
                allowNone="Colore predefinito"
                onPick={(col) => {
                  if (col) c()?.setColor(col).run();
                  else c()?.unsetColor().run();
                  close();
                }}
              />
            )}
          </Popover>
          <Popover title="Evidenziazione" trigger={<Highlighter size={ICON_SIZE} />}>
            {(close) => (
              <Swatches
                colors={HIGHLIGHT_COLORS}
                value={(editor ? (editor.getAttributes('highlight').color as string) : null) ?? null}
                allowNone="Nessuna evidenziazione"
                onPick={(col) => {
                  if (col) c()?.setHighlight({ color: col }).run();
                  else c()?.unsetHighlight().run();
                  close();
                }}
              />
            )}
          </Popover>
          <Btn onClick={() => c()?.toggleCode().run()} active={!!editor?.isActive('code')} title={`Codice in linea (${formatCombo('mod+e')})`} disabled={!editor}>
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
              if (v === 'p') c()?.setParagraph().run();
              else c()?.setHeading({ level: Number(v[1]) as 1 | 2 | 3 }).run();
            }}
            aria-label="Stile paragrafo"
            title="Stile paragrafo"
            disabled={!editor}
          >
            <option value="p">Testo</option>
            <option value="h1">Titolo 1</option>
            <option value="h2">Titolo 2</option>
            <option value="h3">Titolo 3</option>
          </select>
          <Popover
            title="Allineamento"
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
                <Btn onClick={() => (c()?.setTextAlign('left').run(), close())} active={!!editor?.isActive({ textAlign: 'left' })} title="Allinea a sinistra">
                  <AlignLeft size={ICON_SIZE} />
                </Btn>
                <Btn onClick={() => (c()?.setTextAlign('center').run(), close())} active={!!editor?.isActive({ textAlign: 'center' })} title="Centra">
                  <AlignCenter size={ICON_SIZE} />
                </Btn>
                <Btn onClick={() => (c()?.setTextAlign('right').run(), close())} active={!!editor?.isActive({ textAlign: 'right' })} title="Allinea a destra">
                  <AlignRight size={ICON_SIZE} />
                </Btn>
                <Btn onClick={() => (c()?.setTextAlign('justify').run(), close())} active={!!editor?.isActive({ textAlign: 'justify' })} title="Giustifica">
                  <AlignJustify size={ICON_SIZE} />
                </Btn>
              </div>
            )}
          </Popover>
          <Popover
            title="Formattazione paragrafo"
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
          <Btn onClick={() => c()?.toggleBulletList().run()} active={!!editor?.isActive('bulletList')} title={`Elenco puntato (${formatCombo('mod+shift+8')})`} disabled={!editor}>
            <List size={ICON_SIZE} />
          </Btn>
          <Btn onClick={() => c()?.toggleOrderedList().run()} active={!!editor?.isActive('orderedList')} title={`Elenco numerato (${formatCombo('mod+shift+7')})`} disabled={!editor}>
            <ListOrdered size={ICON_SIZE} />
          </Btn>
          <Btn onClick={() => c()?.toggleTaskList().run()} active={!!editor?.isActive('taskList')} title={`Lista di controllo (${formatCombo('mod+shift+9')})`} disabled={!editor}>
            <ListChecks size={ICON_SIZE} />
          </Btn>
          <Btn onClick={() => c()?.outdent().run()} title="Riduci rientro (⇧⇥)" disabled={!editor}>
            <IndentDecrease size={ICON_SIZE} />
          </Btn>
          <Btn onClick={() => c()?.indent().run()} title="Aumenta rientro (⇥)" disabled={!editor}>
            <IndentIncrease size={ICON_SIZE} />
          </Btn>
          <Btn onClick={() => c()?.toggleBlockquote().run()} active={!!editor?.isActive('blockquote')} title={`Citazione (${formatCombo('mod+shift+b')} nel testo)`} disabled={!editor}>
            <Quote size={ICON_SIZE} />
          </Btn>
          <Btn onClick={() => c()?.setHorizontalRule().run()} title="Linea divisoria" disabled={!editor}>
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
          <Btn onClick={() => editor && void promptLink(editor)} active={!!editor?.isActive('link')} title={`Collegamento (${formatCombo('mod+k')})`} disabled={!editor}>
            <Link2 size={ICON_SIZE} />
            <span className="rb-compact-label">Link</span>
          </Btn>
          <Popover
            title="Link a pagina ([[…]])"
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
                      disabled={!editor}
                      onClick={() => {
                        close();
                        c()?.insertContent(`[[${p.title}]]`).run();
                      }}
                    >
                      {p.title}
                    </button>
                  ))}
                <button
                  className="menu-item"
                  disabled={!editor}
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
                      const active = useActiveEditor.getState().editor;
                      if (!active || active.isDestroyed) return;
                      if (title?.trim()) {
                        active.chain().focus().insertContent(`[[${title.trim()}]]`).run();
                      } else {
                        active.commands.focus();
                      }
                    });
                  }}
                >
                  + Nuova o altra pagina…
                </button>
              </div>
            )}
          </Popover>
          <Btn onClick={() => c()?.toggleCodeBlock().run()} active={inCode} title={`Blocco di codice (${formatCombo('mod+alt+c')})`} disabled={!editor}>
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

// --------------------------------------------------------------------------- tool options (Word-style stacked)

function WidthSlider({ value, min, max, step, onChange }: { value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <label className="width-slider" title="Spessore">
      <span className="width-dot" style={{ width: Math.min(16, Math.max(3, value)), height: Math.min(16, Math.max(3, value)) }} />
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label="Spessore tratto" />
      <span className="width-val">{value}</span>
    </label>
  );
}

function ToolOptions({ tool }: { tool: Tool }) {
  const s = useSettings();
  if (tool === 'pen')
    return (
      <div className="format-bar">
        <RibbonSection label="Penna">
          <RibbonRow>
            <span className="rb-label">Colore</span>
            <Swatches colors={INK_COLORS} value={s.penColor} onPick={(c) => c && s.set({ penColor: c })} />
          </RibbonRow>
          <RibbonRow>
            <span className="rb-label">Spessore</span>
            <WidthSlider value={s.penWidth} min={0.5} max={12} step={0.5} onChange={(v) => s.set({ penWidth: v })} />
          </RibbonRow>
        </RibbonSection>
      </div>
    );
  if (tool === 'highlighter')
    return (
      <div className="format-bar">
        <RibbonSection label="Evidenziatore">
          <RibbonRow>
            <span className="rb-label">Colore</span>
            <Swatches colors={HL_INK} value={s.highlighterColor} onPick={(c) => c && s.set({ highlighterColor: c })} />
          </RibbonRow>
          <RibbonRow>
            <span className="rb-label">Spessore</span>
            <WidthSlider value={s.highlighterWidth} min={6} max={40} step={1} onChange={(v) => s.set({ highlighterWidth: v })} />
          </RibbonRow>
        </RibbonSection>
      </div>
    );
  if (['line', 'arrow', 'double-arrow', 'rect', 'ellipse'].includes(tool))
    return (
      <div className="format-bar">
        <RibbonSection label="Forme geometriche">
          <RibbonRow>
            <span className="rb-label">Bordo</span>
            <Swatches colors={INK_COLORS} value={s.shapeColor} onPick={(c) => c && s.set({ shapeColor: c })} />
            {(tool === 'rect' || tool === 'ellipse') && (
              <>
                <span className="rb-label" style={{ marginLeft: 6 }}>
                  Riempimento
                </span>
                <Swatches colors={['#ffe066', '#a5d8ff', '#b2f2bb', '#ffc9de']} value={s.shapeFill} allowNone="Nessuno" onPick={(c) => s.set({ shapeFill: c })} allowCustom={false} />
              </>
            )}
          </RibbonRow>
          <RibbonRow>
            <span className="rb-label">Spessore</span>
            <WidthSlider value={s.shapeWidth} min={1} max={12} step={0.5} onChange={(v) => s.set({ shapeWidth: v })} />
            <span className="rb-hint">⇧ vincola proporzioni</span>
          </RibbonRow>
        </RibbonSection>
      </div>
    );
  if (tool === 'connector')
    return (
      <div className="format-bar">
        <RibbonSection label="Connettore">
          <RibbonRow>
            <span className="rb-label">Colore</span>
            <Swatches colors={INK_COLORS} value={s.connectorColor} onPick={(c) => c && s.set({ connectorColor: c })} />
          </RibbonRow>
          <RibbonRow>
            <span className="rb-label">Spessore</span>
            <WidthSlider value={s.connectorWidth} min={1} max={8} step={0.5} onChange={(v) => s.set({ connectorWidth: v })} />
            <span className="rb-hint">Trascina tra oggetti per collegarli</span>
          </RibbonRow>
        </RibbonSection>
      </div>
    );
  if (tool === 'eraser')
    return (
      <div className="format-bar">
        <RibbonSection label="Gomma">
          <RibbonRow>
            <span className="rb-hint">Passa sui tratti e sulle forme per cancellarli</span>
          </RibbonRow>
          <RibbonRow>
            <span className="rb-hint">I tratti e le forme vengono rimossi al tocco</span>
          </RibbonRow>
        </RibbonSection>
      </div>
    );
  if (tool === 'text' || tool === 'sticky')
    return (
      <div className="format-bar">
        <RibbonSection label="Testo & Note">
          <RibbonRow>
            <span className="rb-hint">Clic su un punto qualsiasi della pagina per scrivere</span>
          </RibbonRow>
          <RibbonRow>
            <span className="rb-hint">Supporta blocchi auto-espandibili fino a 1850px</span>
          </RibbonRow>
        </RibbonSection>
      </div>
    );
  if (tool === 'hand')
    return (
      <div className="format-bar">
        <RibbonSection label="Panoramica">
          <RibbonRow>
            <span className="rb-hint">Trascina per spostare la vista · o usa 2 dita sul touchpad</span>
          </RibbonRow>
          <RibbonRow>
            <span className="rb-hint">Anche Spazio + trascina con qualsiasi strumento attivo</span>
          </RibbonRow>
        </RibbonSection>
      </div>
    );
  return null;
}

// --------------------------------------------------------------------------- selection actions (Word-style stacked)

function SelectionActions({ items }: { items: CanvasItem[] }) {
  const allLocked = items.every((i) => i.locked);
  const images = items.filter((i) => i.type === 'image');
  const inked = items.filter((i) => i.type === 'stroke' || i.type === 'shape' || i.type === 'connector');
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
              <Swatches colors={INK_COLORS} value={first?.color} onPick={(c) => c && patchSelection((it) => ('color' in it ? { color: c } : null))} />
              <WidthSlider
                value={first?.width ?? 2}
                min={0.5}
                max={40}
                step={0.5}
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
  const canUndo = editor ? editor.can().undo() : canUndoStore;
  const canRedo = editor ? editor.can().redo() : canRedoStore;
  const undo = () => {
    if (editor) editor.chain().focus().undo().run();
    else useStore.getState().undo();
  };
  const redo = () => {
    if (editor) editor.chain().focus().redo().run();
    else useStore.getState().redo();
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
    useUI.getState().set({ homeOpen: true, homeTab: 'notebooks', homeNotebookId: null, homeSectionId: null });
  };
  const goBack = () => {
    void useStore.getState().goBack();
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
  } else if (tool === 'text') {
    content = <FormatBar editor={editor ?? null} />;
  } else if (tool !== 'select') {
    content = <ToolOptions tool={tool} />;
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
