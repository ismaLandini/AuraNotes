import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft,
  ArrowUpDown,
  BookOpen,
  ChevronRight,
  Clock,
  FileDown,
  FileText,
  FileUp,
  FolderPlus,
  Hash,
  Home,
  MoreHorizontal,
  Palette,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { askText, confirmDanger, toast, useUI, type HomeTab } from '../store/ui';
import { registerShortcuts } from '../shortcuts/registry';
import * as W from '../model/workspaceOps';
import type { ID, Notebook, PageMeta, PageSortOrder, PdfSourceAttr, Section } from '../types';
import { usePdfPageUrl } from '../pdf/pageCache';
import { importPdfAsDocument } from '../pdf/importPdfDocument';

function relTime(ts: number): string {
  const d = Date.now() - ts;
  if (d < 60_000) return 'adesso';
  if (d < 3_600_000) return `${Math.floor(d / 60_000)} min fa`;
  const date = new Date(ts);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  return date.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

interface ContextMenuItem {
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  onClick?: () => void;
  submenu?: Array<{ label: string; onClick: () => void; color?: string }>;
}

const COLOR_LABELS = ['Blu', 'Viola', 'Rosa', 'Arancio', 'Giallo', 'Verde', 'Turchese', 'Grigio'];

function colorSubmenu(onPick: (c: string) => void) {
  return W.PALETTE.map((c, i) => ({ label: COLOR_LABELS[i] ?? c, color: c, onClick: () => onPick(c) }));
}

function HomeContextMenu({ items, onClose, anchor }: { items: ContextMenuItem[]; onClose: () => void; anchor: { x: number; y: number } }) {
  const ref = useRef<HTMLDivElement>(null);
  const [sub, setSub] = useState<number | null>(null);
  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('pointerdown', close, true);
    const off = registerShortcuts(
      [{ id: 'home-menu-esc', keys: ['escape'], label: 'Chiudi menu', category: 'Navigazione', scope: 'global', inModal: true, hidden: true, run: () => onClose() }],
      { prepend: true },
    );
    return () => {
      document.removeEventListener('pointerdown', close, true);
      off();
    };
  }, [onClose]);
  const left = Math.min(anchor.x, window.innerWidth - 230);
  const top = Math.min(anchor.y, window.innerHeight - 260);
  return createPortal(
    <div ref={ref} className="menu glass-strong" style={{ left, top }} role="menu" data-ui>
      {items.map((m, i) =>
        m.submenu ? (
          <div key={m.label} className="menu-item has-sub" onClick={() => setSub(sub === i ? null : i)} role="menuitem">
            {m.icon}
            <span>{m.label}</span>
            <ChevronRight size={14} className="menu-chev" />
            {sub === i && (
              <div className="submenu">
                {m.submenu.map((s) => (
                  <button
                    key={s.label}
                    className="menu-item"
                    onClick={(e) => {
                      e.stopPropagation();
                      s.onClick();
                      onClose();
                    }}
                  >
                    {s.color && <span className="dot" style={{ background: s.color }} />}
                    <span>{s.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <button
            key={m.label}
            className={`menu-item${m.danger ? ' danger' : ''}`}
            role="menuitem"
            onClick={() => {
              onClose();
              m.onClick?.();
            }}
          >
            {m.icon}
            <span>{m.label}</span>
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}

/** Large macOS-style folder graphic tinted with the notebook's color. */
function MacFolderGraphic({ color, hasContent }: { color: string; hasContent: boolean }) {
  const gradId = `folder-${color.replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <div className="mac-folder-graphic" style={{ ['--folder-color' as string]: color }} aria-hidden="true">
      <svg viewBox="0 0 180 140" className="mac-folder-svg">
        <defs>
          <linearGradient id={`${gradId}-back`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.82" />
            <stop offset="100%" stopColor={color} stopOpacity="0.98" />
          </linearGradient>
          <linearGradient id={`${gradId}-front`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.28" />
            <stop offset="22%" stopColor={color} stopOpacity="0.1" />
            <stop offset="100%" stopColor="#000000" stopOpacity="0.22" />
          </linearGradient>
        </defs>
        {/* Back plate with macOS folder tab */}
        <path
          d="M14 26 C14 19, 19 14, 26 14 L66 14 C72 14, 76 17, 80 22 L85 28 C88 31, 92 33, 97 33 L154 33 C161 33, 166 38, 166 45 L166 116 C166 123, 161 128, 154 128 L26 128 C19 128, 14 123, 14 116 Z"
          fill={color}
          opacity="0.78"
        />
        <path
          d="M14 26 C14 19, 19 14, 26 14 L66 14 C72 14, 76 17, 80 22 L85 28 C88 31, 92 33, 97 33 L154 33 C161 33, 166 38, 166 45 L166 116 C166 123, 161 128, 154 128 L26 128 C19 128, 14 123, 14 116 Z"
          fill="rgba(0,0,0,0.14)"
        />
        {/* Paper sheets peeking out if notebook has sections */}
        {hasContent && (
          <>
            <rect x="28" y="30" width="124" height="76" rx="6" fill="#f8fafc" opacity="0.92" transform="rotate(-1.5 90 68)" />
            <rect x="26" y="34" width="128" height="76" rx="6" fill="#ffffff" opacity="0.97" />
            <line x1="38" y1="45" x2="96" y2="45" stroke="#cbd5e1" strokeWidth="2.5" strokeLinecap="round" />
            <line x1="38" y1="53" x2="122" y2="53" stroke="#e2e8f0" strokeWidth="2" strokeLinecap="round" />
          </>
        )}
        {/* Front pocket of the macOS folder */}
        <rect x="12" y="42" width="156" height="86" rx="13" fill={color} />
        <rect x="12" y="42" width="156" height="86" rx="13" fill={`url(#${gradId}-front)`} />
        {/* Top specular highlight on folder pocket */}
        <path d="M25 43.5 L155 43.5" stroke="rgba(255,255,255,0.55)" strokeWidth="1.5" strokeLinecap="round" />
        {/* Subtle bottom groove */}
        <path d="M24 123 L156 123" stroke="rgba(0,0,0,0.18)" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </div>
  );
}

/** Goodnotes-style 3D colored book graphic for a Section. */
function BookGraphic({ color, title, pageCount }: { color: string; title: string; pageCount: number }) {
  return (
    <div className="gn-book-graphic" style={{ ['--book-color' as string]: color }} aria-hidden="true">
      <div className="gn-book-cover">
        <div className="gn-book-spine" />
        <div className="gn-book-body">
          <div className="gn-book-label-plate">
            <span className="gn-book-plate-line" />
            <span className="gn-book-plate-title">{title}</span>
            <span className="gn-book-plate-sub">{pageCount === 1 ? '1 pagina' : `${pageCount} pagine`}</span>
          </div>
        </div>
      </div>
      <div className="gn-book-pages-edge" />
    </div>
  );
}

/** Goodnotes-style stacked sheets preview cover for a Page / Document. */
function PageCoverGraphic({ page, accentColor }: { page: PageMeta; accentColor?: string }) {
  const isPdf = Boolean(page.pdfAssetId || page.firstSheetType === 'pdf');
  const sheetCount = page.sheetCount ?? 1;
  const isMulti = sheetCount > 1;
  const pdfSource: PdfSourceAttr | null = useMemo(
    () => (isPdf && page.pdfAssetId ? { type: 'pdf', assetId: page.pdfAssetId, page: 1, mode: 'live' } : null),
    [isPdf, page.pdfAssetId],
  );
  const { url, loading } = usePdfPageUrl(pdfSource, 280, true);

  return (
    <div className={`home-cover-stage${isPdf ? ' is-pdf' : ''}`} aria-hidden="true">
      <div className={`home-doc-stack${isMulti ? ' is-multi' : ''}`}>
        {/* Under-sheets giving the stacked 'set of pages' look */}
        <div className="doc-sheet-under sheet-layer-2" />
        <div className="doc-sheet-under sheet-layer-1" />

        {/* Front cover sheet displaying the initial page */}
        <div className={`doc-sheet-front${isPdf ? ' is-pdf' : ''}`}>
          {isPdf ? (
            url ? (
              <img src={url} alt="" className="doc-cover-pdf-img" draggable={false} />
            ) : (
              <div className="doc-cover-pdf-placeholder">
                <FileText size={22} className="doc-cover-pdf-icon" />
                <span className="doc-cover-pdf-status">{loading ? 'Anteprima…' : 'PDF'}</span>
              </div>
            )
          ) : (
            <div className="doc-cover-note-front">
              <div className="doc-cover-note-top" style={accentColor ? { borderTopColor: accentColor } : undefined}>
                <span className="doc-cover-note-title">{page.title || 'Senza titolo'}</span>
              </div>
              <div className="doc-cover-lines">
                <span className="doc-line" />
                <span className="doc-line" />
                <span className="doc-line" />
                <span className="doc-line" />
                <span className="doc-line short" />
              </div>
            </div>
          )}

          {isPdf && <div className="doc-cover-badge pdf">PDF</div>}
        </div>
      </div>
    </div>
  );
}

const HOLD_DELAY_MS = 160;

interface PageDragState {
  pageId: ID;
  fromIndex: number;
  x: number;
  y: number;
  overPageId: ID | null;
  side: 'before' | 'after';
  toIndex: number;
}

export function HomeView() {
  const ws = useStore((s) => s.workspace);
  const currentPageId = useStore((s) => s.pageId);
  const homeTab = useUI((s) => s.homeTab);
  const homeNotebookId = useUI((s) => s.homeNotebookId);
  const homeSectionId = useUI((s) => s.homeSectionId);
  const setUI = useUI((s) => s.set);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importingPdf, setImportingPdf] = useState(false);

  const [query, setQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ kind: 'notebook' | 'section' | 'page'; id: ID; x: number; y: number } | null>(null);

  const sectionPagesGridRef = useRef<HTMLDivElement>(null);
  const [pageDrag, setPageDrag] = useState<PageDragState | null>(null);
  const suppressClickRef = useRef(false);
  const dragCleanupRef = useRef<(() => void) | null>(null);

  // If the currently inspected notebook was deleted, fall back to root notebooks grid
  const activeNotebook: Notebook | null = homeNotebookId ? (ws.notebooks[homeNotebookId] ?? null) : null;
  const activeSection: Section | null = homeSectionId ? (ws.sections[homeSectionId] ?? null) : null;

  useEffect(() => {
    return () => {
      dragCleanupRef.current?.();
    };
  }, [activeSection?.id]);

  useEffect(() => {
    if (homeNotebookId && !ws.notebooks[homeNotebookId]) {
      setUI({ homeNotebookId: null, homeSectionId: null });
    }
  }, [homeNotebookId, ws.notebooks, setUI]);

  useEffect(() => {
    if (homeSectionId && !ws.sections[homeSectionId]) {
      setUI({ homeSectionId: null });
    }
  }, [homeSectionId, ws.sections, setUI]);

  const allTags = useMemo(() => W.allWorkspaceTags(ws), [ws]);
  const activeTag = selectedTag && allTags.includes(selectedTag) ? selectedTag : null;
  const cleanQuery = query.trim().toLowerCase();
  const isFiltering = cleanQuery.length > 0 || activeTag !== null;

  const favoriteCount = useMemo(() => {
    let count = 0;
    for (const id of ws.notebookIds) if (ws.notebooks[id]?.starred) count++;
    for (const s of Object.values(ws.sections)) if (s.starred) count++;
    for (const p of Object.values(ws.pages)) if (p.starred) count++;
    return count;
  }, [ws]);

  // Actions for notebooks
  const handleAddNotebook = async () => {
    const name = await askText({
      title: 'Nuovo quaderno',
      label: 'Nome',
      initial: '',
      placeholder: 'Es. Ricerca Operativa',
      confirmLabel: 'Crea',
    });
    if (name?.trim()) {
      useStore.getState().createNotebookInHome(name.trim());
      toast(`Quaderno "${name.trim()}" creato`, 'success');
    }
  };

  const handleRenameNotebook = async (id: ID) => {
    const nb = ws.notebooks[id];
    if (!nb) return;
    const name = await askText({
      title: 'Rinomina quaderno',
      label: 'Nome',
      initial: nb.name,
      confirmLabel: 'Rinomina',
    });
    if (name?.trim()) useStore.getState().mutateWorkspace((w) => W.renameNotebook(w, id, name.trim()));
  };

  const handleDeleteNotebook = async (id: ID) => {
    const nb = ws.notebooks[id];
    if (!nb) return;
    const n = nb.sectionIds.reduce((a, s) => a + (ws.sections[s]?.pageIds.length ?? 0), 0);
    if (
      await confirmDanger(
        'Eliminare il quaderno?',
        `"${nb.name}" e le sue ${nb.sectionIds.length} sezioni verranno eliminati. Le ${n} pagine finiranno nel cestino e potrai ripristinarle.`,
      )
    ) {
      useStore.getState().deleteNotebook(id);
      if (homeNotebookId === id) setUI({ homeNotebookId: null });
      toast('Quaderno eliminato. Le pagine sono nel cestino.');
    }
  };

  // Actions for sections
  const handleAddSection = async (notebookId: ID) => {
    const name = await askText({
      title: 'Nuova sezione',
      label: 'Nome',
      initial: '',
      placeholder: 'Es. Lezioni',
      confirmLabel: 'Crea',
    });
    if (name?.trim()) {
      useStore.getState().createSectionInHome(notebookId, name.trim());
      toast(`Sezione "${name.trim()}" creata`, 'success');
    }
  };

  const handleRenameSection = async (id: ID) => {
    const sec = ws.sections[id];
    if (!sec) return;
    const name = await askText({
      title: 'Rinomina sezione',
      label: 'Nome',
      initial: sec.name,
      confirmLabel: 'Rinomina',
    });
    if (name?.trim()) useStore.getState().mutateWorkspace((w) => W.renameSection(w, id, name.trim()));
  };

  const handleDeleteSection = async (id: ID) => {
    const s = ws.sections[id];
    if (!s) return;
    if (await confirmDanger('Eliminare la sezione?', `"${s.name}" verrà eliminata. Le sue ${s.pageIds.length} pagine finiranno nel cestino.`)) {
      useStore.getState().deleteSection(id);
      toast('Sezione eliminata. Le pagine sono nel cestino.');
    }
  };

  // Actions for pages
  const handleRenamePage = async (id: ID) => {
    const p = ws.pages[id];
    if (!p) return;
    const title = await askText({ title: 'Rinomina pagina', label: 'Titolo', initial: p.title, confirmLabel: 'Rinomina' });
    if (title?.trim()) useStore.getState().mutateWorkspace((w) => W.renamePage(w, id, title.trim()));
  };

  const handleDeletePage = async (id: ID) => {
    const p = ws.pages[id];
    if (!p) return;
    if (await confirmDanger('Spostare la pagina nel cestino?', `"${p.title}" potrà essere ripristinata dal cestino.`, 'Sposta nel cestino')) {
      useStore.getState().deletePage(id);
    }
  };

  const openNotebookFolder = (id: ID) => {
    setUI({ homeTab: 'notebooks', homeNotebookId: id, homeSectionId: null });
  };

  const openSectionBook = (id: ID) => {
    const sec = ws.sections[id];
    setUI({
      homeTab: 'notebooks',
      homeNotebookId: sec ? sec.notebookId : homeNotebookId,
      homeSectionId: id,
    });
  };

  const openPageCard = (id: ID) => {
    void useStore.getState().openPage(id);
  };

  const switchTab = (tab: HomeTab) => {
    setUI({ homeTab: tab, ...(tab === 'notebooks' ? { homeNotebookId: null, homeSectionId: null } : { homeSectionId: null }) });
  };

  const handleAddPageInSection = (sectionId: ID) => {
    const pid = useStore.getState().addPage(sectionId, 'Pagina senza titolo');
    if (pid) {
      toast('Nuova pagina creata', 'success');
    }
  };

  const handleImportPdfClick = () => {
    fileInputRef.current?.click();
  };

  const handlePdfFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeSection) return;
    try {
      setImportingPdf(true);
      toast('Importazione del PDF in corso...', 'info', 2500);
      const res = await importPdfAsDocument(file, file.name, activeSection.id);
      toast(`"${res.title}" importato con successo (${res.sheetCount} pagine)`, 'success');
      await useStore.getState().openPage(res.pageId);
    } catch (err) {
      console.error(err);
      toast('Impossibile importare il PDF. Verifica che il file sia valido.', 'error');
    } finally {
      setImportingPdf(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Filtered items when searching or filtering by tag in Home
  const filteredResults = useMemo(() => {
    if (!isFiltering) return null;
    const notebooks: Notebook[] = [];
    const sections: Section[] = [];
    const pages: PageMeta[] = [];

    for (const nid of ws.notebookIds) {
      const nb = ws.notebooks[nid];
      if (!nb) continue;
      if (!activeTag && cleanQuery && nb.name.toLowerCase().includes(cleanQuery)) {
        notebooks.push(nb);
      }
      for (const sid of nb.sectionIds) {
        const sec = ws.sections[sid];
        if (!sec) continue;
        if (!activeTag && cleanQuery && sec.name.toLowerCase().includes(cleanQuery)) {
          sections.push(sec);
        }
        for (const pid of sec.pageIds) {
          const p = ws.pages[pid];
          if (!p) continue;
          if (activeTag && !p.tags?.includes(activeTag)) continue;
          if (cleanQuery) {
            const matchTitle = p.title.toLowerCase().includes(cleanQuery);
            const matchText = p.searchText.toLowerCase().includes(cleanQuery);
            const matchTag = p.tags?.some((t) => t.includes(cleanQuery.replace(/^#/, ''))) ?? false;
            if (!matchTitle && !matchText && !matchTag) continue;
          }
          pages.push(p);
        }
      }
    }
    return { notebooks, sections, pages };
  }, [ws, isFiltering, cleanQuery, activeTag]);

  // Recent items
  const recentData = useMemo(() => {
    const sections = Object.values(ws.sections)
      .filter((s) => ws.notebooks[s.notebookId])
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 8);
    const pages = Object.values(ws.pages)
      .filter((p) => ws.sections[p.sectionId])
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 24);
    return { sections, pages };
  }, [ws]);

  // Favorites items
  const favoritesData = useMemo(() => {
    const notebooks = ws.notebookIds.map((id) => ws.notebooks[id]).filter((n): n is Notebook => !!n && !!n.starred);
    const sections = Object.values(ws.sections).filter((s) => s.starred && ws.notebooks[s.notebookId]);
    const pages = Object.values(ws.pages).filter((p) => p.starred && ws.sections[p.sectionId]);
    return { notebooks, sections, pages };
  }, [ws]);

  const renderFolderCard = (nb: Notebook) => {
    const secCount = nb.sectionIds.length;
    const pageCount = nb.sectionIds.reduce((acc, sid) => acc + (ws.sections[sid]?.pageIds.length ?? 0), 0);
    return (
      <div
        key={nb.id}
        className="home-folder-card"
        data-testid={`home-notebook-${nb.name}`}
        role="button"
        tabIndex={0}
        aria-label={`Quaderno ${nb.name}`}
        onClick={() => openNotebookFolder(nb.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openNotebookFolder(nb.id);
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setMenu({ kind: 'notebook', id: nb.id, x: e.clientX, y: e.clientY });
        }}
      >
        <div className="home-card-actions" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className={`home-star-btn${nb.starred ? ' starred' : ''}`}
            onClick={() => useStore.getState().mutateWorkspace((w) => W.toggleNotebookStar(w, nb.id))}
            title={nb.starred ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti'}
            aria-label={nb.starred ? `Rimuovi ${nb.name} dai preferiti` : `Aggiungi ${nb.name} ai preferiti`}
          >
            <Star size={15} fill={nb.starred ? 'currentColor' : 'none'} />
          </button>
          <button
            type="button"
            className="home-more-btn"
            onClick={(e) => setMenu({ kind: 'notebook', id: nb.id, x: e.clientX, y: e.clientY })}
            title="Azioni quaderno"
            aria-label={`Azioni quaderno ${nb.name}`}
          >
            <MoreHorizontal size={16} />
          </button>
        </div>

        <MacFolderGraphic color={nb.color} hasContent={secCount > 0} />

        <div className="home-card-info">
          <div className="home-card-title">{nb.name}</div>
          <div className="home-card-meta">
            <span>{secCount === 1 ? '1 sezione' : `${secCount} sezioni`}</span>
            <span>·</span>
            <span>{pageCount === 1 ? '1 pagina' : `${pageCount} pagine`}</span>
          </div>
          <div className="home-card-date">{relTime(nb.updatedAt)}</div>
        </div>
      </div>
    );
  };

  const renderBookCard = (sec: Section, showNotebookContext = false) => {
    const nb = ws.notebooks[sec.notebookId];
    const pageCount = sec.pageIds.length;
    return (
      <div
        key={sec.id}
        className="home-book-card"
        data-testid={`home-section-${sec.name}`}
        role="button"
        tabIndex={0}
        aria-label={`Sezione ${sec.name}`}
        onClick={() => openSectionBook(sec.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openSectionBook(sec.id);
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setMenu({ kind: 'section', id: sec.id, x: e.clientX, y: e.clientY });
        }}
      >
        <div className="home-card-actions" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className={`home-star-btn${sec.starred ? ' starred' : ''}`}
            onClick={() => useStore.getState().mutateWorkspace((w) => W.toggleSectionStar(w, sec.id))}
            title={sec.starred ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti'}
            aria-label={sec.starred ? `Rimuovi ${sec.name} dai preferiti` : `Aggiungi ${sec.name} ai preferiti`}
          >
            <Star size={15} fill={sec.starred ? 'currentColor' : 'none'} />
          </button>
          <button
            type="button"
            className="home-more-btn"
            onClick={(e) => setMenu({ kind: 'section', id: sec.id, x: e.clientX, y: e.clientY })}
            title="Azioni sezione"
            aria-label={`Azioni sezione ${sec.name}`}
          >
            <MoreHorizontal size={16} />
          </button>
        </div>

        <BookGraphic color={sec.color} title={sec.name} pageCount={pageCount} />

        <div className="home-card-info">
          <div className="home-card-title">{sec.name}</div>
          <div className="home-card-meta">
            {showNotebookContext && nb ? (
              <>
                <span className="home-ctx-dot" style={{ background: nb.color }} />
                <span>{nb.name}</span>
                <span>·</span>
              </>
            ) : null}
            <span>{pageCount === 0 ? 'Nuova sezione' : pageCount === 1 ? '1 pagina' : `${pageCount} pagine`}</span>
          </div>
          <div className="home-card-date">{relTime(sec.updatedAt)}</div>
        </div>
      </div>
    );
  };

  const computeDropTarget = (
    clientX: number,
    clientY: number,
    fromIndex: number,
  ): { overPageId: ID | null; side: 'before' | 'after'; toIndex: number } => {
    const grid = sectionPagesGridRef.current;
    if (!grid) return { overPageId: null, side: 'before', toIndex: fromIndex };
    const cards = Array.from(grid.querySelectorAll<HTMLElement>('.home-page-card[data-page-id]'));
    let targetCard: HTMLElement | null = null;
    let targetRect: DOMRect | null = null;
    let bestScore = Infinity;

    for (const card of cards) {
      const rect = card.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
        targetCard = card;
        targetRect = rect;
        break;
      }
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dyBand = clientY < rect.top ? rect.top - clientY : clientY > rect.bottom ? clientY - rect.bottom : 0;
      const score = dyBand * 3 + Math.hypot(clientX - cx, clientY - cy);
      if (score < bestScore) {
        bestScore = score;
        targetCard = card;
        targetRect = rect;
      }
    }

    if (!targetCard || !targetRect) {
      return { overPageId: null, side: 'before', toIndex: fromIndex };
    }

    const overId = targetCard.dataset.pageId ?? null;
    const idx = Number(targetCard.dataset.pageIndex ?? -1);
    if (!overId || Number.isNaN(idx) || idx < 0 || idx === fromIndex) {
      return { overPageId: null, side: 'before', toIndex: fromIndex };
    }

    let side: 'before' | 'after' = clientX < targetRect.left + targetRect.width / 2 ? 'before' : 'after';
    if (idx === fromIndex + 1 && clientX >= targetRect.left + targetRect.width * 0.15) {
      side = 'after';
    } else if (idx === fromIndex - 1 && clientX <= targetRect.right - targetRect.width * 0.15) {
      side = 'before';
    }

    const slot = side === 'before' ? idx : idx + 1;
    const toIndex = slot > fromIndex ? slot - 1 : slot;
    return { overPageId: overId, side, toIndex };
  };

  const startPagePressOrDrag = (e: React.PointerEvent<HTMLElement>, pageId: ID, fromIndex: number) => {
    if (!activeSection || e.button !== 0) return;
    if ((e.target as HTMLElement).closest('.home-card-actions')) return;

    dragCleanupRef.current?.();
    suppressClickRef.current = false;

    const sectionId = activeSection.id;
    const startX = e.clientX;
    const startY = e.clientY;
    let lastX = e.clientX;
    let lastY = e.clientY;
    let activeDrag: PageDragState | null = null;
    let cancelled = false;

    const beginDrag = (x: number, y: number) => {
      if (activeDrag || cancelled) return;
      suppressClickRef.current = true;
      const target = computeDropTarget(x, y, fromIndex);
      activeDrag = { pageId, fromIndex, x, y, ...target };
      setPageDrag(activeDrag);
    };

    const holdTimer = window.setTimeout(() => {
      beginDrag(lastX, lastY);
    }, HOLD_DELAY_MS);

    const onPointerMove = (ev: PointerEvent) => {
      lastX = ev.clientX;
      lastY = ev.clientY;
      if (!activeDrag) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) >= 6) {
          window.clearTimeout(holdTimer);
          beginDrag(ev.clientX, ev.clientY);
        }
        return;
      }
      const target = computeDropTarget(ev.clientX, ev.clientY, fromIndex);
      activeDrag = { pageId, fromIndex, x: ev.clientX, y: ev.clientY, ...target };
      setPageDrag(activeDrag);
    };

    const removeListeners = () => {
      window.clearTimeout(holdTimer);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      window.removeEventListener('keydown', onKeyDown, true);
      dragCleanupRef.current = null;
    };

    const onPointerUp = () => {
      removeListeners();
      const finalDrag = activeDrag;
      activeDrag = null;
      setPageDrag(null);
      if (finalDrag) {
        if (!cancelled && finalDrag.toIndex !== finalDrag.fromIndex) {
          useStore.getState().mutateWorkspace((w) => W.movePage(w, finalDrag.pageId, sectionId, finalDrag.toIndex));
        }
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 0);
      } else if (cancelled) {
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 0);
      }
    };

    const onPointerCancel = () => {
      cancelled = true;
      removeListeners();
      activeDrag = null;
      setPageDrag(null);
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    };

    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        cancelled = true;
        window.clearTimeout(holdTimer);
        activeDrag = null;
        setPageDrag(null);
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('keydown', onKeyDown, true);
      }
    };

    dragCleanupRef.current = () => {
      removeListeners();
      activeDrag = null;
      setPageDrag(null);
      suppressClickRef.current = false;
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    window.addEventListener('keydown', onKeyDown, true);
  };

  const renderPageCard = (p: PageMeta, reorderIndex?: number) => {
    const sec = ws.sections[p.sectionId];
    const nb = sec ? ws.notebooks[sec.notebookId] : null;
    const isPdf = Boolean(p.pdfAssetId || p.firstSheetType === 'pdf');
    const sheetCount = p.sheetCount ?? 1;
    const countLabel = isPdf
      ? sheetCount === 1
        ? '1 pagina'
        : `${sheetCount} pagine`
      : sheetCount === 1
        ? '1 foglio'
        : `${sheetCount} fogli`;
    const canReorder = reorderIndex !== undefined;
    const isDraggingSource = canReorder && pageDrag?.pageId === p.id;
    const isDropBefore =
      canReorder &&
      pageDrag?.overPageId === p.id &&
      pageDrag.side === 'before' &&
      pageDrag.toIndex !== pageDrag.fromIndex;
    const isDropAfter =
      canReorder &&
      pageDrag?.overPageId === p.id &&
      pageDrag.side === 'after' &&
      pageDrag.toIndex !== pageDrag.fromIndex;

    return (
      <div
        key={p.id}
        className={`home-page-card${canReorder ? ' is-reorderable' : ''}${isDraggingSource ? ' is-dragging-source' : ''}${isDropBefore ? ' drop-before' : ''}${isDropAfter ? ' drop-after' : ''}`}
        data-testid={`home-page-${p.title}`}
        data-page-id={canReorder ? p.id : undefined}
        data-page-index={canReorder ? reorderIndex : undefined}
        role="button"
        tabIndex={0}
        aria-label={`Pagina ${p.title || 'Senza titolo'}`}
        onPointerDown={canReorder ? (e) => startPagePressOrDrag(e, p.id, reorderIndex) : undefined}
        onDragStart={canReorder ? (e) => e.preventDefault() : undefined}
        onClick={() => {
          if (suppressClickRef.current) {
            suppressClickRef.current = false;
            return;
          }
          openPageCard(p.id);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openPageCard(p.id);
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setMenu({ kind: 'page', id: p.id, x: e.clientX, y: e.clientY });
        }}
      >
        <div className="home-card-actions" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className={`home-star-btn${p.starred ? ' starred' : ''}`}
            onClick={() => useStore.getState().mutateWorkspace((w) => W.togglePageStar(w, p.id))}
            title={p.starred ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti'}
            aria-label={p.starred ? `Rimuovi ${p.title} dai preferiti` : `Aggiungi ${p.title} ai preferiti`}
          >
            <Star size={15} fill={p.starred ? 'currentColor' : 'none'} />
          </button>
          <button
            type="button"
            className="home-more-btn"
            onClick={(e) => setMenu({ kind: 'page', id: p.id, x: e.clientX, y: e.clientY })}
            title="Azioni pagina"
            aria-label={`Azioni pagina ${p.title}`}
          >
            <MoreHorizontal size={16} />
          </button>
        </div>

        <PageCoverGraphic page={p} accentColor={sec?.color} />

        <div className="home-card-info">
          <div className="home-card-title">{p.title || 'Senza titolo'}</div>
          <div className="home-card-meta">
            <span className="home-page-badge-pill">{countLabel}</span>
            {nb && !activeSection && (
              <>
                <span>·</span>
                <span className="home-ctx-dot" style={{ background: nb.color }} />
                <span>{nb.name}</span>
              </>
            )}
          </div>
          <div className="home-card-date">{relTime(p.updatedAt)}</div>
        </div>
      </div>
    );
  };

  return (
    <div className="home-view" data-testid="home-view">
      {/* Left Sidebar in Home */}
      <aside className="home-sidebar" aria-label="Menu Home">
        <div className="home-brand">
          <span className="brand-mark" />
          <span className="home-brand-name">AuraNotes</span>
        </div>

        <nav className="home-nav" aria-label="Sezioni Home">
          <button
            type="button"
            className={`home-nav-item${homeTab === 'notebooks' ? ' active' : ''}`}
            onClick={() => switchTab('notebooks')}
            data-testid="home-nav-notebooks"
          >
            <Home size={17} />
            <span>Quaderni</span>
            <span className="home-nav-badge">{ws.notebookIds.length}</span>
          </button>

          <button
            type="button"
            className={`home-nav-item${homeTab === 'recent' ? ' active' : ''}`}
            onClick={() => switchTab('recent')}
            data-testid="home-nav-recent"
          >
            <Clock size={17} />
            <span>Recenti</span>
          </button>

          <button
            type="button"
            className={`home-nav-item${homeTab === 'favorites' ? ' active' : ''}`}
            onClick={() => switchTab('favorites')}
            data-testid="home-nav-favorites"
          >
            <Star size={17} />
            <span>Preferiti</span>
            {favoriteCount > 0 && <span className="home-nav-badge">{favoriteCount}</span>}
          </button>

          <button
            type="button"
            className={`home-nav-item${homeTab === 'trash' ? ' active' : ''}`}
            onClick={() => switchTab('trash')}
            data-testid="home-nav-trash"
          >
            <Trash2 size={17} />
            <span>Eliminati</span>
            {ws.trash.length > 0 && <span className="home-nav-badge">{ws.trash.length}</span>}
          </button>
        </nav>

        {allTags.length > 0 && (
          <div className="home-sidebar-tags">
            <div className="home-sidebar-section-title">Filtra per #tag</div>
            <div className="home-tag-list">
              {allTags.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`sidebar-tag-chip${activeTag === t ? ' active' : ''}`}
                  onClick={() => setSelectedTag((cur) => (cur === t ? null : t))}
                  data-testid={`home-tag-${t}`}
                >
                  <Hash size={11} />
                  <span>{t}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="home-sidebar-footer">
          <button
            type="button"
            className="home-nav-item"
            onClick={() => setUI({ searchOpen: true })}
            title="Ricerca avanzata (⌘K)"
          >
            <Search size={16} />
            <span>Ricerca avanzata…</span>
          </button>
          <button
            type="button"
            className="home-nav-item"
            onClick={() => setUI({ settingsOpen: true })}
            title="Impostazioni e backup"
          >
            <Settings2 size={16} />
            <span>Impostazioni</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area in Home */}
      <main className="home-main">
        <header className="home-header">
          <div className="home-header-left">
            {homeTab === 'notebooks' && activeNotebook ? (
              <div className="home-breadcrumb">
                <button
                  type="button"
                  className="home-back-btn"
                  onClick={() => setUI({ homeNotebookId: null, homeSectionId: null })}
                  data-testid="home-back-to-notebooks"
                  aria-label="Torna a tutti i quaderni"
                >
                  <ArrowLeft size={17} />
                  <span>Quaderni</span>
                </button>
                <ChevronRight size={15} className="home-crumb-sep" />
                {activeSection ? (
                  <>
                    <button
                      type="button"
                      className="home-back-btn inline"
                      onClick={() => setUI({ homeSectionId: null })}
                      data-testid="home-back-to-sections"
                      aria-label={`Torna alle sezioni di ${activeNotebook.name}`}
                    >
                      <span className="home-ctx-dot" style={{ background: activeNotebook.color }} />
                      <span>{activeNotebook.name}</span>
                    </button>
                    <ChevronRight size={15} className="home-crumb-sep" />
                    <span className="home-current-notebook">
                      <span className="home-ctx-dot lg" style={{ background: activeSection.color }} />
                      {activeSection.name}
                    </span>
                  </>
                ) : (
                  <span className="home-current-notebook">
                    <span className="home-ctx-dot lg" style={{ background: activeNotebook.color }} />
                    {activeNotebook.name}
                  </span>
                )}
              </div>
            ) : (
              <h1 className="home-title">
                {homeTab === 'notebooks' && 'Quaderni'}
                {homeTab === 'recent' && 'Recenti'}
                {homeTab === 'favorites' && 'Preferiti'}
                {homeTab === 'trash' && 'Eliminati'}
              </h1>
            )}
          </div>

          <div className="home-header-right">
            <input
              type="file"
              ref={fileInputRef}
              accept="application/pdf,.pdf"
              style={{ display: 'none' }}
              onChange={handlePdfFileSelected}
              data-testid="home-pdf-file-input"
            />
            <div className="home-search-box">
              <Search size={15} />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filtra quaderni, sezioni, pagine o #tag…"
                aria-label="Filtra nella Home"
                data-testid="home-search-input"
              />
              {(query || activeTag) && (
                <button
                  type="button"
                  className="icon-btn xs"
                  onClick={() => {
                    setQuery('');
                    setSelectedTag(null);
                  }}
                  title="Cancella filtro"
                  aria-label="Cancella filtro"
                >
                  <X size={13} />
                </button>
              )}
            </div>

            {homeTab === 'notebooks' && !activeNotebook && (
              <button type="button" className="btn primary" onClick={() => void handleAddNotebook()} data-testid="home-add-notebook">
                <FolderPlus size={15} />
                <span>Nuovo quaderno</span>
              </button>
            )}

            {homeTab === 'notebooks' && activeNotebook && !activeSection && (
              <button
                type="button"
                className="btn primary"
                onClick={() => void handleAddSection(activeNotebook.id)}
                data-testid="home-add-section"
              >
                <Plus size={15} />
                <span>Nuova sezione</span>
              </button>
            )}

            {homeTab === 'notebooks' && activeNotebook && activeSection && (
              <>
                <div className="home-sort-box">
                  <ArrowUpDown size={14} className="home-sort-icon" aria-hidden="true" />
                  <select
                    className="home-sort-select"
                    value={activeSection.pageSort ?? 'manual'}
                    onChange={(e) =>
                      useStore.getState().mutateWorkspace((w) => W.sortSectionPages(w, activeSection.id, e.target.value as PageSortOrder))
                    }
                    aria-label="Ordina pagine"
                    data-testid="section-page-sort"
                  >
                    {W.PAGE_SORT_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  className="btn"
                  onClick={handleImportPdfClick}
                  disabled={importingPdf}
                  data-testid="home-header-import-pdf"
                  title="Importa un PDF per intero in questa sezione"
                >
                  <FileUp size={15} />
                  <span>{importingPdf ? 'Importazione…' : 'Importa PDF'}</span>
                </button>
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => void handleAddPageInSection(activeSection.id)}
                  data-testid="home-header-add-page"
                  title="Crea una nuova pagina in questa sezione"
                >
                  <Plus size={15} />
                  <span>Nuova pagina</span>
                </button>
              </>
            )}

            {homeTab === 'trash' && ws.trash.length > 0 && (
              <button
                type="button"
                className="btn danger"
                onClick={async () => {
                  if (await confirmDanger('Svuotare il cestino?', `Tutte le ${ws.trash.length} pagine nel cestino verranno eliminate definitivamente.`)) {
                    await useStore.getState().emptyTrash();
                    toast('Cestino svuotato');
                  }
                }}
                data-testid="home-empty-trash"
              >
                <Trash2 size={15} />
                <span>Svuota cestino</span>
              </button>
            )}

            {currentPageId && ws.pages[currentPageId] && (
              <button
                type="button"
                className="btn home-resume-btn"
                onClick={() => setUI({ homeOpen: false })}
                data-testid="home-resume-workspace"
                title={`Torna alla pagina aperta: ${ws.pages[currentPageId].title}`}
              >
                <BookOpen size={15} />
                <span>Foglio di lavoro</span>
              </button>
            )}
          </div>
        </header>

        <div className="home-content">
          {/* Search / Tag Filter Results */}
          {isFiltering && filteredResults ? (
            <div className="home-sections-stack">
              {filteredResults.notebooks.length > 0 && (
                <section className="home-group">
                  <h2 className="home-group-title">Quaderni ({filteredResults.notebooks.length})</h2>
                  <div className="home-grid folders">{filteredResults.notebooks.map(renderFolderCard)}</div>
                </section>
              )}
              {filteredResults.sections.length > 0 && (
                <section className="home-group">
                  <h2 className="home-group-title">Sezioni ({filteredResults.sections.length})</h2>
                  <div className="home-grid books">{filteredResults.sections.map((s) => renderBookCard(s, true))}</div>
                </section>
              )}
              {filteredResults.pages.length > 0 && (
                <section className="home-group">
                  <h2 className="home-group-title">Pagine ({filteredResults.pages.length})</h2>
                  <div className="home-grid pages">{filteredResults.pages.map((p) => renderPageCard(p))}</div>
                </section>
              )}
              {filteredResults.notebooks.length === 0 && filteredResults.sections.length === 0 && filteredResults.pages.length === 0 && (
                <div className="home-empty-state">
                  <Search size={36} />
                  <h3>Nessun risultato trovato</h3>
                  <p>Nessun quaderno, sezione o pagina corrisponde ai criteri di ricerca.</p>
                </div>
              )}
            </div>
          ) : homeTab === 'notebooks' && !activeNotebook ? (
            /* Level 1: All Notebooks as large macOS Folders */
            <div className="home-grid folders" data-testid="home-notebooks-grid">
              {ws.notebookIds.map((id) => {
                const nb = ws.notebooks[id];
                return nb ? renderFolderCard(nb) : null;
              })}
              <button
                type="button"
                className="home-new-card folder"
                onClick={() => void handleAddNotebook()}
                data-testid="home-new-notebook-card"
                aria-label="Crea nuovo quaderno"
              >
                <div className="home-new-card-icon">
                  <Plus size={28} />
                </div>
                <span className="home-new-card-label">Nuovo quaderno</span>
              </button>
            </div>
          ) : homeTab === 'notebooks' && activeNotebook && !activeSection ? (
            /* Level 2: Inside a Notebook -> Sections as Colored Books */
            <div className="home-grid books" data-testid="home-sections-grid">
              {activeNotebook.sectionIds.map((sid) => {
                const sec = ws.sections[sid];
                return sec ? renderBookCard(sec, false) : null;
              })}
              <button
                type="button"
                className="home-new-card book"
                onClick={() => void handleAddSection(activeNotebook.id)}
                data-testid="home-new-section-card"
                aria-label="Crea nuova sezione"
              >
                <div className="home-new-card-icon">
                  <Plus size={28} />
                </div>
                <span className="home-new-card-label">Nuova sezione</span>
              </button>
            </div>
          ) : homeTab === 'notebooks' && activeNotebook && activeSection ? (
            /* Level 3: Inside a Section -> Pages as Goodnotes Document Cards */
            <div ref={sectionPagesGridRef} className="home-grid pages" data-testid="home-section-pages-grid">
              <button
                type="button"
                className="home-new-card page"
                onClick={() => void handleAddPageInSection(activeSection.id)}
                data-testid="home-new-page-card"
                aria-label="Crea nuova pagina"
              >
                <div className="home-new-card-icon">
                  <Plus size={28} />
                </div>
                <span className="home-new-card-label">Nuova pagina</span>
              </button>

              <button
                type="button"
                className="home-new-card pdf"
                onClick={handleImportPdfClick}
                disabled={importingPdf}
                data-testid="home-import-pdf-card"
                aria-label="Importa PDF per intero"
              >
                <div className="home-new-card-icon pdf-icon">
                  <FileUp size={28} />
                </div>
                <span className="home-new-card-label">{importingPdf ? 'Importazione…' : 'Importa PDF'}</span>
              </button>

              {activeSection.pageIds.map((pid, idx) => {
                const p = ws.pages[pid];
                return p ? renderPageCard(p, idx) : null;
              })}
            </div>
          ) : homeTab === 'recent' ? (
            /* Recent Tab */
            <div className="home-sections-stack" data-testid="home-recent-view">
              {recentData.sections.length > 0 && (
                <section className="home-group">
                  <h2 className="home-group-title">Sezioni recenti</h2>
                  <div className="home-grid books">{recentData.sections.map((s) => renderBookCard(s, true))}</div>
                </section>
              )}
              {recentData.pages.length > 0 && (
                <section className="home-group">
                  <h2 className="home-group-title">Pagine modificate di recente</h2>
                  <div className="home-grid pages">{recentData.pages.map((p) => renderPageCard(p))}</div>
                </section>
              )}
              {recentData.sections.length === 0 && recentData.pages.length === 0 && (
                <div className="home-empty-state">
                  <Clock size={36} />
                  <h3>Nessun elemento recente</h3>
                  <p>I quaderni, le sezioni e le pagine su cui lavori appariranno qui.</p>
                </div>
              )}
            </div>
          ) : homeTab === 'favorites' ? (
            /* Favorites Tab */
            <div className="home-sections-stack" data-testid="home-favorites-view">
              {favoritesData.notebooks.length > 0 && (
                <section className="home-group">
                  <h2 className="home-group-title">Quaderni preferiti</h2>
                  <div className="home-grid folders">{favoritesData.notebooks.map(renderFolderCard)}</div>
                </section>
              )}
              {favoritesData.sections.length > 0 && (
                <section className="home-group">
                  <h2 className="home-group-title">Sezioni preferite</h2>
                  <div className="home-grid books">{favoritesData.sections.map((s) => renderBookCard(s, true))}</div>
                </section>
              )}
              {favoritesData.pages.length > 0 && (
                <section className="home-group">
                  <h2 className="home-group-title">Pagine preferite</h2>
                  <div className="home-grid pages">{favoritesData.pages.map((p) => renderPageCard(p))}</div>
                </section>
              )}
              {favoritesData.notebooks.length === 0 && favoritesData.sections.length === 0 && favoritesData.pages.length === 0 && (
                <div className="home-empty-state">
                  <Star size={36} />
                  <h3>Nessun preferito</h3>
                  <p>Clicca sulla stella di un quaderno, di una sezione o di una pagina per ritrovarli rapidamente qui.</p>
                </div>
              )}
            </div>
          ) : (
            /* Trash Tab */
            <div className="home-trash-view" data-testid="home-trash-view">
              {ws.trash.length === 0 ? (
                <div className="home-empty-state">
                  <Trash2 size={36} />
                  <h3>Il cestino è vuoto</h3>
                  <p>Le pagine eliminate dai quaderni vengono conservate qui finché non svuoti il cestino.</p>
                </div>
              ) : (
                <ul className="home-trash-list">
                  {ws.trash.map((entry) => (
                    <li key={entry.page.id} className="home-trash-item" data-testid={`trash-item-${entry.page.title}`}>
                      <div className="home-trash-item-info">
                        <FileText size={18} className="home-trash-icon" />
                        <div>
                          <div className="home-trash-title">{entry.page.title || 'Senza titolo'}</div>
                          <div className="home-trash-meta">
                            Da &ldquo;{entry.fromSectionName}&rdquo; · Eliminata {relTime(entry.deletedAt)}
                          </div>
                        </div>
                      </div>
                      <div className="home-trash-actions">
                        <button
                          type="button"
                          className="btn sm"
                          onClick={async () => {
                            const ok = await useStore.getState().restorePage(entry.page.id);
                            if (ok) toast('Pagina ripristinata', 'success');
                            else toast('Crea prima una sezione in cui ripristinare la pagina.', 'error');
                          }}
                        >
                          <RotateCcw size={13} /> Ripristina
                        </button>
                        <button
                          type="button"
                          className="btn sm danger-outline"
                          onClick={async () => {
                            if (await confirmDanger('Eliminare definitivamente?', `"${entry.page.title}" non potrà più essere recuperata.`)) {
                              await useStore.getState().emptyTrash([entry.page.id]);
                            }
                          }}
                        >
                          <Trash2 size={13} /> Elimina
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </main>

      {/* Context Menus */}
      {menu && menu.kind === 'notebook' && ws.notebooks[menu.id] && (
        <HomeContextMenu
          anchor={menu}
          onClose={() => setMenu(null)}
          items={[
            { label: 'Apri quaderno', icon: <BookOpen size={14} />, onClick: () => openNotebookFolder(menu.id) },
            {
              label: 'Esporta quaderno in PDF…',
              icon: <FileDown size={14} />,
              onClick: () => {
                const nbId = menu.id;
                useStore.getState().selectNotebook(nbId);
                useUI.getState().set({ exportOpen: true, exportInitialScope: 'notebook', exportNotebookId: nbId, homeOpen: false });
              },
            },
            {
              label: ws.notebooks[menu.id].starred ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti',
              icon: <Star size={14} />,
              onClick: () => useStore.getState().mutateWorkspace((w) => W.toggleNotebookStar(w, menu.id)),
            },
            { label: 'Rinomina', icon: <Pencil size={14} />, onClick: () => void handleRenameNotebook(menu.id) },
            {
              label: 'Colore',
              icon: <Palette size={14} />,
              submenu: colorSubmenu((c) => useStore.getState().mutateWorkspace((w) => W.setNotebookColor(w, menu.id, c))),
            },
            { label: 'Elimina', icon: <Trash2 size={14} />, danger: true, onClick: () => void handleDeleteNotebook(menu.id) },
          ]}
        />
      )}

      {menu && menu.kind === 'section' && ws.sections[menu.id] && (
        <HomeContextMenu
          anchor={menu}
          onClose={() => setMenu(null)}
          items={[
            { label: 'Apri sezione', icon: <BookOpen size={14} />, onClick: () => openSectionBook(menu.id) },
            {
              label: 'Esporta sezione in PDF…',
              icon: <FileDown size={14} />,
              onClick: () => {
                const secId = menu.id;
                useStore.getState().selectSection(secId);
                useUI.getState().set({ exportOpen: true, exportInitialScope: 'section', exportSectionId: secId, homeOpen: false });
              },
            },
            {
              label: ws.sections[menu.id].starred ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti',
              icon: <Star size={14} />,
              onClick: () => useStore.getState().mutateWorkspace((w) => W.toggleSectionStar(w, menu.id)),
            },
            { label: 'Rinomina', icon: <Pencil size={14} />, onClick: () => void handleRenameSection(menu.id) },
            {
              label: 'Colore',
              icon: <Palette size={14} />,
              submenu: colorSubmenu((c) => useStore.getState().mutateWorkspace((w) => W.setSectionColor(w, menu.id, c))),
            },
            { label: 'Elimina', icon: <Trash2 size={14} />, danger: true, onClick: () => void handleDeleteSection(menu.id) },
          ]}
        />
      )}

      {menu && menu.kind === 'page' && ws.pages[menu.id] && (
        <HomeContextMenu
          anchor={menu}
          onClose={() => setMenu(null)}
          items={[
            { label: 'Apri pagina', icon: <FileText size={14} />, onClick: () => openPageCard(menu.id) },
            {
              label: ws.pages[menu.id].starred ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti',
              icon: <Star size={14} />,
              onClick: () => useStore.getState().mutateWorkspace((w) => W.togglePageStar(w, menu.id)),
            },
            { label: 'Rinomina', icon: <Pencil size={14} />, onClick: () => void handleRenamePage(menu.id) },
            { label: 'Sposta nel cestino', icon: <Trash2 size={14} />, danger: true, onClick: () => void handleDeletePage(menu.id) },
          ]}
        />
      )}

      {pageDrag &&
        ws.pages[pageDrag.pageId] &&
        createPortal(
          <div
            className="home-page-drag-ghost"
            style={{ left: pageDrag.x, top: pageDrag.y }}
            aria-hidden="true"
            data-testid="home-page-drag-ghost"
          >
            <PageCoverGraphic page={ws.pages[pageDrag.pageId]} accentColor={activeSection?.color} />
            <div className="home-drag-ghost-title">{ws.pages[pageDrag.pageId].title || 'Senza titolo'}</div>
          </div>,
          document.body,
        )}
    </div>
  );
}
