import { useMemo } from 'react';
import { AlignLeft, ArrowUpRight, FilePlus2, Hash, Link2, ListTree, X } from 'lucide-react';
import { useUI } from '../store/ui';
import { useStore } from '../store/useStore';
import { revealRect } from '../canvas/viewport';
import { itemBounds } from '../lib/geometry';
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
  const selected = useStore((s) => s.selection);

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

  return (
    <aside className="page-outline-panel glass-strong" data-ui aria-label="Indice della pagina">
      <div className="page-outline-header">
        <div className="page-outline-title">
          <ListTree size={16} />
          <span>Indice e Collegamenti</span>
          <span className="outline-count-pill">{headings.length + backlinks.length}</span>
        </div>
        <button className="icon-btn xs" onClick={close} title="Chiudi indice" aria-label="Chiudi indice">
          <X size={14} />
        </button>
      </div>

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
    </aside>
  );
}
