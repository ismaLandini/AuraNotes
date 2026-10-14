import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  ArrowDownToLine,
  ArrowUpToLine,
  Bold,
  ChevronDown,
  ChevronsDown,
  ChevronsUp,
  Code,
  CopyPlus,
  Eraser as ClearIcon,
  Group,
  Ungroup,
  Highlighter,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Lock,
  Minus,
  PenLine,
  Quote,
  Redo2,
  RotateCcw,
  RotateCw,
  Sigma,
  SquareCode,
  Strikethrough,
  Subscript,
  Superscript,
  Table,
  Trash2,
  Underline,
  Undo2,
  Unlock,
} from 'lucide-react';
import type { Editor } from '@tiptap/core';
import { useShallow } from 'zustand/react/shallow';
import { useActiveEditor } from '../editor/activeEditor';
import { HIGHLIGHT_COLORS } from '../editor/extensions';
import { promptLink } from '../editor/EditableRichText';
import { useStore } from '../store/useStore';
import { useSettings } from '../store/settings';
import { askText } from '../store/ui';
import type { CanvasItem, ConnectorItem, Tool } from '../types';
import { deleteSelection, duplicateSelection, groupSelection, patchSelection, reorderSelection, rotateSelectedImages, toggleLockSelection, ungroupSelection } from '../canvas/actions';
import { formatCombo, registerShortcuts } from '../shortcuts/registry';

export const INK_COLORS = ['#1d1d1f', '#1f3a93', '#0a84ff', '#30a46c', '#e5484d', '#f76b15', '#8e4ec6', '#ffffff'];
const TEXT_COLORS = ['#1d1d1f', '#6e6e73', '#e5484d', '#f76b15', '#c99a00', '#30a46c', '#0a84ff', '#8e4ec6'];
const STICKY_COLORS = ['#fff4b8', '#ffe0e9', '#dff3ff', '#e2f8e5', '#efe6ff', '#ffe8d1', '#f2f2f7'];
const HL_INK = ['#ffd60a', '#9cf06b', '#7cd4ff', '#ff8fb8', '#ffb35c', '#c4a6ff'];

/** Keeps the editor selection when clicking toolbar controls. */
const keepFocus = (e: React.MouseEvent) => e.preventDefault();

function Btn({ onClick, active, title, children, disabled, testid }: { onClick: () => void; active?: boolean; title: string; children: ReactNode; disabled?: boolean; testid?: string }) {
  return (
    <button className={`rb-btn${active ? ' active' : ''}`} onMouseDown={keepFocus} onClick={onClick} title={title} aria-label={title} aria-pressed={active} disabled={disabled} data-testid={testid}>
      {children}
    </button>
  );
}

