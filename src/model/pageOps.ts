import type { JSONContent } from '@tiptap/core';
import type { CanvasItem, ID, ImageBlockAttrs, NoteContainerItem, PageContent, SheetDef } from '../types';
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
    case 'container':
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
    case 'container':
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
  if (!doc || typeof doc !== 'object') return '';
  const parts: string[] = [];
  const walk = (n: JSONContent | undefined | null) => {
    if (!n || typeof n !== 'object') return;
    if (n.type === 'text' && n.text) parts.push(n.text);
    if ((n.type === 'mathInline' || n.type === 'mathBlock') && n.attrs?.latex) parts.push(String(n.attrs.latex));
    if (n.type === 'imageBlock' && n.attrs?.alt) {
      parts.push(String(n.attrs.alt));
    }
    if (n.content && Array.isArray(n.content)) n.content.forEach(walk);
    if (n.type && ['paragraph', 'heading', 'listItem', 'taskItem', 'codeBlock', 'blockquote', 'tableCell', 'tableHeader', 'mathBlock', 'imageBlock'].includes(n.type)) {
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
    if (it && (it.type === 'text' || it.type === 'container')) out.push(docToText(it.doc));
  }
  return out.join('\n').slice(0, 20000);
}

export function extractDocAssets(doc: JSONContent | undefined | null, out: Set<ID>): void {
  if (!doc || typeof doc !== 'object') return;
  const walk = (n: JSONContent | undefined | null) => {
    if (!n || typeof n !== 'object') return;
    if (n.type === 'imageBlock') {
      if (n.attrs?.assetId) out.add(String(n.attrs.assetId));
      const src = n.attrs?.source as { type?: unknown; assetId?: unknown } | undefined | null;
      if (src && typeof src === 'object' && src.type === 'pdf' && typeof src.assetId === 'string' && src.assetId) {
        out.add(src.assetId);
      }
    }
    if (n.content && Array.isArray(n.content)) n.content.forEach(walk);
  };
  walk(doc);
}

export function referencedAssets(page: PageContent): Set<ID> {
  const s = new Set<ID>();
  if (!page || typeof page !== 'object') return s;
  if (typeof page.pdfAssetId === 'string' && page.pdfAssetId) {
    s.add(page.pdfAssetId);
  }
  if (Array.isArray(page.sheets)) {
    for (const sh of page.sheets) {
      if (sh && typeof sh.pdfAssetId === 'string' && sh.pdfAssetId) {
        s.add(sh.pdfAssetId);
      }
    }
  }
  if (!page.items || typeof page.items !== 'object') return s;
  for (const it of Object.values(page.items)) {
    if (!it) continue;
    if (it.type === 'image' && it.assetId) {
      s.add(it.assetId);
    } else if (it.type === 'container' && it.doc) {
      extractDocAssets(it.doc, s);
    } else if (it.type === 'text' && it.doc) {
      extractDocAssets(it.doc, s);
    }
  }
  return s;
}

export function textDocFromPlain(text: string): JSONContent {
  const paras = text.split(/\r\n?|\n/);
  return {
    type: 'doc',
    content: paras.map((p) => (p ? { type: 'paragraph', content: [{ type: 'text', text: p }] } : { type: 'paragraph' })),
  };
}

export const EMPTY_DOC: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] };

export function isDocEmpty(doc: JSONContent | null | undefined): boolean {
  if (!doc) return true;
  const hasContent = (node: JSONContent | undefined | null): boolean => {
    if (!node || typeof node !== 'object') return false;
    if (
      node.type === 'imageBlock' ||
      node.type === 'mathInline' ||
      node.type === 'mathBlock' ||
      node.type === 'horizontalRule' ||
      node.type === 'table'
    ) {
      return true;
    }
    if (node.type === 'text' && typeof node.text === 'string' && node.text.trim().length > 0) {
      return true;
    }
    if (Array.isArray(node.content)) {
      return node.content.some(hasContent);
    }
    return false;
  };
  return !hasContent(doc);
}

/**
 * Removes any plain text blocks or containers whose document is empty
 * (except `keepId` when it is currently being edited, or items attached to a connector).
 */
