import type {
  Anchor,
  SideAnchor,
  CanvasItem,
  ConnectorItem,
  ImageItem,
  PageContent,
  Point,
  Rect,
} from '../types';

export const EMPTY_RECT: Rect = { x: 0, y: 0, w: 0, h: 0 };

export function rectFromPoints(x1: number, y1: number, x2: number, y2: number): Rect {
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
}

export function unionRects(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
}

export function pointInRect(p: Point, r: Rect, pad = 0): boolean {
  return p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad;
}

export function rotatePoint(p: Point, c: Point, deg: number): Point {
  if (!deg) return p;
  const r = (deg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

/** Converts a normalised image-local point (0..1) to world coordinates. */
export function fromImageLocal(img: ImageItem, nx: number, ny: number): Point {
  const p = { x: img.x + nx * img.w, y: img.y + ny * img.h };
  return rotatePoint(p, { x: img.x + img.w / 2, y: img.y + img.h / 2 }, img.rotation);
}

/** Converts a world point to normalised image-local coordinates. */
export function toImageLocal(img: ImageItem, wx: number, wy: number): Point {
  const p = rotatePoint({ x: wx, y: wy }, { x: img.x + img.w / 2, y: img.y + img.h / 2 }, -img.rotation);
  return { x: (p.x - img.x) / img.w, y: (p.y - img.y) / img.h };
}

function imageRect(img: ImageItem): Rect {
  if (!img.rotation) return { x: img.x, y: img.y, w: img.w, h: img.h };
  const corners = [
    fromImageLocal(img, 0, 0),
    fromImageLocal(img, 1, 0),
    fromImageLocal(img, 1, 1),
    fromImageLocal(img, 0, 1),
  ];
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY };
}

function pointsRect(pts: Point[], pad: number): Rect {
  if (pts.length === 0) return EMPTY_RECT;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX - pad, y: minY - pad, w: Math.max(...xs) - minX + pad * 2, h: Math.max(...ys) - minY + pad * 2 };
}

/** Returns the item's geometric points in world coordinates (for strokes/shapes). */
export function worldPoints(item: CanvasItem, items: Record<string, CanvasItem>): Point[] {
  const parent = item.parentId ? items[item.parentId] : undefined;
  const map = (x: number, y: number): Point =>
    parent && parent.type === 'image' ? fromImageLocal(parent, x, y) : { x, y };
  if (item.type === 'stroke') {
    const out: Point[] = [];
    for (let i = 0; i + 1 < item.points.length; i += 2) out.push(map(item.points[i], item.points[i + 1]));
    return out;
  }
  if (item.type === 'shape') {
    if (item.kind === 'rect' || item.kind === 'ellipse') {
      return [map(item.x1, item.y1), map(item.x2, item.y1), map(item.x2, item.y2), map(item.x1, item.y2)];
    }
    return [map(item.x1, item.y1), map(item.x2, item.y2)];
  }
  return [];
}

/** Axis-aligned world bounds of an item. */
export function itemBounds(item: CanvasItem, items: Record<string, CanvasItem>): Rect {
  switch (item.type) {
    case 'text':
    case 'container': {
      const parent = item.parentId ? items[item.parentId] : undefined;
      if (parent && parent.type === 'image') {
        const p = fromImageLocal(parent, item.x, item.y);
        return { x: p.x, y: p.y, w: item.w, h: Math.max(item.h, 24) };
      }
      return { x: item.x, y: item.y, w: item.w, h: Math.max(item.h, 24) };
    }
    case 'image':
      return imageRect(item);
    case 'stroke':
      return pointsRect(worldPoints(item, items), item.width / 2 + 1);
    case 'shape':
      return pointsRect(worldPoints(item, items), item.width / 2 + (item.kind.includes('arrow') ? 8 : 1));
    case 'connector': {
      const ep = connectorEndpoints(item, items);
      if (!ep) return EMPTY_RECT;
      return pointsRect([ep.from, ep.to], 8);
    }
  }
}

export function sideMidpoint(r: Rect, side: SideAnchor): Point {
  switch (side) {
    case 'top':
      return { x: r.x + r.w / 2, y: r.y };
    case 'bottom':
      return { x: r.x + r.w / 2, y: r.y + r.h };
    case 'left':
      return { x: r.x, y: r.y + r.h / 2 };
    case 'right':
      return { x: r.x + r.w, y: r.y + r.h / 2 };
  }
}

/** Point on the rectangle boundary along the ray from its centre towards `towards`. */
export function rectBoundaryPoint(r: Rect, towards: Point): Point {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const dx = towards.x - cx;
  const dy = towards.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const hw = r.w / 2 || 0.0001;
  const hh = r.h / 2 || 0.0001;
  const scale = 1 / Math.max(Math.abs(dx) / hw, Math.abs(dy) / hh);
  return { x: cx + dx * scale, y: cy + dy * scale };
}

