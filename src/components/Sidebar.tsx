import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen, ChevronLeft, ChevronRight, Copy, FileText, FolderInput, Layers, MoreHorizontal, Palette, Pencil, Plus, Trash2 } from 'lucide-react';
import { useStore } from '../store/useStore';
import { useSettings } from '../store/settings';
import { askText, confirmDanger, toast, useUI } from '../store/ui';
import { registerShortcuts } from '../shortcuts/registry';
import * as W from '../model/workspaceOps';
import type { ID } from '../types';

function relTime(ts: number): string {
  const d = Date.now() - ts;
  if (d < 60_000) return 'adesso';
  if (d < 3_600_000) return `${Math.floor(d / 60_000)} min fa`;
  const date = new Date(ts);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  return date.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

interface MenuItem {
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  onClick?: () => void;
  submenu?: Array<{ label: string; onClick: () => void; color?: string; disabled?: boolean }>;
}

function ItemMenu({ items, onClose, anchor }: { items: MenuItem[]; onClose: () => void; anchor: { x: number; y: number } }) {
  const ref = useRef<HTMLDivElement>(null);
  const [sub, setSub] = useState<number | null>(null);
  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('pointerdown', close, true);
    const off = registerShortcuts([{ id: 'menu-esc', keys: ['escape'], label: 'Chiudi menu', category: 'Navigazione', scope: 'global', inModal: true, hidden: true, run: () => onClose() }], { prepend: true });
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
                    disabled={s.disabled}
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

type DragKind = 'notebook' | 'section' | 'page';
let dragData: { kind: DragKind; id: ID } | null = null;

function useMenu() {
  const [menu, setMenu] = useState<{ id: ID; x: number; y: number } | null>(null);
  const open = (id: ID, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ id, x: e.clientX, y: e.clientY });
  };
  return { menu, open, close: () => setMenu(null) };
}

function PanelHeader({ title, icon, onAdd, addLabel, onCollapse }: { title: string; icon: ReactNode; onAdd?: () => void; addLabel: string; onCollapse: () => void }) {
  return (
    <div className="panel-header">
      <span className="panel-title">
        {icon}
        {title}
      </span>
      <div className="panel-actions">
        {onAdd && (
          <button className="icon-btn sm" onClick={onAdd} title={addLabel} aria-label={addLabel}>
            <Plus size={15} />
          </button>
        )}
        <button className="icon-btn sm" onClick={onCollapse} title={`Comprimi ${title.toLowerCase()}`} aria-label={`Comprimi ${title}`}>
          <ChevronLeft size={15} />
        </button>
      </div>
    </div>
  );
}

function CollapsedStrip({ label, icon, onExpand }: { label: string; icon: ReactNode; onExpand: () => void }) {
  return (
    <button className="collapsed-strip" onClick={onExpand} title={`Mostra ${label.toLowerCase()}`} aria-label={`Mostra ${label}`}>
      {icon}
      <span className="vertical-label">{label}</span>
    </button>
  );
}

function Resizer({ onResize }: { onResize: (dx: number) => void }) {
  const start = useRef<number | null>(null);
  return (
    <div
      className="resizer"
      role="separator"
      aria-orientation="vertical"
      onPointerDown={(e) => {
        start.current = e.clientX;
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (start.current === null) return;
        const dx = e.clientX - start.current;
        start.current = e.clientX;
        onResize(dx);
      }}
      onPointerUp={() => (start.current = null)}
      onDoubleClick={() => onResize(0)}
    />
  );
}

const clampW = (w: number) => Math.max(120, Math.min(380, w));

