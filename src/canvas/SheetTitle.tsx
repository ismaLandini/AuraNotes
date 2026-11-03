import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Hash, Link2, Plus, X } from 'lucide-react';
import { useStore } from '../store/useStore';
import { isModalOpen, useUI } from '../store/ui';
import * as W from '../model/workspaceOps';
import { BODY_START, PAGE_MARGIN, TITLE_Y } from '../lib/page';
import { createTextBlock } from './actions';

/** Page title written on the sheet itself (top-left, like OneNote), with creation date, tags, and backlinks below. */
export function SheetTitle({ pageId }: { pageId: string }) {
  const ws = useStore((s) => s.workspace);
  const pages = useStore((s) => s.pages);
  const meta = ws.pages[pageId];
  const focusTitle = useStore((s) => s.focusTitleFor);
  const [value, setValue] = useState(meta?.title ?? '');
  const [addingTag, setAddingTag] = useState(false);
  const [tagDraft, setTagDraft] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);
  const title = meta?.title ?? '';

  const [prevTrack, setPrevTrack] = useState({ title, pageId });
  if (prevTrack.title !== title || prevTrack.pageId !== pageId) {
    setPrevTrack({ title, pageId });
    setValue(title === 'Pagina senza titolo' ? '' : title);
    setAddingTag(false);
    setTagDraft('');
  }

  // A freshly created page puts the cursor straight into the title.
  useEffect(() => {
    if (focusTitle === pageId && ref.current) {
      ref.current.focus();
      ref.current.select();
      useStore.setState({ focusTitleFor: null });
    }
  }, [focusTitle, pageId]);

  useEffect(() => {
    if (addingTag && tagInputRef.current) {
      tagInputRef.current.focus();
    }
  }, [addingTag]);

  const commit = useCallback(() => {
    const v = value.trim() || 'Pagina senza titolo';
    if (v !== title) useStore.getState().mutateWorkspace((w) => W.renamePage(w, pageId, v));
  }, [value, title, pageId]);

  const commitTag = (raw: string, keepOpen = false) => {
    const clean = W.normalizeTag(raw);
    if (clean) {
      useStore.getState().mutateWorkspace((w) => W.addPageTag(w, pageId, clean));
    }
    setTagDraft('');
    if (!keepOpen) setAddingTag(false);
  };

  const modalOpen = useUI(isModalOpen);
  useEffect(() => {
    if (modalOpen && ref.current && document.activeElement === ref.current) {
      commit();
      ref.current.blur();
    }
  }, [modalOpen, commit]);

  const allTags = useMemo(() => W.allWorkspaceTags(ws), [ws]);
  const backlinks = useMemo(() => W.findBacklinks(ws, pageId, pages), [ws, pageId, pages]);

  if (!meta) return null;

  const created = new Date(meta.createdAt);
  const tags = meta.tags ?? [];

  return (
    <div className="sheet-title" style={{ left: PAGE_MARGIN, top: TITLE_Y }} data-ui>
      <input
        ref={ref}
        className="sheet-title-input"
        value={value}
        placeholder="Titolo della pagina"
        aria-label="Titolo pagina"
        data-testid="page-title"
        spellCheck
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
            (e.target as HTMLInputElement).blur();
            // Continue writing in the body, just below the title.
            const page = useStore.getState().currentPage();
            if (page && page.order.length === 0) createTextBlock(BODY_START, { w: 560 });
          } else if (e.key === 'Escape') {
            setValue(title === 'Pagina senza titolo' ? '' : title);
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      <div className="sheet-meta-row">
        <div className="sheet-date">
          {created.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          {'  '}
          {created.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
        </div>

        <div className="sheet-tags" data-testid="sheet-tags">
          {tags.map((t) => (
            <span key={t} className="tag-pill" data-testid={`page-tag-${t}`}>
              <Hash size={11} />
              <span>{t}</span>
              <button
                type="button"
                className="tag-pill-remove"
                aria-label={`Rimuovi tag ${t}`}
                title={`Rimuovi #${t}`}
                onClick={() => useStore.getState().mutateWorkspace((w) => W.removePageTag(w, pageId, t))}
              >
                <X size={11} />
              </button>
            </span>
          ))}

          {addingTag ? (
            <span className="tag-input-wrap">
              <Hash size={11} />
              <input
                ref={tagInputRef}
                type="text"
                className="tag-inline-input"
                data-testid="tag-input"
                aria-label="Nuovo tag"
                placeholder="esame, importante…"
                list="workspace-tags-datalist"
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                onBlur={() => commitTag(tagDraft, false)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault();
                    commitTag(tagDraft, e.key === ',');
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setTagDraft('');
                    setAddingTag(false);
                  }
                }}
              />
              <datalist id="workspace-tags-datalist">
                {allTags
                  .filter((t) => !tags.includes(t))
                  .map((t) => (
                    <option key={t} value={t} />
                  ))}
              </datalist>
            </span>
          ) : (
            <button
              type="button"
              className="tag-add-btn"
              data-testid="add-tag-btn"
              aria-label="Aggiungi tag"
              title="Aggiungi un tag alla pagina (#esame, #importante…)"
              onClick={() => setAddingTag(true)}
            >
              <Plus size={11} />
              <span>Tag</span>
            </button>
          )}

          {backlinks.length > 0 && (
            <button
              type="button"
              className="sheet-backlinks-pill"
              data-testid="sheet-backlinks-btn"
              title="Mostra i collegamenti e l’indice della pagina"
              onClick={() => useUI.getState().set({ outlineOpen: !useUI.getState().outlineOpen })}
            >
              <Link2 size={11} />
              <span>
                {backlinks.length} {backlinks.length === 1 ? 'backlink' : 'backlink'}
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