export function pruneEmptyTextItems(page: PageContent, keepId: ID | null = null): PageContent {
  const connected = new Set<ID>();
  for (const it of Object.values(page.items)) {
    if (it.type === 'connector') {
      connected.add(it.fromId);
      connected.add(it.toId);
    }
  }
  const emptyIds: ID[] = [];
  for (const [id, it] of Object.entries(page.items)) {
    if (id === keepId) continue;
    if ((it.type === 'text' || it.type === 'container') && it.variant === 'plain' && isDocEmpty(it.doc) && !connected.has(id)) {
      emptyIds.push(id);
    }
  }
  if (emptyIds.length === 0) return page;
  return deleteItems(page, emptyIds);
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

/**
 * A container is a free-standing image if and only if its document contains
 * exactly one block which is an imageBlock.
 */
export function isFreeImageContainer(item: CanvasItem | null | undefined): boolean {
  if (!item || (item.type !== 'container' && item.type !== 'text')) return false;
  const content = item.doc?.content;
  return Array.isArray(content) && content.length === 1 && content[0]?.type === 'imageBlock';
}

/** Removes dangling references and synchronizes derived properties (such as freeImage). */
export function repairPage(page: PageContent): PageContent {
  const bad = new Set<ID>();
  for (const it of Object.values(page.items)) {
    if (it.type === 'connector' && (!page.items[it.fromId] || !page.items[it.toId] || it.fromId === it.toId)) bad.add(it.id);
    if (it.parentId && page.items[it.parentId]?.type !== 'image' && page.items[it.parentId]?.type !== 'container') bad.add(it.id);
  }
  const order = page.order.filter((id) => page.items[id] && !bad.has(id));
  const known = new Set(order);
  for (const id of Object.keys(page.items)) if (!bad.has(id) && !known.has(id)) order.push(id);

  let itemsChanged = false;
  const items = { ...page.items };
  for (const id of bad) {
    delete items[id];
    itemsChanged = true;
  }

  for (const [id, it] of Object.entries(items)) {
    if (it.type === 'container') {
      const isFree = isFreeImageContainer(it);
      if (it.freeImage !== isFree) {
        items[id] = { ...it, freeImage: isFree };
        itemsChanged = true;
      }
    }
  }

  if (!itemsChanged && order.length === page.order.length) return page;
  return { ...page, items, order };
}

/** Recursively removes legacy ocr and highlights attributes from any imageBlock node in a document. */
export function stripOcrFromDoc(doc: JSONContent): JSONContent {
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.content)) return doc;
  let modified = false;
  const cleanNodes = (nodes: JSONContent[]): JSONContent[] => {
    return nodes.map((n) => {
      if (!n || typeof n !== 'object') return n;
      let node = n;
      if (n.type === 'imageBlock' && n.attrs && ('ocr' in n.attrs || 'highlights' in n.attrs)) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { ocr, highlights, ...cleanAttrs } = n.attrs as Record<string, unknown>;
        node = { ...n, attrs: cleanAttrs };
        modified = true;
      }
      if (node.content && Array.isArray(node.content)) {
        const nextChildren = cleanNodes(node.content);
        if (nextChildren !== node.content) {
          node = { ...node, content: nextChildren };
        }
      }
      return node;
    });
  };
  const nextContent = cleanNodes(doc.content);
  return modified ? { ...doc, content: nextContent } : doc;
}

/** Strips legacy ocr and highlights attributes from all containers in a page. */
export function stripOcrFromPage(page: PageContent): PageContent {
  if (!page || !page.items) return page;
  let modified = false;
  const nextItems = { ...page.items };
  for (const [id, it] of Object.entries(page.items)) {
    if ((it.type === 'container' || it.type === 'text') && it.doc) {
      const cleanDoc = stripOcrFromDoc(it.doc);
      if (cleanDoc !== it.doc) {
        nextItems[id] = { ...it, doc: cleanDoc };
        modified = true;
      }
    }
  }
  return modified ? { ...page, items: nextItems } : page;
}

/**
 * Migrates a PageContent object from schema version 1 to schema version 2.
 * - Text items are converted to NoteContainer items (type: 'container').
 * - Standalone image items are converted to NoteContainer items with freeImage: true,
 *   wrapping an imageBlock node in their document flow.
 * - Any child annotations with parentId pointing to an image are attached to the imageBlock's
 *   annotations attribute, while also preserving parentId compatibility.
 * - All IDs, connectors, coordinates, and z-order are preserved.
 */