/** Compact notebook switcher: coloured initials, full panel on demand. */
function NotebookRail({ onExpand }: { onExpand: () => void }) {
  const ws = useStore((s) => s.workspace);
  const current = useStore((s) => s.notebookId);
  const add = async () => {
    const name = await askText({ title: 'Nuovo blocco appunti', label: 'Nome', initial: '', placeholder: 'Es. Ricerca Operativa', confirmLabel: 'Crea' });
    if (name?.trim()) useStore.getState().addNotebook(name.trim());
  };
  return (
    <nav className="nb-rail" aria-label="Blocchi appunti">
      <button className="icon-btn sm" onClick={onExpand} title="Mostra elenco blocchi appunti" aria-label="Mostra Blocchi">
        <BookOpen size={15} />
      </button>
      <div className="nb-rail-list">
        {ws.notebookIds.map((id) => {
          const nb = ws.notebooks[id];
          return (
            <button key={id} className={`nb-chip${id === current ? ' active' : ''}`} style={{ ['--nb' as string]: nb.color }} onClick={() => useStore.getState().selectNotebook(id)} title={nb.name} aria-label={`Blocco ${nb.name}`} aria-current={id === current}>
              {nb.name.trim().charAt(0).toUpperCase() || '?'}
            </button>
          );
        })}
      </div>
      <button className="icon-btn sm" onClick={add} title="Nuovo blocco appunti" aria-label="Nuovo blocco appunti">
        <Plus size={15} />
      </button>
    </nav>
  );
}

export function Sidebar({ overlay = false }: { overlay?: boolean }) {
  const layout = useSettings((s) => s.layout);
  const setLayout = useSettings((s) => s.setLayout);
  return (
    <aside className={`sidebar${overlay ? ' overlay glass' : ''}`} aria-label="Navigazione">
      {layout.notebooksVisible ? (
        <>
          <section className="panel" style={{ width: layout.notebooksWidth }}>
            <NotebookList onCollapse={() => setLayout({ notebooksVisible: false })} />
          </section>
          <Resizer onResize={(dx) => setLayout({ notebooksWidth: clampW(useSettings.getState().layout.notebooksWidth + dx) })} />
        </>
      ) : (
        <NotebookRail onExpand={() => setLayout({ notebooksVisible: true })} />
      )}
      {layout.sectionsVisible ? (
        <>
          <section className="panel" style={{ width: layout.sectionsWidth }}>
            <SectionList onCollapse={() => setLayout({ sectionsVisible: false })} />
          </section>
          <Resizer onResize={(dx) => setLayout({ sectionsWidth: clampW(useSettings.getState().layout.sectionsWidth + dx) })} />
        </>
      ) : (
        <CollapsedStrip label="Sezioni" icon={<Layers size={16} />} onExpand={() => setLayout({ sectionsVisible: true })} />
      )}
      {layout.pagesVisible ? (
        <>
          <section className="panel" style={{ width: layout.pagesWidth }}>
            <PageList onCollapse={() => setLayout({ pagesVisible: false })} />
          </section>
          <Resizer onResize={(dx) => setLayout({ pagesWidth: clampW(useSettings.getState().layout.pagesWidth + dx) })} />
        </>
      ) : (
        <CollapsedStrip label="Pagine" icon={<FileText size={16} />} onExpand={() => setLayout({ pagesVisible: true })} />
      )}
    </aside>
  );
}

function colorSubmenu(onPick: (c: string) => void) {
  return W.PALETTE.map((c, i) => ({ label: ['Blu', 'Viola', 'Rosa', 'Arancio', 'Giallo', 'Verde', 'Turchese', 'Grigio'][i], color: c, onClick: () => onPick(c) }));
}

