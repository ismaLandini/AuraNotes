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