export function migratePageV1toV2(page: PageContent): PageContent {
  if (!page || typeof page !== 'object') return page;
  if (page.schemaVersion && page.schemaVersion >= 2) {
    return repairPage(stripOcrFromPage(page));
  }

  const items: Record<ID, CanvasItem> = {};
  const order: ID[] = [];

  const childAnnotationsByParent = new Map<ID, CanvasItem[]>();
  for (const it of Object.values(page.items ?? {})) {
    if (it.parentId) {
      const arr = childAnnotationsByParent.get(it.parentId) ?? [];
      arr.push(it);
      childAnnotationsByParent.set(it.parentId, arr);
    }
  }

  const convertItem = (it: CanvasItem): CanvasItem => {
    if (it.type === 'text') {
      const container: NoteContainerItem = {
        id: it.id,
        type: 'container',
        x: it.x,
        y: it.y,
        w: it.w,
        h: it.h,
        doc: it.doc ?? EMPTY_DOC,
        variant: it.variant ?? 'plain',
        bg: it.bg,
        customW: it.customW,
        parentId: it.parentId,
        groupId: it.groupId,
        locked: it.locked,
      };
      return container;
    }
    if (it.type === 'image') {
      const childAnnotations = childAnnotationsByParent.get(it.id) ?? [];
      const attrs: ImageBlockAttrs = {
        assetId: it.assetId,
        width: it.w,
        naturalWidth: it.naturalWidth,
        naturalHeight: it.naturalHeight,
        mime: it.mime,
        rotation: it.rotation || 0,
        indent: 0,
        annotations: childAnnotations.length > 0 ? childAnnotations : undefined,
      };
      const container: NoteContainerItem = {
        id: it.id,
        type: 'container',
        x: it.x,
        y: it.y,
        w: it.w,
        h: it.h,
        freeImage: true,
        variant: 'plain',
        parentId: it.parentId,
        groupId: it.groupId,
        locked: it.locked,
        doc: {
          type: 'doc',
          content: [
            {
              type: 'imageBlock',
              attrs,
            },
          ],
        },
      };
      return container;
    }
    return it;
  };

  for (const id of page.order ?? []) {
    const it = page.items?.[id];
    if (!it) continue;
    items[id] = convertItem(it);
    order.push(id);
  }

  for (const [id, it] of Object.entries(page.items ?? {})) {
    if (!items[id]) {
      items[id] = convertItem(it);
      order.push(id);
    }
  }

  return repairPage({
    ...page,
    schemaVersion: 2,
    items,
    order,
  });
}

function sanitizeImageSourceInDoc(doc: JSONContent | undefined): { doc: JSONContent | undefined; changed: boolean } {
  if (!doc || typeof doc !== 'object') return { doc, changed: false };
  let changed = false;
  const walk = (n: JSONContent): JSONContent => {
    if (!n || typeof n !== 'object') return n;
    let nextNode = n;
    if (n.type === 'imageBlock' && n.attrs && 'source' in n.attrs) {
      const src = n.attrs.source as Record<string, unknown> | null | undefined;
      if (src !== undefined && src !== null) {
        const isValid =
          typeof src === 'object' &&
          src.type === 'pdf' &&
          typeof src.assetId === 'string' &&
          src.assetId.length > 0 &&
          typeof src.page === 'number' &&
          Number.isFinite(src.page) &&
          src.page >= 1;
        if (!isValid) {
          const nextAttrs = { ...n.attrs };
          delete nextAttrs.source;
          nextNode = { ...n, attrs: nextAttrs };
          changed = true;
        }
      }
    }
    if (nextNode.content && Array.isArray(nextNode.content)) {
      let childChanged = false;
      const nextContent = nextNode.content.map((c) => {
        const wc = walk(c);
        if (wc !== c) childChanged = true;
        return wc;
      });
      if (childChanged) {
        nextNode = { ...nextNode, content: nextContent };
        changed = true;
      }
    }
    return nextNode;
  };
  const nextDoc = walk(doc);
  return { doc: changed ? nextDoc : doc, changed };
}

