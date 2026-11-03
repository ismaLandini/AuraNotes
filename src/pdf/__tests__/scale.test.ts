import { describe, expect, it } from 'vitest';
import {
  CHROMIUM_CANVAS_LIMITS,
  SAFARI_SAFE_CANVAS_LIMITS,
  detectCanvasLimits,
} from '../scale';

describe('detectCanvasLimits WebKit detection', () => {
  it('detects Safari desktop as WebKit (SAFARI_SAFE_CANVAS_LIMITS)', () => {
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
    expect(detectCanvasLimits(ua)).toEqual(SAFARI_SAFE_CANVAS_LIMITS);
  });

  it('detects Tauri 2 WKWebView on macOS (no Safari token in UA) as WebKit', () => {
    // Crucial for Tauri 2 macOS: WKWebView user agent has AppleWebKit but lacks 'Safari'
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)';
    expect(detectCanvasLimits(ua)).toEqual(SAFARI_SAFE_CANVAS_LIMITS);
  });

  it('detects iOS Mobile Safari / WebKit as SAFARI_SAFE_CANVAS_LIMITS', () => {
    const ua =
      'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
    expect(detectCanvasLimits(ua)).toEqual(SAFARI_SAFE_CANVAS_LIMITS);
  });

  it('detects Google Chrome as CHROMIUM_CANVAS_LIMITS', () => {
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
    expect(detectCanvasLimits(ua)).toEqual(CHROMIUM_CANVAS_LIMITS);
  });

  it('detects Microsoft Edge as CHROMIUM_CANVAS_LIMITS', () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0';
    expect(detectCanvasLimits(ua)).toEqual(CHROMIUM_CANVAS_LIMITS);
  });

  it('detects Electron app as CHROMIUM_CANVAS_LIMITS (excluding WebKit limits)', () => {
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) AuraNotes/1.2.0 Chrome/120.0.0.0 Electron/28.0.0 Safari/537.36';
    expect(detectCanvasLimits(ua)).toEqual(CHROMIUM_CANVAS_LIMITS);
  });

  it('detects Firefox (Gecko) as CHROMIUM_CANVAS_LIMITS', () => {
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:123.0) Gecko/20100101 Firefox/123.0';
    expect(detectCanvasLimits(ua)).toEqual(CHROMIUM_CANVAS_LIMITS);
  });

  it('handles empty string and undefined gracefully', () => {
    expect(detectCanvasLimits('')).toEqual(CHROMIUM_CANVAS_LIMITS);
  });
});
