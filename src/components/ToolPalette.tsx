import type { ReactNode } from 'react';
import { Grid3x3, GripHorizontal, ArrowRight, Circle, Eraser, Hand, Highlighter, Maximize, Minus, MousePointer2, MoveHorizontal, Pen, Plus, Scan, Spline, Square, StickyNote, Type } from 'lucide-react';
import { useStore } from '../store/useStore';
import type { BackgroundPattern, Tool } from '../types';
import { useSettings } from '../store/settings';
import { formatCombo } from '../shortcuts/registry';
import { centerContent, fitContent, resetZoom, zoomAt } from '../canvas/viewport';
import { defaultViewport } from '../canvas/viewport';

export const TOOL_DEFS: Array<{ tool: Tool; label: string; key: string; icon: ReactNode; group: number }> = [
  { tool: 'select', label: 'Selezione', key: 'v', icon: <MousePointer2 size={18} />, group: 0 },
  { tool: 'hand', label: 'Mano (sposta vista)', key: 'h', icon: <Hand size={18} />, group: 0 },
  { tool: 'text', label: 'Testo', key: 't', icon: <Type size={18} />, group: 1 },
  { tool: 'sticky', label: 'Nota adesiva', key: 'n', icon: <StickyNote size={18} />, group: 1 },
  { tool: 'pen', label: 'Penna', key: 'p', icon: <Pen size={18} />, group: 2 },
  { tool: 'highlighter', label: 'Evidenziatore', key: 'm', icon: <Highlighter size={18} />, group: 2 },
  { tool: 'eraser', label: 'Gomma', key: 'e', icon: <Eraser size={18} />, group: 2 },
  { tool: 'line', label: 'Linea (⇧ per angoli di 45°)', key: 'l', icon: <Minus size={18} style={{ transform: 'rotate(-45deg)' }} />, group: 3 },
  { tool: 'arrow', label: 'Freccia (da un oggetto a un altro crea un connettore)', key: 'a', icon: <ArrowRight size={18} />, group: 3 },
  { tool: 'double-arrow', label: 'Doppia freccia', key: 'd', icon: <MoveHorizontal size={18} />, group: 3 },
  { tool: 'rect', label: 'Rettangolo (⇧ per quadrato)', key: 'r', icon: <Square size={18} />, group: 3 },
  { tool: 'ellipse', label: 'Ellisse (⇧ per cerchio)', key: 'o', icon: <Circle size={18} />, group: 3 },
  { tool: 'connector', label: 'Connettore tra oggetti', key: 'c', icon: <Spline size={18} />, group: 4 },
];

export function ToolPalette() {
  const tool = useStore((s) => s.tool);
  const hasPage = useStore((s) => !!s.pageId);
  if (!hasPage) return null;
  return (
    <nav className="tool-palette glass" data-ui aria-label="Strumenti di disegno" data-testid="tool-palette">
      {TOOL_DEFS.map((t, i) => {
        const sep = i > 0 && t.group !== TOOL_DEFS[i - 1].group;
        return (
          <span key={t.tool} className="tool-wrap">
            {sep && <span className="tool-sep" />}
            <button
              className={`tool-btn${tool === t.tool ? ' active' : ''}`}
              onClick={() => useStore.getState().setTool(t.tool)}
              title={`${t.label} (${t.key.toUpperCase()})`}
              aria-label={t.label}
              aria-pressed={tool === t.tool}
              data-tool={t.tool}
            >
              {t.icon}
            </button>
          </span>
        );
      })}
    </nav>
  );
}

const BG_OPTIONS: Array<{ pattern: BackgroundPattern; label: string; icon: ReactNode }> = [
  { pattern: 'plain', label: 'Pagina bianca', icon: <Square size={14} /> },
  { pattern: 'grid', label: 'Pagina a quadretti', icon: <Grid3x3 size={14} /> },
  { pattern: 'dots', label: 'Pagina a puntini', icon: <GripHorizontal size={14} /> },
];

/** Background of the open page: white (default), squared or dotted. Saved with the page. */
function PageBackgroundSwitch() {
  const defaultPattern = useSettings((s) => s.background);
  const paper = useSettings((s) => s.paper);
  const pattern = useStore((s) => (s.pageId ? s.pages[s.pageId]?.background?.pattern : undefined)) ?? defaultPattern;
  const set = (p: BackgroundPattern) => {
    if (p === pattern) return;
    useStore.getState().updatePage((page) => ({ ...page, background: { pattern: p, paper: page.background?.paper ?? paper } }));
  };
  return (
    <div className="bg-switch" role="radiogroup" aria-label="Sfondo della pagina">
      {BG_OPTIONS.map((o) => (
        <button key={o.pattern} role="radio" aria-checked={pattern === o.pattern} className={`icon-btn sm${pattern === o.pattern ? ' on' : ''}`} onClick={() => set(o.pattern)} title={o.label} aria-label={o.label} data-testid={`bg-${o.pattern}`}>
          {o.icon}
        </button>
      ))}
    </div>
  );
}

export function ZoomControls() {
  const zoom = useStore((s) => (s.pageId ? s.viewports[s.pageId]?.zoom : undefined) ?? defaultViewport().zoom);
  const hasPage = useStore((s) => !!s.pageId);
  if (!hasPage) return null;
  return (
    <div className="zoom-controls glass" data-ui>
      <PageBackgroundSwitch />
      <span className="sep" />
      <button className="icon-btn sm" onClick={() => zoomAt(1 / 1.2)} title={`Riduci (${formatCombo('mod+minus')})`} aria-label="Riduci zoom">
        <Minus size={15} />
      </button>
      <button className="zoom-value" onClick={resetZoom} title={`Zoom 100% (${formatCombo('mod+0')})`} data-testid="zoom-value">
        {Math.round(zoom * 100)}%
      </button>
      <button className="icon-btn sm" onClick={() => zoomAt(1.2)} title={`Ingrandisci (${formatCombo('mod+plus')})`} aria-label="Aumenta zoom">
        <Plus size={15} />
      </button>
      <span className="sep" />
      <button className="icon-btn sm" onClick={fitContent} title={`Adatta contenuto (${formatCombo('shift+1')})`} aria-label="Adatta il contenuto alla vista">
        <Maximize size={15} />
      </button>
      <button className="icon-btn sm" onClick={centerContent} title={`Centra contenuto (${formatCombo('shift+2')})`} aria-label="Centra il contenuto">
        <Scan size={15} />
      </button>
    </div>
  );
}