/**
 * Idempotent migration from schema v2 (or v1) to schema v3.
 * Preserves all existing items, notes and images untouched; ignores/sanitizes invalid source attributes.
 */
export function migratePageV2toV3(page: PageContent): PageContent {
  if (!page || typeof page !== 'object') return page;
  const v2 = migratePageV1toV2(page);
  let itemsChanged = false;
  const nextItems: Record<ID, CanvasItem> = {};
  for (const [id, it] of Object.entries(v2.items)) {
    if ((it.type === 'container' || it.type === 'text') && it.doc) {
      const { doc, changed } = sanitizeImageSourceInDoc(it.doc);
      if (changed && doc) {
        nextItems[id] = { ...it, doc };
        itemsChanged = true;
      } else {
        nextItems[id] = it;
      }
    } else {
      nextItems[id] = it;
    }
  }
  if (v2.schemaVersion === SCHEMA_VERSION && !itemsChanged) return v2;
  return {
    ...v2,
    schemaVersion: SCHEMA_VERSION,
    items: itemsChanged ? nextItems : v2.items,
  };
}

/** Removes an imageBlock matching blockId (or the first matching assetId) from a TipTap document. */
export function removeImageBlockFromDoc(doc: JSONContent, assetId: ID, blockId?: ID): JSONContent {
  if (!doc || typeof doc !== 'object') return doc;
  let removed = false;
  const hasBlockIdMatch = blockId
    ? (Array.isArray(doc.content) ? doc.content : []).some((n) => n && typeof n === 'object' && n.type === 'imageBlock' && n.attrs?.id === blockId)
    : false;
  const filterNodes = (nodes: JSONContent[]): JSONContent[] => {
    const out: JSONContent[] = [];
    for (const n of nodes) {
      if (!n || typeof n !== 'object') {
        out.push(n);
        continue;
      }
      if (!removed && n.type === 'imageBlock') {
        const match = hasBlockIdMatch ? n.attrs?.id === blockId : n.attrs?.assetId === assetId;
        if (match) {
          removed = true;
          continue;
        }
      }
      out.push(n.content && Array.isArray(n.content) ? { ...n, content: filterNodes(n.content) } : n);
    }
    return out;
  };
  return {
    ...doc,
    content: Array.isArray(doc.content) ? filterNodes(doc.content) : [],
  };
}

/** Inserts an imageBlock into a TipTap document at a block boundary. */
export function insertImageBlockIntoDoc(
  doc: JSONContent,
  attrs: ImageBlockAttrs,
  insertIndex?: number,
  containerWidth?: number,
): JSONContent {
  const content = doc && Array.isArray(doc.content) ? [...doc.content] : [];
  const idx =
    insertIndex !== undefined && insertIndex >= 0 && insertIndex <= content.length
      ? insertIndex
      : content.length;

  const prevBlock = idx > 0 ? content[idx - 1] : undefined;
  const inheritedIndent =
    attrs.indent !== undefined && attrs.indent !== 0 ? attrs.indent : Number(prevBlock?.attrs?.indent || 0);

  let imageWidth = attrs.width;
  if (containerWidth && containerWidth > 100) {
    const usefulWidth = Math.max(80, containerWidth - 24 - inheritedIndent * 24);
    if (imageWidth > usefulWidth) {
      imageWidth = Math.round(usefulWidth);
    }
  }

  const finalAttrs: ImageBlockAttrs = {
    ...attrs,
    id: attrs.id || newId(),
    width: imageWidth,
    indent: inheritedIndent,
  };

  const imageNode: JSONContent = { type: 'imageBlock', attrs: finalAttrs };
  content.splice(idx, 0, imageNode);
  return { ...doc, content };
}

/**
 * Moves an imageBlock out of its container and onto the canvas as a free image container.
 * This is an atomic operation on the PageContent.
 */
