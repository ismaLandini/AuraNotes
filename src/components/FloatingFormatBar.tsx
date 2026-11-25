import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bold, Heading, Highlighter, Italic, Link2, List, ListChecks, ListOrdered, Strikethrough, Underline } from 'lucide-react';
import { NodeSelection } from 'prosemirror-state';
import { useActiveEditor } from '../editor/activeEditor';
import { HIGHLIGHT_COLORS } from '../editor/extensions';
import { promptLink } from '../editor/EditableRichText';
import { isModalOpen, useUI } from '../store/ui';
import { formatCombo } from '../shortcuts/registry';
import { applyBlockStyle, Btn, ICON_SIZE, Popover, Swatches, TEXT_COLORS } from './Ribbon';

const GAP = 10;
const BAR_H = 36;

interface Spot {
  left: number;
  top: number;
}

/** Where the bar goes: centred above the selection, or below it when there is no room above. */
function spotFor(editor: NonNullable<ReturnType<typeof useActiveEditor.getState>['editor']>): Spot | null {
  const { from, to, empty } = editor.state.selection;
  if (empty) return null;
  let rect: { left: number; right: number; top: number; bottom: number } | null = null;
  try {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
      const r = sel.getRangeAt(0).getBoundingClientRect();
      if (r.width > 0 || r.height > 0) rect = r;
    }
    if (!rect) {
      const a = editor.view.coordsAtPos(from);
      const b = editor.view.coordsAtPos(to);
      rect = { left: Math.min(a.left, b.left), right: Math.max(a.right, b.right), top: Math.min(a.top, b.top), bottom: Math.max(a.bottom, b.bottom) };
    }
  } catch {
    return null; // the view cannot be measured (not mounted yet)
  }
  const cx = (rect.left + rect.right) / 2;
  const above = rect.top - BAR_H - GAP;
  const top = above >= 8 ? above : rect.bottom + GAP;
  return { left: cx, top: Math.min(top, window.innerHeight - BAR_H - 8) };
}

/**
 * Quick text formatting that appears over a text selection (style, bold/italic/underline/strike,
 * colour, highlight, link, lists). The ribbon keeps the full set of controls.
 */
