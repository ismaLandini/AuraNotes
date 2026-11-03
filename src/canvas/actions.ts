import type { JSONContent } from '@tiptap/core';
import { generateJSON } from '@tiptap/core';
import type { CanvasItem, ID, NoteContainerItem, PageContent, Point, TextItem } from '../types';
import { useStore } from '../store/useStore';
import { useSettings } from '../store/settings';
import { toast } from '../store/ui';
import * as P from '../model/pageOps';
import { newId } from '../model/workspaceOps';
import { dataUrlToBlob, importImageBlob, SUPPORTED_IMAGE_TYPES } from '../storage/assets';
import { getViewport, insertionPoint, revealRect, screenSize } from './viewport';
import { PAGE_WIDTH } from '../lib/page';
import { itemBounds, unionRects } from '../lib/geometry';
import { sharedExtensions } from '../editor/extensions';
import { useActiveEditor } from '../editor/activeEditor';
import { openPdfImportDialog, pickPdfFile } from '../components/PdfImportDialog';

export { pickPdfFile };

const CLIP_MARKER = 'glassnote-clip:';

interface ClipPayload {
  marker: string;
  items: Record<ID, CanvasItem>;
  order: ID[];
  ids: ID[];
}

let internalClip: ClipPayload | null = null;

/** Snapshot taken just before a text block is created for immediate editing (one undo step). */
export const editSession: { pendingBefore: PageContent | null } = { pendingBefore: null };
let pasteCount = 0;

export let cancelActiveGesture: (() => boolean) | null = null;
export function setCancelActiveGesture(fn: (() => boolean) | null): void {
  cancelActiveGesture = fn;
}

function page(): PageContent | null {
  return useStore.getState().currentPage();
}

export function topLevelSelection(): ID[] {
  const p = page();
  if (!p) return [];
  const sel = useStore.getState().selection.filter((id) => p.items[id]);
  // Drop annotations whose parent is selected too (they move with the parent).
  return sel.filter((id) => {
    const it = p.items[id];
    return !(it.parentId && sel.includes(it.parentId));
  });
}

export function deleteSelection(): boolean {
  const ids = useStore.getState().selection;
  if (!ids.length) return false;
  useStore.getState().updatePage((p) => P.deleteItems(p, ids));
  useStore.getState().setSelection([]);
  return true;
}

export function selectAll(): void {
  const p = page();
  if (!p) return;
  useStore.getState().setSelection(p.order.filter((id) => !p.items[id]?.parentId));
}

export function duplicateSelection(): void {
  const p = page();
  const ids = topLevelSelection();
  if (!p || !ids.length) return;
  const { items } = P.cloneItems(p.items, p.order, ids, 24, 24);
  useStore.getState().updatePage((pg) => P.addItems(pg, items));
  useStore.getState().setSelection(items.filter((i) => !i.parentId || !items.some((x) => x.id === i.parentId)).map((i) => i.id));
}

export function nudgeSelection(dx: number, dy: number): void {
  const p = page();
  const ids = topLevelSelection();
  if (!p || !ids.length) return;
  const patches: Record<ID, Partial<CanvasItem>> = {};
  for (const id of ids) {
    const it = p.items[id];
    if (it.locked) continue;
    if (it.parentId) {
      const parent = p.items[it.parentId];
      if (parent?.type === 'image') patches[id] = P.translateLocal(it, dx / parent.w, dy / parent.h);
    } else {
      const patch = P.translateItem(it, dx, dy);
      if ('x' in patch && typeof patch.x === 'number') {
        const itemW = 'w' in it && typeof it.w === 'number' ? it.w : 0;
        patch.x = Math.max(0, Math.min(PAGE_WIDTH - itemW, patch.x));
      }
      patches[id] = patch;
    }
  }
  useStore.getState().updatePage((pg) => P.updateItems(pg, patches));
}

