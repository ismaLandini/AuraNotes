import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import * as W from '../model/workspaceOps';
import { BODY_START, PAGE_MARGIN, TITLE_Y } from '../lib/page';
import { createTextBlock } from './actions';

/** Page title written on the sheet itself (top-left, like OneNote), with the creation date below. */
export function SheetTitle({ pageId }: { pageId: string }) {
  const meta = useStore((s) => s.workspace.pages[pageId]);
  const focusTitle = useStore((s) => s.focusTitleFor);
  const [value, setValue] = useState(meta?.title ?? '');
  const ref = useRef<HTMLInputElement>(null);
  const title = meta?.title ?? '';

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setValue(title === 'Pagina senza titolo' ? '' : title), [title, pageId]);

  // A freshly created page puts the cursor straight into the title.
  useEffect(() => {
    if (focusTitle === pageId && ref.current) {
      ref.current.focus();
      ref.current.select();
      useStore.setState({ focusTitleFor: null });
    }
  }, [focusTitle, pageId]);

  if (!meta) return null;

  const commit = () => {
    const v = value.trim() || 'Pagina senza titolo';
    if (v !== title) useStore.getState().mutateWorkspace((w) => W.renamePage(w, pageId, v));
  };

  const created = new Date(meta.createdAt);
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
      <div className="sheet-date">
        {created.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        {'  '}
        {created.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
      </div>
    </div>
  );
}
