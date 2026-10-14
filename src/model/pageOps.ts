import type { JSONContent } from '@tiptap/core';
import type { CanvasItem, ID, PageContent } from '../types';
import { SCHEMA_VERSION } from '../types';
import { newId } from './workspaceOps';

export function emptyPage(id: ID): PageContent {
  return { id, schemaVersion: SCHEMA_VERSION, items: {}, order: [] };
}

export function addItems(page: PageContent, items: CanvasItem[]): PageContent {
  const next = { ...page.items };
  const order = page.order.slice();
  for (const it of items) {
    next[it.id] = it;
    if (!order.includes(it.id)) order.push(it.id);
  }
  return { ...page, items: next, order };
}

export function updateItems(page: PageContent, patches: Record<ID, Partial<CanvasItem>>): PageContent {
  const next = { ...page.items };
  let changed = false;
  for (const [id, patch] of Object.entries(patches)) {
    const cur = next[id];
    if (!cur) continue;
    next[id] = { ...cur, ...patch } as CanvasItem;
    changed = true;
  }
  return changed ? { ...page, items: next } : page;
}

/** Expands a set of ids with their attached annotations (children). */
export function withChildren(page: PageContent, ids: Iterable<ID>): Set<ID> {
  const set = new Set(ids);
  for (const it of Object.values(page.items)) if (it.parentId && set.has(it.parentId)) set.add(it.id);
  return set;
}

/** Deletes items, their annotations and any connector referencing them. */
export function deleteItems(page: PageContent, ids: Iterable<ID>): PageContent {
  const set = withChildren(page, ids);
  for (const it of Object.values(page.items)) {
    if (it.type === 'connector' && (set.has(it.fromId) || set.has(it.toId))) set.add(it.id);
  }
  if (set.size === 0) return page;
  const items = { ...page.items };
  for (const id of set) delete items[id];
  return { ...page, items, order: page.order.filter((id) => !set.has(id)) };
}

/** Translates top-level items by (dx, dy). Annotations follow their parent implicitly. */
export function translateItem(it: CanvasItem, dx: number, dy: number): Partial<CanvasItem> {
  if (it.parentId) return {};
  switch (it.type) {
    case 'text':
    case 'image':
      return { x: it.x + dx, y: it.y + dy };
    case 'stroke': {
      const pts = it.points.slice();
      for (let i = 0; i < pts.length; i += 2) {
        pts[i] += dx;
        pts[i + 1] += dy;
      }
      return { points: pts };
    }
    case 'shape':
      return { x1: it.x1 + dx, y1: it.y1 + dy, x2: it.x2 + dx, y2: it.y2 + dy };
    case 'connector':
      return {};
  }
}

/** Translates an annotation inside its parent's normalised frame. */
export function translateLocal(it: CanvasItem, ndx: number, ndy: number): Partial<CanvasItem> {
  switch (it.type) {
    case 'text':
      return { x: it.x + ndx, y: it.y + ndy };
    case 'stroke': {
      const pts = it.points.slice();
      for (let i = 0; i < pts.length; i += 2) {
        pts[i] += ndx;
        pts[i + 1] += ndy;
      }
      return { points: pts };
    }
    case 'shape':
      return { x1: it.x1 + ndx, y1: it.y1 + ndy, x2: it.x2 + ndx, y2: it.y2 + ndy };
    default:
      return {};
  }
}

/**
 * Clones items (and their annotations and connectors among them) with fresh ids.
 * Returns the cloned items in z-order and the id mapping.
 */
export function cloneItems(
  source: Record<ID, CanvasItem>,
  sourceOrder: ID[],
  ids: Iterable<ID>,
  dx: number,
  dy: number,
): { items: CanvasItem[]; map: Map<ID, ID> } {
  const pick = new Set(ids);
  for (const it of Object.values(source)) if (it.parentId && pick.has(it.parentId)) pick.add(it.id);
  // include connectors whose both ends are copied
  for (const it of Object.values(source)) {
    if (it.type === 'connector' && pick.has(it.fromId) && pick.has(it.toId)) pick.add(it.id);
  }
  const map = new Map<ID, ID>();
  for (const id of pick) map.set(id, newId());
  // Copies form their own groups, never joining the originals'.
  const groupMap = new Map<ID, ID>();
  const out: CanvasItem[] = [];
  for (const id of sourceOrder) {
    if (!pick.has(id)) continue;
    const it = source[id];
    if (!it) continue;
    if (it.type === 'connector' && (!map.has(it.fromId) || !map.has(it.toId))) continue;
    let copy = structuredClone(it) as CanvasItem;
    copy.id = map.get(id)!;
    if (copy.groupId) {
      if (!groupMap.has(copy.groupId)) groupMap.set(copy.groupId, newId());
      copy.groupId = groupMap.get(copy.groupId);
    }
    if (copy.parentId) {
      if (map.has(copy.parentId)) copy.parentId = map.get(copy.parentId);
      else continue; // orphan annotation without its image
    } else {
      copy = { ...copy, ...translateItem(copy, dx, dy) } as CanvasItem;
    }
    if (copy.type === 'connector') {
      copy.fromId = map.get(copy.fromId)!;
      copy.toId = map.get(copy.toId)!;
    }
    out.push(copy);
  }
  return { items: out, map };
}