export function reorderSelection(move: P.ZMove): void {
  const ids = useStore.getState().selection;
  if (!ids.length) return;
  useStore.getState().updatePage((p) => P.reorderZ(p, ids, move));
}

export function toggleLockSelection(): void {
  const p = page();
  const ids = useStore.getState().selection;
  if (!p || !ids.length) return;
  const lock = !ids.every((id) => p.items[id]?.locked);
  const patches: Record<ID, Partial<CanvasItem>> = {};
  for (const id of ids) patches[id] = { locked: lock };
  useStore.getState().updatePage((pg) => P.updateItems(pg, patches));
  toast(lock ? 'Oggetti bloccati' : 'Oggetti sbloccati');
}

export function rotateSelectedImages(deg: number): void {
  const p = page();
  if (!p) return;
  const patches: Record<ID, Partial<CanvasItem>> = {};
  for (const id of useStore.getState().selection) {
    const it = p.items[id];
    if (it?.type === 'image') patches[id] = { rotation: (((it.rotation + deg) % 360) + 360) % 360 };
  }
  useStore.getState().updatePage((pg) => P.updateItems(pg, patches));
}

export function patchSelection(patch: (it: CanvasItem) => Partial<CanvasItem> | null): void {
  const p = page();
  if (!p) return;
  const patches: Record<ID, Partial<CanvasItem>> = {};
  for (const id of useStore.getState().selection) {
    const it = p.items[id];
    if (!it) continue;
    const ch = patch(it);
    if (ch) patches[id] = ch;
  }
  if (Object.keys(patches).length) useStore.getState().updatePage((pg) => P.updateItems(pg, patches));
}

// ---------------------------------------------------------------------------
// Text blocks

export const MIN_TEXT_WIDTH = 480;
export const MAX_TEXT_WIDTH = 1850;

export function createTextBlock(at: Point, opts: { variant?: 'plain' | 'sticky'; doc?: JSONContent; edit?: boolean; w?: number; customW?: boolean } = {}): ID | null {
  const s = useStore.getState();
  if (!s.pageId) return null;
  if (s.editingId) finishEditing(s.editingId);
  const variant = opts.variant ?? 'plain';
  const customW = opts.customW ?? (opts.w !== undefined);
  const item: NoteContainerItem = {
    id: newId(),
    type: 'container',
    x: Math.round(at.x),
    y: Math.round(at.y),
    w: opts.w ?? (variant === 'sticky' ? 240 : MIN_TEXT_WIDTH),
    h: 32,
    doc: opts.doc ?? P.EMPTY_DOC,
    variant,
    ...(customW ? { customW: true } : {}),
    ...(variant === 'sticky' ? { bg: '#fff4b8' } : {}),
  };
  // When editing starts immediately, the edit session records the creation in history.
  if (opts.edit !== false && !editSession.pendingBefore) editSession.pendingBefore = s.currentPage();
  s.updatePage((p) => P.pruneEmptyTextItems(P.addItems(p, [item]), item.id), opts.edit === false);
  s.setSelection([item.id]);
  if (opts.edit !== false) s.setEditing(item.id);
  return item.id;
}

/** Called when a text block leaves edit mode: syncs latest editor state and drops any empty blocks on the page. */
export function finishEditing(id: ID): void {
  const s = useStore.getState();
  const activeEd = useActiveEditor.getState().editor;
  const liveDoc =
    activeEd && !activeEd.isDestroyed && (activeEd.storage as Record<string, unknown>)?.containerId === id
      ? activeEd.getJSON()
      : null;
  if (s.editingId === id) s.setEditing(null);
  const keepId = useStore.getState().editingId;
  s.updatePage((pg) => {
    const synced = liveDoc && pg.items[id] ? P.updateItems(pg, { [id]: { doc: liveDoc } }) : pg;
    return P.pruneEmptyTextItems(synced, keepId);
  }, false);
  const after = useStore.getState().currentPage();
  if (after) {
    const nextSel = useStore.getState().selection.filter((x) => after.items[x]);
    if (nextSel.length !== useStore.getState().selection.length) {
      useStore.getState().setSelection(nextSel);
    }
  }
}

