import { useEffect, useRef, type ReactNode } from 'react';
import { LayoutGrid, Grid3x3, GripHorizontal, ArrowRight, Circle, Eraser, Hand, Highlighter, Maximize, Minus, MousePointer2, MoveHorizontal, PanelLeft, Pen, Plus, Spline, Square, StickyNote, Type } from 'lucide-react';
import { useStore } from '../store/useStore';
import type { BackgroundPattern, Tool } from '../types';
import { useSettings } from '../store/settings';
import { useUI } from '../store/ui';
import { formatCombo } from '../shortcuts/registry';
import { fitContent, resetZoom, zoomAt, defaultViewport } from '../canvas/viewport';
import { HL_INK, INK_COLORS, Swatches, WidthSlider } from './Ribbon';

export function NavMiniMenu({ compact }: { compact?: boolean }) {
  const sidebarVisible = useSettings((s) => s.layout.sidebarVisible);
  const setLayout = useSettings((s) => s.setLayout);
  const layout = useSettings((s) => s.layout);
  const ui = useUI();

  const toggleSidebar = () => {
    if (compact) ui.set({ mobileNavOpen: !ui.mobileNavOpen });
    else setLayout({ sidebarVisible: !layout.sidebarVisible });
  };

  return (
    <div className="nav-minimenu glass" data-ui title="Quaderni / Sezioni / Pagine">
      <button
        className={`tool-btn nav-toggle-btn${sidebarVisible ? ' active' : ''}`}
        onClick={toggleSidebar}
        title={`Pannelli di navigazione (${formatCombo('mod+shift+b')})`}
        aria-label="Mostra o nascondi navigazione"
        aria-pressed={sidebarVisible}
        data-testid="toggle-sidebar"
      >
        <PanelLeft size={18} />
      </button>
    </div>
  );
}

export function DockActions() {
  const outlineOpen = useUI((s) => s.outlineOpen);
  const hasPage = useStore((s) => !!s.pageId);
  if (!hasPage) return null;
  return (
    <div className="dock-actions" data-ui>
      <span className="tool-sep" />
      <button
        className={`tool-btn${outlineOpen ? ' active' : ''}`}
        onClick={() => useUI.getState().set({ outlineOpen: !outlineOpen })}
        title={`Indice e miniature (${formatCombo('mod+shift+o')})`}
        aria-label="Indice e miniature"
        aria-pressed={outlineOpen}
        data-testid="toggle-outline"
      >
        <LayoutGrid size={18} />
      </button>
      <button
        className="tool-btn"
        onClick={() => useUI.getState().set({ focusMode: true, outlineOpen: false })}
        title={`Modalità Focus (${formatCombo('mod+alt+f')}) · Esc o clic per uscire`}
        aria-label="Modalità Focus"
        data-testid="toggle-focus"
      >
        <Maximize size={18} />
      </button>
    </div>
  );
}

export const TOOL_DEFS: Array<{ tool: Tool; label: string; key: string; icon: ReactNode; group: number }> = [
  { tool: 'select', label: 'Selezione', key: 'v', icon: <MousePointer2 size={18} />, group: 0 },
  { tool: 'hand', label: 'Mano (sposta vista)', key: 'h', icon: <Hand size={18} />, group: 0 },
  { tool: 'text', label: 'Testo', key: 't', icon: <Type size={18} />, group: 1 },
  { tool: 'sticky', label: 'Nota adesiva', key: 'n', icon: <StickyNote size={18} />, group: 1 },
  { tool: 'pen', label: 'Penna', key: 'p', icon: <Pen size={18} />, group: 2 },
  { tool: 'highlighter', label: 'Evidenziatore', key: 'm', icon: <Highlighter size={18} />, group: 2 },
  { tool: 'eraser', label: 'Gomma', key: 'e', icon: <Eraser size={18} />, group: 2 },
  { tool: 'arrow', label: 'Freccia (da un oggetto a un altro crea un connettore)', key: 'a', icon: <ArrowRight size={18} />, group: 3 },
  { tool: 'double-arrow', label: 'Doppia freccia', key: 'd', icon: <MoveHorizontal size={18} />, group: 3 },
  { tool: 'rect', label: 'Rettangolo (⇧ per quadrato)', key: 'r', icon: <Square size={18} />, group: 3 },
  { tool: 'ellipse', label: 'Ellisse (⇧ per cerchio)', key: 'o', icon: <Circle size={18} />, group: 3 },
  { tool: 'connector', label: 'Connettore tra oggetti', key: 'c', icon: <Spline size={18} />, group: 4 },
];

