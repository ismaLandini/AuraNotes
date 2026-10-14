import type { Rect } from '../types';

export type PaperSize = 'a4' | 'letter' | 'a3' | 'a5';
export type Orientation = 'portrait' | 'landscape';
export type ScaleMode = 'fit-width' | 'fit-page' | 'actual' | 'custom';

export const PAPERS: Record<PaperSize, { label: string; w: number; h: number; css: string }> = {
  a4: { label: 'A4', w: 210, h: 297, css: 'A4' },
  letter: { label: 'Letter', w: 215.9, h: 279.4, css: 'letter' },
  a3: { label: 'A3', w: 297, h: 420, css: 'A3' },
  a5: { label: 'A5', w: 148, h: 210, css: 'A5' },
};

/** CSS pixels per millimetre (96 dpi). */
export const PX_PER_MM = 96 / 25.4;

export interface PrintOptions {
  paper: PaperSize;
  orientation: Orientation;
  marginMm: number;
  scaleMode: ScaleMode;
  customScale: number; // 0.1..3
  includeBackground: boolean;
  pageNumbers: boolean;
  showTitle: boolean;
}

export const DEFAULT_PRINT_OPTIONS: PrintOptions = {
  paper: 'a4',
  orientation: 'portrait',
  marginMm: 12,
  scaleMode: 'fit-width',
  customScale: 1,
  includeBackground: false,
  pageNumbers: true,
  showTitle: true,
};

export interface Slice {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SheetLayout {
  sheetWmm: number;
  sheetHmm: number;
  /** Printable content box (inside margins, minus header/footer) in CSS px. */
  contentW: number;
  contentH: number;
  headerH: number;
  footerH: number;
  scale: number;
  slices: Slice[];
}

const HEADER_PX = 30;
const FOOTER_PX = 22;
/** Margin around content bounds so strokes/arrowheads at the edge are not clipped. */
const CONTENT_PAD = 12;

export function sheetSize(o: Pick<PrintOptions, 'paper' | 'orientation'>): { w: number; h: number } {
  const p = PAPERS[o.paper];
  return o.orientation === 'portrait' ? { w: p.w, h: p.h } : { w: p.h, h: p.w };
}

/**
 * Finds a page-break position <= nominal that does not cut through an item, preferring the
 * lowest such position within the last 40% of the slice. Falls back to the nominal break.
 */
export function chooseBreak(start: number, nominal: number, itemRects: Rect[]): number {
  const minPos = start + (nominal - start) * 0.6;
  const sliceH = nominal - start;
  const blockers = itemRects.filter((r) => r.h < sliceH * 0.95); // tall items can't avoid being split
  const cuts = (pos: number) => blockers.some((r) => r.y < pos - 0.5 && r.y + r.h > pos + 0.5);
  if (!cuts(nominal)) return nominal;
  const candidates = new Set<number>();
  for (const r of blockers) {
    for (const v of [r.y - 4, r.y + r.h + 4]) if (v > minPos && v < nominal) candidates.add(v);
  }
  const sorted = [...candidates].sort((a, b) => b - a);
  for (const c of sorted) if (!cuts(c)) return c;
  return nominal;
}

/** Computes scale and page slices (in world coordinates) for printing a free-form page. */
export function computeLayout(bounds: Rect | null, itemRects: Rect[], o: PrintOptions): SheetLayout {
  const { w: sheetWmm, h: sheetHmm } = sheetSize(o);
  const headerH = o.showTitle ? HEADER_PX : 0;
  const footerH = o.pageNumbers ? FOOTER_PX : 0;
  const contentW = Math.max(50, (sheetWmm - o.marginMm * 2) * PX_PER_MM);
  const contentH = Math.max(50, (sheetHmm - o.marginMm * 2) * PX_PER_MM - headerH - footerH);
  if (!bounds || bounds.w <= 0 || bounds.h <= 0) {
    return { sheetWmm, sheetHmm, contentW, contentH, headerH, footerH, scale: 1, slices: [{ x: 0, y: 0, w: contentW, h: contentH }] };
  }
  const b = { x: bounds.x - CONTENT_PAD, y: bounds.y - CONTENT_PAD, w: bounds.w + CONTENT_PAD * 2, h: bounds.h + CONTENT_PAD * 2 };
  let scale: number;
  switch (o.scaleMode) {
    case 'fit-width':
      scale = Math.min(contentW / b.w, 1.5);
      break;
    case 'fit-page':
      scale = Math.min(contentW / b.w, contentH / b.h, 1.5);
      break;
    case 'actual':
      scale = 1;
      break;
    case 'custom':
      scale = Math.max(0.05, Math.min(4, o.customScale));
      break;
  }
  const worldW = contentW / scale;
  const worldH = contentH / scale;
  const cols = Math.max(1, Math.ceil(b.w / worldW - 1e-6));
  const slices: Slice[] = [];
  let y = b.y;
  let guard = 0;
  while (y < b.y + b.h - 0.5 && guard++ < 500) {
    const nominal = y + worldH;
    const end = nominal >= b.y + b.h ? nominal : chooseBreak(y, nominal, itemRects);
    for (let c = 0; c < cols; c++) {
      const s = { x: b.x + c * worldW, y, w: worldW, h: end - y };
      // Skip sheets without any content (avoids blank pages in sparse layouts).
      const hasContent = itemRects.some((r) => r.x < s.x + s.w && r.x + r.w > s.x && r.y < s.y + s.h && r.y + r.h > s.y);
      if (hasContent) slices.push(s);
    }
    y = end;
  }
  if (!slices.length) slices.push({ x: b.x, y: b.y, w: worldW, h: worldH });
  return { sheetWmm, sheetHmm, contentW, contentH, headerH, footerH, scale, slices };
}