// ---------------------------------------------------------------------------
// Images

export function isPdfFile(file: Blob | File): boolean {
  if (file.type === 'application/pdf' || file.type === 'application/x-pdf') return true;
  const name = (file as { name?: string }).name;
  return typeof name === 'string' && /\.pdf$/i.test(name);
}

export async function insertImageFiles(
  files: Blob[],
  at?: Point,
  dropTarget?: { containerId: ID; insertIndex?: number },
): Promise<number> {
  const pdfs = files.filter((f) => isPdfFile(f));
  if (pdfs.length > 0) {
    const activeContainerId = dropTarget?.containerId ?? useStore.getState().editingId ?? undefined;
    openPdfImportDialog(pdfs[0], {
      at,
      containerId: activeContainerId,
      insertIndex: dropTarget?.insertIndex,
    });
    return 1;
  }

  const images = files.filter((f) => f.type.startsWith('image/'));
  const unsupported = files.length - images.length;
  if (unsupported > 0) toast(`${unsupported} file ignorati: formato non supportato`, 'error');
  if (!images.length) return 0;
  const s = useStore.getState();
  if (!s.pageId) {
    toast('Apri o crea una pagina prima di inserire immagini', 'error');
    return 0;
  }

  // If dropped onto a specific container target on the canvas, insert into that container's document flow
  if (dropTarget?.containerId) {
    let idx = dropTarget.insertIndex;
    let count = 0;
    for (const file of images) {
      try {
        const img = await importImageBlob(file);
        s.updatePage((p) => {
          const target = p.items[dropTarget.containerId];
          if (!target || (target.type !== 'container' && target.type !== 'text')) return p;
          const nextDoc = P.insertImageBlockIntoDoc(
            target.doc,
            {
              assetId: img.assetId,
              width: img.width,
              naturalWidth: img.width,
              naturalHeight: img.height,
              mime: img.mime,
              rotation: 0,
              indent: 0,
            },
            idx,
            target.w,
          );
          if (idx !== undefined) idx++;
          return P.updateItems(p, { [dropTarget.containerId]: { doc: nextDoc } });
        });
        count++;
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Impossibile importare l’immagine', 'error');
      }
    }
    return count;
  }

  // If an editor is currently active and no canvas point is specified, insert into the editor flow
  const activeEd = useActiveEditor.getState().editor;
  if (!at && activeEd && !activeEd.isDestroyed) {
    const containerW = activeEd.view.dom.clientWidth || 500;
    const maxWContainer = Math.min(1850, Math.max(100, containerW - 24));
    let count = 0;
    for (const file of images) {
      try {
        const img = await importImageBlob(file);
        const scale = Math.min(1, maxWContainer / img.width);
        const w = Math.max(80, Math.round(img.width * scale));
        activeEd.chain().focus().setImageBlock({
          assetId: img.assetId,
          width: w,
          naturalWidth: img.width,
          naturalHeight: img.height,
          mime: img.mime,
          rotation: 0,
          indent: 0,
        }).run();
        count++;
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Impossibile importare l’immagine', 'error');
      }
    }
    return count;
  }

  const base = at ?? insertionPoint();
  const vp = getViewport();
  const { w: sw } = screenSize();
  const maxW = Math.min(640, (sw / vp.zoom) * 0.6);
  const created: NoteContainerItem[] = [];
  let offset = 0;
  for (const file of images) {
    if (!SUPPORTED_IMAGE_TYPES.includes(file.type)) toast(`Formato ${file.type} potrebbe non essere supportato dal browser`, 'info');
    if (file.size > 25 * 1024 * 1024) toast('Immagine molto grande: potrebbe rallentare l’app', 'info');
    try {
      const img = await importImageBlob(file);
      const scale = Math.min(1, maxW / img.width);
      const w = Math.max(40, Math.round(img.width * scale));
      const h = Math.max(30, Math.round(img.height * scale));
      created.push({
        id: newId(),
        type: 'container',
        x: Math.round(base.x + offset - (at ? 0 : w / 2)),
        y: Math.round(base.y + offset - (at ? 0 : h / 2)),
        w,
        h,
        freeImage: true,
        customW: true,
        variant: 'plain',
        doc: {
          type: 'doc',
          content: [
            {
              type: 'imageBlock',
              attrs: {
                assetId: img.assetId,
                width: w,
                naturalWidth: img.width,
                naturalHeight: img.height,
                mime: img.mime,
                rotation: 0,
                indent: 0,
              },
            },
          ],
        },
      });
      offset += 28;
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Impossibile importare l’immagine', 'error');
    }
  }
  if (!created.length) return 0;
  const st = useStore.getState();
  if (st.pageId !== s.pageId) return 0;
  st.updatePage((p) => P.addItems(p, created));
  st.setSelection(created.map((c) => c.id));
  st.setTool('select');
  useStore.setState({ selection: created.map((c) => c.id) });
  return created.length;
}

