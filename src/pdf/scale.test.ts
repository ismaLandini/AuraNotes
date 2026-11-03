import { describe, expect, it } from 'vitest';
import {
  CHROMIUM_CANVAS_LIMITS,
  SAFARI_SAFE_CANVAS_LIMITS,
  computePageScale,
  estimatePdfImportBytes,
  normalizeRotation,
  parsePageRange,
} from './scale';

describe('PDF scale & DPI calculation', () => {
  it('computes Standard (150 DPI) and Maximum (300 DPI) presets accurately for A4 (595 x 842 pt)', () => {
    const std = computePageScale(595, 842, 'standard', 0, CHROMIUM_CANVAS_LIMITS);
    expect(std.effectiveDpi).toBe(150);
    expect(std.width).toBe(Math.floor(595 * (150 / 72))); // 1239
    expect(std.height).toBe(Math.floor(842 * (150 / 72))); // 1754
    expect(std.clampedByCanvasLimit).toBe(false);

    const max = computePageScale(595, 842, 'maximum', 0, CHROMIUM_CANVAS_LIMITS);
    expect(max.effectiveDpi).toBe(300);
    expect(max.width).toBe(Math.floor(595 * (300 / 72))); // 2479
    expect(max.height).toBe(Math.floor(842 * (300 / 72))); // 3508
    expect(max.clampedByCanvasLimit).toBe(false);
  });

  it('enforces minimum 2000 px on the short side for High (220 DPI) preset', () => {
    // A4 portrait: 595 x 842 pt -> at 220 DPI short side is 595 * 220/72 = 1818 px < 2000 px
    // So scale must boost so short side is 2000 px
    const a4High = computePageScale(595, 842, 'high', 0, CHROMIUM_CANVAS_LIMITS);
    expect(a4High.width).toBe(2000);
    expect(a4High.height).toBe(Math.floor(842 * (2000 / 595))); // 2830
    expect(a4High.effectiveDpi).toBeGreaterThanOrEqual(220);
    expect(a4High.clampedByCanvasLimit).toBe(false);

    // Large page where 220 DPI already exceeds 2000 px on short side (e.g. 800 x 1000 pt)
    const largeHigh = computePageScale(800, 1000, 'high', 0, CHROMIUM_CANVAS_LIMITS);
    expect(largeHigh.effectiveDpi).toBe(220);
    expect(largeHigh.width).toBe(Math.floor(800 * (220 / 72))); // 2444
  });

  it('respects page rotation (0, 90, 180, 270) and swaps dimensions on 90/270', () => {
    expect(normalizeRotation(0)).toBe(0);
    expect(normalizeRotation(90)).toBe(90);
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(450)).toBe(90);

    const p0 = computePageScale(600, 800, 'standard', 0, CHROMIUM_CANVAS_LIMITS);
    const p90 = computePageScale(600, 800, 'standard', 90, CHROMIUM_CANVAS_LIMITS);
    const p180 = computePageScale(600, 800, 'standard', 180, CHROMIUM_CANVAS_LIMITS);
    const p270 = computePageScale(600, 800, 'standard', 270, CHROMIUM_CANVAS_LIMITS);

    expect(p90.width).toBe(p0.height);
    expect(p90.height).toBe(p0.width);
    expect(p180.width).toBe(p0.width);
    expect(p180.height).toBe(p0.height);
    expect(p270.width).toBe(p0.height);
    expect(p270.height).toBe(p0.width);
  });

  it('clamps and computes tiles when an A0 poster page (2384 x 3370 pt) exceeds Safari or Chromium canvas limits', () => {
    // A0 is 841 x 1189 mm = 2384 x 3370 pt. At 220 DPI that would be 7284 x 10297 px (~75 MP > 16.7 MP Safari limit)
    const a0Safari = computePageScale(2384, 3370, 'high', 0, SAFARI_SAFE_CANVAS_LIMITS);
    expect(a0Safari.clampedByCanvasLimit).toBe(true);
    expect(a0Safari.width).toBeLessThanOrEqual(SAFARI_SAFE_CANVAS_LIMITS.maxSide);
    expect(a0Safari.height).toBeLessThanOrEqual(SAFARI_SAFE_CANVAS_LIMITS.maxSide);
    expect(a0Safari.width * a0Safari.height).toBeLessThanOrEqual(SAFARI_SAFE_CANVAS_LIMITS.maxArea);
    expect(a0Safari.tiles).toBeDefined();
    expect(a0Safari.tiles!.length).toBeGreaterThan(1);
    // Aspect ratio is preserved
    expect(a0Safari.width / a0Safari.height).toBeCloseTo(2384 / 3370, 2);
  });
});

describe('parsePageRange', () => {
  it('returns all pages when empty or "tutte"', () => {
    expect(parsePageRange('', 5)).toEqual({ pages: [1, 2, 3, 4, 5] });
    expect(parsePageRange('tutte', 3)).toEqual({ pages: [1, 2, 3] });
  });

  it('parses complex page ranges and sorts/deduplicates them', () => {
    expect(parsePageRange('1-3, 5, 2-4, 8', 10)).toEqual({ pages: [1, 2, 3, 4, 5, 8] });
  });

  it('returns clear errors on invalid or out-of-bounds ranges', () => {
    expect(parsePageRange('0-3', 5).error).toMatch(/fuori limite/);
    expect(parsePageRange('1-10', 5).error).toMatch(/fuori limite/);
    expect(parsePageRange('5-2', 5).error).toMatch(/supera la fine/);
    expect(parsePageRange('abc', 5).error).toMatch(/non valido/);
  });

  it('estimates storage bytes with WebP lossless saving space vs PNG', () => {
    const pngEst = estimatePdfImportBytes(10, 1024 * 1024, 'high', 'png');
    const webpEst = estimatePdfImportBytes(10, 1024 * 1024, 'high', 'webp');
    expect(webpEst).toBeLessThan(pngEst);
    expect(pngEst).toBeGreaterThan(1024 * 1024);
  });
});