export type ZMove = 'forward' | 'backward' | 'front' | 'back';

export function reorderZ(page: PageContent, ids: ID[], move: ZMove): PageContent {
  const sel = new Set(ids);
  let order = page.order.slice();
  if (move === 'front') order = [...order.filter((i) => !sel.has(i)), ...order.filter((i) => sel.has(i))];
  else if (move === 'back') order = [...order.filter((i) => sel.has(i)), ...order.filter((i) => !sel.has(i))];
  else if (move === 'forward') {
    for (let i = order.length - 2; i >= 0; i--) {
      if (sel.has(order[i]) && !sel.has(order[i + 1])) [order[i], order[i + 1]] = [order[i + 1], order[i]];
    }
  } else {
    for (let i = 1; i < order.length; i++) {
      if (sel.has(order[i]) && !sel.has(order[i - 1])) [order[i], order[i - 1]] = [order[i - 1], order[i]];
    }
  }
  return { ...page, order };
}

/** Extracts plain text from a TipTap JSON document (used for search & titles). */
export function docToText(doc: JSONContent | undefined): string {
  if (!doc) return '';
  const parts: string[] = [];
  const walk = (n: JSONContent) => {
    if (n.type === 'text' && n.text) parts.push(n.text);
    if ((n.type === 'mathInline' || n.type === 'mathBlock') && n.attrs?.latex) parts.push(String(n.attrs.latex));
    if (n.content) n.content.forEach(walk);
    if (n.type && ['paragraph', 'heading', 'listItem', 'taskItem', 'codeBlock', 'blockquote', 'tableCell', 'tableHeader', 'mathBlock'].includes(n.type)) {
      parts.push('\n');
    }
  };
  walk(doc);
  return parts.join('').replace(/\n{2,}/g, '\n').trim();
}

export function pageSearchText(page: PageContent): string {
  const out: string[] = [];
  for (const id of page.order) {
    const it = page.items[id];
    if (it && it.type === 'text') out.push(docToText(it.doc));
  }
  return out.join('\n').slice(0, 20000);
}

export function referencedAssets(page: PageContent): Set<ID> {
  const s = new Set<ID>();
  for (const it of Object.values(page.items)) if (it.type === 'image') s.add(it.assetId);
  return s;
}

export function textDocFromPlain(text: string): JSONContent {
  const paras = text.split(/\r?\n/);
  return {
    type: 'doc',
    content: paras.map((p) => (p ? { type: 'paragraph', content: [{ type: 'text', text: p }] } : { type: 'paragraph' })),
  };
}

export const EMPTY_DOC: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] };

export function isDocEmpty(doc: JSONContent): boolean {
  const c = doc.content ?? [];
  if (c.length === 0) return true;
  return c.length === 1 && c[0].type === 'paragraph' && !(c[0].content && c[0].content.length);
}

/** Assigns a new shared group id to the given top-level items (at least two). */
export function groupItems(page: PageContent, ids: ID[]): PageContent {
  const tops = ids.filter((id) => page.items[id] && !page.items[id].parentId && page.items[id].type !== 'connector');
  if (tops.length < 2) return page;
  const gid = newId();
  const patches: Record<ID, Partial<CanvasItem>> = {};
  for (const id of tops) patches[id] = { groupId: gid };
  return updateItems(page, patches);
}

export function ungroupItems(page: PageContent, ids: ID[]): PageContent {
  const patches: Record<ID, Partial<CanvasItem>> = {};
  for (const id of ids) if (page.items[id]?.groupId) patches[id] = { groupId: undefined };
  return updateItems(page, patches);
}

/** Removes dangling references: connectors to missing items and annotations without their image. */
export function repairPage(page: PageContent): PageContent {
  const bad = new Set<ID>();
  for (const it of Object.values(page.items)) {
    if (it.type === 'connector' && (!page.items[it.fromId] || !page.items[it.toId] || it.fromId === it.toId)) bad.add(it.id);
    if (it.parentId && page.items[it.parentId]?.type !== 'image') bad.add(it.id);
  }
  const order = page.order.filter((id) => page.items[id] && !bad.has(id));
  const known = new Set(order);
  for (const id of Object.keys(page.items)) if (!bad.has(id) && !known.has(id)) order.push(id);
  if (!bad.size && order.length === page.order.length) return page;
  const items = { ...page.items };
  for (const id of bad) delete items[id];
  return { ...page, items, order };
}
