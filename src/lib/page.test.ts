import { describe, expect, it } from 'vitest';
import { PAGE_WIDTH, constrainChanged, constrainItem, sheetBottom, sheetLeft, sheetRight, TWO_A4_HEIGHT, SHEET_TOP, MAX_PAGE_ITEM_WIDTH } from './page';
import { perimeterAnchorAt, connectorEndpoints, fixedAnchorPoint } from './geometry';
import * as P from '../model/pageOps';
import type { CanvasItem, ConnectorItem, ImageItem, PageContent, TextItem } from '../types';

const text = (id: string, x: number, w = 200): TextItem => ({ id, type: 'text', x, y: 0, w, h: 40, doc: P.EMPTY_DOC, variant: 'plain' });
const image = (id: string, x: number, w: number, h: number): ImageItem => ({ id, type: 'image', x, y: 0, w, h, rotation: 0, assetId: 'a', naturalWidth: w, naturalHeight: h, mime: 'image/png' });

describe('two-A4 page geometry and item constraints', () => {
  it('is 420 mm wide at print scale', () => {
    expect(PAGE_WIDTH).toBe(1587);
  });
  it('prevents objects from moving past the left margin', () => {
    expect((constrainItem(text('t', -50), {}) as TextItem).x).toBe(0);
  });
  it('scales oversized images and text blocks to the max item width (1850 px)', () => {
    const i = constrainItem(image('i', 0, 3000, 600), {}) as ImageItem;
    expect(i.w).toBeCloseTo(MAX_PAGE_ITEM_WIDTH);
    expect(i.h).toBeCloseTo(600 * (MAX_PAGE_ITEM_WIDTH / 3000));
    expect((constrainItem(text('t', 0, 5000), {}) as TextItem).w).toBe(MAX_PAGE_ITEM_WIDTH);
  });
  it('leaves untouched items of existing pages where they are', () => {
    const old: PageContent = P.addItems(P.emptyPage('p'), [text('legacy', 1700), text('t', 10)]);
    const next = P.updateItems(old, { t: { x: 1600 } });
    const c = constrainChanged(old, next);
    expect((c.items.legacy as TextItem).x).toBe(1700);
    expect((c.items.t as TextItem).x).toBe(1600);
  });
  it('grows the sheet with the content, at least two vertical A4 tall (~2245 px)', () => {
    expect(sheetBottom(P.emptyPage('p'))).toBe(SHEET_TOP + TWO_A4_HEIGHT);
    const p = P.addItems(P.emptyPage('p'), [{ ...text('t', 0), y: 3000 }]);
    expect(sheetBottom(p)).toBeGreaterThan(3000);
  });
  it('calculates horizontal bounds with sheetLeft and sheetRight', () => {
    const empty = P.emptyPage('p');
    expect(sheetLeft(empty)).toBe(0);
    expect(sheetRight(empty)).toBe(PAGE_WIDTH);

    const extendedRight = P.addItems(empty, [text('r', 2000, 300)]);
    expect(sheetRight(extendedRight)).toBeGreaterThan(2300);

    const extendedLeft = P.addItems(empty, [{ ...text('l', -300, 200), x: -300 }]);
    expect(sheetLeft(extendedLeft)).toBeLessThan(-300);
  });
});

describe('perimeter anchors', () => {
  const items: Record<string, CanvasItem> = { a: { ...text('a', 0), w: 100, h: 50 }, b: { ...text('b', 300), w: 100, h: 50 } };
  it('snaps a point near the outline to the closest perimeter position', () => {
    expect(perimeterAnchorAt(items.a, items, { x: 100, y: 25 }, 6)).toEqual({ x: 1, y: 0.5 });
    expect(perimeterAnchorAt(items.a, items, { x: 30, y: 52 }, 6)).toEqual({ x: 0.3, y: 1 });
    expect(perimeterAnchorAt(items.a, items, { x: 50, y: 25 }, 6)).toBeNull(); // interior → automatic
    expect(perimeterAnchorAt(items.a, items, { x: 200, y: 25 }, 6)).toBeNull(); // far away
  });
  it('keeps the attachment point when the object is moved or resized', () => {
    const c: ConnectorItem = { id: 'c', type: 'connector', fromId: 'a', toId: 'b', fromAnchor: { x: 1, y: 0.5 }, toAnchor: { x: 0.5, y: 0 }, arrow: 'end', color: '#000', width: 2, layer: 'back' };
    const e1 = connectorEndpoints(c, items)!;
    expect(e1.to.x).toBeCloseTo(350);
    const moved = { ...items, b: { ...(items.b as TextItem), x: 500, w: 300 } };
    const e2 = connectorEndpoints(c, moved)!;
    expect(e2.to.x).toBeCloseTo(650);
    expect(fixedAnchorPoint(moved.b, moved, { x: 0.5, y: 0 }).x).toBe(650);
  });
  it('follows rotated images through their local frame', () => {
    const img: ImageItem = { ...image('i', 0, 200, 100), rotation: 90 };
    const p = fixedAnchorPoint(img, { i: img }, { x: 1, y: 0.5 });
    expect(p.x).toBeCloseTo(100);
    expect(p.y).toBeCloseTo(150);
  });
});

describe('groups and repair', () => {
  it('groups and ungroups items; copies get their own group', () => {
    let p = P.addItems(P.emptyPage('p'), [text('a', 0), text('b', 300), text('c', 600)]);
    p = P.groupItems(p, ['a', 'b']);
    expect(p.items.a.groupId).toBeTruthy();
    expect(p.items.a.groupId).toBe(p.items.b.groupId);
    expect(p.items.c.groupId).toBeUndefined();
    const { items } = P.cloneItems(p.items, p.order, ['a', 'b'], 10, 10);
    expect(items[0].groupId).toBe(items[1].groupId);
    expect(items[0].groupId).not.toBe(p.items.a.groupId);
    p = P.ungroupItems(p, ['a', 'b']);
    expect(p.items.a.groupId).toBeUndefined();
  });
  it('removes orphan connectors and annotations when loading', () => {
    const p: PageContent = {
      id: 'p',
      schemaVersion: 1,
      order: ['t', 'c', 's'],
      items: {
        t: text('t', 0),
        c: { id: 'c', type: 'connector', fromId: 't', toId: 'gone', fromAnchor: 'auto', toAnchor: 'auto', arrow: 'end', color: '#000', width: 2, layer: 'back' },
        s: { id: 's', type: 'stroke', parentId: 'missing', points: [0, 0, 1, 1], color: '#000', width: 1, opacity: 1, tool: 'pen' },
      },
    };
    const r = P.repairPage(p);
    expect(r.order).toEqual(['t']);
    expect(Object.keys(r.items)).toEqual(['t']);
  });
});