export function pickImageFiles(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.multiple = true;
  input.onchange = () => {
    const files = input.files ? Array.from(input.files) : [];
    if (files.length) void insertImageFiles(files);
  };
  input.click();
}

// ---------------------------------------------------------------------------
// Clipboard

function buildClip(): ClipPayload | null {
  const p = page();
  const ids = topLevelSelection();
  if (!p || !ids.length) return null;
  const all = P.withChildren(p, ids);
  for (const it of Object.values(p.items)) if (it.type === 'connector' && all.has(it.fromId) && all.has(it.toId)) all.add(it.id);
  const items: Record<ID, CanvasItem> = {};
  for (const id of all) items[id] = structuredClone(p.items[id]);
  return { marker: CLIP_MARKER + newId(), items, order: p.order.filter((id) => all.has(id)), ids };
}

function clipPlainText(c: ClipPayload): string {
  const texts = c.order.map((id) => c.items[id]).filter((i): i is TextItem | NoteContainerItem => i?.type === 'text' || i?.type === 'container').map((t) => P.docToText(t.doc));
  return texts.join('\n\n');
}

/** Handles the native copy/cut event when the canvas (not a text field) has focus. */
export function handleCopy(e: ClipboardEvent, cut: boolean): boolean {
  const clip = buildClip();
  if (!clip) return false;
  internalClip = clip;
  pasteCount = 0;
  if (e.clipboardData) {
    const text = clipPlainText(clip);
    e.clipboardData.setData('text/plain', text || ' ');
    try {
      e.clipboardData.setData('text/html', `<meta name="glassnote" content="${clip.marker}">${text.replace(/[<>&]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[ch]!)}`);
    } catch {
      /* ignore */
    }
  }
  e.preventDefault();
  if (cut) deleteSelection();
  toast(cut ? 'Tagliato' : 'Copiato', 'info', 1200);
  return true;
}

export function copySelectionToInternal(): boolean {
  const clip = buildClip();
  if (!clip) return false;
  internalClip = clip;
  pasteCount = 0;
  return true;
}

function pasteInternal(clip: ClipPayload): void {
  pasteCount++;
  const offset = 24 * pasteCount;
  const s = useStore.getState();
  const cur = page();
  if (!cur) return;
  // When pasting onto another page, place the content near the insertion point.
  let dx = offset;
  let dy = offset;
  const sameVisible = cur.order.some((id) => clip.items[id]);
  if (!sameVisible) {
    const rects = clip.ids.map((id) => itemBounds(clip.items[id], clip.items));
    const b = unionRects(rects);
    if (b) {
      const at = insertionPoint(false);
      dx = at.x - (b.x + b.w / 2) + offset - 24;
      dy = at.y - (b.y + b.h / 2) + offset - 24;
    }
  }
  const { items } = P.cloneItems(clip.items, clip.order, clip.ids, dx, dy);
  s.updatePage((p) => P.addItems(p, items));
  const sel = items.filter((i) => !i.parentId || !items.some((x) => x.id === i.parentId)).map((i) => i.id);
  s.setSelection(sel);
  const b = unionRects(sel.map((id) => itemBounds(items.find((i) => i.id === id)!, Object.fromEntries(items.map((i) => [i.id, i])))));
  if (b) revealRect(b);
}