function Popover({ trigger, title, children }: { trigger: ReactNode; title: string; children: (close: () => void) => ReactNode }) {
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
    const off = registerShortcuts([{ id: 'popover-esc', keys: ['escape'], label: 'Chiudi', category: 'Navigazione', scope: 'global', inModal: true, hidden: true, run: () => setPos(null) }], { prepend: true });
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
      <button className={`rb-btn with-chev${open ? ' active' : ''}`} onMouseDown={keepFocus} onClick={toggle} title={title} aria-label={title} aria-expanded={open}>
        {trigger}
        <ChevronDown size={11} />
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

function Swatches({ colors, value, onPick, allowCustom = true, allowNone }: { colors: string[]; value?: string | null; onPick: (c: string | null) => void; allowCustom?: boolean; allowNone?: string }) {
  return (
    <div className="swatches">
      {allowNone && (
        <button className={`swatch none${!value ? ' active' : ''}`} onMouseDown={keepFocus} onClick={() => onPick(null)} title={allowNone} aria-label={allowNone} />
      )}
      {colors.map((c) => (
        <button key={c} className={`swatch${value?.toLowerCase() === c.toLowerCase() ? ' active' : ''}`} style={{ background: c }} onMouseDown={keepFocus} onClick={() => onPick(c)} title={c} aria-label={`Colore ${c}`} />
      ))}
      {allowCustom && (
        <label className="swatch custom" title="Colore personalizzato">
          <input type="color" value={value && value.startsWith('#') && value.length === 7 ? value : '#000000'} onChange={(e) => onPick(e.target.value)} aria-label="Colore personalizzato" />
        </label>
      )}
    </div>
  );
}

function Sep() {
  return <span className="rb-sep" />;
}

// --------------------------------------------------------------------------- text formatting

function FormatBar({ editor }: { editor: Editor }) {
  useActiveEditor((s) => s.tick); // re-render on every transaction
  const c = () => editor.chain().focus();
  const level = ([1, 2, 3] as const).find((l) => editor.isActive('heading', { level: l }));
  const ts = editor.getAttributes('textStyle') as { fontSize?: string; fontFamily?: string; color?: string };
  const inTable = editor.isActive('table');
  const inCode = editor.isActive('codeBlock');
  const codeLang = (editor.getAttributes('codeBlock').language as string | null) ?? '';

  const insertMath = async (display: boolean) => {
    const sel = editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, ' ');
    const latex = await askText({ title: display ? 'Equazione (blocco)' : 'Equazione in linea', label: 'LaTeX', initial: sel, placeholder: '\\frac{a}{b}', mathPreview: true, multiline: display, confirmLabel: 'Inserisci' });
    if (latex?.trim()) c().insertMath(latex.trim(), display).run();
  };

  return (
    <div className="ribbon-group format-bar" data-testid="format-bar">
      <Btn onClick={() => c().undo().run()} title={`Annulla (${formatCombo('mod+z')})`} disabled={!editor.can().undo()}>
        <Undo2 size={15} />
      </Btn>
      <Btn onClick={() => c().redo().run()} title={`Ripeti (${formatCombo('mod+shift+z')})`} disabled={!editor.can().redo()}>
        <Redo2 size={15} />
      </Btn>
      <Sep />
      <select
        className="rb-select"
        value={level ? `h${level}` : 'p'}
        onChange={(e) => {
          const v = e.target.value;
          if (v === 'p') c().setParagraph().run();
          else c().setHeading({ level: Number(v[1]) as 1 | 2 | 3 }).run();
        }}
        aria-label="Stile paragrafo"
        title="Stile paragrafo"
      >
        <option value="p">Testo</option>
        <option value="h1">Titolo 1</option>
        <option value="h2">Titolo 2</option>
        <option value="h3">Titolo 3</option>
      </select>
      <select
        className="rb-select"
        value={ts.fontFamily ?? ''}
        onChange={(e) => (e.target.value ? c().setFontFamily(e.target.value).run() : c().unsetFontFamily().run())}
        aria-label="Carattere"
        title="Carattere"
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
        onChange={(e) => (e.target.value ? c().setFontSize(e.target.value).run() : c().unsetFontSize().run())}
        aria-label="Dimensione carattere"
        title="Dimensione carattere"
      >
        <option value="">Auto</option>
        {['11px', '13px', '15px', '17px', '20px', '24px', '30px', '36px'].map((s) => (
          <option key={s} value={s}>
            {parseInt(s, 10)}
          </option>
        ))}
      </select>
      <Sep />
      <Btn onClick={() => c().toggleBold().run()} active={editor.isActive('bold')} title={`Grassetto (${formatCombo('mod+b')})`} testid="fmt-bold">
        <Bold size={15} />
      </Btn>
      <Btn onClick={() => c().toggleItalic().run()} active={editor.isActive('italic')} title={`Corsivo (${formatCombo('mod+i')})`}>
        <Italic size={15} />
      </Btn>
      <Btn onClick={() => c().toggleUnderline().run()} active={editor.isActive('underline')} title={`Sottolineato (${formatCombo('mod+u')})`}>
        <Underline size={15} />
      </Btn>
      <Btn onClick={() => c().toggleStrike().run()} active={editor.isActive('strike')} title={`Barrato (${formatCombo('mod+shift+x')})`}>
        <Strikethrough size={15} />
      </Btn>
      <Popover title="Colore testo" trigger={<span className="color-a" style={{ borderColor: ts.color ?? 'currentColor' }}>A</span>}>
        {(close) => (
          <Swatches
            colors={TEXT_COLORS}
            value={ts.color}
            allowNone="Colore predefinito"
            onPick={(col) => {
              if (col) c().setColor(col).run();
              else c().unsetColor().run();
              close();
            }}
          />
        )}
      </Popover>
      <Popover title="Evidenziazione" trigger={<Highlighter size={15} />}>
        {(close) => (
          <Swatches
            colors={HIGHLIGHT_COLORS}
            value={(editor.getAttributes('highlight').color as string) ?? null}
            allowNone="Nessuna evidenziazione"
            onPick={(col) => {
              if (col) c().setHighlight({ color: col }).run();
              else c().unsetHighlight().run();
              close();
            }}
          />
        )}
      </Popover>
      <Btn onClick={() => c().toggleSuperscript().run()} active={editor.isActive('superscript')} title={`Apice (${formatCombo('mod+.')})`}>
        <Superscript size={15} />
      </Btn>
      <Btn onClick={() => c().toggleSubscript().run()} active={editor.isActive('subscript')} title={`Pedice (${formatCombo('mod+,')})`}>
        <Subscript size={15} />
      </Btn>
      <Sep />
      <Popover
        title="Allineamento"
        trigger={editor.isActive({ textAlign: 'center' }) ? <AlignCenter size={15} /> : editor.isActive({ textAlign: 'right' }) ? <AlignRight size={15} /> : editor.isActive({ textAlign: 'justify' }) ? <AlignJustify size={15} /> : <AlignLeft size={15} />}
      >
        {(close) => (
          <div className="ribbon-group">
            <Btn onClick={() => (c().setTextAlign('left').run(), close())} active={editor.isActive({ textAlign: 'left' })} title="Allinea a sinistra">
              <AlignLeft size={15} />
            </Btn>
            <Btn onClick={() => (c().setTextAlign('center').run(), close())} active={editor.isActive({ textAlign: 'center' })} title="Centra">
              <AlignCenter size={15} />
            </Btn>
            <Btn onClick={() => (c().setTextAlign('right').run(), close())} active={editor.isActive({ textAlign: 'right' })} title="Allinea a destra">
              <AlignRight size={15} />
            </Btn>
            <Btn onClick={() => (c().setTextAlign('justify').run(), close())} active={editor.isActive({ textAlign: 'justify' })} title="Giustifica">
              <AlignJustify size={15} />
            </Btn>
          </div>
        )}
      </Popover>
      <Btn onClick={() => c().toggleBulletList().run()} active={editor.isActive('bulletList')} title={`Elenco puntato (${formatCombo('mod+shift+8')})`}>
        <List size={15} />
      </Btn>
      <Btn onClick={() => c().toggleOrderedList().run()} active={editor.isActive('orderedList')} title={`Elenco numerato (${formatCombo('mod+shift+7')})`}>
        <ListOrdered size={15} />
      </Btn>
      <Btn onClick={() => c().toggleTaskList().run()} active={editor.isActive('taskList')} title={`Lista di controllo (${formatCombo('mod+shift+9')})`}>
        <ListChecks size={15} />
      </Btn>
      <Btn onClick={() => c().outdent().run()} title="Riduci rientro (⇧⇥)">
        <IndentDecrease size={15} />
      </Btn>
      <Btn onClick={() => c().indent().run()} title="Aumenta rientro (⇥)">
        <IndentIncrease size={15} />
      </Btn>
      <Sep />
      <Btn onClick={() => c().toggleBlockquote().run()} active={editor.isActive('blockquote')} title={`Citazione (${formatCombo('mod+shift+b')} nel testo)`}>
        <Quote size={15} />
      </Btn>
      <Btn onClick={() => c().setHorizontalRule().run()} title="Linea divisoria">
        <Minus size={15} />
      </Btn>
      <Btn onClick={() => void promptLink(editor)} active={editor.isActive('link')} title={`Collegamento (${formatCombo('mod+k')})`}>
        <Link2 size={15} />
      </Btn>
      <Btn onClick={() => c().toggleCode().run()} active={editor.isActive('code')} title={`Codice in linea (${formatCombo('mod+e')})`}>
        <Code size={15} />
      </Btn>
      <Btn onClick={() => c().toggleCodeBlock().run()} active={inCode} title={`Blocco di codice (${formatCombo('mod+alt+c')})`}>
        <SquareCode size={15} />
      </Btn>
      {inCode && (
        <select className="rb-select narrow" value={codeLang} onChange={(e) => c().updateAttributes('codeBlock', { language: e.target.value || null }).run()} aria-label="Linguaggio" title="Linguaggio">
          <option value="">Auto</option>
          {['python', 'javascript', 'typescript', 'java', 'c', 'cpp', 'sql', 'matlab', 'r', 'bash', 'json', 'xml', 'css'].map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      )}
      <Popover title="Equazione" trigger={<Sigma size={15} />}>
        {(close) => (
          <div className="menu-col">
            <button className="menu-item" onClick={() => (close(), void insertMath(false))}>
              Equazione in linea
            </button>
            <button className="menu-item" onClick={() => (close(), void insertMath(true))}>
              Equazione a blocco
            </button>
            <div className="menu-hint">Simboli rapidi</div>
            <div className="symbol-grid">
              {['α', 'β', 'γ', 'δ', 'ε', 'θ', 'λ', 'μ', 'π', 'σ', 'φ', 'ω', 'Δ', 'Σ', 'Ω', '∞', '≈', '≠', '≤', '≥', '±', '×', '÷', '→', '⇒', '⇔', '∀', '∃', '∈', '∉', '⊂', '∪', '∩', '∫', '∂', '√', '∇', '°'].map((s) => (
                <button key={s} className="sym" onClick={() => c().insertContent(s).run()}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
      </Popover>
      <Popover title="Tabella" trigger={<Table size={15} />}>
        {(close) => (
          <div className="menu-col">
            {!inTable && (
              <button className="menu-item" onClick={() => (close(), c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run())}>
                Inserisci tabella 3×3
              </button>
            )}
            {inTable && (
              <>
                <button className="menu-item" onClick={() => c().addRowAfter().run()}>
                  Aggiungi riga sotto
                </button>
                <button className="menu-item" onClick={() => c().addColumnAfter().run()}>
                  Aggiungi colonna a destra
                </button>
                <button className="menu-item" onClick={() => c().deleteRow().run()}>
                  Elimina riga
                </button>
                <button className="menu-item" onClick={() => c().deleteColumn().run()}>
                  Elimina colonna
                </button>
                <button className="menu-item" onClick={() => c().toggleHeaderRow().run()}>
                  Riga di intestazione
                </button>
                <button className="menu-item danger" onClick={() => (close(), c().deleteTable().run())}>
                  Elimina tabella
                </button>
              </>
            )}
          </div>
        )}
      </Popover>
      <Btn onClick={() => c().unsetAllMarks().clearNodes().run()} title="Cancella formattazione">
        <ClearIcon size={15} />
      </Btn>
    </div>
  );
}

// --------------------------------------------------------------------------- tool options

function WidthSlider({ value, min, max, step, onChange }: { value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <label className="width-slider" title="Spessore">
      <span className="width-dot" style={{ width: Math.min(18, Math.max(3, value)), height: Math.min(18, Math.max(3, value)) }} />
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label="Spessore tratto" />
      <span className="width-val">{value}</span>
    </label>
  );
}

function ToolOptions({ tool }: { tool: Tool }) {
  const s = useSettings();
  if (tool === 'pen')
    return (
      <div className="ribbon-group">
        <span className="rb-label">Penna</span>
        <Swatches colors={INK_COLORS} value={s.penColor} onPick={(c) => c && s.set({ penColor: c })} />
        <WidthSlider value={s.penWidth} min={0.5} max={12} step={0.5} onChange={(v) => s.set({ penWidth: v })} />
      </div>
    );
  if (tool === 'highlighter')
    return (
      <div className="ribbon-group">
        <span className="rb-label">Evidenziatore</span>
        <Swatches colors={HL_INK} value={s.highlighterColor} onPick={(c) => c && s.set({ highlighterColor: c })} />
        <WidthSlider value={s.highlighterWidth} min={6} max={40} step={1} onChange={(v) => s.set({ highlighterWidth: v })} />
      </div>
    );
  if (['line', 'arrow', 'double-arrow', 'rect', 'ellipse'].includes(tool))
    return (
      <div className="ribbon-group">
        <span className="rb-label">Forme</span>
        <Swatches colors={INK_COLORS} value={s.shapeColor} onPick={(c) => c && s.set({ shapeColor: c })} />
        <WidthSlider value={s.shapeWidth} min={1} max={12} step={0.5} onChange={(v) => s.set({ shapeWidth: v })} />
        {(tool === 'rect' || tool === 'ellipse') && (
          <>
            <span className="rb-label">Riempimento</span>
            <Swatches colors={['#ffe066', '#a5d8ff', '#b2f2bb', '#ffc9de']} value={s.shapeFill} allowNone="Nessun riempimento" onPick={(c) => s.set({ shapeFill: c })} allowCustom={false} />
          </>
        )}
        <span className="rb-hint">Tieni premuto ⇧ per vincolare</span>
      </div>
    );
  if (tool === 'connector')
    return (
      <div className="ribbon-group">
        <span className="rb-label">Connettore</span>
        <Swatches colors={INK_COLORS} value={s.connectorColor} onPick={(c) => c && s.set({ connectorColor: c })} />
        <WidthSlider value={s.connectorWidth} min={1} max={8} step={0.5} onChange={(v) => s.set({ connectorWidth: v })} />
        <span className="rb-hint">Trascina da un oggetto a un altro · rilascia vicino a un lato per fissare l’aggancio</span>
      </div>
    );
  if (tool === 'eraser') return <div className="ribbon-group"><span className="rb-hint">Passa sui tratti e sulle forme per cancellarli</span></div>;
  if (tool === 'text' || tool === 'sticky') return <div className="ribbon-group"><span className="rb-hint">Clic su un punto della pagina (anche sopra un’immagine) per scrivere</span></div>;
  if (tool === 'hand') return <div className="ribbon-group"><span className="rb-hint">Trascina per spostare la vista · anche Spazio + trascina con qualsiasi strumento</span></div>;
  return null;
}

// --------------------------------------------------------------------------- selection actions

function SelectionActions({ items }: { items: CanvasItem[] }) {
  const allLocked = items.every((i) => i.locked);
  const images = items.filter((i) => i.type === 'image');
  const inked = items.filter((i) => i.type === 'stroke' || i.type === 'shape' || i.type === 'connector');
  const connectors = items.filter((i): i is ConnectorItem => i.type === 'connector');
  const stickies = items.filter((i) => i.type === 'text' && i.variant === 'sticky');
  const boxes = items.filter((i) => i.type === 'shape' && (i.kind === 'rect' || i.kind === 'ellipse'));
  const first = inked[0] as (CanvasItem & { color?: string; width?: number }) | undefined;
  return (
    <div className="ribbon-group" data-testid="selection-actions">
      <span className="rb-label">{items.length === 1 ? labelFor(items[0]) : items.every((i) => i.groupId && i.groupId === items[0].groupId) ? `Gruppo di ${items.length}` : `${items.length} oggetti`}</span>
      <Btn onClick={duplicateSelection} title={`Duplica (${formatCombo('mod+d')})`}>
        <CopyPlus size={15} />
      </Btn>
      <Btn onClick={() => reorderSelection('front')} title={`Porta in primo piano (${formatCombo('mod+shift+up')})`}>
        <ChevronsUp size={15} />
      </Btn>
      <Btn onClick={() => reorderSelection('forward')} title={`Porta avanti (${formatCombo('mod+up')})`}>
        <ArrowUpToLine size={15} />
      </Btn>
      <Btn onClick={() => reorderSelection('backward')} title={`Porta indietro (${formatCombo('mod+down')})`}>
        <ArrowDownToLine size={15} />
      </Btn>
      <Btn onClick={() => reorderSelection('back')} title={`Porta in fondo (${formatCombo('mod+shift+down')})`}>
        <ChevronsDown size={15} />
      </Btn>
      <Btn onClick={toggleLockSelection} active={allLocked} title={`${allLocked ? 'Sblocca' : 'Blocca'} (${formatCombo('mod+shift+l')})`}>
        {allLocked ? <Lock size={15} /> : <Unlock size={15} />}
      </Btn>
      {items.length > 1 && !items.every((i) => i.groupId && i.groupId === items[0].groupId) && (
        <Btn onClick={groupSelection} title={`Raggruppa (${formatCombo('mod+g')})`} testid="group">
          <Group size={15} />
        </Btn>
      )}
      {items.some((i) => i.groupId) && (
        <Btn onClick={ungroupSelection} title={`Separa gruppo (${formatCombo('mod+shift+g')})`} testid="ungroup">
          <Ungroup size={15} />
        </Btn>
      )}
      {images.length > 0 && (
        <>
          <Sep />
          <Btn onClick={() => rotateSelectedImages(-90)} title="Ruota a sinistra">
            <RotateCcw size={15} />
          </Btn>
          <Btn onClick={() => rotateSelectedImages(90)} title="Ruota a destra">
            <RotateCw size={15} />
          </Btn>
          <Btn onClick={() => useStore.getState().setTool('pen')} title="Annota l’immagine con la penna">
            <PenLine size={15} />
            <span className="rb-text">Annota</span>
          </Btn>
        </>
      )}
      {inked.length > 0 && (
        <>
          <Sep />
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
        <Swatches colors={['#ffe066', '#a5d8ff', '#b2f2bb', '#ffc9de']} value={(boxes[0] as { fill: string | null }).fill} allowNone="Nessun riempimento" allowCustom={false} onPick={(c) => patchSelection((it) => (it.type === 'shape' ? { fill: c } : null))} />
      )}
      {connectors.length > 0 && (
        <>
          <select className="rb-select" value={connectors[0].arrow} onChange={(e) => patchSelection((it) => (it.type === 'connector' ? { arrow: e.target.value as ConnectorItem['arrow'] } : null))} aria-label="Punte">
            <option value="none">Senza punta</option>
            <option value="end">Freccia</option>
            <option value="both">Doppia freccia</option>
          </select>
          <select className="rb-select" value={connectors[0].layer} onChange={(e) => patchSelection((it) => (it.type === 'connector' ? { layer: e.target.value as ConnectorItem['layer'] } : null))} aria-label="Livello">
            <option value="back">Dietro agli oggetti</option>
            <option value="front">Davanti agli oggetti</option>
          </select>
          <select
            className="rb-select"
            value={
              connectors.length !== 1
                ? 'auto|auto'
                : typeof connectors[0].fromAnchor === 'object' || typeof connectors[0].toAnchor === 'object'
                  ? 'custom'
                  : `${connectors[0].fromAnchor}|${connectors[0].toAnchor}`
            }
            onChange={(e) => {
              if (e.target.value === 'custom') return;
              const [fromAnchor, toAnchor] = e.target.value.split('|') as [ConnectorItem['fromAnchor'], ConnectorItem['toAnchor']];
              patchSelection((it) => (it.type === 'connector' ? { fromAnchor, toAnchor } : null));
            }}
            aria-label="Aggancio"
            title="Punti di aggancio"
          >
            <option value="custom" disabled>Punti scelti sul bordo</option>
            <option value="auto|auto">Aggancio automatico</option>
            <option value="right|left">Destra → sinistra</option>
            <option value="bottom|top">Sotto → sopra</option>
            <option value="left|right">Sinistra → destra</option>
            <option value="top|bottom">Sopra → sotto</option>
          </select>
        </>
      )}
      {stickies.length > 0 && (
        <>
          <Sep />
          <span className="rb-label">Nota</span>
          <Swatches colors={STICKY_COLORS} value={(stickies[0] as { bg?: string }).bg} allowCustom={false} onPick={(c) => c && patchSelection((it) => (it.type === 'text' && it.variant === 'sticky' ? { bg: c } : null))} />
        </>
      )}
      <Sep />
      <Btn onClick={deleteSelection} title="Elimina (⌫)" testid="delete-selection">
        <Trash2 size={15} />
      </Btn>
    </div>
  );
}

function labelFor(it: CanvasItem): string {
  switch (it.type) {
    case 'text':
      return it.variant === 'sticky' ? 'Nota adesiva' : 'Blocco di testo';
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
  const [overflow, setOverflow] = useState({ over: false, end: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setOverflow({ over: el.scrollWidth > el.clientWidth + 2, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2 });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    el.addEventListener('scroll', update, { passive: true });
    // Vertical wheel scrolls the toolbar horizontally.
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && el.scrollWidth > el.clientWidth) {
        el.scrollLeft += e.deltaY;
        e.preventDefault();
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      ro.disconnect();
      el.removeEventListener('scroll', update);
      el.removeEventListener('wheel', onWheel);
    };
  }, [editingId, tool, selected.length, hasPage]);
  if (!hasPage) return <div className="ribbon glass" data-ui />;
  let content: ReactNode;
  if (editor && editingId) content = <FormatBar editor={editor} />;
  else if (tool === 'select' && selected.length) content = <SelectionActions items={selected} />;
  else if (tool !== 'select') content = <ToolOptions tool={tool} />;
  return (
    <div ref={ref} className={`ribbon glass${overflow.over ? ' overflowing' : ''}${overflow.end ? ' at-end' : ''}`} data-ui data-keep-editing role="toolbar" aria-label="Opzioni contestuali">
      {content ?? <span className="rb-hint">Seleziona un oggetto, scegli uno strumento o fai doppio clic sulla pagina per scrivere.</span>}
    </div>
  );
}
