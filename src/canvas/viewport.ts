import type { PageContent, Point, Rect, Viewport } from '../types';
import { useStore } from '../store/useStore';
import { useSettings } from '../store/settings';
import { contentBounds } from '../lib/geometry';
import { A4_HEIGHT, A4_WIDTH, PAGE_WIDTH, SHEET_TOP, getPageSheets, isPdfDocument, sheetBottom, sheetLeft, sheetRight } from '../lib/page';

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 6;

export const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

let containerEl: HTMLElement | null = null;
let lastPointerWorld: Point | null = null;

export function registerContainer(el: HTMLElement | null) {
  containerEl = el;
}

export function setLastPointerWorld(p: Point | null) {
  lastPointerWorld = p;
}

export function defaultViewport(page = useStore.getState().currentPage()): Viewport {
  const isPdf = isPdfDocument(page);
  const size = screenSize();
  let zoom = useSettings.getState().defaultZoom || 1;
  if (isPdf && page) {
    const sRight = sheetRight(page);
    const sLeft = sheetLeft(page);
    const totalW = sRight - sLeft;
    if (totalW + 48 > size.w && size.w > 300) {
      zoom = clampZoom((size.w - 48) / totalW);
    }
  }
  return { x: -1e6, y: isPdf ? -1e6 : SHEET_TOP - 1e6, zoom };
}

const EDGE = 24; // screen pixels of background visible beyond the sheet edges

export function computeViewportBounds(
  vw: number,
  vh: number,
  zoom: number,
  bottom: number,
  page: PageContent | null | undefined,
) {
  const isPdf = isPdfDocument(page);
  const topEdge = isPdf ? 0 : SHEET_TOP;

  // Vertical boundary: comfortable top margin, scrolling continuously down through all sheets and notes.
  const minY = topEdge - 24 / zoom;
  const pageBottom = Math.max(bottom, topEdge + A4_HEIGHT);
  const maxY = Math.max(minY, pageBottom - vh + 160 / zoom);

  // Horizontal boundary: lock the sheet dead-center horizontally with no sideways panning.
  const sheetW = Math.max(...getPageSheets(page).map((s) => s.width), A4_WIDTH);
  const centeredX = -(vw - sheetW) / 2;
  const minX = centeredX;
  const maxX = centeredX;

  return { minX, maxX, minY, maxY, centeredX };
}

/**
 * Keeps the sheet centered horizontally in the workspace like Microsoft Word when it fits,
 * and horizontally scrollable when zoomed wider than the viewport;
 * vertically starting right below the toolbar and scrolling continuously through all sheets.
 */
export function clampViewport(
  v: Viewport,
  size = screenSize(),
  bottom = sheetBottom(useStore.getState().currentPage()),
  page = useStore.getState().currentPage(),
): Viewport {
  const zoom = clampZoom(v.zoom);
  const vw = size.w / zoom;
  const vh = size.h / zoom;

  const { minX, maxX, minY, maxY, centeredX } = computeViewportBounds(vw, vh, zoom, bottom, page);

  let x: number;
  if (v.x <= -5e5) {
    x = Math.min(Math.max(centeredX, minX), maxX); // Centered at initial open
  } else {
    x = Math.min(Math.max(v.x, minX), maxX);
  }

  let y: number;
  if (v.y <= SHEET_TOP - 5e5) {
    y = minY; // Snug at initial open
  } else {
    y = Math.min(Math.max(v.y, minY), maxY);
  }

  return { x, y, zoom };
}

export function getViewport(): Viewport {
  const s = useStore.getState();
  return clampViewport((s.pageId && s.viewports[s.pageId]) || defaultViewport());
}

/** Stores a viewport for the current page, clamped to the sheet. */
export function setVp(v: Viewport) {
  const id = useStore.getState().pageId;
  if (id) useStore.getState().setViewport(id, clampViewport(v));
}

export function screenSize(): { w: number; h: number } {
  if (!containerEl) return { w: 1000, h: 700 };
  return { w: containerEl.clientWidth, h: containerEl.clientHeight };
}

export function screenToWorld(sx: number, sy: number, vp = getViewport()): Point {
  return { x: vp.x + sx / vp.zoom, y: vp.y + sy / vp.zoom };
}

export function clientToWorld(cx: number, cy: number): Point {
  const r = containerEl?.getBoundingClientRect();
  return screenToWorld(cx - (r?.left ?? 0), cy - (r?.top ?? 0));
}

/** World point at the centre of the visible area, or the last pointer position when it is visible. */
export function insertionPoint(preferPointer = true): Point {
  const vp = getViewport();
  const { w, h } = screenSize();
  if (preferPointer && lastPointerWorld) {
    const p = lastPointerWorld;
    if (p.x > vp.x && p.y > vp.y && p.x < vp.x + w / vp.zoom && p.y < vp.y + h / vp.zoom) return p;
  }
  return screenToWorld(w / 2, h / 2, vp);
}

export function zoomAt(factor: number, sx?: number, sy?: number) {
  const vp = getViewport();
  const { w, h } = screenSize();
  const px = sx ?? w / 2;
  const py = sy ?? h / 2;
  const nz = clampZoom(vp.zoom * factor);
  const world = screenToWorld(px, py, vp);
  setVp({ zoom: nz, x: world.x - px / nz, y: world.y - py / nz });
}

export function setZoom(z: number) {
  zoomAt(clampZoom(z) / getViewport().zoom);
}

export function panBy(dxScreen: number, dyScreen: number) {
  const vp = getViewport();
  setVp({ ...vp, x: vp.x + dxScreen / vp.zoom, y: vp.y + dyScreen / vp.zoom });
}

export function fitRect(r: Rect, padding = 48, maxZoom = 1.5) {
  const { w, h } = screenSize();
  const zoom = clampZoom(Math.min((w - padding * 2) / Math.max(r.w, 1), (h - padding * 2) / Math.max(r.h, 1), maxZoom));
  setVp({ zoom, x: r.x + r.w / 2 - w / 2 / zoom, y: r.y + r.h / 2 - h / 2 / zoom });
}

/** Zooms so the full width of the sheet (A4 or PDF) is visible and centered. */
export function fitContent() {
  const page = useStore.getState().currentPage();
  const { w } = screenSize();
  const sLeft = sheetLeft(page);
  const sRight = sheetRight(page);
  const pageW = Math.max(PAGE_WIDTH, sRight - sLeft);
  const pad = EDGE * 2;
  const zoom = clampZoom((w - pad) / pageW);
  setVp({ zoom, x: -1e6, y: getViewport().y });
}

export function centerContent() {
  const page = useStore.getState().currentPage();
  const b = page && contentBounds(page);
  const vp = getViewport();
  if (!b) return setVp({ ...defaultViewport(), zoom: vp.zoom });
  const { w, h } = screenSize();
  setVp({ zoom: vp.zoom, x: b.x + b.w / 2 - w / 2 / vp.zoom, y: b.y + b.h / 2 - h / 2 / vp.zoom });
}

export function resetZoom() {
  zoomAt(1 / getViewport().zoom);
}

/** Scrolls so that the given world rect is visible. */
export function revealRect(r: Rect) {
  const vp = getViewport();
  const { w, h } = screenSize();
  const vw = w / vp.zoom;
  const vh = h / vp.zoom;
  if (r.x >= vp.x && r.y >= vp.y && r.x + r.w <= vp.x + vw && r.y + r.h <= vp.y + vh) return;
  setVp({ zoom: vp.zoom, x: r.x + r.w / 2 - vw / 2, y: Math.max(r.y - 60, r.y + r.h / 2 - vh / 2) });
}