/** Paste from the internal clipboard (used by the keyboard shortcut fallback). */
export function pasteFromInternal(): boolean {
  if (!internalClip) return false;
  pasteInternal(internalClip);
  return true;
}

export function htmlToDoc(html: string): JSONContent | null {
  try {
    const cleaned = html.replace(/<meta[^>]*>/gi, '');
    return generateJSON(cleaned, sharedExtensions());
  } catch {
    return null;
  }
}

/** Handles a paste event on the canvas: PDF files, images, GlassNote objects or external text. */
export async function handlePaste(e: ClipboardEvent): Promise<boolean> {
  const dt = e.clipboardData;
  if (!dt) return false;
  const files: File[] = [];
  const pdfFiles: File[] = [];
  for (const item of Array.from(dt.items)) {
    if (item.kind === 'file') {
      const f = item.getAsFile();
      if (!f) continue;
      if (isPdfFile(f)) pdfFiles.push(f);
      else if (f.type.startsWith('image/')) files.push(f);
    }
  }
  if (pdfFiles.length === 0 && dt.files) {
    for (const f of Array.from(dt.files)) {
      if (isPdfFile(f)) pdfFiles.push(f);
    }
  }
  if (files.length === 0 && dt.files) {
    for (const f of Array.from(dt.files)) {
      if (f.type.startsWith('image/')) files.push(f);
    }
  }
  if (pdfFiles.length > 0) {
    e.preventDefault();
    const editingId = useStore.getState().editingId;
    openPdfImportDialog(pdfFiles[0], editingId ? { containerId: editingId } : undefined);
    return true;
  }
  const html = dt.getData('text/html');
  const text = dt.getData('text/plain');
  if (internalClip && html.includes(internalClip.marker)) {
    e.preventDefault();
    pasteInternal(internalClip);
    return true;
  }
  if (files.length) {
    e.preventDefault();
    await insertImageFiles(files);
    return true;
  }
  // Images copied from a browser often arrive as HTML with an <img>; try to fetch data: URLs.
  const imgSrc = /<img[^>]+src="(data:image\/[^"]+)"/i.exec(html)?.[1];
  if (imgSrc && !text.trim()) {
    e.preventDefault();
    await insertImageFiles([dataUrlToBlob(imgSrc)]);
    return true;
  }
  if (html || text) {
    e.preventDefault();
    const doc = (html && htmlToDoc(html)) || P.textDocFromPlain(text);
    const at = insertionPoint();
    createTextBlock({ x: at.x - 40, y: at.y - 20 }, { doc, edit: false, w: 420 });
    return true;
  }
  return false;
}

export function canvasHasFocus(): boolean {
  const a = document.activeElement;
  return !a || a === document.body || !!(a instanceof HTMLElement && a.closest('[data-canvas-root]'));
}

export const settingsForTool = () => useSettings.getState();

export function groupSelection(): void {
  const ids = topLevelSelection();
  if (ids.length < 2) {
    toast('Seleziona almeno due oggetti da raggruppare');
    return;
  }
  useStore.getState().updatePage((p) => P.groupItems(p, ids));
  toast('Oggetti raggruppati', 'info', 1500);
}

export function ungroupSelection(): void {
  const ids = useStore.getState().selection;
  const p = page();
  if (!p || !ids.some((id) => p.items[id]?.groupId)) return;
  useStore.getState().updatePage((pg) => P.ungroupItems(pg, ids));
  toast('Gruppo separato', 'info', 1500);
}
