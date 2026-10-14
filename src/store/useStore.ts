import { create } from 'zustand';
import type { CanvasItem, ID, PageContent, Tool, Viewport, Workspace } from '../types';
import * as W from '../model/workspaceOps';
import * as P from '../model/pageOps';
import { buildExampleWorkspace } from '../model/example';
import { constrainChanged } from '../lib/page';
import { deleteAssets, deletePages, listAssetIds, loadAllPages, loadPage, loadWorkspace } from '../storage/db';

export type SaveStatus = 'saved' | 'saving' | 'unsaved' | 'error';

const HISTORY_LIMIT = 150;
const LAST_PAGE_KEY = 'glassnote.lastPage';

interface History {
  past: PageContent[];
  future: PageContent[];
}

let initPromise: Promise<void> | null = null;

/** Module-level dirty tracking consumed by the autosave service. */
export const dirty = { ws: false, pages: new Set<ID>() };

export interface AppState {
  loaded: boolean;
  loadError: string | null;
  workspace: Workspace;
  notebookId: ID | null;
  sectionId: ID | null;
  pageId: ID | null;
  pages: Record<ID, PageContent>;
  history: Record<ID, History>;
  viewports: Record<ID, Viewport>;
  selection: ID[];
  editingId: ID | null;
  tool: Tool;
  saveStatus: SaveStatus;
  saveError: string | null;
  dirtyTick: number;
  lastSavedAt: number | null;
  /** Page whose on-sheet title should receive focus (set when a page is created). */
  focusTitleFor: ID | null;

  init: () => Promise<void>;
  initInternal: () => Promise<void>;
  markDirty: (pageId?: ID) => void;
  mutateWorkspace: (fn: (ws: Workspace) => Workspace) => void;

  selectNotebook: (id: ID) => void;
  selectSection: (id: ID) => void;
  openPage: (id: ID) => Promise<void>;
  ensurePageLoaded: (id: ID) => Promise<PageContent>;

  addNotebook: (name: string) => ID;
  addSection: (notebookId: ID, name: string) => ID;
  addPage: (sectionId?: ID, title?: string) => ID | null;
  duplicatePage: (id: ID) => Promise<ID | null>;
  deletePage: (id: ID) => void;
  deleteSection: (id: ID) => void;
  deleteNotebook: (id: ID) => void;
  restorePage: (id: ID) => Promise<boolean>;
  emptyTrash: (ids?: ID[]) => Promise<void>;
  garbageCollectAssets: () => Promise<number>;

  // page content
  currentPage: () => PageContent | null;
  updatePage: (fn: (p: PageContent) => PageContent, record?: boolean, pageId?: ID) => void;
  commitFrom: (before: PageContent) => void;
  undo: () => boolean;
  redo: () => boolean;
  canUndo: () => boolean;
  canRedo: () => boolean;

  setSelection: (ids: ID[]) => void;
  setEditing: (id: ID | null) => void;
  setTool: (t: Tool) => void;
  setViewport: (pageId: ID, v: Viewport) => void;
  setSaveStatus: (s: SaveStatus, err?: string | null) => void;
}

function rememberPage(id: ID | null) {
  try {
    if (id) localStorage.setItem(LAST_PAGE_KEY, id);
  } catch {
    /* ignore */
  }
}

