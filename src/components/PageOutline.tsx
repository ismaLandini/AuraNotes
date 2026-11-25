import { useMemo, useState } from 'react';
import { SheetThumb } from './PageThumb';
import { AlignLeft, ArrowUpRight, FilePlus2, Hash, LayoutGrid, Link2, ListTree, X } from 'lucide-react';
import { useUI } from '../store/ui';
import { useStore } from '../store/useStore';
import { defaultViewport, getViewport, revealRect, screenSize, setVp } from '../canvas/viewport';
import { itemBounds } from '../lib/geometry';
import { computeSheetLayouts, isPdfDocument, SHEET_TOP, type SheetLayout } from '../lib/page';
import * as W from '../model/workspaceOps';
import * as P from '../model/pageOps';
import type { JSONContent } from '@tiptap/core';

export interface OutlineItem {
  id: string;
  containerId: string;
  level: number;
  text: string;
  x: number;
  y: number;
}

function extractHeadingsFromDoc(doc: JSONContent | undefined, containerId: string, x: number, y: number): OutlineItem[] {
  if (!doc) return [];
  const items: OutlineItem[] = [];
  let index = 0;

  function traverse(node: JSONContent) {
    if (node.type === 'heading') {
      const level = (node.attrs?.level as number) || 1;
      const text = (node.content || [])
        .map((c) => c.text || '')
        .join('')
        .trim();
      if (text) {
        items.push({
          id: `${containerId}-h-${index++}`,
          containerId,
          level,
          text,
          x,
          y,
        });
      }
    }
    if (node.content && Array.isArray(node.content)) {
      for (const child of node.content) {
        traverse(child);
      }
    }
  }

  traverse(doc);
  return items;
}

