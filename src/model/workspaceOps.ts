import { nanoid } from 'nanoid';
import type { ID, Notebook, PageMeta, Section, TrashEntry, Workspace } from '../types';
import { SCHEMA_VERSION } from '../types';

export const PALETTE = ['#5b8def', '#9b6bf2', '#e86aa6', '#f0805a', '#e9b949', '#4fbf8b', '#3fb6c9', '#8a94a6'];

export const newId = (): ID => nanoid(12);

export function emptyWorkspace(): Workspace {
  return { schemaVersion: SCHEMA_VERSION, notebookIds: [], notebooks: {}, sections: {}, pages: {}, trash: [] };
}

function pickColor(i: number): string {
  return PALETTE[i % PALETTE.length];
}

export function createNotebook(ws: Workspace, name: string, id: ID = newId()): Workspace {
  const now = Date.now();
  const nb: Notebook = { id, name, color: pickColor(ws.notebookIds.length), sectionIds: [], createdAt: now, updatedAt: now };
  return { ...ws, notebookIds: [...ws.notebookIds, id], notebooks: { ...ws.notebooks, [id]: nb } };
}

export function createSection(ws: Workspace, notebookId: ID, name: string, id: ID = newId()): Workspace {
  const nb = ws.notebooks[notebookId];
  if (!nb) throw new Error('Notebook inesistente');
  const now = Date.now();
  const sec: Section = { id, notebookId, name, color: pickColor(nb.sectionIds.length + 2), pageIds: [], createdAt: now, updatedAt: now };
  return {
    ...ws,
    notebooks: { ...ws.notebooks, [notebookId]: { ...nb, sectionIds: [...nb.sectionIds, id], updatedAt: now } },
    sections: { ...ws.sections, [id]: sec },
  };
}

export function createPage(ws: Workspace, sectionId: ID, title: string, id: ID = newId(), index?: number): Workspace {
  const sec = ws.sections[sectionId];
  if (!sec) throw new Error('Sezione inesistente');
  const now = Date.now();
  const page: PageMeta = { id, sectionId, title, createdAt: now, updatedAt: now, searchText: '' };
  const pageIds = [...sec.pageIds];
  pageIds.splice(index ?? pageIds.length, 0, id);
  return {
    ...ws,
    sections: { ...ws.sections, [sectionId]: { ...sec, pageIds, updatedAt: now } },
    pages: { ...ws.pages, [id]: page },
  };
}

export function renameNotebook(ws: Workspace, id: ID, name: string): Workspace {
  const nb = ws.notebooks[id];
  if (!nb) return ws;
  return { ...ws, notebooks: { ...ws.notebooks, [id]: { ...nb, name, updatedAt: Date.now() } } };
}

export function renameSection(ws: Workspace, id: ID, name: string): Workspace {
  const s = ws.sections[id];
  if (!s) return ws;
  return { ...ws, sections: { ...ws.sections, [id]: { ...s, name, updatedAt: Date.now() } } };
}

export function renamePage(ws: Workspace, id: ID, title: string): Workspace {
  const p = ws.pages[id];
  if (!p) return ws;
  return { ...ws, pages: { ...ws.pages, [id]: { ...p, title, updatedAt: Date.now() } } };
}

export function setNotebookColor(ws: Workspace, id: ID, color: string): Workspace {
  const nb = ws.notebooks[id];
  if (!nb) return ws;
  return { ...ws, notebooks: { ...ws.notebooks, [id]: { ...nb, color } } };
}

export function setSectionColor(ws: Workspace, id: ID, color: string): Workspace {
  const s = ws.sections[id];
  if (!s) return ws;
  return { ...ws, sections: { ...ws.sections, [id]: { ...s, color } } };
}

function moveInArray<T>(arr: T[], from: number, to: number): T[] {
  const out = arr.slice();
  const [x] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(to, out.length)), 0, x);
  return out;
}

export function reorderNotebook(ws: Workspace, id: ID, toIndex: number): Workspace {
  const from = ws.notebookIds.indexOf(id);
  if (from < 0) return ws;
  return { ...ws, notebookIds: moveInArray(ws.notebookIds, from, toIndex) };
}

export function reorderSection(ws: Workspace, id: ID, toIndex: number): Workspace {
  const s = ws.sections[id];
  if (!s) return ws;
  const nb = ws.notebooks[s.notebookId];
  const from = nb.sectionIds.indexOf(id);
  return { ...ws, notebooks: { ...ws.notebooks, [nb.id]: { ...nb, sectionIds: moveInArray(nb.sectionIds, from, toIndex) } } };
}