function NotebookList({ onCollapse }: { onCollapse: () => void }) {
  const ws = useStore((s) => s.workspace);
  const current = useStore((s) => s.notebookId);
  const { menu, open, close } = useMenu();
  const [dropIdx, setDropIdx] = useState<number | null>(null);

  const add = async () => {
    const name = await askText({ title: 'Nuovo blocco appunti', label: 'Nome', initial: '', placeholder: 'Es. Ricerca Operativa', confirmLabel: 'Crea' });
    if (name?.trim()) useStore.getState().addNotebook(name.trim());
  };

  const rename = async (id: ID) => {
    const name = await askText({ title: 'Rinomina blocco appunti', label: 'Nome', initial: ws.notebooks[id].name, confirmLabel: 'Rinomina' });
    if (name?.trim()) useStore.getState().mutateWorkspace((w) => W.renameNotebook(w, id, name.trim()));
  };

  const remove = async (id: ID) => {
    const nb = ws.notebooks[id];
    const n = nb.sectionIds.reduce((a, s) => a + (ws.sections[s]?.pageIds.length ?? 0), 0);
    if (await confirmDanger('Eliminare il blocco appunti?', `"${nb.name}" e le sue ${nb.sectionIds.length} sezioni verranno eliminati. Le ${n} pagine finiranno nel cestino e potrai ripristinarle.`)) {
      useStore.getState().deleteNotebook(id);
      toast('Blocco appunti eliminato. Le pagine sono nel cestino.');
    }
  };

  return (
    <>
      <PanelHeader title="Blocchi" icon={<BookOpen size={14} />} onAdd={add} addLabel="Nuovo blocco appunti" onCollapse={onCollapse} />
      <ul className="nav-list" onDragLeave={() => setDropIdx(null)}>
        {ws.notebookIds.map((id, i) => {
          const nb = ws.notebooks[id];
          return (
            <li
              key={id}
              className={`nav-item${id === current ? ' active' : ''}${dropIdx === i ? ' drop-before' : ''}`}
              draggable
              onDragStart={(e) => {
                dragData = { kind: 'notebook', id };
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', nb.name);
              }}
              onDragOver={(e) => {
                if (dragData?.kind === 'notebook') {
                  e.preventDefault();
                  setDropIdx(i);
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragData?.kind === 'notebook') {
                  const from = ws.notebookIds.indexOf(dragData.id);
                  useStore.getState().mutateWorkspace((w) => W.reorderNotebook(w, dragData!.id, from < i ? i - 1 : i));
                }
                setDropIdx(null);
                dragData = null;
              }}
              onClick={() => useStore.getState().selectNotebook(id)}
              onDoubleClick={() => rename(id)}
              onContextMenu={(e) => open(id, e)}
              title={nb.name}
            >
              <span className="nb-icon" style={{ background: nb.color }}>
                {nb.name.trim().charAt(0).toUpperCase() || '?'}
              </span>
              <span className="nav-label">{nb.name}</span>
              <button className="icon-btn xs more" onClick={(e) => open(id, e)} aria-label="Azioni blocco">
                <MoreHorizontal size={14} />
              </button>
            </li>
          );
        })}
        {ws.notebookIds.length === 0 && (
          <li className="nav-empty">
            Nessun blocco.
            <button className="link-btn" onClick={add}>
              Creane uno
            </button>
          </li>
        )}
      </ul>
      {menu && ws.notebooks[menu.id] && (
        <ItemMenu
          anchor={menu}
          onClose={close}
          items={[
            { label: 'Rinomina', icon: <Pencil size={14} />, onClick: () => rename(menu.id) },
            { label: 'Colore', icon: <Palette size={14} />, submenu: colorSubmenu((c) => useStore.getState().mutateWorkspace((w) => W.setNotebookColor(w, menu.id, c))) },
            { label: 'Elimina', icon: <Trash2 size={14} />, danger: true, onClick: () => remove(menu.id) },
          ]}
        />
      )}
    </>
  );
}