export function FloatingFormatBar() {
  const editor = useActiveEditor((s) => s.editor);
  const tick = useActiveEditor((s) => s.tick);
  const prompt = useUI((s) => s.prompt);
  const [spot, setSpot] = useState<Spot | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [width, setWidth] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  // The bar stays out of the way while the pointer is still dragging the selection.
  useEffect(() => {
    if (!editor) return;
    const down = (e: PointerEvent) => {
      if (editor.view.dom.contains(e.target as Node)) setSelecting(true);
    };
    const up = () => setSelecting(false);
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('pointerup', up, true);
    document.addEventListener('pointercancel', up, true);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('pointerup', up, true);
      document.removeEventListener('pointercancel', up, true);
      setSelecting(false);
    };
  }, [editor]);

  const place = () => {
    if (!editor || editor.isDestroyed) return setSpot(null);
    const sel = editor.state.selection;
    // Only real text selections: not node selections (images…) and not inside code blocks.
    if (sel instanceof NodeSelection || sel.empty || editor.isActive('codeBlock')) return setSpot(null);
    setSpot(spotFor(editor));
  };

  // Follow the selection (every transaction) and the canvas being panned or zoomed.
  useEffect(() => {
    place();
    if (!editor) return;
    const onMove = () => place();
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    window.addEventListener('wheel', onMove, { passive: true });
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
      window.removeEventListener('wheel', onMove);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, tick, selecting]);

  const visible = spot !== null;
  useLayoutEffect(() => {
    if (ref.current) setWidth(ref.current.offsetWidth);
  }, [visible]);

  if (!editor || !spot || selecting || prompt || isModalOpen()) return null;

  const c = () => editor.chain().focus();
  const level = ([1, 2, 3] as const).find((l) => editor.isActive('heading', { level: l }));
  const color = (editor.getAttributes('textStyle') as { color?: string }).color;
  const left = Math.max(8, Math.min(spot.left - width / 2, window.innerWidth - width - 8));

  return createPortal(
    <div
      ref={ref}
      className="floating-format-bar"
      style={{ left, top: spot.top, visibility: width ? 'visible' : 'hidden' }}
      role="toolbar"
      aria-label="Formattazione rapida"
      data-testid="floating-format-bar"
      data-ui
      data-keep-editing
      onMouseDown={(e) => e.preventDefault()}
    >
      <Popover title="Stile" trigger={<Heading size={ICON_SIZE} />}>
        {(close) => (
          <div className="menu-col">
            {([
              ['Testo', 'p'],
              ['Titolo 1', 1],
              ['Titolo 2', 2],
              ['Titolo 3', 3],
            ] as const).map(([label, v]) => {
              const active = v === 'p' ? !level : level === v;
              return (
                <button
                  key={label}
                  className={`menu-item${active ? ' active' : ''}`}
                  onClick={() => {
                    applyBlockStyle(editor, v);
                    close();
                  }}
                >
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
        )}
      </Popover>
      <span className="ffb-sep" aria-hidden="true" />
      <Btn onClick={() => c().toggleBold().run()} active={editor.isActive('bold')} title={`Grassetto (${formatCombo('mod+b')})`}>
        <Bold size={ICON_SIZE} />
      </Btn>
      <Btn onClick={() => c().toggleItalic().run()} active={editor.isActive('italic')} title={`Corsivo (${formatCombo('mod+i')})`}>
        <Italic size={ICON_SIZE} />
      </Btn>
      <Btn onClick={() => c().toggleUnderline().run()} active={editor.isActive('underline')} title={`Sottolineato (${formatCombo('mod+u')})`}>
        <Underline size={ICON_SIZE} />
      </Btn>
      <Btn onClick={() => c().toggleStrike().run()} active={editor.isActive('strike')} title={`Barrato (${formatCombo('mod+shift+x')})`}>
        <Strikethrough size={ICON_SIZE} />
      </Btn>
      <span className="ffb-sep" aria-hidden="true" />
      <Popover title="Colore del testo" trigger={<span className="color-a" style={{ borderColor: color && color.toLowerCase() !== '#1d1d1f' ? color : '#67b2ff' }}>A</span>}>
        {(close) => (
          <Swatches
            colors={TEXT_COLORS}
            value={color}
            allowNone="Colore predefinito"
            onPick={(col, isCustom) => {
              if (col) c().setColor(col).run();
              else c().unsetColor().run();
              if (!isCustom) close();
            }}
          />
        )}
      </Popover>
      <Popover title="Evidenzia" trigger={<Highlighter size={ICON_SIZE} />}>
        {(close) => (
          <Swatches
            colors={HIGHLIGHT_COLORS}
            value={(editor.getAttributes('highlight').color as string | undefined) ?? null}
            allowNone="Nessuna evidenziazione"
            onPick={(col, isCustom) => {
              if (col) c().setHighlight({ color: col }).run();
              else c().unsetHighlight().run();
              if (!isCustom) close();
            }}
          />
        )}
      </Popover>
      <Btn onClick={() => void promptLink(editor)} active={editor.isActive('link')} title={`Collegamento (${formatCombo('mod+k')})`}>
        <Link2 size={ICON_SIZE} />
      </Btn>
      <span className="ffb-sep" aria-hidden="true" />
      <Btn onClick={() => c().toggleBulletList().run()} active={editor.isActive('bulletList')} title="Elenco puntato">
        <List size={ICON_SIZE} />
      </Btn>
      <Btn onClick={() => c().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Elenco numerato">
        <ListOrdered size={ICON_SIZE} />
      </Btn>
      <Btn onClick={() => c().toggleTaskList().run()} active={editor.isActive('taskList')} title="Lista di controllo">
        <ListChecks size={ICON_SIZE} />
      </Btn>
    </div>,
    document.body,
  );
}