export function moveImageToCanvas(
  page: PageContent,
  sourceContainerId: ID,
  attrs: ImageBlockAttrs,
  at: { x: number; y: number },
): { page: PageContent; newId: ID } {
  const newContainerId = newId();
  const w = attrs.width || 400;
  const ratio = attrs.naturalWidth && attrs.naturalHeight ? attrs.naturalWidth / attrs.naturalHeight : 1.333;
  const h = Math.round(w / ratio);

  const freeContainer: NoteContainerItem = {
    id: newContainerId,
    type: 'container',
    x: Math.round(at.x - w / 2),
    y: Math.round(at.y - h / 2),
    w,
    h,
    freeImage: true,
    variant: 'plain',
    doc: {
      type: 'doc',
      content: [
        {
          type: 'imageBlock',
          attrs,
        },
      ],
    },
  };

  const source = page.items[sourceContainerId];
  const nextItems = { ...page.items };
  let nextOrder = page.order.slice();

  if (source && (source.type === 'container' || source.type === 'text')) {
    if (source.type === 'container' && source.freeImage) {
      delete nextItems[sourceContainerId];
      nextOrder = nextOrder.filter((id) => id !== sourceContainerId);
    } else {
      const updatedDoc = removeImageBlockFromDoc(source.doc, attrs.assetId, attrs.id);
      const isEmpty =
        !updatedDoc.content ||
        updatedDoc.content.length === 0 ||
        (updatedDoc.content.length === 1 &&
          updatedDoc.content[0]?.type === 'paragraph' &&
          (!updatedDoc.content[0].content || updatedDoc.content[0].content.length === 0));

      if (isEmpty) {
        delete nextItems[sourceContainerId];
        nextOrder = nextOrder.filter((id) => id !== sourceContainerId);
      } else {
        nextItems[sourceContainerId] = {
          ...source,
          doc: updatedDoc,
        };
      }
    }
  }

  nextItems[newContainerId] = freeContainer;
  if (!nextOrder.includes(newContainerId)) nextOrder.push(newContainerId);

  return {
    page: repairPage({ ...page, items: nextItems, order: nextOrder }),
    newId: newContainerId,
  };
}

/**
 * Moves an imageBlock into another container's document flow.
 * If sourceContainer was a freeImage container, it is removed from the canvas.
 */
export function moveImageIntoContainer(
  page: PageContent,
  sourceContainerId: ID,
  targetContainerId: ID,
  attrs: ImageBlockAttrs,
  insertIndex?: number,
): PageContent {
  const target = page.items[targetContainerId];
  if (!target || (target.type !== 'container' && target.type !== 'text')) return page;

  const nextItems = { ...page.items };
  let nextOrder = page.order.slice();

  const source = page.items[sourceContainerId];
  if (source && (source.type === 'container' || source.type === 'text')) {
    if (source.type === 'container' && source.freeImage) {
      delete nextItems[sourceContainerId];
      nextOrder = nextOrder.filter((id) => id !== sourceContainerId);
    } else {
      const updatedSourceDoc = removeImageBlockFromDoc(source.doc, attrs.assetId, attrs.id);
      const isEmpty =
        !updatedSourceDoc.content ||
        updatedSourceDoc.content.length === 0 ||
        (updatedSourceDoc.content.length === 1 &&
          updatedSourceDoc.content[0]?.type === 'paragraph' &&
          (!updatedSourceDoc.content[0].content || updatedSourceDoc.content[0].content.length === 0));

      if (isEmpty) {
        delete nextItems[sourceContainerId];
        nextOrder = nextOrder.filter((id) => id !== sourceContainerId);
      } else {
        nextItems[sourceContainerId] = {
          ...source,
          doc: updatedSourceDoc,
        };
      }
    }
  }

  const containerW = target.type === 'container' || target.type === 'text' ? target.w : undefined;
  const updatedTargetDoc = insertImageBlockIntoDoc(target.doc, attrs, insertIndex, containerW);
  nextItems[targetContainerId] = {
    ...target,
    doc: updatedTargetDoc,
  };

  return repairPage({ ...page, items: nextItems, order: nextOrder });
}

export function addSheet(page: PageContent, sheetDef?: Partial<SheetDef>): PageContent {
  const currentSheets =
    page.sheets && page.sheets.length > 0
      ? [...page.sheets]
      : [{ id: newId(), width: 794, height: 1123, type: 'blank' as const }];

  const lastSheet = currentSheets[currentSheets.length - 1];
  const newSheet: SheetDef = {
    id: newId(),
    width: sheetDef?.width ?? lastSheet?.width ?? 794,
    height: sheetDef?.height ?? lastSheet?.height ?? 1123,
    type: sheetDef?.type ?? 'blank',
    pdfPage: sheetDef?.pdfPage,
    pdfAssetId: sheetDef?.pdfAssetId,
  };
  return { ...page, sheets: [...currentSheets, newSheet] };
}

