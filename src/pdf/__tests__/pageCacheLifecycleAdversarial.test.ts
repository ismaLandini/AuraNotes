import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import {
  clearPageCache,
  configurePageCache,
  getCachedPdfPageUrl,
  getPageCacheStats,
  getPdfPageUrl,
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

describe('Adversarial Stress Test: usePdfPageUrl & releasePdfDocument (Milestone 2)', () => {
  let createdUrls = new Set<string>();
  let revokedUrls: string[] = [];
  let urlCounter = 0;

  const pdfBytesDocA = createVectorFormulasPdf(4);
  const pdfBytesDocB = createVectorFormulasPdf(4);
  const pdfAssetA = 'pdf-asset-stress-A';
  const pdfAssetB = 'pdf-asset-stress-B';

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
      const u = `blob:stress-${++urlCounter}`;
      createdUrls.add(u);
      return u;
    });

    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((u: string) => {
      revokedUrls.push(u);
      createdUrls.delete(u);
    });

    await putAsset({
      id: pdfAssetA,
      blob: makePdfBlob(pdfBytesDocA),
      mime: 'application/pdf',
      createdAt: Date.now(),
    });

    await putAsset({
      id: pdfAssetB,
      blob: makePdfBlob(pdfBytesDocB),
      mime: 'application/pdf',
      createdAt: Date.now(),
    });
  });

  afterEach(() => {
    clearPageCache();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // SUITE 1: usePdfPageUrl Hook Lifecycle Stress & Edge Cases
  // =========================================================================
  describe('usePdfPageUrl Hook Lifecycle Stress', () => {
    it('1.1. Rapid layout width changes within the same bucket trigger zero additional renders', async () => {
      const source: PdfSourceAttr = { type: 'pdf', assetId: pdfAssetA, page: 1, mode: 'live' };

      // At DPR=1, width 400 gives bucket 768.
      // Any width from 342 to 512 maps to bucket 768.
      const { result, rerender } = renderHook(
        ({ width }) => usePdfPageUrl(source, width, true),
        { initialProps: { width: 400 } },
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
      const initialUrl = result.current.url;
      expect(initialUrl).toMatch(/^blob:stress-/);
      const initialCreatedCount = createdUrls.size;

      // Rapidly re-render with varying widths inside the 768 px bucket
      for (const w of [405, 410, 420, 430, 440, 450, 460, 470, 480, 490, 500]) {
        rerender({ width: w });
        expect(result.current.loading).toBe(false);
        expect(result.current.url).toBe(initialUrl);
      }

      // No new blob URLs should have been created
      expect(createdUrls.size).toBe(initialCreatedCount);
      expect(getPageCacheStats().size).toBe(1);
    });

    it('1.2. Layout width resizing across bucket boundaries gracefully cancels previous and fetches new bucket', async () => {
      const source: PdfSourceAttr = { type: 'pdf', assetId: pdfAssetA, page: 1, mode: 'live' };

      // Width 200 -> bucket 512
      const { result, rerender } = renderHook(
        ({ width }) => usePdfPageUrl(source, width, true),
        { initialProps: { width: 200 } },
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
      const url512 = result.current.url;
      expect(url512).toBeDefined();

      // Resize to 600 -> bucket 1024
      rerender({ width: 600 });
      expect(result.current.loading).toBe(true);

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
      const url1024 = result.current.url;
      expect(url1024).not.toBe(url512);

      // Resize to 1200 -> bucket 2048
      rerender({ width: 1200 });
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
      const url2048 = result.current.url;
      expect(url2048).not.toBe(url1024);

      // Now switch back to 200 -> should hit cache synchronously without loading
      rerender({ width: 200 });
      expect(result.current.loading).toBe(false);
      expect(result.current.url).toBe(url512);
    });

    it('1.3. Rapid toggling of enabled (viewport scroll in/out) cleanly aborts and recovers', async () => {
      const source: PdfSourceAttr = { type: 'pdf', assetId: pdfAssetA, page: 2, mode: 'live' };

      // Mount with enabled = false
      const { result, rerender } = renderHook(
        ({ enabled }) => usePdfPageUrl(source, 600, enabled),
        { initialProps: { enabled: false } },
      );

      expect(result.current).toEqual({ url: null, loading: false, error: null });
      expect(getPageCacheStats().activeJobs).toBe(0);

      // Enable
      rerender({ enabled: true });
      expect(result.current.loading).toBe(true);

      // Rapidly disable before completion
      rerender({ enabled: false });
      expect(result.current).toEqual({ url: null, loading: false, error: null });

      // Re-enable and allow to complete
      rerender({ enabled: true });
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
      expect(result.current.url).toMatch(/^blob:stress-/);

      // Disable after completion -> resets to null url, idle
      rerender({ enabled: false });
      expect(result.current).toEqual({ url: null, loading: false, error: null });

      // Re-enable after cached -> synchronously returns cached URL!
      rerender({ enabled: true });
      expect(result.current.loading).toBe(false);
      expect(result.current.url).toMatch(/^blob:stress-/);
    });

    it('1.4. Fast unmount during active render does not trigger unhandled exceptions or state update errors', async () => {
      const source: PdfSourceAttr = { type: 'pdf', assetId: pdfAssetA, page: 3, mode: 'live' };

      // Mount and immediately unmount
      const { unmount } = renderHook(() => usePdfPageUrl(source, 600, true));
      unmount();

      // Drain macrotasks
      await new Promise((r) => setTimeout(r, 50));

      const stats = getPageCacheStats();
      expect(stats.activeJobs).toBe(0);
      expect(stats.queuedJobs).toBe(0);
    });

    it('1.5. Multi-subscriber race: unmounting one subscriber does NOT cancel shared render for others', async () => {
      const source: PdfSourceAttr = { type: 'pdf', assetId: pdfAssetA, page: 4, mode: 'live' };

      // Subscriber 1 and 2 mount simultaneously
      const hook1 = renderHook(() => usePdfPageUrl(source, 600, true));
      const hook2 = renderHook(() => usePdfPageUrl(source, 600, true));

      expect(hook1.result.current.loading).toBe(true);
      expect(hook2.result.current.loading).toBe(true);

      // Subscriber 1 unmounts mid-flight
      hook1.unmount();

      // Subscriber 2 MUST continue and succeed
      await waitFor(() => {
        expect(hook2.result.current.loading).toBe(false);
      });

      expect(hook2.result.current.url).toMatch(/^blob:stress-/);
      expect(hook2.result.current.error).toBeNull();
      hook2.unmount();
    });

    it('1.6. Handles invalid/corrupt inputs safely (zero width, negative, NaN, non-existent asset, bad page)', async () => {
      const validSource: PdfSourceAttr = { type: 'pdf', assetId: pdfAssetA, page: 1, mode: 'live' };

      // Zero width -> safely clamped to min bucket 256
      const { result: rZero } = renderHook(() => usePdfPageUrl(validSource, 0, true));
      await waitFor(() => expect(rZero.current.loading).toBe(false));
      expect(rZero.current.url).toBeDefined();

      // Negative width -> clamped
      const { result: rNeg } = renderHook(() => usePdfPageUrl(validSource, -500, true));
      await waitFor(() => expect(rNeg.current.loading).toBe(false));
      expect(rNeg.current.url).toBeDefined();

      // NaN width -> clamped to default
      const { result: rNan } = renderHook(() => usePdfPageUrl(validSource, NaN, true));
      await waitFor(() => expect(rNan.current.loading).toBe(false));
      expect(rNan.current.url).toBeDefined();

      // Invalid page 999 -> sets error
      const badPageSource: PdfSourceAttr = { type: 'pdf', assetId: pdfAssetA, page: 999, mode: 'live' };
      const { result: rBadPage, rerender: rerenderBadPage } = renderHook(
        ({ src }) => usePdfPageUrl(src, 600, true),
        { initialProps: { src: badPageSource } },
      );

      await waitFor(() => expect(rBadPage.current.loading).toBe(false));
      expect(rBadPage.current.error).toBeDefined();
      expect(rBadPage.current.error?.message).toMatch(/Numero pagina non valido/);
      expect(rBadPage.current.url).toBeNull();

      // Recover by providing valid page
      rerenderBadPage({ src: validSource });
      await waitFor(() => expect(rBadPage.current.loading).toBe(false));
      expect(rBadPage.current.error).toBeNull();
      expect(rBadPage.current.url).toBeDefined();
    });
  });

  // =========================================================================
  // SUITE 2: releasePdfDocument Complete Cleanup & Stress
  // =========================================================================
  describe('releasePdfDocument Complete Cleanup', () => {
    it('2.1. Evicts all cached pages and buckets across a document and destroys proxy', async () => {
      // Warm up multiple pages and buckets for Doc A
      const [u1, u2, u3, u4] = await Promise.all([
        getPdfPageUrl(pdfAssetA, 1, 400),
        getPdfPageUrl(pdfAssetA, 1, 800),
        getPdfPageUrl(pdfAssetA, 2, 400),
        getPdfPageUrl(pdfAssetA, 3, 400),
      ]);

      expect(new Set([u1, u2, u3, u4]).size).toBe(4);
      expect(getPageCacheStats().size).toBe(4);
      expect(getPageCacheStats().openDocuments).toBe(1);

      // Release Doc A
      releasePdfDocument(pdfAssetA);

      // Invariants:
      // 1. All blob URLs are revoked
      expect(revokedUrls).toContain(u1);
      expect(revokedUrls).toContain(u2);
      expect(revokedUrls).toContain(u3);
      expect(revokedUrls).toContain(u4);

      // 2. Synchronous cache hit returns undefined
      expect(getCachedPdfPageUrl(pdfAssetA, 1, 400)).toBeUndefined();
      expect(getCachedPdfPageUrl(pdfAssetA, 1, 800)).toBeUndefined();
      expect(getCachedPdfPageUrl(pdfAssetA, 2, 400)).toBeUndefined();
      expect(getCachedPdfPageUrl(pdfAssetA, 3, 400)).toBeUndefined();

      // 3. Stats reset
      const stats = getPageCacheStats();
      expect(stats.size).toBe(0);
      expect(stats.totalBytes).toBe(0);
      expect(stats.openDocuments).toBe(0);
    });

    it('2.2. Guarantees multi-document isolation (releasing Doc A leaves Doc B completely intact)', async () => {
      const urlA1 = await getPdfPageUrl(pdfAssetA, 1, 600);
      const urlA2 = await getPdfPageUrl(pdfAssetA, 2, 600);
      const urlB1 = await getPdfPageUrl(pdfAssetB, 1, 600);
      const urlB2 = await getPdfPageUrl(pdfAssetB, 2, 600);

      expect(getPageCacheStats().size).toBe(4);
      expect(getPageCacheStats().openDocuments).toBe(2);

      // Release only Doc A
      releasePdfDocument(pdfAssetA);

      // Doc A URLs revoked
      expect(revokedUrls).toContain(urlA1);
      expect(revokedUrls).toContain(urlA2);
      expect(getCachedPdfPageUrl(pdfAssetA, 1, 600)).toBeUndefined();

      // Doc B URLs NOT revoked and still accessible synchronously
      expect(revokedUrls).not.toContain(urlB1);
      expect(revokedUrls).not.toContain(urlB2);
      expect(getCachedPdfPageUrl(pdfAssetB, 1, 600)).toBe(urlB1);
      expect(getCachedPdfPageUrl(pdfAssetB, 2, 600)).toBe(urlB2);

      const stats = getPageCacheStats();
      expect(stats.size).toBe(2);
      expect(stats.openDocuments).toBe(1);
    });

    it('2.3. Cancels queued and active in-flight renders when document is already open without worker deadlocks', async () => {
      // First, ensure Doc A is already opened
      await getPdfPageUrl(pdfAssetA, 1, 400);
      expect(getPageCacheStats().openDocuments).toBe(1);

      // Launch 4 render requests for Doc A
      const p1 = getPdfPageUrl(pdfAssetA, 1, 800);
      const p2 = getPdfPageUrl(pdfAssetA, 2, 400);
      const p3 = getPdfPageUrl(pdfAssetA, 3, 400);
      const p4 = getPdfPageUrl(pdfAssetA, 4, 400);

      // Immediately release Doc A
      releasePdfDocument(pdfAssetA);

      // All 4 should reject with abort message
      const results = await Promise.allSettled([p1, p2, p3, p4]);
      for (const res of results) {
        expect(res.status).toBe('rejected');
        if (res.status === 'rejected') {
          expect((res.reason as Error).message).toMatch(/Documento PDF chiuso|annullata/i);
        }
      }

      // Ensure activeWorkers and queues are cleared
      const stats = getPageCacheStats();
      expect(stats.queuedJobs).toBe(0);

      // Wait a tick for any async finally blocks to execute
      await new Promise((r) => setTimeout(r, 50));
      expect(getPageCacheStats().activeJobs).toBe(0);

      // Invariant: New request for Doc B executes cleanly (proves workers did not deadlock)
      const urlB = await getPdfPageUrl(pdfAssetB, 1, 600);
      expect(urlB).toMatch(/^blob:stress-/);
      expect(getPageCacheStats().openDocuments).toBe(1);
    });

    it('2.4. Is completely safe and idempotent when called repeatedly or on non-existent IDs', () => {
      expect(() => releasePdfDocument('completely-fake-id')).not.toThrow();
      expect(() => releasePdfDocument(pdfAssetA)).not.toThrow();
      expect(() => releasePdfDocument(pdfAssetA)).not.toThrow();
      expect(getPageCacheStats().size).toBe(0);
      expect(getPageCacheStats().openDocuments).toBe(0);
    });

    it('2.5. [EMPIRICAL BUG PROBE] releasePdfDocument during pending document acquisition leaves leaked proxy in documentPool', async () => {
      // Doc A is NOT yet opened (documentPool has 0 documents).
      expect(getPageCacheStats().openDocuments).toBe(0);

      // Request page 1. This triggers acquireDocument -> getAsset (async) -> openPdfDocument (async).
      const p = getPdfPageUrl(pdfAssetA, 1, 400);

      // Immediately call releasePdfDocument BEFORE acquireDocument resolves
      releasePdfDocument(pdfAssetA);

      // Promise p is rejected with abort error
      await expect(p).rejects.toThrow(/Documento PDF chiuso|annullata/i);

      // Wait for the async acquireDocument / openPdfDocument to settle in the background
      await new Promise((r) => setTimeout(r, 100));

      // EXPECTATION FOR A LEAK-FREE ENGINE: openDocuments MUST be 0
      // ACTUAL BEHAVIOR: acquireDocument resolves after closeDocument ran,
      // and inserts Doc A into documentPool with a 60-second idle timer!
      const openDocs = getPageCacheStats().openDocuments;
      expect(openDocs).toBe(0);
    });

    it('2.6. [EMPIRICAL BUG PROBE] clearPageCache during pending document acquisition leaves leaked proxy in documentPool', async () => {
      expect(getPageCacheStats().openDocuments).toBe(0);

      const p = getPdfPageUrl(pdfAssetA, 1, 400);
      clearPageCache();

      await expect(p).rejects.toThrow(/Cache pagina cancellata|annullata/i);
      await new Promise((r) => setTimeout(r, 100));

      const openDocs = getPageCacheStats().openDocuments;
      expect(openDocs).toBe(0);
    });
  });
});