/** Moves a page within its section or into another section (at index, default end). */
export function movePage(ws: Workspace, pageId: ID, toSectionId: ID, toIndex?: number): Workspace {
  const page = ws.pages[pageId];
  const target = ws.sections[toSectionId];
  if (!page || !target) return ws;
  const source = ws.sections[page.sectionId];
  const now = Date.now();
  if (source.id === target.id) {
    const from = source.pageIds.indexOf(pageId);
    return {
      ...ws,
      sections: { ...ws.sections, [source.id]: { ...source, pageIds: moveInArray(source.pageIds, from, toIndex ?? source.pageIds.length - 1) } },
    };
  }
  const srcIds = source.pageIds.filter((p) => p !== pageId);
  const dstIds = target.pageIds.slice();
  dstIds.splice(toIndex ?? dstIds.length, 0, pageId);
  return {
    ...ws,
    sections: {
      ...ws.sections,
      [source.id]: { ...source, pageIds: srcIds, updatedAt: now },
      [target.id]: { ...target, pageIds: dstIds, updatedAt: now },
    },
    pages: { ...ws.pages, [pageId]: { ...page, sectionId: target.id, updatedAt: now } },
  };
}

/** Moves a page to the trash (content is kept in storage until the trash is emptied). */
export function trashPage(ws: Workspace, pageId: ID): Workspace {
  const page = ws.pages[pageId];
  if (!page) return ws;
  const sec = ws.sections[page.sectionId];
  const entry: TrashEntry = {
    page,
    deletedAt: Date.now(),
    fromSectionId: sec.id,
    fromNotebookId: sec.notebookId,
    fromSectionName: sec.name,
  };
  const pages = { ...ws.pages };
  delete pages[pageId];
  return {
    ...ws,
    pages,
    sections: { ...ws.sections, [sec.id]: { ...sec, pageIds: sec.pageIds.filter((p) => p !== pageId) } },
    trash: [entry, ...ws.trash],
  };
}

export function deleteSection(ws: Workspace, sectionId: ID): Workspace {
  const sec = ws.sections[sectionId];
  if (!sec) return ws;
  let next = ws;
  for (const pid of sec.pageIds) next = trashPage(next, pid);
  const nb = next.notebooks[sec.notebookId];
  const sections = { ...next.sections };
  delete sections[sectionId];
  return {
    ...next,
    sections,
    notebooks: { ...next.notebooks, [nb.id]: { ...nb, sectionIds: nb.sectionIds.filter((s) => s !== sectionId) } },
  };
}

export function deleteNotebook(ws: Workspace, notebookId: ID): Workspace {
  const nb = ws.notebooks[notebookId];
  if (!nb) return ws;
  let next = ws;
  for (const sid of nb.sectionIds) next = deleteSection(next, sid);
  const notebooks = { ...next.notebooks };
  delete notebooks[notebookId];
  return { ...next, notebooks, notebookIds: next.notebookIds.filter((n) => n !== notebookId) };
}

/**
 * Restores a page from the trash into its original section, or into `fallbackSectionId`
 * when the original no longer exists. Returns the section it was restored to.
 */
export function restorePage(ws: Workspace, pageId: ID, fallbackSectionId: ID | null): { ws: Workspace; sectionId: ID | null } {
  const entry = ws.trash.find((t) => t.page.id === pageId);
  if (!entry) return { ws, sectionId: null };
  const sectionId = ws.sections[entry.fromSectionId] ? entry.fromSectionId : fallbackSectionId;
  if (!sectionId || !ws.sections[sectionId]) return { ws, sectionId: null };
  const sec = ws.sections[sectionId];
  return {
    sectionId,
    ws: {
      ...ws,
      trash: ws.trash.filter((t) => t.page.id !== pageId),
      pages: { ...ws.pages, [pageId]: { ...entry.page, sectionId } },
      sections: { ...ws.sections, [sectionId]: { ...sec, pageIds: [...sec.pageIds, pageId] } },
    },
  };
}

export function removeFromTrash(ws: Workspace, pageIds: ID[]): Workspace {
  const set = new Set(pageIds);
  return { ...ws, trash: ws.trash.filter((t) => !set.has(t.page.id)) };
}

export function setPageMeta(ws: Workspace, id: ID, patch: Partial<PageMeta>): Workspace {
  const p = ws.pages[id];
  if (!p) return ws;
  return { ...ws, pages: { ...ws.pages, [id]: { ...p, ...patch } } };
}

/** Structural integrity check used after loading/importing. Repairs dangling references. */
export function repairWorkspace(ws: Workspace): Workspace {
  const notebookIds = ws.notebookIds.filter((id) => ws.notebooks[id]);
  const notebooks: Workspace['notebooks'] = {};
  const sections: Workspace['sections'] = {};
  const pages: Workspace['pages'] = {};
  for (const nid of notebookIds) {
    const nb = ws.notebooks[nid];
    const sectionIds = nb.sectionIds.filter((sid) => ws.sections[sid]);
    notebooks[nid] = { ...nb, sectionIds };
    for (const sid of sectionIds) {
      const s = ws.sections[sid];
      const pageIds = s.pageIds.filter((pid) => ws.pages[pid]);
      sections[sid] = { ...s, notebookId: nid, pageIds };
      for (const pid of pageIds) pages[pid] = { ...ws.pages[pid], sectionId: sid };
    }
  }
  return { ...ws, notebookIds, notebooks, sections, pages, trash: Array.isArray(ws.trash) ? ws.trash : [] };
}

export function findNotebookOfPage(ws: Workspace, pageId: ID): ID | null {
  const p = ws.pages[pageId];
  if (!p) return null;
  return ws.sections[p.sectionId]?.notebookId ?? null;
}
