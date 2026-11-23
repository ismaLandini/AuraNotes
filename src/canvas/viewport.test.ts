import { describe, expect, it } from 'vitest';
import { clampViewport } from './viewport';
import * as P from '../model/pageOps';
import { A4_WIDTH } from '../lib/page';

describe('viewport horizontal centering lock', () => {
  it('centers an A4 page at -(vw - sheetW) / 2 even when items extend past the sheet right edge', () => {
    const page = P.addItems(P.emptyPage('p1'), [
      {
        id: 'e1',
        type: 'shape',
        kind: 'ellipse',
        x1: 610,
        y1: 300,
        x2: 975,
        y2: 400,
        color: '#e5484d',
        width: 2,
        opacity: 1,
        fill: null,
      },
    ]);
    const expectedX = -(1440 - A4_WIDTH) / 2;
    const vp = clampViewport({ x: -1e6, y: -1e6, zoom: 1 }, { w: 1440, h: 900 }, 1123, page);
    expect(vp.x).toBeCloseTo(expectedX);
  });

  it('ignores sideways pan offsets and keeps the page locked dead-center', () => {
    const page = P.emptyPage('p2');
    const expectedX = -(1280 - A4_WIDTH) / 2;
    expect(clampViewport({ x: 400, y: 0, zoom: 1 }, { w: 1280, h: 800 }, 1123, page).x).toBeCloseTo(expectedX);
    expect(clampViewport({ x: -800, y: 0, zoom: 1 }, { w: 1280, h: 800 }, 1123, page).x).toBeCloseTo(expectedX);
  });
});
