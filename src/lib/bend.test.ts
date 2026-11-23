import { describe, expect, it } from 'vitest';
import { bendControl, hitTest, sampleBend } from './geometry';
import { translateItem, translateLocal } from '../model/pageOps';
import type { ShapeItem } from '../types';

describe('bent arrows', () => {
  it('curve passes through the bend point at t = 0.5', () => {
    const item = { x1: 0, y1: 0, x2: 100, y2: 0, bend: { x: 50, y: 40 } };
    const pts = sampleBend(item, 24);
    expect(pts[12].x).toBeCloseTo(50);
    expect(pts[12].y).toBeCloseTo(40);
    expect(bendControl({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 40 })).toEqual({ x: 50, y: 80 });
  });

  it('without bend stays straight', () => {
    expect(sampleBend({ x1: 0, y1: 0, x2: 10, y2: 10 })).toHaveLength(2);
  });

  it('translateItem and translateLocal shift bend along with endpoints', () => {
    const arrow: ShapeItem = {
      id: 'a1',
      type: 'shape',
      kind: 'arrow',
      x1: 10,
      y1: 20,
      x2: 110,
      y2: 20,
      bend: { x: 60, y: 70 },
      color: '#000',
      width: 2,
      opacity: 1,
      fill: null,
    };
    expect(translateItem(arrow, 15, -5)).toEqual({
      x1: 25,
      y1: 15,
      x2: 125,
      y2: 15,
      bend: { x: 75, y: 65 },
    });
    expect(translateLocal(arrow, 0.1, 0.2)).toEqual({
      x1: 10.1,
      y1: 20.2,
      x2: 110.1,
      y2: 20.2,
      bend: { x: 60.1, y: 70.2 },
    });
  });

  it('hitTest hits near curved midpoint and misses straight chord far from curve', () => {
    const arrow: ShapeItem = {
      id: 'a2',
      type: 'shape',
      kind: 'arrow',
      x1: 0,
      y1: 0,
      x2: 200,
      y2: 0,
      bend: { x: 100, y: 80 },
      color: '#000',
      width: 2,
      opacity: 1,
      fill: null,
    };
    const items = { a2: arrow };
    expect(hitTest(arrow, items, { x: 100, y: 80 }, 4)).toBe(true);
    expect(hitTest(arrow, items, { x: 100, y: 0 }, 4)).toBe(false);
  });
});
