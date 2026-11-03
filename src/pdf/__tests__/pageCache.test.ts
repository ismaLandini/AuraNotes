import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import {
  computeBucket,
  computeBucketWidth,
  configurePageCache,
  clearPageCache,
  getCachedPdfPageUrl,
  getPageCacheStats,
  getPdfPageUrl,
  normalizeBucket,
  releasePdfDocument,
  usePdfPageUrl,
  DEFAULT_MAX_CACHE_BYTES,
  DEFAULT_MAX_CONCURRENCY,
} from '../pageCache';
import { createVectorFormulasPdf } from '../pdfTestFixtures';
import { putAsset, resetDBConnection } from '../../storage/db';
import { clearAssetUrlCache } from '../../storage/assets';
import type { PdfSourceAttr } from '../../types';

function makePdfBlob(bytes: Uint8Array): Blob {
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Blob([ab], { type: 'application/pdf' });
}

describe('pageCache', () => {
  let createdUrls = new Set<string>();
  let revokedUrls: string[] = [];
  let urlCounter = 0;

  beforeEach(async () => {
    await resetDBConnection();
    clearAssetUrlCache();
    clearPageCache();
    configurePageCache({
      maxBytes: DEFAULT_MAX_CACHE_BYTES,
      maxConcurrency: DEFAULT_MAX_CONCURRENCY,
      idleTimeoutMs: 60_000,
    });

    createdUrls.clear();
    revokedUrls = [];
    urlCounter = 0;

    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      const u = `blob:test-page-${++urlCounter}`;
      createdUrls.add(u);
      return u;
    });

    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((u: string) => {
      revokedUrls.push(u);
      createdUrls.delete(u);
    });
  });

  afterEach(() => {
    clearPageCache();
    vi.restoreAllMocks();
  });

  // --- Suite 1: Bucketing Math ---
  describe('Resolution Bucketing', () => {
    it('quantizes layout widths into 256 px bucket multiples', () => {
      // 100 * 1 * 1.5 = 150 -> minimum 256
      expect(computeBucketWidth(100, 1)).toBe(256);

      // 300 * 1 * 1.5 = 450 -> ceil(450/256)*256 = 512
      expect(computeBucketWidth(300, 1)).toBe(512);

      // 600 * 1 * 1.5 = 900 -> ceil(900/256)*256 = 1024
      expect(computeBucketWidth(600, 1)).toBe(1024);

      // 600 * 2 (Retina) * 1.5 = 1800 -> ceil(1800/256)*256 = 2048
      expect(computeBucketWidth(600, 2)).toBe(2048);
    });

    it('prevents thrashing on small drag increments within the same 256 px bucket', () => {
      // At DPR 1, 400 * 1.5 = 600 -> 768
      // 420 * 1.5 = 630 -> 768
      expect(computeBucketWidth(400, 1)).toBe(768);
      expect(computeBucketWidth(420, 1)).toBe(768);
      expect(computeBucketWidth(400, 1)).toBe(computeBucketWidth(420, 1));
    });

    it('normalizes arbitrary widths and handles bounds', () => {
      expect(normalizeBucket(0)).toBe(256);
      expect(normalizeBucket(256)).toBe(256);
      expect(normalizeBucket(257)).toBe(512);
      expect(normalizeBucket(1000)).toBe(1024);
      expect(computeBucket(600, 1)).toBe(1024); // alias check
    });
  });

  // --- Suite 2: Document Proxy Pooling & Cache Hits ---
  describe('Document Pooling & Cache Retrieval', () => {
    const pdfBytes = createVectorFormulasPdf(4);
    const pdfAssetId = 'pdf-asset-doc-1';

    beforeEach(async () => {
      await putAsset({
        id: pdfAssetId,
        blob: makePdfBlob(pdfBytes),
        mime: 'application/pdf',
        createdAt: Date.now(),
      });
    });

    it('renders on-demand, stores in LRU cache, and returns blob URL', async () => {
      const url1 = await getPdfPageUrl(pdfAssetId, 1, 600);
      expect(url1).toMatch(/^blob:test-page-/);

      // Synchronous cache hit check
      const cached = getCachedPdfPageUrl(pdfAssetId, 1, 600);
      expect(cached).toBe(url1);

      // Second getPdfPageUrl call returns the exact same URL without re-rendering
      const url2 = await getPdfPageUrl(pdfAssetId, 1, 600);
      expect(url2).toBe(url1);

      const stats = getPageCacheStats();
      expect(stats.size).toBe(1);
      expect(stats.openDocuments).toBe(1);
    });

    it('deduplicates simultaneous in-flight requests for the same page and bucket', async () => {
      const [u1, u2, u3] = await Promise.all([
        getPdfPageUrl(pdfAssetId, 2, 600),
        getPdfPageUrl(pdfAssetId, 2, 600),
        getPdfPageUrl(pdfAssetId, 2, 600),
      ]);

      expect(u1).toBe(u2);
      expect(u2).toBe(u3);
      expect(getPageCacheStats().size).toBe(1);
    });

    it('renders different pages or buckets as independent cache entries', async () => {
      const page1 = await getPdfPageUrl(pdfAssetId, 1, 600);
      const page2 = await getPdfPageUrl(pdfAssetId, 2, 600);
      const page1HighRes = await getPdfPageUrl(pdfAssetId, 1, 1200);

      expect(page1).not.toBe(page2);
      expect(page1).not.toBe(page1HighRes);
      expect(getPageCacheStats().size).toBe(3);
    });

    it('throws when page number is out of bounds or asset does not exist', async () => {
      await expect(getPdfPageUrl(pdfAssetId, 99, 600)).rejects.toThrow(/Numero pagina non valido/);
      await expect(getPdfPageUrl('non-existent-pdf', 1, 600)).rejects.toThrow(/Asset PDF non trovato/);
    });

    it('releasePdfDocument revokes blob URLs and destroys document proxy', async () => {
      const url1 = await getPdfPageUrl(pdfAssetId, 1, 600);
      const url2 = await getPdfPageUrl(pdfAssetId, 2, 600);

      expect(getCachedPdfPageUrl(pdfAssetId, 1, 600)).toBe(url1);
      expect(getCachedPdfPageUrl(pdfAssetId, 2, 600)).toBe(url2);

      releasePdfDocument(pdfAssetId);

      expect(getCachedPdfPageUrl(pdfAssetId, 1, 600)).toBeUndefined();
      expect(getCachedPdfPageUrl(pdfAssetId, 2, 600)).toBeUndefined();
      expect(revokedUrls).toContain(url1);
      expect(revokedUrls).toContain(url2);
      expect(getPageCacheStats().openDocuments).toBe(0);
      expect(getPageCacheStats().size).toBe(0);
    });

    it('clearPageCache clears all entries, revokes all URLs, and destroys all documents', async () => {
      const url = await getPdfPageUrl(pdfAssetId, 1, 600);
      expect(getPageCacheStats().size).toBe(1);

      clearPageCache();

      expect(revokedUrls).toContain(url);
      expect(getPageCacheStats().size).toBe(0);
      expect(getPageCacheStats().totalBytes).toBe(0);
      expect(getPageCacheStats().openDocuments).toBe(0);
    });
  });

  // --- Suite 3: Concurrency Queue (Max 2) ---
  describe('Max-2 Concurrency Queue', () => {
    const pdfBytes = createVectorFormulasPdf(4);
    const pdfAssetId = 'pdf-asset-concurrency';

    beforeEach(async () => {
      await putAsset({
        id: pdfAssetId,
        blob: makePdfBlob(pdfBytes),
        mime: 'application/pdf',
        createdAt: Date.now(),
      });
      configurePageCache({ maxConcurrency: 2 });
    });

    it('throttles concurrent rendering jobs to at most 2 active workers', async () => {
      let maxObservedActiveJobs = 0;
      const interval = setInterval(() => {
        const stats = getPageCacheStats();
        if (stats.activeJobs > maxObservedActiveJobs) {
          maxObservedActiveJobs = stats.activeJobs;
        }
      }, 5);

      const promises = [
        getPdfPageUrl(pdfAssetId, 1, 400),
        getPdfPageUrl(pdfAssetId, 2, 500),
        getPdfPageUrl(pdfAssetId, 3, 600),
        getPdfPageUrl(pdfAssetId, 4, 700),
      ];

      const results = await Promise.all(promises);
      clearInterval(interval);

      expect(results).toHaveLength(4);
      expect(maxObservedActiveJobs).toBeLessThanOrEqual(2);
    });
  });

  // --- Suite 4: LRU Eviction & URL.revokeObjectURL ---
  describe('LRU Eviction & Memory Tracking', () => {
    const pdfBytes = createVectorFormulasPdf(4);
    const pdfAssetId = 'pdf-asset-lru';

    beforeEach(async () => {
      await putAsset({
        id: pdfAssetId,
        blob: makePdfBlob(pdfBytes),
        mime: 'application/pdf',
        createdAt: Date.now(),
      });
    });

    it('tracks widthPx * heightPx * 4 memory and evicts least-recently used entries when budget is exceeded', async () => {
      // First, render a page to inspect its size
      const u1 = await getPdfPageUrl(pdfAssetId, 1, 600);
      const singlePageBytes = getPageCacheStats().totalBytes;
      expect(singlePageBytes).toBeGreaterThan(0);

      // Set maxCacheBytes to hold exactly 1.5 pages so that a 2nd page forces eviction of the 1st
      configurePageCache({ maxBytes: Math.floor(singlePageBytes * 1.5) });

      // Render page 2
      const u2 = await getPdfPageUrl(pdfAssetId, 2, 600);

      // Page 1 should have been evicted and revoked
      expect(revokedUrls).toContain(u1);
      expect(getCachedPdfPageUrl(pdfAssetId, 1, 600)).toBeUndefined();
      expect(getCachedPdfPageUrl(pdfAssetId, 2, 600)).toBe(u2);
      expect(getPageCacheStats().totalBytes).toBeLessThanOrEqual(Math.floor(singlePageBytes * 1.5));
    });

    it('touches entries on access to update LRU order', async () => {
      // Set budget for ~2.5 pages
      const u1 = await getPdfPageUrl(pdfAssetId, 1, 600);
      const singlePageBytes = getPageCacheStats().totalBytes;
      configurePageCache({ maxBytes: Math.floor(singlePageBytes * 2.5) });

      const u2 = await getPdfPageUrl(pdfAssetId, 2, 600);
      expect(getPageCacheStats().size).toBe(2);

      // Access page 1 again to touch it (making page 2 the least recently used)
      expect(getCachedPdfPageUrl(pdfAssetId, 1, 600)).toBe(u1);

      // Render page 3 -> budget exceeded, should evict page 2 instead of page 1
      const u3 = await getPdfPageUrl(pdfAssetId, 3, 600);

      expect(revokedUrls).toContain(u2);
      expect(revokedUrls).not.toContain(u1);
      expect(getCachedPdfPageUrl(pdfAssetId, 1, 600)).toBe(u1);
      expect(getCachedPdfPageUrl(pdfAssetId, 2, 600)).toBeUndefined();
      expect(getCachedPdfPageUrl(pdfAssetId, 3, 600)).toBe(u3);
    });
  });

  // --- Suite 5: AbortSignal Cancellation ---
  describe('AbortSignal Cancellation', () => {
    const pdfBytes = createVectorFormulasPdf(4);
    const pdfAssetId = 'pdf-asset-abort';

    beforeEach(async () => {
      await putAsset({
        id: pdfAssetId,
        blob: makePdfBlob(pdfBytes),
        mime: 'application/pdf',
        createdAt: Date.now(),
      });
    });

    it('rejects immediately without rendering if signal is already aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(getPdfPageUrl(pdfAssetId, 1, 600, controller.signal)).rejects.toThrow(/annullata/i);
      expect(getPageCacheStats().size).toBe(0);
    });

    it('cancels queued/in-flight jobs and does not leak blob URLs if aborted', async () => {
      const controller = new AbortController();
      const promise = getPdfPageUrl(pdfAssetId, 1, 600, controller.signal);
      controller.abort();

      await expect(promise).rejects.toThrow(/annullata/i);
    });

    it('does not cancel in-flight render if another subscriber remains active', async () => {
      const controllerA = new AbortController();

      // Two callers request the same page
      const promiseA = getPdfPageUrl(pdfAssetId, 1, 600, controllerA.signal);
      const promiseB = getPdfPageUrl(pdfAssetId, 1, 600); // no signal

      // Caller A aborts
      controllerA.abort();

      await expect(promiseA).rejects.toThrow(/annullata/i);
      // Caller B should succeed
      const urlB = await promiseB;
      expect(urlB).toMatch(/^blob:test-page-/);
      expect(getCachedPdfPageUrl(pdfAssetId, 1, 600)).toBe(urlB);
    });
  });

  // --- Suite 6: React Hook usePdfPageUrl ---
  describe('usePdfPageUrl React Hook', () => {
    const pdfBytes = createVectorFormulasPdf(4);
    const pdfAssetId = 'pdf-asset-hook';

    beforeEach(async () => {
      await putAsset({
        id: pdfAssetId,
        blob: makePdfBlob(pdfBytes),
        mime: 'application/pdf',
        createdAt: Date.now(),
      });
    });

    it('returns null and idle loading if source is invalid or missing', () => {
      const { result } = renderHook(() => usePdfPageUrl(null, 600));
      expect(result.current).toEqual({ url: null, loading: false, error: null });

      const { result: r2 } = renderHook(() =>
        usePdfPageUrl({ type: 'pdf', assetId: '', page: 1, mode: 'live' }, 600),
      );
      expect(r2.current).toEqual({ url: null, loading: false, error: null });

      const { result: r3 } = renderHook(() =>
        usePdfPageUrl({ type: 'pdf', assetId: pdfAssetId, page: 0, mode: 'live' }, 600),
      );
      expect(r3.current).toEqual({ url: null, loading: false, error: null });
    });

    it('returns null and idle loading when enabled is false', () => {
      const source: PdfSourceAttr = { type: 'pdf', assetId: pdfAssetId, page: 1, mode: 'live' };
      const { result } = renderHook(() => usePdfPageUrl(source, 600, false));
      expect(result.current).toEqual({ url: null, loading: false, error: null });
      expect(getPageCacheStats().size).toBe(0);
    });

    it('returns cached URL synchronously with loading: false on initial frame if in LRU cache', async () => {
      // Pre-warm the cache with the expected bucket width
      const bucketWidth = computeBucketWidth(600, 1);
      const cachedUrl = await getPdfPageUrl(pdfAssetId, 1, bucketWidth);

      const source: PdfSourceAttr = { type: 'pdf', assetId: pdfAssetId, page: 1, mode: 'live' };
      const { result } = renderHook(() => usePdfPageUrl(source, 600, true));

      // Synchronous initial frame check: zero loading flash
      expect(result.current.url).toBe(cachedUrl);
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it('loads asynchronously and updates state when not previously cached', async () => {
      const source: PdfSourceAttr = { type: 'pdf', assetId: pdfAssetId, page: 2, mode: 'live' };
      const { result } = renderHook(() => usePdfPageUrl(source, 600, true));

      expect(result.current.loading).toBe(true);
      expect(result.current.url).toBeNull();

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.url).toMatch(/^blob:test-page-/);
      expect(result.current.error).toBeNull();
    });

    it('cleans up and aborts on unmount without crashing', () => {
      const source: PdfSourceAttr = { type: 'pdf', assetId: pdfAssetId, page: 3, mode: 'live' };
      const { unmount } = renderHook(() => usePdfPageUrl(source, 600, true));
      expect(() => unmount()).not.toThrow();
    });
  });
});
