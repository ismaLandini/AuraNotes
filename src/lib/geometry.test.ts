import { describe, expect, it } from 'vitest';
import * as G from './geometry';
import type { CanvasItem, ConnectorItem, ImageItem, TextItem } from '../types';

const box = (id: string, x: number, y: number, w = 100, h = 50): TextItem => ({ id, type: 'text', x, y, w, h, doc: { type: 'doc' }, variant: 'plain' });
const conn = (fromId: string, toId: string, extra: Partial<ConnectorItem> = {}): ConnectorItem => ({ id: 'c', type: 'connector', fromId, toId, fromAnchor: 'auto', toAnchor: 'auto', arrow: 'end', color: '#000', width: 2, layer: 'back', ...extra });

describe('connectors', () => {
  it('attach to the facing boundaries of their targets', () => {
    const items: Record<string, CanvasItem> = { a: box('a', 0, 0), b: box('b', 300, 0) };
    const ep = G.connectorEndpoints(conn('a', 'b'), items)!;
    expect(ep.from.x).toBeCloseTo(104); // right edge + gap
    expect(ep.to.x).toBeCloseTo(296); // left edge - gap
    expect(ep.from.y).toBeCloseTo(25);
  });

  it('follow their targets when objects move', () => {
    const items: Record<string, CanvasItem> = { a: box('a', 0, 0), b: box('b', 300, 0) };
    const c = conn('a', 'b');
    const before = G.connectorEndpoints(c, items)!;
    items.b = box('b', 300, 400);
    const after = G.connectorEndpoints(c, items)!;
    expect(after.to.y).toBeGreaterThan(before.to.y + 300);
    expect(after.to.y).toBeCloseTo(396); // now attached to the top edge
  });

  it('respect fixed anchors', () => {
    const items: Record<string, CanvasItem> = { a: box('a', 0, 0), b: box('b', 300, 0) };
    const ep = G.connectorEndpoints(conn('a', 'b', { fromAnchor: 'bottom', toAnchor: 'top' }), items)!;
    expect(ep.from).toEqual({ x: 50, y: 54 });
    expect(ep.to).toEqual({ x: 350, y: -4 });
  });

  it('return null when a target is missing', () => {
    expect(G.connectorEndpoints(conn('a', 'zzz'), { a: box('a', 0, 0) })).toBeNull();
  });

  it('projects any point onto the closest perimeter coordinate across all 4 sides and corners', () => {
    const t1 = box('t1', 0, 0, 400, 100);
    const t2 = box('t2', 500, 200, 300, 80);
    const items: Record<string, CanvasItem> = { t1, t2 };
    // Interior point closer to top edge at x=25%
    const aTop = G.closestPerimeterAnchor(t1, items, { x: 100, y: 20 });
    expect(aTop).toEqual({ x: 0.25, y: 0 });
    // Interior point closer to bottom edge at x=75%
    const aBot = G.closestPerimeterAnchor(t1, items, { x: 300, y: 82 });
    expect(aBot).toEqual({ x: 0.75, y: 1 });
    // Interior point closer to left edge at y=40%
    const aLeft = G.closestPerimeterAnchor(t2, items, { x: 515, y: 232 });
    expect(aLeft).toEqual({ x: 0, y: 0.4 });
    // Interior point closer to right edge at y=60%
    const aRight = G.closestPerimeterAnchor(t2, items, { x: 790, y: 248 });
    expect(aRight).toEqual({ x: 1, y: 0.6 });

    const ep = G.connectorEndpoints(conn('t1', 't2', { fromAnchor: aTop, toAnchor: aRight }), items)!;
    expect(ep.from).toEqual({ x: 100, y: -4 });
    expect(ep.to).toEqual({ x: 804, y: 248 });
  });

  it('computes true elliptical perimeter anchors for circle and ellipse shapes', () => {
    const ellipse: CanvasItem = {
      id: 'e1',
      type: 'shape',
      kind: 'ellipse',
      x1: 100,
      y1: 100,
      x2: 300,
      y2: 200,
      color: '#000',
      width: 2,
      opacity: 1,
      fill: null,
    };
    const items = { e1: ellipse };

    // Point directly to the right: angle 0, perimeter at (300, 150) -> normalized anchor (1, 0.5)
    const rightAnchor = G.closestPerimeterAnchor(ellipse, items, { x: 350, y: 150 });
    expect(rightAnchor.x).toBeCloseTo(1, 2);
    expect(rightAnchor.y).toBeCloseTo(0.5, 2);

    const rightPt = G.fixedAnchorPoint(ellipse, items, rightAnchor);
    // Bounds of shape include stroke padding (width=2 -> pad=2: x in [98, 302], y in [98, 202])
    expect(rightPt.x).toBeCloseTo(302, 1);
    expect(rightPt.y).toBeCloseTo(150, 1);

    // Point diagonally towards (300, 200): vector from center (200, 150) is (100, 50).
    // The anchor must be on the true ellipse curve (not the bounding box corner 302, 202).
    const diagAnchor = G.closestPerimeterAnchor(ellipse, items, { x: 300, y: 200 });
    const diagPt = G.fixedAnchorPoint(ellipse, items, diagAnchor);
    expect(diagPt.x).toBeLessThan(300);
    expect(diagPt.y).toBeLessThan(200);
    // On the ellipse (x - 200)^2 / 102^2 + (y - 150)^2 / 52^2 == 1:
    const ellipseEq = Math.pow((diagPt.x - 200) / 102, 2) + Math.pow((diagPt.y - 150) / 52, 2);
    expect(ellipseEq).toBeCloseTo(1, 4);
  });
});