function SectionList({ onCollapse }: { onCollapse: () => void }) {
  const ws = useStore((s) => s.workspace);
  const notebookId = useStore((s) => s.notebookId);
  const current = useStore((s) => s.sectionId);
  const { menu, open, close } = useMenu();
  const [dropIdx, setDropIdx] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<ID | null>(null);
  const nb = notebookId ? ws.notebooks[notebookId] : null;

  const add = async () => {
    if (!nb) return;
    const name = await askText({ title: 'Nuova sezione', label: 'Nome', initial: '', placeholder: 'Es. Lezioni', confirmLabel: 'Crea' });
    if (name?.trim()) useStore.getState().addSection(nb.id, name.trim());
  };
  const rename = async (id: ID) => {
    const name = await askText({ title: 'Rinomina sezione', label: 'Nome', initial: ws.sections[id].name, confirmLabel: 'Rinomina' });
    if (name?.trim()) useStore.getState().mutateWorkspace((w) => W.renameSection(w, id, name.trim()));
  };
  const remove = async (id: ID) => {
    const s = ws.sections[id];
    if (await confirmDanger('Eliminare la sezione?', `"${s.name}" verrà eliminata. Le sue ${s.pageIds.length} pagine finiranno nel cestino.`)) {
      useStore.getState().deleteSection(id);
      toast('Sezione eliminata. Le pagine sono nel cestino.');
    }
  };

  return (
    <>
      <PanelHeader title="Sezioni" icon={<Layers size={14} />} onAdd={nb ? add : undefined} addLabel="Nuova sezione" onCollapse={onCollapse} />
      {nb && <div className="panel-sub">{nb.name}</div>}
      <ul className="nav-list" onDragLeave={() => setDropIdx(null)}>
        {nb?.sectionIds.map((id, i) => {
          const s = ws.sections[id];
          return (
            <li
              key={id}
              className={`nav-item section${id === current ? ' active' : ''}${dropIdx === i ? ' drop-before' : ''}${dropTarget === id ? ' drop-into' : ''}`}
              draggable
              onDragStart={(e) => {
                dragData = { kind: 'section', id };
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', s.name);
              }}
              onDragOver={(e) => {
                if (dragData?.kind === 'section') {
                  e.preventDefault();
                  setDropIdx(i);
                } else if (dragData?.kind === 'page') {
                  e.preventDefault();
                  setDropTarget(id);
                }
              }}
              onDragLeave={() => setDropTarget(null)}
              onDrop={(e) => {
                e.preventDefault();
                if (dragData?.kind === 'section') {
                  const from = nb.sectionIds.indexOf(dragData.id);
                  useStore.getState().mutateWorkspace((w) => W.reorderSection(w, dragData!.id, from < i ? i - 1 : i));
                } else if (dragData?.kind === 'page') {
                  const pid = dragData.id;
                  useStore.getState().mutateWorkspace((w) => W.movePage(w, pid, id));
                  toast(`Pagina spostata in "${s.name}"`);
                }
                setDropIdx(null);
                setDropTarget(null);
                dragData = null;
              }}
              onClick={() => useStore.getState().selectSection(id)}
              onDoubleClick={() => rename(id)}
              onContextMenu={(e) => open(id, e)}
              title={s.name}
            >
              <span className="section-tab" style={{ background: s.color }} />
              <span className="nav-label">{s.name}</span>
              <span className="count">{s.pageIds.length}</span>
              <button className="icon-btn xs more" onClick={(e) => open(id, e)} aria-label="Azioni sezione">
                <MoreHorizontal size={14} />
              </button>
            </li>
          );
        })}
        {nb && nb.sectionIds.length === 0 && (
          <li className="nav-empty">
            Nessuna sezione.
            <button className="link-btn" onClick={add}>
              Aggiungi
            </button>
          </li>
        )}
        {!nb && <li className="nav-empty">Seleziona un blocco appunti.</li>}
      </ul>
      {menu && ws.sections[menu.id] && (
        <ItemMenu
          anchor={menu}
          onClose={close}
          items={[
            { label: 'Rinomina', icon: <Pencil size={14} />, onClick: () => rename(menu.id) },
            { label: 'Colore', icon: <Palette size={14} />, submenu: colorSubmenu((c) => useStore.getState().mutateWorkspace((w) => W.setSectionColor(w, menu.id, c))) },
            { label: 'Elimina', icon: <Trash2 size={14} />, danger: true, onClick: () => remove(menu.id) },
          ]}
        />
      )}
    </>
  );
}

