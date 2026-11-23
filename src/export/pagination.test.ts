import { describe, expect, it } from 'vitest';
import { chooseBreak, computeLayout, DEFAULT_PRINT_OPTIONS, layoutForPage, PX_PER_MM } from './pagination';
import type { PageContent } from '../types';

describe('print pagination', () => {
  const o = { ...DEFAULT_PRINT_OPTIONS, marginMm: 10, showTitle: false, pageNumbers: false };
  const contentW = (210 - 20) * PX_PER_MM;

  it('fits wide content to the page width', () => {
    const l = computeLayout({ x: 0, y: 0, w: 2000, h: 300 }, [{ x: 0, y: 0, w: 2000, h: 300 }], o);
    expect(l.scale).toBeCloseTo(contentW / 2024, 3);
    expect(l.slices).toHaveLength(1);
  });

  it('paginates long notes vertically', () => {
    const rects = Array.from({ length: 40 }, (_, i) => ({ x: 0, y: i * 100, w: 600, h: 60 }));
    const l = computeLayout({ x: 0, y: 0, w: 600, h: 4000 }, rects, o);
    expect(l.slices.length).toBeGreaterThan(3);
    // consecutive slices are contiguous
    for (let i = 1; i < l.slices.length; i++) expect(l.slices[i].y).toBeCloseTo(l.slices[i - 1].y + l.slices[i - 1].h);
  });

  it('never cuts through a block when a clean break exists', () => {
    const rects = [{ x: 0, y: 900, w: 300, h: 200 }];
    const br = chooseBreak(0, 1000, rects);
    expect(br).toBeLessThanOrEqual(900);
    expect(br).toBeGreaterThan(600);
  });

  it('tiles content wider than the page at 100% scale', () => {
    const l = computeLayout({ x: 0, y: 0, w: 2000, h: 400 }, [{ x: 0, y: 0, w: 2000, h: 400 }], { ...o, scaleMode: 'actual' });
    expect(l.scale).toBe(1);
    expect(l.slices.length).toBeGreaterThanOrEqual(3);
  });

  it('skips blank sheets between distant objects', () => {
    const rects = [
      { x: 0, y: 0, w: 300, h: 100 },
      { x: 0, y: 5000, w: 300, h: 100 },
    ];
    const l = computeLayout({ x: 0, y: 0, w: 300, h: 5100 }, rects, { ...o, scaleMode: 'actual' });
    expect(l.slices).toHaveLength(2);
  });

  it('fit-page puts everything on one sheet', () => {
    const l = computeLayout({ x: 0, y: 0, w: 800, h: 3000 }, [{ x: 0, y: 0, w: 800, h: 3000 }], { ...o, scaleMode: 'fit-page' });
    expect(l.slices).toHaveLength(1);
  });

  it('landscape swaps sheet dimensions', () => {
    const l = computeLayout(null, [], { ...o, orientation: 'landscape' });
    expect(l.sheetWmm).toBe(297);
    expect(l.sheetHmm).toBe(210);
  });

  it('exports imported PDF documents with exact sheet slices for every slide', () => {
    const pdfPage: PageContent = {
      id: 'p1',
      schemaVersion: 1,
      pdfAssetId: 'asset-test-pdf',
      sheets: [
        { id: 'sheet-1', type: 'pdf', pdfAssetId: 'asset-test-pdf', pdfPage: 1, width: 1040, height: 585 },
        { id: 'sheet-2', type: 'pdf', pdfAssetId: 'asset-test-pdf', pdfPage: 2, width: 1040, height: 585 },
        { id: 'sheet-3', type: 'blank', width: 1040, height: 585 },
      ],
      items: {
        stroke1: {
          id: 'stroke1',
          type: 'stroke',
          points: [50, 50, 60, 60],
          color: '#ff0000',
          width: 4,
          opacity: 1,
          tool: 'pen',
        },
      },
      order: ['stroke1'],
    };

    const l = layoutForPage(pdfPage, { ...DEFAULT_PRINT_OPTIONS, paper: 'original' });
    expect(l.isPdf).toBe(true);
    // All 3 sheets are exported, not just the one with stroke1!
    expect(l.slices).toHaveLength(3);
    expect(l.slices[0].sheetDef?.type).toBe('pdf');
    expect(l.slices[1].sheetDef?.type).toBe('pdf');
    expect(l.slices[2].sheetDef?.type).toBe('blank');
    expect(l.slices[0].w).toBe(1040);
    expect(l.slices[0].h).toBe(585);
  });

  it('respects paper size and scaleMode for non-PDF pages with explicit sheets', () => {
    const sheetPage: PageContent = {
      id: 'p2',
      schemaVersion: 1,
      sheets: [{ id: 's1', type: 'blank', width: 794, height: 1123 }],
      items: {},
      order: [],
    };
    const lActual = layoutForPage(sheetPage, { ...DEFAULT_PRINT_OPTIONS, paper: 'a4', scaleMode: 'actual' });
    expect(lActual.scale).toBe(1);
    expect(lActual.slices[0].wMm).toBe(210);
    expect(lActual.slices[0].hMm).toBe(297);

    const lCustom = layoutForPage(sheetPage, { ...DEFAULT_PRINT_OPTIONS, paper: 'a4', scaleMode: 'custom', customScale: 0.75 });
    expect(lCustom.scale).toBe(0.75);
  });
});
