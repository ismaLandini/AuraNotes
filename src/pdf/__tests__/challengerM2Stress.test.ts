import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  configurePageCache,
  clearPageCache,
  getCachedPdfPageUrl,
  getPageCacheStats,
  getPdfPageUrl,
  releasePdfDocument,
  DEFAULT_MAX_CACHE_BYTES,
  DEFAULT_MAX_CONCURRENCY,
} from '../pageCache';
import {
  createVectorFormulasPdf,
  createHugeA0PosterPdf,
  createCorruptPdf,
  createPasswordProtectedPdf,
} from '../pdfTestFixtures';
import { putAsset, resetDBConnection } from '../../storage/db';
import { clearAssetUrlCache } from '../../storage/assets';
import {
  detectCanvasLimits,
  SAFARI_SAFE_CANVAS_LIMITS,
  CHROMIUM_CANVAS_LIMITS,
  computePageScale,
} from '../scale';
import * as rendererModule from '../renderer';

function makePdfBlob(bytes: Uint8Array): Blob {
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Blob([ab], { type: 'application/pdf' });
}

describe('Milestone 2 Adversarial & Empirical Stress Harness', () => {
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
      const u = `blob:adversarial-test-${++urlCounter}`;
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

  // =========================================================================
  // SECTION 1: CONCURRENCY QUEUE (MAX 2) UNDER ADVERSARIAL LOAD
  // =========================================================================
  describe('Concurrency Queue (Max 2) Empirical Verification', () => {
    const pdfAssetId = 'pdf-stress-concurrency';

    beforeEach(async () => {
      const pdfBytes = createVectorFormulasPdf(20);
      await putAsset({
        id: pdfAssetId,
        blob: makePdfBlob(pdfBytes),
        mime: 'application/pdf',
        createdAt: Date.now(),
      });
    });

    it('strictly enforces max concurrency of 2 at every millisecond during 50 concurrent requests', async () => {
      let concurrentRenders = 0;
      let maxObservedConcurrency = 0;

      const originalRender = rendererModule.renderPageOntoSurface;
      vi.spyOn(rendererModule, 'renderPageOntoSurface').mockImplementation(
        async (page, scale, w, h, signal) => {
          concurrentRenders++;
          if (concurrentRenders > maxObservedConcurrency) {
            maxObservedConcurrency = concurrentRenders;
          }
          // Artificially induce a slight non-zero asynchronous delay to ensure overlap
          await new Promise((r) => setTimeout(r, 8));
          try {
            return await originalRender(page, scale, w, h, signal);
          } finally {
            concurrentRenders--;
          }
        },
      );

      // Fire 50 distinct page requests simultaneously
      const requests = Array.from({ length: 50 }, (_, i) => {
        const pageNum = (i % 20) + 1;
        const bucket = 300 + (i % 5) * 256;
        return getPdfPageUrl(pdfAssetId, pageNum, bucket);
      });

      const results = await Promise.all(requests);

      expect(results).toHaveLength(50);
      expect(maxObservedConcurrency).toBe(2);
      expect(concurrentRenders).toBe(0);

      const stats = getPageCacheStats();
      expect(stats.activeJobs).toBe(0);
      expect(stats.queuedJobs).toBe(0);
    });

    it('maintains queue integrity and active worker count under mixed chaotic errors', async () => {
      const corruptAssetId = 'pdf-corrupt';
      await putAsset({
        id: corruptAssetId,
        blob: makePdfBlob(createCorruptPdf()),
        mime: 'application/pdf',
        createdAt: Date.now(),
      });

      const protectedAssetId = 'pdf-protected';
      await putAsset({
        id: protectedAssetId,
        blob: makePdfBlob(createPasswordProtectedPdf('secret')),
        mime: 'application/pdf',
        createdAt: Date.now(),
      });

      // 30 mixed requests: valid, missing asset, invalid page range, corrupt PDF, password protected
      const promises = [
        getPdfPageUrl(pdfAssetId, 1, 512),
        getPdfPageUrl('non-existent-asset', 1, 512).catch((e) => e),
        getPdfPageUrl(pdfAssetId, 999, 512).catch((e) => e), // page out of bounds
        getPdfPageUrl(corruptAssetId, 1, 512).catch((e) => e), // corrupt
        getPdfPageUrl(pdfAssetId, 2, 512),
        getPdfPageUrl(protectedAssetId, 1, 512).catch((e) => e), // password required
        getPdfPageUrl(pdfAssetId, 3, 512),
      ];

      const outcomes = await Promise.all(promises);

      // Verify valid pages succeeded
      expect(typeof outcomes[0]).toBe('string');
      expect(typeof outcomes[4]).toBe('string');
      expect(typeof outcomes[6]).toBe('string');

      // Verify errors were captured without unhandled rejection or crashing queue
      expect(outcomes[1]).toBeInstanceOf(Error);
      expect(outcomes[2]).toBeInstanceOf(Error);
      expect(outcomes[3]).toBeInstanceOf(Error);

      // Verify queue is idle and ready for subsequent requests
      const stats = getPageCacheStats();
      expect(stats.activeJobs).toBe(0);
      expect(stats.queuedJobs).toBe(0);

      // Next request succeeds immediately
      const followup = await getPdfPageUrl(pdfAssetId, 4, 512);
      expect(followup).toMatch(/^blob:adversarial-test-/);
    });

    it('prioritizes high-priority visible tasks over queued background prefetch tasks', async () => {
      const executionOrder: string[] = [];

      const originalRender = rendererModule.renderPageOntoSurface;
      vi.spyOn(rendererModule, 'renderPageOntoSurface').mockImplementation(
        async (page, scale, w, h, signal) => {
          executionOrder.push(`start-page-${page.pageNumber}`);
          await new Promise((r) => setTimeout(r, 20));
          const res = await originalRender(page, scale, w, h, signal);
          executionOrder.push(`finish-page-${page.pageNumber}`);
          return res;
        },
      );

      // Start 2 workers to saturate the max-2 concurrency
      const active1 = getPdfPageUrl(pdfAssetId, 1, 512, undefined, { priority: 0 });
      const active2 = getPdfPageUrl(pdfAssetId, 2, 512, undefined, { priority: 0 });

      // Enqueue 3 background tasks (priority: 0)
      const bg3 = getPdfPageUrl(pdfAssetId, 3, 512, undefined, { priority: 0 });
      const bg4 = getPdfPageUrl(pdfAssetId, 4, 512, undefined, { priority: 0 });
      const bg5 = getPdfPageUrl(pdfAssetId, 5, 512, undefined, { priority: 0 });

      // Enqueue an urgent visible task (priority: 10)
      const urgent6 = getPdfPageUrl(pdfAssetId, 6, 512, undefined, { priority: 10 });

      await Promise.all([active1, active2, bg3, bg4, bg5, urgent6]);

      // Page 1 and 2 started first because they saturated the 2 initial worker slots.
      // Once slot freed up, page 6 (priority 10) MUST start before pages 3, 4, 5!
      const start6Idx = executionOrder.indexOf('start-page-6');
      const start3Idx = executionOrder.indexOf('start-page-3');
      const start4Idx = executionOrder.indexOf('start-page-4');
      const start5Idx = executionOrder.indexOf('start-page-5');

      expect(start6Idx).toBeLessThan(start3Idx);
      expect(start6Idx).toBeLessThan(start4Idx);
      expect(start6Idx).toBeLessThan(start5Idx);
    });
  });

  // =========================================================================
  // SECTION 2: LRU EVICTION & MEMORY BUDGET UNDER STRESS
  // =========================================================================
  describe('LRU Eviction & URL.revokeObjectURL Stress', () => {
    const pdfAssetId = 'pdf-stress-lru';

    beforeEach(async () => {
      const pdfBytes = createVectorFormulasPdf(10);
      await putAsset({
        id: pdfAssetId,
        blob: makePdfBlob(pdfBytes),
        mime: 'application/pdf',
        createdAt: Date.now(),
      });
    });

    it('enforces memory budget and revokes exact blob URLs under continuous page thrashing', async () => {
      // Warm up one page to compute actual byte size for bucket 512
      const firstUrl = await getPdfPageUrl(pdfAssetId, 1, 512);
      const singlePageBytes = getPageCacheStats().totalBytes;
      expect(singlePageBytes).toBeGreaterThan(0);

      // Constrain cache to hold at most 3 pages
      const maxThreePages = singlePageBytes * 3 + 1024;
      configurePageCache({ maxBytes: maxThreePages });

      // Render 10 distinct pages sequentially
      for (let p = 2; p <= 10; p++) {
        await getPdfPageUrl(pdfAssetId, p, 512);
        const stats = getPageCacheStats();
        expect(stats.totalBytes).toBeLessThanOrEqual(maxThreePages);
        expect(stats.size).toBeLessThanOrEqual(3);
      }

      // 10 pages requested, at most 3 kept -> at least 7 evicted and revoked
      expect(revokedUrls.length).toBeGreaterThanOrEqual(7);
      expect(revokedUrls).toContain(firstUrl);

      // Verify that every revoked URL was previously created and is no longer reported in createdUrls
      for (const rev of revokedUrls) {
        expect(createdUrls.has(rev)).toBe(false);
      }

      // Memory tracking in pageCache must match the sum of bytes of existing entries
      const currentStats = getPageCacheStats();
      expect(currentStats.totalBytes).toBeLessThanOrEqual(maxThreePages);
    });

    it('handles oversized entry larger than maxCacheBytes without deadlock or corruption', async () => {
      // Set an artificially small cache of 100 KB
      configurePageCache({ maxBytes: 100 * 1024 });

      // Page rendered at 512 px will exceed 100 KB (~500 KB - 1 MB)
      const url = await getPdfPageUrl(pdfAssetId, 1, 512);
      expect(url).toMatch(/^blob:adversarial-test-/);

      const stats = getPageCacheStats();
      expect(stats.size).toBe(1);
      expect(stats.totalBytes).toBeGreaterThan(100 * 1024);

      // Next render evicts the previous oversized entry
      const url2 = await getPdfPageUrl(pdfAssetId, 2, 512);
      expect(revokedUrls).toContain(url);
      expect(getCachedPdfPageUrl(pdfAssetId, 1, 512)).toBeUndefined();
      expect(getCachedPdfPageUrl(pdfAssetId, 2, 512)).toBe(url2);
    });

    it('isolates document release: releasePdfDocument evicts only target document', async () => {
      const pdfAssetId2 = 'pdf-stress-lru-doc2';
      const pdfBytes2 = createVectorFormulasPdf(5);
      await putAsset({
        id: pdfAssetId2,
        blob: makePdfBlob(pdfBytes2),
        mime: 'application/pdf',
        createdAt: Date.now(),
      });

      const doc1Url1 = await getPdfPageUrl(pdfAssetId, 1, 512);
      const doc1Url2 = await getPdfPageUrl(pdfAssetId, 2, 512);
      const doc2Url1 = await getPdfPageUrl(pdfAssetId2, 1, 512);

      expect(getPageCacheStats().size).toBe(3);

      // Release Doc 1 only
      releasePdfDocument(pdfAssetId);

      expect(revokedUrls).toContain(doc1Url1);
      expect(revokedUrls).toContain(doc1Url2);
      expect(revokedUrls).not.toContain(doc2Url1);

      expect(getCachedPdfPageUrl(pdfAssetId, 1, 512)).toBeUndefined();
      expect(getCachedPdfPageUrl(pdfAssetId2, 1, 512)).toBe(doc2Url1);
      expect(getPageCacheStats().size).toBe(1);
    });

    it('clearPageCache immediately rejects queued and in-flight renders with AbortError', async () => {
      const originalRender = rendererModule.renderPageOntoSurface;
      vi.spyOn(rendererModule, 'renderPageOntoSurface').mockImplementation(
        async (page, scale, w, h, signal) => {
          await new Promise((r) => setTimeout(r, 50));
          return originalRender(page, scale, w, h, signal);
        },
      );

      // Enqueue 4 requests
      const promises = [
        getPdfPageUrl(pdfAssetId, 1, 512),
        getPdfPageUrl(pdfAssetId, 2, 512),
        getPdfPageUrl(pdfAssetId, 3, 512),
        getPdfPageUrl(pdfAssetId, 4, 512),
      ];

      // Immediately clear cache while renders are queued/in-flight
      clearPageCache();

      const settled = await Promise.allSettled(promises);
      for (const res of settled) {
        expect(res.status).toBe('rejected');
        if (res.status === 'rejected') {
          expect((res.reason as Error).name).toBe('AbortError');
        }
      }

      // Wait for background cancellation/cleanup to complete
      await new Promise((r) => setTimeout(r, 70));

      const stats = getPageCacheStats();
      expect(stats.size).toBe(0);
      expect(stats.activeJobs).toBe(0);
      expect(stats.queuedJobs).toBe(0);
    });
  });

  // =========================================================================
  // SECTION 3: ABORTSIGNAL RESILIENCE & CANCELLATION
  // =========================================================================
  describe('AbortSignal Resilience & Cancellation', () => {
    const pdfAssetId = 'pdf-stress-abort';

    beforeEach(async () => {
      const pdfBytes = createVectorFormulasPdf(10);
      await putAsset({
        id: pdfAssetId,
        blob: makePdfBlob(pdfBytes),
        mime: 'application/pdf',
        createdAt: Date.now(),
      });
    });

    it('simulates rapid scroll flurries: cancels aborted jobs without leaking resources', async () => {
      const originalRender = rendererModule.renderPageOntoSurface;
      vi.spyOn(rendererModule, 'renderPageOntoSurface').mockImplementation(
        async (page, scale, w, h, signal) => {
          await new Promise((r) => setTimeout(r, 15));
          return originalRender(page, scale, w, h, signal);
        },
      );

      const controllers = Array.from({ length: 20 }, () => new AbortController());
      const promises = controllers.map((c, i) =>
        getPdfPageUrl(pdfAssetId, (i % 5) + 1, 512 + (i % 2) * 256, c.signal).catch((err: unknown) => {
          return { aborted: true, err };
        }),
      );

      // Abort 16 out of 20 with staggered delays
      controllers.forEach((c, i) => {
        if (i % 4 !== 0) {
          setTimeout(() => c.abort(), (i % 3) * 5);
        }
      });

      const results = await Promise.all(promises);
      expect(results).toHaveLength(20);

      // Verify that active workers and queued jobs dropped back to 0
      const stats = getPageCacheStats();
      expect(stats.activeJobs).toBe(0);
      expect(stats.queuedJobs).toBe(0);
    });

    it('handles multiple subscribers where some abort and others stay active', async () => {
      const originalRender = rendererModule.renderPageOntoSurface;
      vi.spyOn(rendererModule, 'renderPageOntoSurface').mockImplementation(
        async (page, scale, w, h, signal) => {
          await new Promise((r) => setTimeout(r, 25));
          return originalRender(page, scale, w, h, signal);
        },
      );

      const c1 = new AbortController();
      const c2 = new AbortController();

      const p1 = getPdfPageUrl(pdfAssetId, 1, 512, c1.signal);
      const p2 = getPdfPageUrl(pdfAssetId, 1, 512, c2.signal);
      const p3 = getPdfPageUrl(pdfAssetId, 1, 512); // no abort signal

      // Abort c1 and c2 while in-flight
      c1.abort();
      c2.abort();

      await expect(p1).rejects.toThrow(/annullata/i);
      await expect(p2).rejects.toThrow(/annullata/i);

      // p3 MUST succeed
      const url3 = await p3;
      expect(url3).toMatch(/^blob:adversarial-test-/);
      expect(getCachedPdfPageUrl(pdfAssetId, 1, 512)).toBe(url3);
    });

    it('late abort on already-resolved subscriber breaks in-flight deduplication if listener is not cleaned up', async () => {
      let renderCallCount = 0;
      const originalRender = rendererModule.renderPageOntoSurface;
      vi.spyOn(rendererModule, 'renderPageOntoSurface').mockImplementation(
        async (page, scale, w, h, signal) => {
          renderCallCount++;
          await new Promise((r) => setTimeout(r, 40));
          return originalRender(page, scale, w, h, signal);
        },
      );

      const c1 = new AbortController();
      const url1 = await getPdfPageUrl(pdfAssetId, 1, 512, c1.signal);
      expect(url1).toBeDefined();
      expect(renderCallCount).toBe(1);

      // Clear pageCache so page 1 must be re-rendered
      clearPageCache();
      renderCallCount = 0;

      // Caller B starts rendering page 1 (takes 40ms)
      const pB = getPdfPageUrl(pdfAssetId, 1, 512);

      // While Caller B is in flight, Controller 1 (from previously finished call!) aborts
      c1.abort();

      // Now Caller C requests page 1 while Caller B is still in flight
      const pC = getPdfPageUrl(pdfAssetId, 1, 512);

      const [urlB, urlC] = await Promise.all([pB, pC]);
      expect(urlB).toBe(urlC);

      // Invariant: Both pB and pC requested page 1 simultaneously, so it should only be rendered ONCE.
      // If c1.abort() deleted inFlightJobs, pC started a redundant duplicate render!
      expect(renderCallCount).toBe(1);
    });
  });

  // =========================================================================
  // SECTION 4: WEBKIT SCALE DETECTION & BOUNDS CLAMPING
  // =========================================================================
  describe('WebKit Scale Detection & Canvas Limits', () => {
    it('exhaustively categorizes all known user agents and browser engines', () => {
      // WebKit family
      const safariDesktop =
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
      const tauriMac =
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)';
      const iOSSafari =
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
      const chromeOnIOS =
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0.6367.88 Mobile/15E148 Safari/604.1';
      const firefoxOnIOS =
        'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/125.0 Mobile/15E148 Safari/605.1.15';

      expect(detectCanvasLimits(safariDesktop)).toEqual(SAFARI_SAFE_CANVAS_LIMITS);
      expect(detectCanvasLimits(tauriMac)).toEqual(SAFARI_SAFE_CANVAS_LIMITS);
      expect(detectCanvasLimits(iOSSafari)).toEqual(SAFARI_SAFE_CANVAS_LIMITS);
      expect(detectCanvasLimits(chromeOnIOS)).toEqual(SAFARI_SAFE_CANVAS_LIMITS);
      expect(detectCanvasLimits(firefoxOnIOS)).toEqual(SAFARI_SAFE_CANVAS_LIMITS);

      // Chromium / Gecko family
      const chromeDesktop =
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
      const edgeDesktop =
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0';
      const electronApp =
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) AuraNotes/1.2.0 Chrome/120.0.0.0 Electron/28.0.0 Safari/537.36';
      const firefoxDesktop =
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:125.0) Gecko/20100101 Firefox/125.0';
      const operaDesktop =
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 OPR/110.0.0.0';

      expect(detectCanvasLimits(chromeDesktop)).toEqual(CHROMIUM_CANVAS_LIMITS);
      expect(detectCanvasLimits(edgeDesktop)).toEqual(CHROMIUM_CANVAS_LIMITS);
      expect(detectCanvasLimits(electronApp)).toEqual(CHROMIUM_CANVAS_LIMITS);
      expect(detectCanvasLimits(firefoxDesktop)).toEqual(CHROMIUM_CANVAS_LIMITS);
      expect(detectCanvasLimits(operaDesktop)).toEqual(CHROMIUM_CANVAS_LIMITS);

      // Edge cases
      expect(detectCanvasLimits('')).toEqual(CHROMIUM_CANVAS_LIMITS);
      expect(detectCanvasLimits('UnknownBrowser/1.0')).toEqual(CHROMIUM_CANVAS_LIMITS);
    });

    it('clamps huge pages (A0 poster) strictly within WebKit 16.7 MP canvas limit', () => {
      // A0 dimensions: 2384 x 3370 pt (841 x 1189 mm)
      // At standard 300 DPI, raw requested dimensions would be 9933 x 14041 px = 139.5 MP!
      const a0Scale = computePageScale(
        2384,
        3370,
        'maximum', // 300 DPI
        0,
        SAFARI_SAFE_CANVAS_LIMITS,
      );

      expect(a0Scale.clampedByCanvasLimit).toBe(true);
      expect(a0Scale.width).toBeLessThanOrEqual(SAFARI_SAFE_CANVAS_LIMITS.maxSide);
      expect(a0Scale.height).toBeLessThanOrEqual(SAFARI_SAFE_CANVAS_LIMITS.maxSide);
      expect(a0Scale.width * a0Scale.height).toBeLessThanOrEqual(SAFARI_SAFE_CANVAS_LIMITS.maxArea);
    });

    it('renders huge A0 poster via pageCache without exceeding WebKit canvas area', async () => {
      const a0AssetId = 'pdf-huge-a0';
      const a0Bytes = createHugeA0PosterPdf();
      await putAsset({
        id: a0AssetId,
        blob: makePdfBlob(a0Bytes),
        mime: 'application/pdf',
        createdAt: Date.now(),
      });

      // Request a high resolution bucket (e.g. 4096 px)
      const url = await getPdfPageUrl(a0AssetId, 1, 4096);
      expect(url).toMatch(/^blob:adversarial-test-/);

      const stats = getPageCacheStats();
      expect(stats.size).toBe(1);

      // Memory tracking in LRU cache: widthPx * heightPx * 4
      // Must not exceed SAFARI_SAFE_CANVAS_LIMITS.maxArea * 4 (67,108,864 bytes)
      expect(stats.totalBytes).toBeLessThanOrEqual(SAFARI_SAFE_CANVAS_LIMITS.maxArea * 4);
    });
  });

  // =========================================================================
  // SECTION 5: ADVANCED ADVERSARIAL PROTOCOLS & LIFECYCLES
  // =========================================================================
  describe('Document Pool Idle Expiration & Multi-Document Interleaving', () => {
    it('automatically closes document proxy after idle timeout expires', async () => {
      const idleAssetId = 'pdf-idle-test';
      const pdfBytes = createVectorFormulasPdf(2);
      await putAsset({
        id: idleAssetId,
        blob: makePdfBlob(pdfBytes),
        mime: 'application/pdf',
        createdAt: Date.now(),
      });

      // Configure a very short idle timeout of 50ms
      configurePageCache({ idleTimeoutMs: 50 });

      // Render page 1
      await getPdfPageUrl(idleAssetId, 1, 512);

      // Immediately after render completes, document is in pool with refCount 0
      expect(getPageCacheStats().openDocuments).toBe(1);

      // Wait 70ms (idleTimeout 50ms exceeded)
      await new Promise((r) => setTimeout(r, 70));

      // Document proxy must have been destroyed and purged from pool
      expect(getPageCacheStats().openDocuments).toBe(0);
    });

    it('cancels idle timeout if document is requested again before expiration', async () => {
      const idleAssetId = 'pdf-idle-renew';
      const pdfBytes = createVectorFormulasPdf(2);
      await putAsset({
        id: idleAssetId,
        blob: makePdfBlob(pdfBytes),
        mime: 'application/pdf',
        createdAt: Date.now(),
      });

      configurePageCache({ idleTimeoutMs: 80 });

      await getPdfPageUrl(idleAssetId, 1, 512);
      expect(getPageCacheStats().openDocuments).toBe(1);

      // Wait 40ms (< 80ms) and request page 2
      await new Promise((r) => setTimeout(r, 40));
      await getPdfPageUrl(idleAssetId, 2, 512);

      // Wait another 50ms (at t=90ms from start, but only 50ms since page 2 was requested)
      await new Promise((r) => setTimeout(r, 50));

      // Still alive because timer was reset
      expect(getPageCacheStats().openDocuments).toBe(1);

      // Wait another 50ms (total 100ms since page 2)
      await new Promise((r) => setTimeout(r, 50));

      // Now expired
      expect(getPageCacheStats().openDocuments).toBe(0);
    });

    it('interleaves 5 distinct PDF documents across max-2 concurrency queue without starvation', async () => {
      let concurrentRenders = 0;
      let maxConcurrency = 0;

      const originalRender = rendererModule.renderPageOntoSurface;
      vi.spyOn(rendererModule, 'renderPageOntoSurface').mockImplementation(
        async (page, scale, w, h, signal) => {
          concurrentRenders++;
          if (concurrentRenders > maxConcurrency) maxConcurrency = concurrentRenders;
          await new Promise((r) => setTimeout(r, 10));
          try {
            return await originalRender(page, scale, w, h, signal);
          } finally {
            concurrentRenders--;
          }
        },
      );

      // Create 5 separate PDF documents
      const docIds = ['doc-A', 'doc-B', 'doc-C', 'doc-D', 'doc-E'];
      for (const id of docIds) {
        await putAsset({
          id,
          blob: makePdfBlob(createVectorFormulasPdf(3)),
          mime: 'application/pdf',
          createdAt: Date.now(),
        });
      }

      // Fire 15 requests (3 pages for each of the 5 documents) interleaved
      const requests: Promise<string>[] = [];
      for (let p = 1; p <= 3; p++) {
        for (const id of docIds) {
          requests.push(getPdfPageUrl(id, p, 512));
        }
      }

      const results = await Promise.all(requests);
      expect(results).toHaveLength(15);
      expect(maxConcurrency).toBe(2);

      // Verify all 5 documents are open in pool
      expect(getPageCacheStats().openDocuments).toBe(5);
      expect(getPageCacheStats().size).toBe(15);
    });
  });
});