export function nearestSide(r: Rect, p: Point, maxDist: number): SideAnchor | null {
  let best: SideAnchor | null = null;
  let bestD = maxDist;
  for (const s of ['top', 'right', 'bottom', 'left'] as const) {
    const m = sideMidpoint(r, s);
    const d = Math.hypot(m.x - p.x, m.y - p.y);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

const CONNECT_GAP = 4;

/** World position of a fixed perimeter anchor (normalised to the item's box or image frame). */
export function fixedAnchorPoint(item: CanvasItem, items: Record<string, CanvasItem>, a: { x: number; y: number }): Point {
  if (item.type === 'image' && !item.parentId) return fromImageLocal(item, a.x, a.y);
  const r = itemBounds(item, items);
  return { x: r.x + a.x * r.w, y: r.y + a.y * r.h };
}

/** Pushes a perimeter point outwards by the connector gap so the line does not touch the object. */
function withGap(item: CanvasItem, items: Record<string, CanvasItem>, a: { x: number; y: number }): Point {
  const p = fixedAnchorPoint(item, items, a);
  let nx = (a.x >= 0.999 ? 1 : 0) - (a.x <= 0.001 ? 1 : 0);
  let ny = (a.y >= 0.999 ? 1 : 0) - (a.y <= 0.001 ? 1 : 0);
  if (nx === 0 && ny === 0) {
    const r = itemBounds(item, items);
    nx = p.x - (r.x + r.w / 2);
    ny = p.y - (r.y + r.h / 2);
  } else if (item.type === 'image' && !item.parentId && item.rotation) {
    const rot = rotatePoint({ x: nx, y: ny }, { x: 0, y: 0 }, item.rotation);
    nx = rot.x;
    ny = rot.y;
  }
  const len = Math.hypot(nx, ny) || 1;
  return { x: p.x + (nx / len) * CONNECT_GAP, y: p.y + (ny / len) * CONNECT_GAP };
}

function anchorEnd(item: CanvasItem, items: Record<string, CanvasItem>, anchor: Anchor, towards: Point): Point {
  const r = itemBounds(item, items);
  if (anchor === 'auto') return rectBoundaryPoint(inflate(r, CONNECT_GAP), towards);
  if (typeof anchor === 'string') return sideMidpoint(inflate(r, CONNECT_GAP), anchor);
  return withGap(item, items, anchor);
}

/** The point the other end aims at when computing an automatic attachment. */
function anchorTarget(item: CanvasItem, items: Record<string, CanvasItem>, anchor: Anchor): Point {
  const r = itemBounds(item, items);
  if (anchor === 'auto') return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  if (typeof anchor === 'string') return sideMidpoint(r, anchor);
  return fixedAnchorPoint(item, items, anchor);
}

/** Computes a connector's world endpoints from the current positions of its targets. */
export function connectorEndpoints(
  c: ConnectorItem,
  items: Record<string, CanvasItem>,
): { from: Point; to: Point } | null {
  const a = items[c.fromId];
  const b = items[c.toId];
  if (!a || !b || a.type === 'connector' || b.type === 'connector') return null;
  const from = anchorEnd(a, items, c.fromAnchor, anchorTarget(b, items, c.toAnchor));
  const to = anchorEnd(b, items, c.toAnchor, anchorTarget(a, items, c.fromAnchor));
  return { from, to };
}

/**
 * Returns the closest normalised point `{ x, y }` on the item's perimeter (0..1 along any of the 4 sides)
 * for any world point `p` (whether inside the item, on its outline, or outside near it).
 */
export function closestPerimeterAnchor(item: CanvasItem, items: Record<string, CanvasItem>, p: Point): { x: number; y: number } {
  let w: number;
  let h: number;
  let lx: number;
  let ly: number;
  if (item.type === 'image' && !item.parentId) {
    const l = toImageLocal(item, p.x, p.y);
    w = item.w;
    h = item.h;
    lx = l.x * w;
    ly = l.y * h;
  } else {
    const r = itemBounds(item, items);
    w = r.w;
    h = r.h;
    lx = p.x - r.x;
    ly = p.y - r.y;
  }
  if (w <= 0 || h <= 0) return { x: 0.5, y: 0 };

  if (item.type === 'shape' && item.kind === 'ellipse') {
    const cx = w / 2;
    const cy = h / 2;
    const angle = Math.atan2(ly - cy, lx - cx);
    return {
      x: Math.max(0, Math.min(1, 0.5 + 0.5 * Math.cos(angle))),
      y: Math.max(0, Math.min(1, 0.5 + 0.5 * Math.sin(angle))),
    };
  }

  const cx = Math.max(0, Math.min(w, lx));
  const cy = Math.max(0, Math.min(h, ly));
  const dists = [
    { d: Math.abs(ly), x: cx, y: 0 },
    { d: Math.abs(h - ly), x: cx, y: h },
    { d: Math.abs(lx), x: 0, y: cy },
    { d: Math.abs(w - lx), x: w, y: cy },
  ].sort((m, n) => m.d - n.d);
  const best = dists[0];
  return { x: best.x / w, y: best.y / h };
}

/**
 * If `p` lies within `tol` of the item's perimeter (inside or outside), returns the
 * normalised perimeter point closest to it; otherwise null.
 */
export function perimeterAnchorAt(item: CanvasItem, items: Record<string, CanvasItem>, p: Point, tol: number): { x: number; y: number } | null {
  let w: number;
  let h: number;
  let lx: number;
  let ly: number;
  if (item.type === 'image' && !item.parentId) {
    const l = toImageLocal(item, p.x, p.y);
    w = item.w;
    h = item.h;
    lx = l.x * w;
    ly = l.y * h;
  } else {
    const r = itemBounds(item, items);
    w = r.w;
    h = r.h;
    lx = p.x - r.x;
    ly = p.y - r.y;
  }
  if (w <= 0 || h <= 0) return null;

  if (item.type === 'shape' && item.kind === 'ellipse') {
    const cx = w / 2;
    const cy = h / 2;
    const angle = Math.atan2(ly - cy, lx - cx);
    const ex = cx + (w / 2) * Math.cos(angle);
    const ey = cy + (h / 2) * Math.sin(angle);
    if (Math.hypot(lx - ex, ly - ey) > tol) return null;
    return {
      x: Math.max(0, Math.min(1, 0.5 + 0.5 * Math.cos(angle))),
      y: Math.max(0, Math.min(1, 0.5 + 0.5 * Math.sin(angle))),
    };
  }

  if (lx < -tol || ly < -tol || lx > w + tol || ly > h + tol) return null;
  const cx = Math.max(0, Math.min(w, lx));
  const cy = Math.max(0, Math.min(h, ly));
  const inside = lx >= 0 && lx <= w && ly >= 0 && ly <= h;
  const dists = [
    { d: Math.abs(ly), x: cx, y: 0 },
    { d: Math.abs(h - ly), x: cx, y: h },
    { d: Math.abs(lx), x: 0, y: cy },
    { d: Math.abs(w - lx), x: w, y: cy },
  ].sort((m, n) => m.d - n.d);
  const best = dists[0];
  const distance = inside ? best.d : Math.hypot(lx - cx, ly - cy);
  if (distance > tol) return null;
  return { x: best.x / w, y: best.y / h };
}

export function inflate(r: Rect, d: number): Rect {
  return { x: r.x - d, y: r.y - d, w: r.w + d * 2, h: r.h + d * 2 };
}

export function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function polylineHit(pts: Point[], p: Point, tol: number, closed = false): boolean {
  if (pts.length === 1) return Math.hypot(pts[0].x - p.x, pts[0].y - p.y) <= tol;
  for (let i = 0; i + 1 < pts.length; i++) if (distToSegment(p, pts[i], pts[i + 1]) <= tol) return true;
  if (closed && pts.length > 2 && distToSegment(p, pts[pts.length - 1], pts[0]) <= tol) return true;
  return false;
}

/** Precise hit testing in world coordinates. */
export function hitTest(item: CanvasItem, items: Record<string, CanvasItem>, p: Point, tol: number): boolean {
  switch (item.type) {
    case 'text':
    case 'container':
      return pointInRect(p, itemBounds(item, items));
    case 'image': {
      const l = toImageLocal(item, p.x, p.y);
      return l.x >= 0 && l.x <= 1 && l.y >= 0 && l.y <= 1;
    }
    case 'stroke':
      return polylineHit(worldPoints(item, items), p, tol + item.width / 2);
    case 'shape': {
      const pts = worldPoints(item, items);
      if (item.kind === 'rect') {
        if (item.fill) return pointInPolygon(p, pts);
        return polylineHit(pts, p, tol + item.width / 2, true);
      }
      if (item.kind === 'ellipse') return ellipseHit(item, items, p, tol);
      return polylineHit(pts, p, tol + item.width / 2);
    }
    case 'connector': {
      const ep = connectorEndpoints(item, items);
      return !!ep && distToSegment(p, ep.from, ep.to) <= tol + item.width / 2;
    }
  }
}

function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function ellipseHit(item: CanvasItem & { type: 'shape' }, items: Record<string, CanvasItem>, p: Point, tol: number): boolean {
  // Sample the ellipse outline in world space (handles parents with rotation).
  const parent = item.parentId ? items[item.parentId] : undefined;
  const cx = (item.x1 + item.x2) / 2;
  const cy = (item.y1 + item.y2) / 2;
  const rx = Math.abs(item.x2 - item.x1) / 2;
  const ry = Math.abs(item.y2 - item.y1) / 2;
  const pts: Point[] = [];
  for (let i = 0; i <= 48; i++) {
    const t = (i / 48) * Math.PI * 2;
    const x = cx + rx * Math.cos(t);
    const y = cy + ry * Math.sin(t);
    pts.push(parent && parent.type === 'image' ? fromImageLocal(parent, x, y) : { x, y });
  }
  if (item.fill && pointInPolygon(p, pts)) return true;
  return polylineHit(pts, p, tol + item.width / 2);
}

/** Constrains (x,y) relative to an origin to 45° increments. */
export function constrainAngle(x0: number, y0: number, x: number, y: number): Point {
  const dx = x - x0;
  const dy = y - y0;
  const len = Math.hypot(dx, dy);
  const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  return { x: x0 + Math.cos(angle) * len, y: y0 + Math.sin(angle) * len };
}

/** Constrains a box drag to a square. */
export function constrainSquare(x0: number, y0: number, x: number, y: number): Point {
  const dx = x - x0;
  const dy = y - y0;
  const s = Math.max(Math.abs(dx), Math.abs(dy));
  return { x: x0 + Math.sign(dx || 1) * s, y: y0 + Math.sign(dy || 1) * s };
}

/**
 * Constrains a stroke to purely horizontal or vertical axis from an origin
 * (whichever displacement is dominant), keeping drawn lines perfectly straight.
 */
export function constrainOrthogonal(x0: number, y0: number, x: number, y: number): Point {
  const dx = Math.abs(x - x0);
  const dy = Math.abs(y - y0);
  if (dx >= dy) {
    return { x, y: y0 };
  }
  return { x: x0, y };
}

/** Builds a smooth SVG path through points using quadratic midpoints. */
export function smoothPath(pts: number[]): string {
  const n = pts.length / 2;
  if (n === 0) return '';
  if (n === 1) return `M ${pts[0]} ${pts[1]} L ${pts[0] + 0.01} ${pts[1]}`;
  if (n === 2) return `M ${pts[0]} ${pts[1]} L ${pts[2]} ${pts[3]}`;
  let d = `M ${pts[0]} ${pts[1]}`;
  for (let i = 1; i < n - 1; i++) {
    const x = pts[i * 2];
    const y = pts[i * 2 + 1];
    const nx = pts[i * 2 + 2];
    const ny = pts[i * 2 + 3];
    d += ` Q ${x} ${y} ${(x + nx) / 2} ${(y + ny) / 2}`;
  }
  d += ` L ${pts[pts.length - 2]} ${pts[pts.length - 1]}`;
  return d;
}

/** Ramer–Douglas–Peucker simplification on a flat point list. */
export function simplify(points: number[], epsilon: number): number[] {
  const n = points.length / 2;
  if (n < 3) return points.slice();
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: Array<[number, number]> = [[0, n - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    const a = { x: points[s * 2], y: points[s * 2 + 1] };
    const b = { x: points[e * 2], y: points[e * 2 + 1] };
    for (let i = s + 1; i < e; i++) {
      const d = distToSegment({ x: points[i * 2], y: points[i * 2 + 1] }, a, b);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > epsilon && idx > 0) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(points[i * 2], points[i * 2 + 1]);
  return out;
}

/** Bounds of every visible (top-level and attached) item on a page. */
export function contentBounds(page: PageContent): Rect | null {
  const rects: Rect[] = [];
  for (const id of page.order) {
    const it = page.items[id];
    if (!it) continue;
    const r = itemBounds(it, page.items);
    if (r.w > 0 || r.h > 0) rects.push(r);
  }
  return unionRects(rects);
}

export function arrowHeadPath(from: Point, to: Point, size: number): string {
  const ang = Math.atan2(to.y - from.y, to.x - from.x);
  const a1 = ang + Math.PI - Math.PI / 7;
  const a2 = ang + Math.PI + Math.PI / 7;
  return `M ${to.x + Math.cos(a1) * size} ${to.y + Math.sin(a1) * size} L ${to.x} ${to.y} L ${to.x + Math.cos(a2) * size} ${to.y + Math.sin(a2) * size}`;
}