const STYLED_DOCK_TOOLS: ReadonlySet<Tool> = new Set([
  'pen',
  'highlighter',
  'arrow',
  'double-arrow',
  'rect',
  'ellipse',
  'connector',
]);

export function DockToolOptions() {
  const tool = useStore((s) => s.tool);
  const hasPage = useStore((s) => !!s.pageId);
  const s = useSettings();
  const barRef = useRef<HTMLDivElement>(null);

  const visible = hasPage && STYLED_DOCK_TOOLS.has(tool);

  useEffect(() => {
    const el = barRef.current;
    if (!el || !visible) return;
    const onWheel = (e: WheelEvent) => {
      e.stopPropagation();
      e.preventDefault();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      ref={barRef}
      className="dock-tool-options glass"
      data-ui
      data-testid="dock-tool-options"
      role="toolbar"
      aria-label="Opzioni colore e spessore strumento"
    >
      {tool === 'pen' && (
        <>
          <span className="dto-label">Colore</span>
          <Swatches colors={INK_COLORS} value={s.penColor} onPick={(c) => c && s.set({ penColor: c })} />
          <span className="tool-sep" />
          <WidthSlider value={s.penWidth} min={0.5} max={12} step={0.5} onChange={(v) => s.set({ penWidth: v })} />
        </>
      )}

      {tool === 'highlighter' && (
        <>
          <span className="dto-label">Colore</span>
          <Swatches colors={HL_INK} value={s.highlighterColor} onPick={(c) => c && s.set({ highlighterColor: c })} />
          <span className="tool-sep" />
          <WidthSlider value={s.highlighterWidth} min={6} max={40} step={1} onChange={(v) => s.set({ highlighterWidth: v })} />
        </>
      )}

      {(tool === 'arrow' || tool === 'double-arrow' || tool === 'rect' || tool === 'ellipse') && (
        <>
          <span className="dto-label">{tool === 'rect' || tool === 'ellipse' ? 'Bordo' : 'Colore'}</span>
          <Swatches colors={INK_COLORS} value={s.shapeColor} onPick={(c) => c && s.set({ shapeColor: c })} />
          {(tool === 'rect' || tool === 'ellipse') && (
            <>
              <span className="tool-sep" />
              <span className="dto-label">Riempimento</span>
              <Swatches
                colors={['#ffe066', '#a5d8ff', '#b2f2bb', '#ffc9de']}
                value={s.shapeFill}
                allowNone="Nessuno"
                onPick={(c) => s.set({ shapeFill: c })}
                allowCustom={false}
              />
            </>
          )}
          <span className="tool-sep" />
          <WidthSlider value={s.shapeWidth} min={1} max={12} step={0.5} onChange={(v) => s.set({ shapeWidth: v })} />
        </>
      )}

      {tool === 'connector' && (
        <>
          <span className="dto-label">Colore</span>
          <Swatches colors={INK_COLORS} value={s.connectorColor} onPick={(c) => c && s.set({ connectorColor: c })} />
          <span className="tool-sep" />
          <WidthSlider value={s.connectorWidth} min={1} max={8} step={0.5} onChange={(v) => s.set({ connectorWidth: v })} />
        </>
      )}
    </div>
  );
}

export function ToolPalette() {
  const tool = useStore((s) => s.tool);
  const hasPage = useStore((s) => !!s.pageId);
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.stopPropagation();
      if (el.scrollHeight <= el.clientHeight + 1) {
        e.preventDefault();
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [hasPage]);

  if (!hasPage) return null;

  const onToolClick = (t: Tool) => {
    const cur = useStore.getState().tool;
    if (cur === t) {
      // Re-clicking an active tool toggles back to the default text / writing mode ('select')
      useStore.getState().setTool('select');
    } else {
      useStore.getState().setTool(t);
    }
  };

  return (
    <nav
      ref={navRef}
      className="tool-palette glass"
      data-ui
      aria-label="Strumenti di disegno"
      data-testid="tool-palette"
    >
      {TOOL_DEFS.map((t, i) => {
        const sep = i > 0 && t.group !== TOOL_DEFS[i - 1].group;
        return (
          <span key={t.tool} className="tool-wrap">
            {sep && <span className="tool-sep" />}
            <button
              className={`tool-btn${tool === t.tool ? ' active' : ''}`}
              onClick={() => onToolClick(t.tool)}
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
    </div>
  );
}
