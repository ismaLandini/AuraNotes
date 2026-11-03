import { nanoid } from 'nanoid';
import type { ID, Notebook, PageContent, PageMeta, Section, TrashEntry, Workspace } from '../types';
import { SCHEMA_VERSION } from '../types';
import { pageSearchText } from './pageOps';

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

export function toggleNotebookStar(ws: Workspace, id: ID): Workspace {
  const nb = ws.notebooks[id];
  if (!nb) return ws;
  return { ...ws, notebooks: { ...ws.notebooks, [id]: { ...nb, starred: !nb.starred } } };
}

export function toggleSectionStar(ws: Workspace, id: ID): Workspace {
  const s = ws.sections[id];
  if (!s) return ws;
  return { ...ws, sections: { ...ws.sections, [id]: { ...s, starred: !s.starred } } };
}

export function togglePageStar(ws: Workspace, id: ID): Workspace {
  const p = ws.pages[id];
  if (!p) return ws;
  return { ...ws, pages: { ...ws.pages, [id]: { ...p, starred: !p.starred } } };
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

/** Moves a section (with its pages) into another notebook, at the end. No-op within the same notebook. */
export function moveSection(ws: Workspace, sectionId: ID, toNotebookId: ID): Workspace {
  const sec = ws.sections[sectionId];
  const target = ws.notebooks[toNotebookId];
  if (!sec || !target || sec.notebookId === toNotebookId) return ws;
  const source = ws.notebooks[sec.notebookId];
  const now = Date.now();
  return {
    ...ws,
    notebooks: {
      ...ws.notebooks,
      [source.id]: { ...source, sectionIds: source.sectionIds.filter((s) => s !== sectionId), updatedAt: now },
      [target.id]: { ...target, sectionIds: [...target.sectionIds, sectionId], updatedAt: now },
    },
    sections: { ...ws.sections, [sectionId]: { ...sec, notebookId: toNotebookId, updatedAt: now } },
  };
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

export function normalizeTag(raw: string): string {
  return raw
    .trim()
    .replace(/^#+/, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}_-]/gu, '')
    .slice(0, 32);
}

export function addPageTag(ws: Workspace, pageId: ID, rawTag: string): Workspace {
  const p = ws.pages[pageId];
  const tag = normalizeTag(rawTag);
  if (!p || !tag) return ws;
  const current = p.tags ?? [];
  if (current.includes(tag)) return ws;
  return {
    ...ws,
    pages: {
      ...ws.pages,
      [pageId]: { ...p, tags: [...current, tag], updatedAt: Date.now() },
    },
  };
}

export function removePageTag(ws: Workspace, pageId: ID, rawTag: string): Workspace {
  const p = ws.pages[pageId];
  const tag = normalizeTag(rawTag);
  if (!p || !p.tags || !p.tags.includes(tag)) return ws;
  const next = p.tags.filter((t) => t !== tag);
  return {
    ...ws,
    pages: {
      ...ws.pages,
      [pageId]: { ...p, tags: next.length ? next : undefined, updatedAt: Date.now() },
    },
  };
}

export function allWorkspaceTags(ws: Workspace, sectionId?: ID | null): string[] {
  const counts = new Map<string, number>();
  const pageIds = sectionId ? (ws.sections[sectionId]?.pageIds ?? []) : Object.keys(ws.pages);
  for (const pid of pageIds) {
    const p = ws.pages[pid];
    if (!p?.tags) continue;
    for (const t of p.tags) {
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([t]) => t);
}

const WIKI_LINK_RE = /\[\[([^[\]\n]+?)\]\]/g;

export function extractWikiLinks(text: string): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of text.matchAll(WIKI_LINK_RE)) {
    const target = m[1].trim();
    if (!target) continue;
    const key = target.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(target);
    }
  }
  return out;
}

export function resolveWikiLink(ws: Workspace, targetTitle: string, fromSectionId?: ID | null): PageMeta | null {
  const needle = targetTitle.trim().toLowerCase();
  if (!needle) return null;
  const matches = Object.values(ws.pages).filter((p) => (p.title || '').trim().toLowerCase() === needle);
  if (matches.length === 0) return null;
  if (fromSectionId) {
    const sameSec = matches.find((p) => p.sectionId === fromSectionId);
    if (sameSec) return sameSec;
    const fromNb = ws.sections[fromSectionId]?.notebookId;
    if (fromNb) {
      const sameNb = matches.find((p) => ws.sections[p.sectionId]?.notebookId === fromNb);
      if (sameNb) return sameNb;
    }
  }
  return matches[0];
}

export interface BacklinkEntry {
  page: PageMeta;
  notebookName: string;
  sectionName: string;
  snippet: string;
}

export function findBacklinks(
  ws: Workspace,
  targetPageId: ID,
  livePages?: Record<ID, PageContent>,
): BacklinkEntry[] {
  const target = ws.pages[targetPageId];
  if (!target) return [];
  const titleNeedle = (target.title || '').trim().toLowerCase();
  if (!titleNeedle) return [];
  const out: BacklinkEntry[] = [];
  for (const nbId of ws.notebookIds) {
    const nb = ws.notebooks[nbId];
    if (!nb) continue;
    for (const secId of nb.sectionIds) {
      const sec = ws.sections[secId];
      if (!sec) continue;
      for (const pid of sec.pageIds) {
        if (pid === targetPageId) continue;
        const p = ws.pages[pid];
        if (!p) continue;
        const live = livePages?.[pid];
        const rawText = live ? pageSearchText(live) : (p.searchText || '');
        const links = extractWikiLinks(rawText);
        if (!links.some((l) => l.toLowerCase() === titleNeedle)) continue;
        let snippet = '';
        const matchIdx = rawText.toLowerCase().indexOf(`[[${titleNeedle}]]`);
        if (matchIdx >= 0) {
          const start = Math.max(0, matchIdx - 28);
          const end = Math.min(rawText.length, matchIdx + titleNeedle.length + 40);
          snippet = (start > 0 ? '…' : '') + rawText.slice(start, end).replace(/\s+/g, ' ').trim() + (end < rawText.length ? '…' : '');
        }
        out.push({ page: p, notebookName: nb.name, sectionName: sec.name, snippet });
      }
    }
  }
  return out;
}