function PageList({ onCollapse }: { onCollapse: () => void }) {
  const ws = useStore((s) => s.workspace);
  const sectionId = useStore((s) => s.sectionId);
  const current = useStore((s) => s.pageId);
  const { menu, open, close } = useMenu();
  const [dropIdx, setDropIdx] = useState<number | null>(null);
  const sec = sectionId ? ws.sections[sectionId] : null;
  const trashCount = ws.trash.length;

  const rename = async (id: ID) => {
    const title = await askText({ title: 'Rinomina pagina', label: 'Titolo', initial: ws.pages[id].title, confirmLabel: 'Rinomina' });
    if (title?.trim()) useStore.getState().mutateWorkspace((w) => W.renamePage(w, id, title.trim()));
  };
  const remove = async (id: ID) => {
    if (await confirmDanger('Spostare la pagina nel cestino?', `"${ws.pages[id].title}" potrà essere ripristinata dal cestino.`, 'Sposta nel cestino')) {
      useStore.getState().deletePage(id);
    }
  };

  const moveTargets = (pid: ID) => {
    const out: Array<{ label: string; onClick: () => void; disabled?: boolean }> = [];
    for (const nid of ws.notebookIds) {
      for (const sid of ws.notebooks[nid].sectionIds) {
        out.push({
          label: `${ws.notebooks[nid].name} › ${ws.sections[sid].name}`,
          disabled: sid === ws.pages[pid]?.sectionId,
          onClick: () => {
            useStore.getState().mutateWorkspace((w) => W.movePage(w, pid, sid));
            toast(`Spostata in "${ws.sections[sid].name}"`);
          },
        });
      }
    }
    return out;
  };

  return (
    <>
      <PanelHeader title="Pagine" icon={<FileText size={14} />} onAdd={sec ? () => useStore.getState().addPage() : undefined} addLabel="Nuova pagina" onCollapse={onCollapse} />
      {sec && <div className="panel-sub">{sec.name}</div>}
      <ul className="nav-list pages" onDragLeave={() => setDropIdx(null)}>
        {sec?.pageIds.map((id, i) => {
          const p = ws.pages[id];
          if (!p) return null;
          return (
            <li
              key={id}
              className={`nav-item page${id === current ? ' active' : ''}${dropIdx === i ? ' drop-before' : ''}`}
              draggable
              onDragStart={(e) => {
                dragData = { kind: 'page', id };
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', p.title);
              }}
              onDragOver={(e) => {
                if (dragData?.kind === 'page') {
                  e.preventDefault();
                  setDropIdx(i);
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragData?.kind === 'page') {
                  const dragged = dragData.id;
                  const from = sec.pageIds.indexOf(dragged);
                  const to = from >= 0 && from < i ? i - 1 : i;
                  useStore.getState().mutateWorkspace((w) => W.movePage(w, dragged, sec.id, to));
                }
                setDropIdx(null);
                dragData = null;
              }}
              onClick={() => void useStore.getState().openPage(id)}
              onDoubleClick={() => rename(id)}
              onContextMenu={(e) => open(id, e)}
              title={p.title}
            >
              <div className="page-text">
                <span className="nav-label">{p.title || 'Senza titolo'}</span>
                <span className="page-meta">{relTime(p.updatedAt)}</span>
              </div>
              <button className="icon-btn xs more" onClick={(e) => open(id, e)} aria-label="Azioni pagina">
                <MoreHorizontal size={14} />
              </button>
            </li>
          );
        })}
        {sec && sec.pageIds.length === 0 && (
          <li className="nav-empty">
            Sezione vuota.
            <button className="link-btn" onClick={() => useStore.getState().addPage()}>
              Nuova pagina
            </button>
          </li>
        )}
        {!sec && <li className="nav-empty">Seleziona una sezione.</li>}
      </ul>
      <button className="trash-link" onClick={() => useUI.getState().set({ trashOpen: true })}>
        <Trash2 size={14} /> Cestino {trashCount > 0 && <span className="count">{trashCount}</span>}
      </button>
      {menu && ws.pages[menu.id] && (
        <ItemMenu
          anchor={menu}
          onClose={close}
          items={[
            { label: 'Rinomina', icon: <Pencil size={14} />, onClick: () => rename(menu.id) },
            { label: 'Duplica', icon: <Copy size={14} />, onClick: () => void useStore.getState().duplicatePage(menu.id) },
            { label: 'Sposta in…', icon: <FolderInput size={14} />, submenu: moveTargets(menu.id) },
            { label: 'Sposta nel cestino', icon: <Trash2 size={14} />, danger: true, onClick: () => remove(menu.id) },
          ]}
        />
      )}
    </>
  );
}
