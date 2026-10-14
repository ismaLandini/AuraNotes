import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { RotateCcw, Search, Trash2, X } from 'lucide-react';
import { useUI } from '../store/ui';
import { renderLatex } from '../editor/extensions';
import { useStore } from '../store/useStore';
import { confirmDanger, toast } from '../store/ui';
import { formatCombo, listShortcuts, onRegistryChange, type ShortcutDef } from '../shortcuts/registry';
import type { ID } from '../types';
import { itemBounds } from '../lib/geometry';
import { docToText } from '../model/pageOps';
import { revealRect } from '../canvas/viewport';

export function Modal({ title, onClose, children, wide, footer, testid }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; footer?: ReactNode; testid?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
      if (e.key === 'Tab' && ref.current) {
        // Simple focus trap
        const f = ref.current.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      prev?.focus?.({ preventScroll: true });
    };
  }, [onClose]);
  useLayoutEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>('[autofocus], input, textarea, button.primary');
    el?.focus();
  }, []);
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()} data-ui>
      <div ref={ref} className={`modal glass-strong${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} data-testid={testid}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn sm" onClick={onClose} aria-label="Chiudi">
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog() {
  const req = useUI((s) => s.confirm);
  if (!req) return null;
  return (
    <Modal
      title={req.title}
      onClose={() => req.resolve('cancel')}
      testid="confirm-dialog"
      footer={
        <>
          <button className="btn" onClick={() => req.resolve('cancel')}>
            Annulla
          </button>
          {req.altLabel && (
            <button className="btn" onClick={() => req.resolve('alt')}>
              {req.altLabel}
            </button>
          )}
          <button className={`btn ${req.danger ? 'danger' : 'primary'}`} onClick={() => req.resolve('confirm')} autoFocus data-testid="confirm-ok">
            {req.confirmLabel ?? 'Conferma'}
          </button>
        </>
      }
    >
      <p className="dialog-text">{req.message}</p>
    </Modal>
  );
}

function MathPreview({ latex, display }: { latex: string; display: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) renderLatex(ref.current, latex, display);
  }, [latex, display]);
  return <div className="math-preview" ref={ref} />;
}

export function PromptDialog() {
  const req = useUI((s) => s.prompt);
  const [value, setValue] = useState('');
  useEffect(() => setValue(req?.initial ?? ''), [req]);
  if (!req) return null;
  const submit = () => req.resolve(value);
  return (
    <Modal
      title={req.title}
      onClose={() => req.resolve(null)}
      testid="prompt-dialog"
      footer={
        <>
          <button className="btn" onClick={() => req.resolve(null)}>
            Annulla
          </button>
          <button className="btn primary" onClick={submit} data-testid="prompt-ok">
            {req.confirmLabel ?? 'OK'}
          </button>
        </>
      }
    >
      <label className="field">
        {req.label && <span>{req.label}</span>}
        {req.multiline ? (
          <textarea
            autoFocus
            value={value}
            placeholder={req.placeholder}
            rows={3}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
            }}
            className={req.mathPreview ? 'mono' : ''}
            data-testid="prompt-input"
          />
        ) : (
          <input
            autoFocus
            value={value}
            placeholder={req.placeholder}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            onFocus={(e) => e.target.select()}
            className={req.mathPreview ? 'mono' : ''}
            data-testid="prompt-input"
          />
        )}
      </label>
      {req.mathPreview && (
        <>
          <MathPreview latex={value} display={!!req.multiline} />
          <p className="hint">Esempi: \frac{'{a}{b}'}, x^2, \sqrt{'{x}'}, \sum_{'{i=1}'}^n, \int_a^b, \alpha \beta. {req.multiline ? '⌘↩ per confermare.' : ''}</p>
        </>
      )}
    </Modal>
  );
}

export function Toasts() {
  const toasts = useUI((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite" data-ui>
      {toasts.map((t) => (
        <div key={t.id} className={`toast glass-strong ${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
          {t.message}
        </div>
      ))}
    </div>
  );
}

// ----------------------------------------------------------------------------- shortcuts overlay

const CATEGORY_ORDER = ['Navigazione', 'Pagine e blocchi', 'Formattazione testo', 'Disegno', 'Canvas', 'Appunti', 'Zoom e vista', 'Ricerca e impostazioni'];