export function PageOutline() {
  const open = useUI((s) => s.outlineOpen);
  const close = () => useUI.getState().set({ outlineOpen: false });
  const ws = useStore((s) => s.workspace);
  const pageId = useStore((s) => s.pageId);
  const sectionId = useStore((s) => s.sectionId);
  const pages = useStore((s) => s.pages);
  const currentPage = pageId ? pages[pageId] ?? null : null;
  const pageTitle = pageId ? ws.pages[pageId]?.title ?? '' : '';
  const vp = useStore((s) => (s.pageId ? s.viewports[s.pageId] : undefined));
  const selected = useStore((s) => s.selection);
  const [tab, setTab] = useState<'titles' | 'thumbs'>('thumbs');

  const sheetLayouts = useMemo(() => (currentPage ? computeSheetLayouts(currentPage) : []), [currentPage]);

  const activeSheetIndex = useMemo(() => {
    if (sheetLayouts.length <= 1) return 0;
    const curVp = vp ?? defaultViewport(currentPage);
    const { h: screenH } = screenSize();
    const probeY = curVp.y + (screenH / curVp.zoom) * 0.35;
    let best = 0;
    for (let i = 0; i < sheetLayouts.length; i++) {
      if (probeY >= sheetLayouts[i].y) best = i;
    }
    return best;
  }, [sheetLayouts, vp, currentPage]);

  const headings = useMemo(() => {
    if (!currentPage) return [];
    const list: OutlineItem[] = [];
    for (const it of Object.values(currentPage.items)) {
      if ((it.type === 'container' || it.type === 'text') && it.doc) {
        list.push(...extractHeadingsFromDoc(it.doc, it.id, it.x, it.y));
      }
    }
    // Sort reading order: top to bottom, then left to right
    list.sort((a, b) => (Math.abs(a.y - b.y) > 25 ? a.y - b.y : a.x - b.x));
    return list;
  }, [currentPage]);

  const backlinks = useMemo(() => (pageId ? W.findBacklinks(ws, pageId, pages) : []), [ws, pageId, pages]);

  const outgoingLinks = useMemo(() => {
    if (!currentPage) return [];
    const text = P.pageSearchText(currentPage);
    return W.extractWikiLinks(text).map((title) => ({
      title,
      resolved: W.resolveWikiLink(ws, title, sectionId),
    }));
  }, [currentPage, ws, sectionId]);

  if (!open) return null;

  const handleClick = (item: OutlineItem) => {
    if (!currentPage) return;
    const it = currentPage.items[item.containerId];
    if (it) {
      revealRect(itemBounds(it, currentPage.items));
      useStore.getState().setSelection([item.containerId]);
    }
  };

  const jumpToSheet = (layout: SheetLayout) => {
    if (!currentPage) return;
    const curVp = getViewport();
    const isPdf = isPdfDocument(currentPage);
    const targetY = layout.index === 0 && !isPdf ? SHEET_TOP - 24 / curVp.zoom : layout.y - 24 / curVp.zoom;
    setVp({ ...curVp, y: targetY });
  };

  const pillCount = tab === 'thumbs' ? sheetLayouts.length : headings.length + backlinks.length;

  return (
    <aside className="page-outline-panel glass-strong" data-ui aria-label="Indice della pagina">
      <div className="page-outline-header">
        <div className="page-outline-title">
          <ListTree size={16} />
          <span>Indice e Collegamenti</span>
          <span className="outline-count-pill">{pillCount}</span>
        </div>
        <button className="icon-btn xs" onClick={close} title="Chiudi indice" aria-label="Chiudi indice">
          <X size={14} />
        </button>
      </div>

      <div className="outline-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'titles'} className={tab === 'titles' ? 'on' : ''} onClick={() => setTab('titles')} data-testid="outline-tab-titles">
          <ListTree size={13} /> Titoli
        </button>
        <button role="tab" aria-selected={tab === 'thumbs'} className={tab === 'thumbs' ? 'on' : ''} onClick={() => setTab('thumbs')} data-testid="outline-tab-thumbs">
          <LayoutGrid size={13} /> Miniature
        </button>
      </div>

      {tab === 'thumbs' ? (
        <div className="page-outline-body thumbs-body" data-testid="outline-thumbs">
          {currentPage &&
            sheetLayouts.map((layout) => (
              <button
                key={layout.sheet.id}
                type="button"
                className={`thumb-card${layout.index === activeSheetIndex ? ' current' : ''}`}
                onClick={() => jumpToSheet(layout)}
                title={`Pagina ${layout.index + 1}`}
                aria-label={`Vai a pagina ${layout.index + 1}`}
                data-testid={`outline-sheet-thumb-${layout.index + 1}`}
              >
                <SheetThumb page={currentPage} layout={layout} pageTitle={pageTitle} />
                <span className="thumb-label">{layout.index + 1}</span>
              </button>
            ))}
        </div>
      ) : (
      <div className="page-outline-body">
        <div className="outline-section">
          <div className="outline-section-label">
            <ListTree size={12} />
            <span>Titoli nella pagina</span>
            <span className="outline-subcount">{headings.length}</span>
          </div>
          {headings.length === 0 ? (
            <div className="page-outline-empty compact">
              <AlignLeft size={22} className="empty-icon" />
              <p className="empty-title">Nessun titolo nella pagina</p>
              <p className="empty-hint">
                Usa il menu <strong>Stile</strong> nel ribbon per formattare i titoli (H1, H2, H3).
              </p>
            </div>
          ) : (
            <nav className="outline-nav-list" aria-label="Navigazione sezioni">
              {headings.map((h) => {
                const isSelected = selected.includes(h.containerId);
                return (
                  <button
                    key={h.id}
                    className={`outline-item level-${h.level}${isSelected ? ' active' : ''}`}
                    onClick={() => handleClick(h)}
                    title={`${h.text} (H${h.level})`}
                  >
                    <span className="outline-level-tag">
                      <Hash size={11} />
                      {h.level}
                    </span>
                    <span className="outline-item-text">{h.text}</span>
                  </button>
                );
              })}
            </nav>
          )}
        </div>

        <div className="outline-section" data-testid="backlinks-section">
          <div className="outline-section-label">
            <Link2 size={12} />
            <span>Backlink (citata da)</span>
            <span className="outline-subcount">{backlinks.length}</span>
          </div>
          {backlinks.length === 0 ? (
            <p className="outline-links-empty">
              Nessuna pagina cita ancora questa pagina. Scrivi <code>[[{ws.pages[pageId ?? '']?.title || 'Titolo pagina'}]]</code> in un’altra pagina per collegarla.
            </p>
          ) : (
            <div className="backlinks-list" data-testid="backlinks-list">
              {backlinks.map((b) => (
                <button
                  key={b.page.id}
                  type="button"
                  className="backlink-card"
                  data-testid={`backlink-item-${b.page.id}`}
                  onClick={() => void useStore.getState().openPage(b.page.id)}
                >
                  <div className="backlink-card-head">
                    <span className="backlink-title">{b.page.title}</span>
                    <ArrowUpRight size={12} />
                  </div>
                  <div className="backlink-ctx">
                    {b.notebookName} › {b.sectionName}
                  </div>
                  {b.snippet && <div className="backlink-snippet">{b.snippet}</div>}
                </button>
              ))}
            </div>
          )}
        </div>

        {outgoingLinks.length > 0 && (
          <div className="outline-section" data-testid="outgoing-links-section">
            <div className="outline-section-label">
              <ArrowUpRight size={12} />
              <span>Link in uscita ([[…]])</span>
              <span className="outline-subcount">{outgoingLinks.length}</span>
            </div>
            <div className="backlinks-list" data-testid="outgoing-links-list">
              {outgoingLinks.map((l) => (
                <button
                  key={l.title}
                  type="button"
                  className="backlink-card compact"
                  onClick={() => void useStore.getState().navigateWikiLink(l.title)}
                >
                  <div className="backlink-card-head">
                    <span className="backlink-title">{l.title}</span>
                    {l.resolved ? <ArrowUpRight size={12} /> : <FilePlus2 size={12} />}
                  </div>
                  <div className="backlink-ctx">{l.resolved ? 'Apri pagina collegata' : 'Crea nuova pagina al clic'}</div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      )}
    </aside>
  );
}
