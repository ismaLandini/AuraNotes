import type { CanvasItem, ID, ImageItem, PageContent, SheetDef } from '../types';
import { itemBounds } from './geometry';
import { translateItem } from '../model/pageOps';

/** CSS pixels per millimetre at print scale (96 dpi). */
const PX_PER_MM = 96 / 25.4;

/** Width of a single standard A4 sheet: 210 mm (~794 px). */
export const A4_WIDTH = Math.round(210 * PX_PER_MM); // 794 px
/** Height of a single standard A4 sheet: 297 mm (~1123 px). */
export const A4_HEIGHT = Math.round(297 * PX_PER_MM); // 1123 px
/** Height of two A4 sheets: 594 mm (~2245 px). Kept for viewport margin calculations. */
export const TWO_A4_HEIGHT = Math.round(594 * PX_PER_MM);

/** Standard page width is now a single A4 sheet. */
export const PAGE_WIDTH = A4_WIDTH;

/** Vertical space between consecutive sheets in a multi-page document. */
export const SHEET_GAP = 36;

/** Maximum allowable width for auto-expanded text items and images */
export const MAX_PAGE_ITEM_WIDTH = 1850;

/** Left margin where the title and the first notes start. */
export const PAGE_MARGIN = 48;
/** The title band lives above y = 0 so existing notes (y ≥ 0) are never covered or moved. */
export const SHEET_TOP = -132;
export const TITLE_Y = -104;
/** Where the body of a new page starts (just below the title). */
export const BODY_START = { x: PAGE_MARGIN, y: 4 };

export interface SheetLayout {
  sheet: SheetDef;
  index: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** True when the page is an imported PDF document (starts with or contains PDF sheets). */
export function isPdfDocument(page: PageContent | null | undefined): boolean {
  return Boolean(page?.pdfAssetId || page?.sheets?.some((s) => s.type === 'pdf'));
}

/** Returns the explicit sheets array or a default single A4 sheet. */
export function getPageSheets(page: PageContent | null | undefined): SheetDef[] {
  if (page?.sheets && page.sheets.length > 0) return page.sheets;
  return [{ id: 'sheet-default', width: A4_WIDTH, height: A4_HEIGHT, type: 'blank' }];
}

/** Computes the stacked vertical layout for all sheets in a page. */
export function computeSheetLayouts(page: PageContent | null | undefined): SheetLayout[] {
  const sheets = getPageSheets(page);
  const isPdf = isPdfDocument(page);
  const maxW = Math.max(...sheets.map((s) => s.width), A4_WIDTH);
  const layouts: SheetLayout[] = [];
  let curY = 0;
  for (let i = 0; i < sheets.length; i++) {
    const s = sheets[i];
    // Center sheets horizontally relative to the widest sheet
    const x = Math.max(0, Math.round((maxW - s.width) / 2));
    // For normal pages, the first sheet extends up to SHEET_TOP (-132) so the page title sits inside the sheet
    const topY = i === 0 && !isPdf ? SHEET_TOP : curY;
    const visualH = i === 0 && !isPdf ? s.height - SHEET_TOP : s.height;
    layouts.push({
      sheet: s,
      index: i,
      x,
      y: topY,
      w: s.width,
      h: visualH,
    });
    curY += s.height + SHEET_GAP;
  }
  return layouts;
}

/** Bottom edge of all sheets / content. */
export function sheetBottom(page: PageContent | null | undefined): number {
  const layouts = computeSheetLayouts(page);
  const lastLayout = layouts[layouts.length - 1];
  let bottom = lastLayout ? lastLayout.y + lastLayout.h : A4_HEIGHT;
  if (page) {
    for (const id of page.order) {
      const it = page.items[id];
      if (!it || it.parentId) continue;
      const r = itemBounds(it, page.items);
      bottom = Math.max(bottom, r.y + r.h + 60);
    }
  }
  return bottom;
}

/** Right edge of the sheet/content: at least the widest sheet, expanding if content extends further. */
export function sheetRight(page: PageContent | null | undefined): number {
  const sheets = getPageSheets(page);
  const sheetW = Math.max(...sheets.map((s) => s.width), A4_WIDTH);
  // For imported PDF documents, lock the right edge rigidly to the sheet width so the PDF stays fixed
  if (isPdfDocument(page)) {
    return sheetW;
  }
  let right = sheetW;
  if (page) {
    for (const id of page.order) {
      const it = page.items[id];
      if (!it || it.parentId) continue;
      const r = itemBounds(it, page.items);
      right = Math.max(right, r.x + r.w + PAGE_MARGIN);
    }
  }
  return right;
}

/** Left edge of the sheet/content: at most 0, expanding if content extends to the left. */
export function sheetLeft(page: PageContent | null | undefined): number {
  if (isPdfDocument(page)) {
    return 0;
  }
  let left = 0;
  if (page) {
    for (const id of page.order) {
      const it = page.items[id];
      if (!it || it.parentId) continue;
      const r = itemBounds(it, page.items);
      left = Math.min(left, r.x - PAGE_MARGIN);
    }
  }
  return left;
}

/**
 * Keeps a top-level item horizontally valid: oversized images and text
 * blocks are constrained to the maximum item width (1850 px), and items
 * are kept from going past the left margin (and right margin for PDF documents).
 * Returns the same object when nothing needs to change.
 */
export function constrainItem(
  it: CanvasItem,
  items: Record<ID, CanvasItem>,
  maxRight?: number,
): CanvasItem {
  if (it.parentId || it.type === 'connector') return it;
  // Caselle di testo (text e container) possono uscire liberamente dal foglio o dal PDF:
  // l'utente è libero di posizionarle nei margini o fuori pagina e riadattarle successivamente.
  if (it.type === 'text' || it.type === 'container') {
    if (it.w > MAX_PAGE_ITEM_WIDTH) {
      return { ...it, w: MAX_PAGE_ITEM_WIDTH };
    }
    return it;
  }
  let next: CanvasItem = it;
  const maxW = maxRight !== undefined ? Math.min(maxRight, MAX_PAGE_ITEM_WIDTH) : MAX_PAGE_ITEM_WIDTH;
  if (it.type === 'image') {
    const r = itemBounds(it, items);
    if (r.w > maxW) {
      const k = maxW / r.w;
      next = { ...it, w: it.w * k, h: it.h * k } as ImageItem;
    }
  }
  const r = itemBounds(next, items);
  let dx = 0;
  if (r.x < 0) dx = -r.x;
  else if (maxRight !== undefined && r.x + r.w > maxRight) {
    dx = maxRight - (r.x + r.w);
    if (r.x + dx < 0) dx = -r.x;
  }
  if (Math.abs(dx) > 0.01) next = { ...next, ...translateItem(next, dx, 0) } as CanvasItem;
  return next;
}

/**
 * Applies the page-width constraint to the items that changed between `prev` and `next`.
 * Untouched items are never moved, so pages created before the limit keep their layout.
 */
export function constrainChanged(prev: PageContent | null, next: PageContent): PageContent {
  const isPdf = isPdfDocument(next);
  const maxRight = isPdf ? sheetRight(next) : undefined;
  let items: Record<ID, CanvasItem> | null = null;
  for (const id of next.order) {
    const it = next.items[id];
    if (!it || (prev && prev.items[id] === it)) continue;
    const c = constrainItem(it, next.items, maxRight);
    if (c !== it) {
      if (!items) items = { ...next.items };
      items[id] = c;
    }
  }
  return items ? { ...next, items } : next;
}