export const useStore = create<AppState>((set, get) => ({
  loaded: false,
  loadError: null,
  workspace: W.emptyWorkspace(),
  notebookId: null,
  sectionId: null,
  pageId: null,
  pages: {},
  history: {},
  viewports: {},
  selection: [],
  editingId: null,
  tool: 'select',
  saveStatus: 'saved',
  saveError: null,
  dirtyTick: 0,
  lastSavedAt: null,
  focusTitleFor: null,

  init: () => {
    // Idempotent: React StrictMode runs mount effects twice in development.
    if (!initPromise) initPromise = get().initInternal();
    return initPromise;
  },

  initInternal: async () => {
    try {
      let ws = await loadWorkspace();
      let preloaded: Record<ID, PageContent> = {};
      if (!ws) {
        const ex = buildExampleWorkspace();
        ws = ex.workspace;
        preloaded = ex.pages;
        dirty.ws = true;
        for (const id of Object.keys(preloaded)) dirty.pages.add(id);
      }
      ws = W.repairWorkspace(ws);
      let last: string | null = null;
      try {
        last = localStorage.getItem(LAST_PAGE_KEY);
      } catch {
        /* ignore */
      }
      const pageId = last && ws.pages[last] ? last : firstPage(ws);
      const sectionId = pageId ? ws.pages[pageId].sectionId : firstSection(ws);
      const notebookId = sectionId ? ws.sections[sectionId].notebookId : ws.notebookIds[0] ?? null;
      set((s) => ({
        workspace: ws!,
        pages: preloaded,
        notebookId,
        sectionId,
        pageId: null,
        loaded: true,
        dirtyTick: s.dirtyTick + (dirty.ws ? 1 : 0),
      }));
      if (pageId) await get().openPage(pageId);
      // Asset GC is safe at startup because no undo history references removed images.
      void get().garbageCollectAssets().catch(() => undefined);
    } catch (e) {
      console.error(e);
      set({ loadError: e instanceof Error ? e.message : String(e), loaded: true });
    }
  },

  markDirty: (pageId) => {
    if (pageId) dirty.pages.add(pageId);
    else dirty.ws = true;
    set((s) => ({ dirtyTick: s.dirtyTick + 1, saveStatus: s.saveStatus === 'error' ? 'error' : 'unsaved' }));
  },

  mutateWorkspace: (fn) => {
    const next = fn(get().workspace);
    if (next === get().workspace) return;
    set({ workspace: next });
    get().markDirty();
  },

  selectNotebook: (id) => {
    const ws = get().workspace;
    const nb = ws.notebooks[id];
    if (!nb) return;
    const sectionId = nb.sectionIds[0] ?? null;
    set({ notebookId: id, sectionId, selection: [], editingId: null });
    const pid = sectionId ? ws.sections[sectionId].pageIds[0] : undefined;
    if (pid) void get().openPage(pid);
    else set({ pageId: null });
  },

  selectSection: (id) => {
    const ws = get().workspace;
    const sec = ws.sections[id];
    if (!sec) return;
    set({ sectionId: id, notebookId: sec.notebookId, selection: [], editingId: null });
    const pid = sec.pageIds[0];
    if (pid) void get().openPage(pid);
    else set({ pageId: null });
  },

  ensurePageLoaded: async (id) => {
    const existing = get().pages[id];
    if (existing) return existing;
    const loadedPage = (await loadPage(id)) ?? P.emptyPage(id);
    // Another call may have loaded it meanwhile.
    const again = get().pages[id];
    if (again) return again;
    set((s) => ({ pages: { ...s.pages, [id]: loadedPage } }));
    return loadedPage;
  },

  openPage: async (id) => {
    const ws = get().workspace;
    const meta = ws.pages[id];
    if (!meta) return;
    const sec = ws.sections[meta.sectionId];
    set({ pageId: id, sectionId: sec.id, notebookId: sec.notebookId, selection: [], editingId: null });
    rememberPage(id);
    await get().ensurePageLoaded(id);
  },

  addNotebook: (name) => {
    const id = W.newId();
    const sid = W.newId();
    const pid = W.newId();
    get().mutateWorkspace((ws) => W.createPage(W.createSection(W.createNotebook(ws, name, id), id, 'Nuova sezione', sid), sid, 'Pagina senza titolo', pid));
    set((s) => ({ pages: { ...s.pages, [pid]: P.emptyPage(pid) } }));
    get().markDirty(pid);
    void get().openPage(pid);
    return id;
  },

  addSection: (notebookId, name) => {
    const sid = W.newId();
    const pid = W.newId();
    get().mutateWorkspace((ws) => W.createPage(W.createSection(ws, notebookId, name, sid), sid, 'Pagina senza titolo', pid));
    set((s) => ({ pages: { ...s.pages, [pid]: P.emptyPage(pid) } }));
    get().markDirty(pid);
    void get().openPage(pid);
    return sid;
  },

  addPage: (sectionId, title = 'Pagina senza titolo') => {
    const sid = sectionId ?? get().sectionId;
    if (!sid || !get().workspace.sections[sid]) return null;
    const pid = W.newId();
    get().mutateWorkspace((ws) => W.createPage(ws, sid, title, pid));
    set((s) => ({ pages: { ...s.pages, [pid]: P.emptyPage(pid) }, focusTitleFor: pid }));
    get().markDirty(pid);
    void get().openPage(pid);
    return pid;
  },

  duplicatePage: async (id) => {
    const ws = get().workspace;
    const meta = ws.pages[id];
    if (!meta) return null;
    const src = await get().ensurePageLoaded(id);
    const { items } = P.cloneItems(src.items, src.order, src.order, 0, 0);
    const pid = W.newId();
    const idx = ws.sections[meta.sectionId].pageIds.indexOf(id) + 1;
    get().mutateWorkspace((w) => W.setPageMeta(W.createPage(w, meta.sectionId, `${meta.title} (copia)`, pid, idx), pid, { searchText: meta.searchText }));
    const copy: PageContent = { ...P.addItems(P.emptyPage(pid), items), background: src.background };
    set((s) => ({ pages: { ...s.pages, [pid]: copy } }));
    get().markDirty(pid);
    await get().openPage(pid);
    return pid;
  },

  deletePage: (id) => {
    const ws = get().workspace;
    const meta = ws.pages[id];
    if (!meta) return;
    const sec = ws.sections[meta.sectionId];
    const idx = sec.pageIds.indexOf(id);
    get().mutateWorkspace((w) => W.trashPage(w, id));
    if (get().pageId === id) {
      const remaining = get().workspace.sections[sec.id].pageIds;
      const next = remaining[Math.min(idx, remaining.length - 1)];
      if (next) void get().openPage(next);
      else set({ pageId: null, selection: [], editingId: null });
    }
  },

  deleteSection: (id) => {
    const ws = get().workspace;
    const sec = ws.sections[id];
    if (!sec) return;
    const wasCurrent = get().sectionId === id;
    get().mutateWorkspace((w) => W.deleteSection(w, id));
    if (wasCurrent) {
      const nb = get().workspace.notebooks[sec.notebookId];
      const nextSec = nb?.sectionIds[0];
      if (nextSec) get().selectSection(nextSec);
      else set({ sectionId: null, pageId: null });
    }
  },

  deleteNotebook: (id) => {
    const wasCurrent = get().notebookId === id;
    get().mutateWorkspace((w) => W.deleteNotebook(w, id));
    if (wasCurrent) {
      const next = get().workspace.notebookIds[0];
      if (next) get().selectNotebook(next);
      else set({ notebookId: null, sectionId: null, pageId: null });
    }
  },

  restorePage: async (id) => {
    const { ws, sectionId } = W.restorePage(get().workspace, id, get().sectionId ?? firstSection(get().workspace));
    if (!sectionId) return false;
    set({ workspace: ws });
    get().markDirty();
    await get().openPage(id);
    return true;
  },

  emptyTrash: async (ids) => {
    const targets = ids ?? get().workspace.trash.map((t) => t.page.id);
    if (targets.length === 0) return;
    get().mutateWorkspace((w) => W.removeFromTrash(w, targets));
    set((s) => {
      const pages = { ...s.pages };
      const history = { ...s.history };
      for (const t of targets) {
        delete pages[t];
        delete history[t];
        dirty.pages.delete(t);
      }
      return { pages, history };
    });
    await deletePages(targets);
    // Images referenced only by deleted pages can be reclaimed now.
    await get().garbageCollectAssets();
  },

  garbageCollectAssets: async () => {
    const all = await loadAllPages();
    const referenced = new Set<ID>();
    const memPages = get().pages;
    const ids = new Set([...all.map((p) => p.id), ...Object.keys(memPages)]);
    for (const id of ids) {
      const p = memPages[id] ?? all.find((x) => x.id === id);
      if (p) for (const a of P.referencedAssets(p)) referenced.add(a);
    }
    // Pages in history (undo) may reference assets too.
    for (const h of Object.values(get().history)) {
      for (const p of [...h.past, ...h.future]) for (const a of P.referencedAssets(p)) referenced.add(a);
    }
    const stored = await listAssetIds();
    const orphan = stored.filter((a) => !referenced.has(a));
    if (orphan.length) await deleteAssets(orphan);
    return orphan.length;
  },

  currentPage: () => {
    const id = get().pageId;
    return id ? get().pages[id] ?? null : null;
  },

  updatePage: (fn, record = true, pageId) => {
    const id = pageId ?? get().pageId;
    if (!id) return;
    const cur = get().pages[id];
    if (!cur) return;
    const raw = fn(cur);
    if (raw === cur) return;
    // Keep edited objects within the two-A4 page width.
    const next = constrainChanged(cur, raw);
    set((s) => {
      const h = s.history[id] ?? { past: [], future: [] };
      return {
        pages: { ...s.pages, [id]: next },
        history: record ? { ...s.history, [id]: { past: [...h.past, cur].slice(-HISTORY_LIMIT), future: [] } } : s.history,
      };
    });
    get().markDirty(id);
  },

  commitFrom: (before) => {
    const id = get().pageId;
    if (!id || before.id !== id) return;
    const cur = get().pages[id];
    if (!cur || cur === before) return;
    set((s) => {
      const h = s.history[id] ?? { past: [], future: [] };
      return { history: { ...s.history, [id]: { past: [...h.past, before].slice(-HISTORY_LIMIT), future: [] } } };
    });
  },

  undo: () => {
    const id = get().pageId;
    if (!id) return false;
    const h = get().history[id];
    const cur = get().pages[id];
    if (!h || h.past.length === 0 || !cur) return false;
    const prev = h.past[h.past.length - 1];
    set((s) => ({
      pages: { ...s.pages, [id]: prev },
      history: { ...s.history, [id]: { past: h.past.slice(0, -1), future: [cur, ...h.future] } },
      selection: s.selection.filter((sid) => prev.items[sid]),
      editingId: null,
    }));
    get().markDirty(id);
    return true;
  },

  redo: () => {
    const id = get().pageId;
    if (!id) return false;
    const h = get().history[id];
    const cur = get().pages[id];
    if (!h || h.future.length === 0 || !cur) return false;
    const next = h.future[0];
    set((s) => ({
      pages: { ...s.pages, [id]: next },
      history: { ...s.history, [id]: { past: [...h.past, cur], future: h.future.slice(1) } },
      selection: s.selection.filter((sid) => next.items[sid]),
      editingId: null,
    }));
    get().markDirty(id);
    return true;
  },

  canUndo: () => {
    const id = get().pageId;
    return !!id && (get().history[id]?.past.length ?? 0) > 0;
  },
  canRedo: () => {
    const id = get().pageId;
    return !!id && (get().history[id]?.future.length ?? 0) > 0;
  },

  setSelection: (ids) => set({ selection: ids }),
  setEditing: (id) => set({ editingId: id }),
  // Leaving an active text block when switching tools is handled by the canvas (finishEditing).
  setTool: (t) => set({ tool: t, selection: t === 'select' ? get().selection : [] }),
  setViewport: (pageId, v) => set((s) => ({ viewports: { ...s.viewports, [pageId]: v } })),
  setSaveStatus: (saveStatus, err = null) =>
    set({ saveStatus, saveError: err, lastSavedAt: saveStatus === 'saved' ? Date.now() : get().lastSavedAt }),
}));

function firstSection(ws: Workspace): ID | null {
  for (const nid of ws.notebookIds) {
    const s = ws.notebooks[nid].sectionIds[0];
    if (s) return s;
  }
  return null;
}

function firstPage(ws: Workspace): ID | null {
  for (const nid of ws.notebookIds) {
    for (const sid of ws.notebooks[nid].sectionIds) {
      const p = ws.sections[sid].pageIds[0];
      if (p) return p;
    }
  }
  return null;
}

/** Convenience helpers used by canvas code. */
export function getItems(): Record<ID, CanvasItem> {
  return useStore.getState().currentPage()?.items ?? {};
}
