import { ChevronRight } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../store/useStore';
import { useSettings, type PanelLayout } from '../store/settings';
import { useUI } from '../store/ui';

type Column = 'notebooks' | 'sections' | 'pages';

/** Makes sure the sidebar (and the given column of it) is visible, so the user can see where they are. */
function reveal(col: Column) {
  if (window.matchMedia('(max-width: 900px)').matches) {
    useUI.getState().set({ mobileNavOpen: true });
    return;
  }
  const patch: Partial<PanelLayout> = { sidebarVisible: true };
  if (col === 'notebooks') patch.notebooksVisible = true;
  else if (col === 'sections') patch.sectionsVisible = true;
  else patch.pagesVisible = true;
  useSettings.getState().setLayout(patch);
}

/**
 * Location of the open page (Blocco › Sezione › Pagina), shown in the window title bar.
 * Each step reveals the matching column of the sidebar; it never changes the selection.
 */
export function Breadcrumb() {
  const crumbs = useStore(
    useShallow((s) => {
      const p = s.pageId ? s.workspace.pages[s.pageId] : undefined;
      const sec = p ? s.workspace.sections[p.sectionId] : undefined;
      const nb = sec ? s.workspace.notebooks[sec.notebookId] : undefined;
      return nb && sec && p ? { nb: nb.name, nbColor: nb.color, sec: sec.name, secColor: sec.color, page: p.title || 'Senza titolo' } : null;
    }),
  );
  if (!crumbs) return <nav className="titlebar-crumbs" aria-label="Posizione" />;
  return (
    <nav className="titlebar-crumbs" aria-label="Posizione" data-testid="breadcrumb" title={`${crumbs.nb} › ${crumbs.sec} › ${crumbs.page}`}>
      <button className="crumb" onClick={() => reveal('notebooks')} title="Mostra i quaderni" aria-label="Mostra l’elenco dei quaderni">
        <span className="crumb-dot" style={{ background: crumbs.nbColor }} />
        <span className="crumb-text">{crumbs.nb}</span>
      </button>
      <ChevronRight size={12} className="crumb-chev" aria-hidden="true" />
      <button className="crumb" onClick={() => reveal('sections')} title="Mostra le sezioni" aria-label="Mostra l’elenco delle sezioni">
        <span className="crumb-dot" style={{ background: crumbs.secColor }} />
        <span className="crumb-text">{crumbs.sec}</span>
      </button>
      <ChevronRight size={12} className="crumb-chev" aria-hidden="true" />
      <button className="crumb current" onClick={() => reveal('pages')} title="Mostra le pagine" aria-label="Mostra l’elenco delle pagine" aria-current="page">
        <span className="crumb-text">{crumbs.page}</span>
      </button>
    </nav>
  );
}
