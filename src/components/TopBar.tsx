import { AlertTriangle, Check, Cloud, FileDown, ImagePlus, Keyboard, Loader2, PanelLeft, Redo2, Search, Settings2, Undo2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../store/useStore';
import { useSettings } from '../store/settings';
import { useUI } from '../store/ui';
import { pickImageFiles } from '../canvas/actions';
import { flush } from '../storage/autosave';
import { formatCombo } from '../shortcuts/registry';

function SaveIndicator() {
  const status = useStore((s) => s.saveStatus);
  const err = useStore((s) => s.saveError);
  const map = {
    saved: { icon: <Check size={13} />, label: 'Salvato', cls: 'ok' },
    saving: { icon: <Loader2 size={13} className="spin" />, label: 'Salvataggio…', cls: 'busy' },
    unsaved: { icon: <Cloud size={13} />, label: 'Modifiche in sospeso', cls: 'pending' },
    error: { icon: <AlertTriangle size={13} />, label: 'Errore di salvataggio', cls: 'error' },
  } as const;
  const m = map[status];
  return (
    <button className={`save-indicator ${m.cls}`} title={err ?? `${m.label} — ${formatCombo('mod+s')} per salvare ora`} onClick={() => void flush()} data-testid="save-status" aria-live="polite">
      {m.icon}
      <span>{m.label}</span>
    </button>
  );
}

/** Breadcrumb of the open page; the title itself is edited on the sheet. */
function PageTitle() {
  const crumbs = useStore(
    useShallow((s) => {
      const p = s.pageId ? s.workspace.pages[s.pageId] : undefined;
      const sec = p ? s.workspace.sections[p.sectionId] : undefined;
      const nb = sec ? s.workspace.notebooks[sec.notebookId] : undefined;
      return nb && sec && p ? { nb: nb.name, sec: sec.name, page: p.title } : { nb: '', sec: '', page: '' };
    }),
  );
  if (!crumbs.page) return <div className="page-title-wrap" />;
  return (
    <div className="page-title-wrap" title={`${crumbs.nb} › ${crumbs.sec} › ${crumbs.page}`}>
      <span className="crumbs">
        {crumbs.nb} <span className="crumb-sep">›</span> {crumbs.sec} <span className="crumb-sep">›</span> <strong>{crumbs.page}</strong>
      </span>
    </div>
  );
}

export function TopBar({ compact }: { compact: boolean }) {
  const canUndo = useStore((s) => !!s.pageId && (s.history[s.pageId]?.past.length ?? 0) > 0);
  const canRedo = useStore((s) => !!s.pageId && (s.history[s.pageId]?.future.length ?? 0) > 0);
  const layout = useSettings((s) => s.layout);
  const setLayout = useSettings((s) => s.setLayout);
  const ui = useUI();
  const hasPage = useStore((s) => !!s.pageId);

  const toggleSidebar = () => {
    if (compact) ui.set({ mobileNavOpen: !ui.mobileNavOpen });
    else setLayout({ sidebarVisible: !layout.sidebarVisible });
  };

  return (
    <header className="topbar glass" data-ui>
      <div className="topbar-left">
        <button className="icon-btn" onClick={toggleSidebar} title={`Pannelli di navigazione (${formatCombo('mod+shift+b')})`} aria-label="Mostra o nascondi navigazione" data-testid="toggle-sidebar">
          <PanelLeft size={18} />
        </button>
        <div className="brand" aria-hidden>
          <span className="brand-mark" />
          {!compact && <span>GlassNotes</span>}
        </div>
      </div>
      <PageTitle />
      <div className="topbar-right">
        <button className="icon-btn" onClick={() => useStore.getState().undo()} disabled={!canUndo} title={`Annulla (${formatCombo('mod+z')})`} aria-label="Annulla">
          <Undo2 size={17} />
        </button>
        <button className="icon-btn" onClick={() => useStore.getState().redo()} disabled={!canRedo} title={`Ripeti (${formatCombo('mod+shift+z')})`} aria-label="Ripeti">
          <Redo2 size={17} />
        </button>
        <span className="sep" />
        <button className="icon-btn" onClick={() => ui.set({ searchOpen: true })} title={`Cerca (${formatCombo('mod+k')})`} aria-label="Cerca">
          <Search size={17} />
        </button>
        <button className="icon-btn" onClick={pickImageFiles} disabled={!hasPage} title="Inserisci immagine" aria-label="Inserisci immagine">
          <ImagePlus size={17} />
        </button>
        <button className="icon-btn" onClick={() => ui.set({ exportOpen: true })} disabled={!hasPage} title={`Stampa / Esporta PDF (${formatCombo('mod+p')})`} aria-label="Esporta PDF" data-testid="open-export">
          <FileDown size={17} />
        </button>
        {!compact && (
          <button className="icon-btn" onClick={() => ui.set({ shortcutsOpen: true })} title={`Scorciatoie (${formatCombo('mod+/')})`} aria-label="Scorciatoie da tastiera">
            <Keyboard size={17} />
          </button>
        )}
        <button className="icon-btn" onClick={() => ui.set({ settingsOpen: true })} title="Impostazioni" aria-label="Impostazioni">
          <Settings2 size={17} />
        </button>
        <SaveIndicator />
      </div>
    </header>
  );
}