export function ShortcutsOverlay() {
  const open = useUI((s) => s.shortcutsOpen);
  const [q, setQ] = useState('');
  const [defs, setDefs] = useState<ShortcutDef[]>(listShortcuts());
  useEffect(() => onRegistryChange(() => setDefs(listShortcuts())), []);
  useEffect(() => {
    if (open) setDefs(listShortcuts());
  }, [open]);
  if (!open) return null;
  const query = q.trim().toLowerCase();
  const filtered = defs.filter((d) => !query || d.label.toLowerCase().includes(query) || d.keys.some((k) => formatCombo(k).toLowerCase().includes(query)) || d.category.toLowerCase().includes(query));
  const groups = CATEGORY_ORDER.map((c) => ({ c, items: filtered.filter((d) => d.category === c) })).filter((g) => g.items.length);
  return (
    <Modal title="Scorciatoie da tastiera" onClose={() => useUI.getState().set({ shortcutsOpen: false })} wide testid="shortcuts-overlay">
      <div className="search-field">
        <Search size={15} />
        <input autoFocus placeholder="Cerca una scorciatoia…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Cerca scorciatoia" />
      </div>
      <div className="shortcut-grid">
        {groups.map((g) => (
          <section key={g.c}>
            <h3>{g.c}</h3>
            <ul>
              {g.items.map((d) => (
                <li key={d.id}>
                  <span>
                    {d.label}
                    {d.note && <em className="sc-note">{d.note}</em>}
                  </span>
                  <span className="kbd-group">
                    {d.keys.map((k) => (
                      <kbd key={k}>{formatCombo(k)}</kbd>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {groups.length === 0 && <p className="empty">Nessuna scorciatoia trovata.</p>}
      </div>
    </Modal>
  );
}

// ----------------------------------------------------------------------------- global search

interface Result {
  kind: 'notebook' | 'section' | 'page';
  id: ID;
  title: string;
  context: string;
  snippet?: string;
  matchStart?: number;
}

function highlight(text: string, q: string): ReactNode {
  if (!q) return text;
  const i = text.toLowerCase().indexOf(q);
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

export function searchWorkspace(ws: ReturnType<typeof useStore.getState>['workspace'], query: string): Result[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: Result[] = [];
  for (const nid of ws.notebookIds) {
    const nb = ws.notebooks[nid];
    if (nb.name.toLowerCase().includes(q)) out.push({ kind: 'notebook', id: nid, title: nb.name, context: 'Blocco appunti' });
    for (const sid of nb.sectionIds) {
      const s = ws.sections[sid];
      if (s.name.toLowerCase().includes(q)) out.push({ kind: 'section', id: sid, title: s.name, context: nb.name });
      for (const pid of s.pageIds) {
        const p = ws.pages[pid];
        const inTitle = p.title.toLowerCase().includes(q);
        const idx = p.searchText.toLowerCase().indexOf(q);
        if (inTitle || idx >= 0) {
          let snippet: string | undefined;
          if (idx >= 0) {
            const start = Math.max(0, idx - 40);
            snippet = (start > 0 ? '…' : '') + p.searchText.slice(start, idx + q.length + 60).replace(/\s+/g, ' ') + '…';
          }
          out.push({ kind: 'page', id: pid, title: p.title, context: `${nb.name} › ${s.name}`, snippet });
        }
      }
    }
  }
  // Pages matching the title first, then content matches.
  return out.sort((a, b) => {
    const rank = (r: Result) => (r.kind === 'page' ? (r.title.toLowerCase().includes(q) ? 0 : 1) : 2);
    return rank(a) - rank(b);
  });
}

/** After opening a page from search, select and reveal the first text block containing the query. */
async function locateInPage(pageId: ID, query: string) {
  const st = useStore.getState();
  const page = await st.ensurePageLoaded(pageId);
  const q = query.toLowerCase();
  for (const id of page.order) {
    const it = page.items[id];
    if (it?.type === 'text' && docToText(it.doc).toLowerCase().includes(q)) {
      useStore.getState().setSelection([id]);
      requestAnimationFrame(() => revealRect(itemBounds(it, page.items)));
      return;
    }
  }
}

export function SearchDialog() {
  const open = useUI((s) => s.searchOpen);
  const ws = useStore((s) => s.workspace);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const results = useMemo(() => searchWorkspace(ws, q).slice(0, 60), [ws, q]);
  useEffect(() => setActive(0), [q]);
  if (!open) return null;
  const close = () => useUI.getState().set({ searchOpen: false });
  const go = (r: Result) => {
    close();
    const st = useStore.getState();
    if (r.kind === 'notebook') st.selectNotebook(r.id);
    else if (r.kind === 'section') st.selectSection(r.id);
    else void st.openPage(r.id).then(() => locateInPage(r.id, q.trim()));
  };
  const query = q.trim().toLowerCase();
  return (
    <Modal title="Cerca" onClose={close} wide testid="search-dialog">
      <div className="search-field big">
        <Search size={17} />
        <input
          autoFocus
          placeholder="Cerca in blocchi, sezioni, titoli e testo delle pagine…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(results.length - 1, a + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === 'Enter' && results[active]) go(results[active]);
          }}
          aria-label="Testo da cercare"
          data-testid="search-input"
        />
      </div>
      <ul className="search-results" role="listbox">
        {results.map((r, i) => (
          <li key={`${r.kind}-${r.id}`} role="option" aria-selected={i === active} className={i === active ? 'active' : ''} onMouseEnter={() => setActive(i)} onClick={() => go(r)}>
            <span className={`res-kind ${r.kind}`}>{r.kind === 'page' ? 'Pagina' : r.kind === 'section' ? 'Sezione' : 'Blocco'}</span>
            <div className="res-main">
              <div className="res-title">{highlight(r.title, query)}</div>
              <div className="res-ctx">{r.context}</div>
              {r.snippet && <div className="res-snippet">{highlight(r.snippet, query)}</div>}
            </div>
          </li>
        ))}
        {query && results.length === 0 && <li className="empty">Nessun risultato per “{q}”.</li>}
        {!query && <li className="empty">Digita per cercare. Il testo nelle immagini e la scrittura a mano non sono indicizzati.</li>}
      </ul>
    </Modal>
  );
}

// ----------------------------------------------------------------------------- trash

export function TrashDialog() {
  const open = useUI((s) => s.trashOpen);
  const trash = useStore((s) => s.workspace.trash);
  if (!open) return null;
  const close = () => useUI.getState().set({ trashOpen: false });
  return (
    <Modal
      title="Cestino"
      onClose={close}
      testid="trash-dialog"
      footer={
        <button
          className="btn danger"
          disabled={!trash.length}
          onClick={async () => {
            if (await confirmDanger('Svuotare il cestino?', `${trash.length} pagine verranno eliminate definitivamente. L’operazione non è reversibile.`, 'Svuota cestino')) {
              await useStore.getState().emptyTrash();
              toast('Cestino svuotato', 'success');
            }
          }}
        >
          Svuota cestino
        </button>
      }
    >
      {trash.length === 0 ? (
        <p className="empty">Il cestino è vuoto.</p>
      ) : (
        <ul className="trash-list">
          {trash.map((t) => (
            <li key={t.page.id}>
              <div>
                <div className="res-title">{t.page.title}</div>
                <div className="res-ctx">
                  da “{t.fromSectionName}” · eliminata il {new Date(t.deletedAt).toLocaleString('it-IT', { dateStyle: 'medium', timeStyle: 'short' })}
                </div>
              </div>
              <div className="row-actions">
                <button
                  className="btn sm"
                  onClick={async () => {
                    const ok = await useStore.getState().restorePage(t.page.id);
                    toast(ok ? 'Pagina ripristinata' : 'Crea prima una sezione in cui ripristinare la pagina', ok ? 'success' : 'error');
                    if (ok) close();
                  }}
                >
                  <RotateCcw size={13} /> Ripristina
                </button>
                <button
                  className="icon-btn sm"
                  title="Elimina definitivamente"
                  aria-label="Elimina definitivamente"
                  onClick={async () => {
                    if (await confirmDanger('Eliminare definitivamente?', `"${t.page.title}" non potrà essere recuperata.`)) await useStore.getState().emptyTrash([t.page.id]);
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
