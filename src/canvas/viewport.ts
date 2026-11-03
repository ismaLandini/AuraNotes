import type { Point, Rect, Viewport } from '../types';
import { useStore } from '../store/useStore';
import { useSettings } from '../store/settings';
import { contentBounds } from '../lib/geometry';
import { PAGE_WIDTH, SHEET_TOP, TWO_A4_HEIGHT, sheetBottom, sheetLeft, sheetRight } from '../lib/page';

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

export function defaultViewport(): Viewport {
  return { x: -1e6, y: SHEET_TOP - 1e6, zoom: useSettings.getState().defaultZoom || 1 }; // clamped to the sheet's top-left
}

const EDGE = 24; // screen pixels of background visible beyond the sheet edges

/**
 * Keeps the sheet in view: anchored cleanly on the left (without empty gap),
 * horizontally scrollable when the window is narrower than the sheet or content;
 * vertically starting right below the toolbar and scrolling continuously through the
 * full height of two vertical A4 sheets (~2245 px) and any further notes.
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

  const sLeft = sheetLeft(page);
  const sRight = sheetRight(page);
  const totalW = sRight - sLeft;

  // Vertical boundary: comfortable top margin,
  // scrolling continuously down through the 2x A4 sheet height (~2245 px) and further notes.
  const minY = SHEET_TOP - 16 / zoom;
  const pageBottom = Math.max(bottom, SHEET_TOP + TWO_A4_HEIGHT);
  const maxY = Math.max(minY, pageBottom - vh + 160 / zoom);

  // Horizontal boundary: when content fits in the viewport, anchor flush on the left
  // without jumping or shifting into the middle of the window. When content exceeds
  // the viewport (zoom or narrow window), allow natural horizontal scrolling.
  const minX = sLeft - 8 / zoom;
  const maxX = totalW <= vw ? minX : Math.max(minX, sRight - vw + 24 / zoom);

  let x: number;
  if (v.x <= -5e5) {
    x = minX; // Snug at initial open
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

/** Zooms so the full width of the two-A4 sheet is visible. */
export function fitContent() {
  const { w } = screenSize();
  const left = EDGE * 2;
  const zoom = clampZoom((w - left) / PAGE_WIDTH);
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
