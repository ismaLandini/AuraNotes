import { ChevronRight } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../store/useStore';
import { pushNavHistory, useUI } from '../store/ui';
import { finishEditing } from '../canvas/actions';

type CrumbLevel = 'notebooks' | 'sections' | 'pages';

/**
 * Location of the open page (Quaderno › Sezione › Pagina), shown in the window title bar.
 * Clicking any segment opens its corresponding dashboard level in HomeView:
 * - Quaderno → all Notebooks grid
 * - Sezione → Sections grid of that Notebook
 * - Pagina → Pages grid of that Section
 */
export function Breadcrumb() {
  const crumbs = useStore(
    useShallow((s) => {
      const p = s.pageId ? s.workspace.pages[s.pageId] : undefined;
      const sec = p ? s.workspace.sections[p.sectionId] : undefined;
      const nb = sec ? s.workspace.notebooks[sec.notebookId] : undefined;
      return nb && sec && p
        ? {
            nbId: nb.id,
            nb: nb.name,
            nbColor: nb.color,
            secId: sec.id,
            sec: sec.name,
            secColor: sec.color,
            pageId: p.id,
            page: p.title || 'Senza titolo',
          }
        : null;
    }),
  );

  if (!crumbs) return <nav className="titlebar-crumbs" aria-label="Posizione" />;

  const goDashboard = (level: CrumbLevel) => {
    const st = useStore.getState();
    if (st.editingId) finishEditing(st.editingId);
    if (st.pageId && st.workspace.pages[st.pageId]) {
      pushNavHistory({ kind: 'page', pageId: st.pageId });
    }
    useUI.getState().set({
      homeOpen: true,
      homeTab: 'notebooks',
      homeNotebookId: level === 'notebooks' ? null : crumbs.nbId,
      homeSectionId: level === 'pages' ? crumbs.secId : null,
    });
  };

  return (
    <nav className="titlebar-crumbs" aria-label="Posizione" data-testid="breadcrumb" title={`${crumbs.nb} › ${crumbs.sec} › ${crumbs.page}`}>
      <button
        type="button"
        className="crumb"
        onClick={() => goDashboard('notebooks')}
        title={`Vai alla dashboard dei quaderni (${crumbs.nb})`}
        aria-label="Vai alla dashboard dei quaderni"
        data-testid="crumb-notebook"
      >
        <span className="crumb-dot" style={{ background: crumbs.nbColor }} />
        <span className="crumb-text">{crumbs.nb}</span>
      </button>
      <ChevronRight size={12} className="crumb-chev" aria-hidden="true" />
      <button
        type="button"
        className="crumb"
        onClick={() => goDashboard('sections')}
        title={`Vai alle sezioni di ${crumbs.nb}`}
        aria-label="Vai alla dashboard delle sezioni"
        data-testid="crumb-section"
      >
        <span className="crumb-dot" style={{ background: crumbs.secColor }} />
        <span className="crumb-text">{crumbs.sec}</span>
      </button>
      <ChevronRight size={12} className="crumb-chev" aria-hidden="true" />
      <button
        type="button"
        className="crumb current"
        onClick={() => goDashboard('pages')}
        title={`Vai alle pagine di ${crumbs.sec}`}
        aria-label="Vai alla dashboard delle pagine"
        aria-current="page"
        data-testid="crumb-page"
      >
        <span className="crumb-text">{crumbs.page}</span>
      </button>
    </nav>
  );
}
