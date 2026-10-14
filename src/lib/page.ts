import type { CanvasItem, ID, ImageItem, PageContent, TextItem } from '../types';
import { itemBounds } from './geometry';
import { translateItem } from '../model/pageOps';

/** CSS pixels per millimetre at print scale (96 dpi). */
const PX_PER_MM = 96 / 25.4;

/** Logical page width: two A4 sheets side by side (2 × 210 mm = 420 mm). */
export const PAGE_WIDTH = Math.round(420 * PX_PER_MM); // 1587 px
/** Width of a single A4 sheet, used for the subtle centre guide. */
export const A4_WIDTH = Math.round(210 * PX_PER_MM);
/** Height of one A4 sheet: the minimum visible page height. */
export const A4_HEIGHT = Math.round(297 * PX_PER_MM);

/** Left margin where the title and the first notes start. */
export const PAGE_MARGIN = 48;
/** The title band lives above y = 0 so existing notes (y ≥ 0) are never covered or moved. */
export const SHEET_TOP = -132;
export const TITLE_Y = -104;
/** Where the body of a new page starts (just below the title). */
export const BODY_START = { x: PAGE_MARGIN, y: 4 };

/** Bottom edge of the sheet: one A4 height at least, always leaving room below the content. */
export function sheetBottom(page: PageContent | null | undefined): number {
  let bottom = SHEET_TOP + A4_HEIGHT;
  if (page) {
    for (const id of page.order) {
      const it = page.items[id];
      if (!it || it.parentId) continue;
      const r = itemBounds(it, page.items);
      bottom = Math.max(bottom, r.y + r.h + 360);
    }
  }
  return bottom;
}

/**
 * Keeps a top-level item horizontally inside the page: oversized images and text
 * blocks are scaled to the page width, then everything is shifted inside [0, PAGE_WIDTH].
 * Returns the same object when nothing needs to change.
 */
export function constrainItem(it: CanvasItem, items: Record<ID, CanvasItem>): CanvasItem {
  if (it.parentId || it.type === 'connector') return it;
  let next: CanvasItem = it;
  if (it.type === 'image') {
    const r = itemBounds(it, items);
    if (r.w > PAGE_WIDTH) {
      const k = PAGE_WIDTH / r.w;
      next = { ...it, w: it.w * k, h: it.h * k } as ImageItem;
    }
  } else if (it.type === 'text' && it.w > PAGE_WIDTH) {
    next = { ...it, w: PAGE_WIDTH } as TextItem;
  }
  const r = itemBounds(next, items);
  let dx = 0;
  if (r.w >= PAGE_WIDTH) dx = -r.x;
  else if (r.x < 0) dx = -r.x;
  else if (r.x + r.w > PAGE_WIDTH) dx = PAGE_WIDTH - (r.x + r.w);
  if (Math.abs(dx) > 0.01) next = { ...next, ...translateItem(next, dx, 0) } as CanvasItem;
  return next;
}

/**
 * Applies the page-width constraint to the items that changed between `prev` and `next`.
 * Untouched items are never moved, so pages created before the limit keep their layout.
 */
export function constrainChanged(prev: PageContent | null, next: PageContent): PageContent {
  let items: Record<ID, CanvasItem> | null = null;
  for (const id of next.order) {
    const it = next.items[id];
    if (!it || (prev && prev.items[id] === it)) continue;
    const c = constrainItem(it, next.items);
    if (c !== it) {
      if (!items) items = { ...next.items };
      items[id] = c;
    }
  }
  return items ? { ...next, items } : next;
}