describe('image local frame', () => {
  const img: ImageItem = { id: 'i', type: 'image', x: 100, y: 50, w: 200, h: 100, rotation: 90, assetId: 'a', naturalWidth: 1, naturalHeight: 1, mime: 'image/png' };
  it('round-trips world ↔ local coordinates with rotation', () => {
    const w = G.fromImageLocal(img, 0.25, 0.75);
    const l = G.toImageLocal(img, w.x, w.y);
    expect(l.x).toBeCloseTo(0.25);
    expect(l.y).toBeCloseTo(0.75);
  });
  it('computes rotated bounds', () => {
    const r = G.itemBounds(img, {});
    expect(r.w).toBeCloseTo(100);
    expect(r.h).toBeCloseTo(200);
  });
  it('annotations follow the image', () => {
    const stroke: CanvasItem = { id: 's', type: 'stroke', parentId: 'i', points: [0, 0, 1, 1], color: '#000', width: 2, opacity: 1, tool: 'pen' };
    const items = { i: { ...img, rotation: 0 }, s: stroke };
    const b1 = G.itemBounds(stroke, items);
    const items2 = { i: { ...img, rotation: 0, x: 500 }, s: stroke };
    const b2 = G.itemBounds(stroke, items2);
    expect(b2.x - b1.x).toBeCloseTo(400);
  });
});

describe('drawing helpers', () => {
  it('constrains lines to 45° increments', () => {
    const p = G.constrainAngle(0, 0, 100, 8);
    expect(p.y).toBeCloseTo(0);
    const d = G.constrainAngle(0, 0, 100, 90);
    expect(d.x).toBeCloseTo(d.y);
  });
  it('constrains boxes to squares', () => {
    const p = G.constrainSquare(0, 0, 40, -100);
    expect(Math.abs(p.x)).toBe(100);
    expect(p.y).toBe(-100);
  });
  it('constrains strokes orthogonally (horizontal or vertical)', () => {
    const h = G.constrainOrthogonal(100, 200, 350, 230);
    expect(h).toEqual({ x: 350, y: 200 });

    const v = G.constrainOrthogonal(100, 200, 120, 500);
    expect(v).toEqual({ x: 100, y: 500 });

    const left = G.constrainOrthogonal(100, 200, -50, 190);
    expect(left).toEqual({ x: -50, y: 200 });

    const up = G.constrainOrthogonal(100, 200, 95, -100);
    expect(up).toEqual({ x: 100, y: -100 });
  });
  it('simplifies collinear points', () => {
    const pts = [0, 0, 1, 0.001, 2, 0, 3, 0.001, 4, 0];
    expect(G.simplify(pts, 0.1)).toEqual([0, 0, 4, 0]);
  });
  it('hit-tests strokes by distance', () => {
    const s: CanvasItem = { id: 's', type: 'stroke', points: [0, 0, 100, 0], color: '#000', width: 2, opacity: 1, tool: 'pen' };
    expect(G.hitTest(s, {}, { x: 50, y: 3 }, 3)).toBe(true);
    expect(G.hitTest(s, {}, { x: 50, y: 20 }, 3)).toBe(false);
  });
  it('builds a smooth path', () => {
    expect(G.smoothPath([0, 0, 10, 10, 20, 0])).toMatch(/^M 0 0 Q 10 10/);
  });
  it('computes content bounds', () => {
    const b = G.contentBounds({ id: 'p', schemaVersion: 1, items: { a: box('a', 0, 0), b: box('b', 300, 200) }, order: ['a', 'b'] })!;
    expect(b).toEqual({ x: 0, y: 0, w: 400, h: 250 });
  });
});