function itemTopY(it: CanvasItem): number {
  if ('y' in it && typeof it.y === 'number') return it.y;
  if ('y1' in it && typeof it.y1 === 'number') return Math.min(it.y1, it.y2 ?? it.y1);
  if (it.type === 'stroke' && it.points.length >= 2) return it.points[1];
  return 0;
}

export function insertSheetAfter(page: PageContent, afterIndex: number, sheetDef?: Partial<SheetDef>): PageContent {
  const currentSheets =
    page.sheets && page.sheets.length > 0
      ? [...page.sheets]
      : [{ id: newId(), width: 794, height: 1123, type: 'blank' as const }];

  const safeIndex = Math.max(0, Math.min(afterIndex, currentSheets.length - 1));
  const refSheet = currentSheets[safeIndex] ?? currentSheets[currentSheets.length - 1];
  const newSheet: SheetDef = {
    id: newId(),
    width: sheetDef?.width ?? refSheet?.width ?? 794,
    height: sheetDef?.height ?? refSheet?.height ?? 1123,
    type: sheetDef?.type ?? 'blank',
    pdfPage: sheetDef?.pdfPage,
    pdfAssetId: sheetDef?.pdfAssetId,
  };

  const SHEET_GAP = 36;
  let splitY = 0;
  for (let i = 0; i <= safeIndex && i < currentSheets.length; i++) {
    splitY += currentSheets[i].height + SHEET_GAP;
  }

  const shiftDy = newSheet.height + SHEET_GAP;
  const nextSheets = [
    ...currentSheets.slice(0, safeIndex + 1),
    newSheet,
    ...currentSheets.slice(safeIndex + 1),
  ];

  const nextItems = { ...page.items };
  let itemsChanged = false;
  for (const id of page.order) {
    const it = nextItems[id];
    if (!it || it.parentId) continue;
    if (itemTopY(it) >= splitY) {
      nextItems[id] = { ...it, ...translateItem(it, 0, shiftDy) } as CanvasItem;
      itemsChanged = true;
    }
  }

  return {
    ...page,
    sheets: nextSheets,
    items: itemsChanged ? nextItems : page.items,
  };
}

/**
 * Removes the sheet at `sheetIndex` (provided at least two sheets exist),
 * deletes items located on that sheet, and shifts subsequent items up.
 */
export function removeSheet(page: PageContent, sheetIndex: number): PageContent {
  const currentSheets =
    page.sheets && page.sheets.length > 0
      ? [...page.sheets]
      : [{ id: newId(), width: 794, height: 1123, type: 'blank' as const }];

  if (currentSheets.length <= 1) return page;
  if (sheetIndex < 0 || sheetIndex >= currentSheets.length) return page;

  const SHEET_GAP = 36;
  const removed = currentSheets[sheetIndex];
  let prevY = 0;
  for (let i = 0; i < sheetIndex; i++) {
    prevY += currentSheets[i].height + SHEET_GAP;
  }
  const bandStart = sheetIndex === 0 ? -Infinity : prevY;
  const bandEnd = prevY + removed.height + SHEET_GAP;
  const shiftDy = -(removed.height + SHEET_GAP);

  const removedIds: ID[] = [];
  for (const id of page.order) {
    const it = page.items[id];
    if (!it || it.parentId) continue;
    const y = itemTopY(it);
    if (y >= bandStart && y < bandEnd) {
      removedIds.push(id);
    }
  }

  const nextPage = removedIds.length > 0 ? deleteItems(page, removedIds) : page;
  const nextItems = { ...nextPage.items };
  let itemsChanged = false;
  for (const id of nextPage.order) {
    const it = nextItems[id];
    if (!it || it.parentId) continue;
    if (itemTopY(it) >= bandEnd) {
      nextItems[id] = { ...it, ...translateItem(it, 0, shiftDy) } as CanvasItem;
      itemsChanged = true;
    }
  }

  return {
    ...nextPage,
    sheets: currentSheets.filter((_, i) => i !== sheetIndex),
    items: itemsChanged ? nextItems : nextPage.items,
  };
}
