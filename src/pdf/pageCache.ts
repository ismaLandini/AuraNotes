import { useState, useEffect } from 'react';
import type { ID, PdfSourceAttr } from '../types';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { getAsset } from '../storage/db';
import {
  openPdfDocument,
  destroyPdfDocument,
  renderPageOntoSurface,
  encodeCanvasLossless,
  releaseCanvasSurface,
  type CanvasPair,
} from './renderer';
import { detectCanvasLimits } from './scale';

// --- Constants ---
export const DEFAULT_MAX_CACHE_BYTES = 150 * 1024 * 1024; // 150 MB (157,286,400 bytes)
export const DEFAULT_MAX_CONCURRENCY = 2;
export const DEFAULT_DOCUMENT_IDLE_TIMEOUT_MS = 60_000; // 60 seconds
export const BUCKET_CHUNK_SIZE = 256;
export const RESOLUTION_OVERSAMPLE = 1.5;

// --- Configurable State ---
let maxCacheBytes = DEFAULT_MAX_CACHE_BYTES;
let maxConcurrency = DEFAULT_MAX_CONCURRENCY;
let documentIdleTimeoutMs = DEFAULT_DOCUMENT_IDLE_TIMEOUT_MS;

// --- Types ---
export interface PageCacheEntry {
  key: string; // `${pdfAssetId}:${page}:${bucket}`
  pdfAssetId: ID;
  page: number;
  bucket: number;
  blobUrl: string; // blob:...
  widthPx: number;
  heightPx: number;
  bytes: number; // widthPx * heightPx * 4
  createdAt: number;
  lastAccessedAt: number;
}

export interface CacheStats {
  size: number;
  totalBytes: number;
  maxBytes: number;
  activeJobs: number;
  queuedJobs: number;
  openDocuments: number;
}

export interface RenderOptions {
  priority?: number; // higher number = executed first (e.g. visible = 1, prefetch = 0)
}

export interface UsePdfPageUrlResult {
  url: string | null;
  loading: boolean;
  error: Error | null;
}

// --- LRU Cache State ---
const pageCache = new Map<string, PageCacheEntry>();
let totalCacheBytes = 0;

// --- In-Flight Deduplication State ---
interface InFlightSubscriber {
  signal?: AbortSignal;
  onAbort?: () => void;
  resolve: (url: string) => void;
  reject: (err: unknown) => void;
}

interface InFlightJob {
  key: string;
  pdfAssetId: ID;
  page: number;
  bucket: number;
  subscribers: Set<InFlightSubscriber>;
  cancelRender?: () => void;
}

const inFlightJobs = new Map<string, InFlightJob>();

// --- Concurrency Queue State ---
interface QueueTask {
  id: string;
  job: InFlightJob;
  priority: number;
}

const renderQueue: QueueTask[] = [];
let activeWorkers = 0;

// --- Document Pool State ---
interface CachedDocument {
  doc: PDFDocumentProxy;
  refCount: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
  lastUsedAt: number;
}

const documentPool = new Map<ID, CachedDocument>();
const pendingDocuments = new Map<ID, Promise<PDFDocumentProxy>>();
const documentEpoch = new Map<ID, number>();

function bumpDocumentEpoch(pdfAssetId: ID): number {
  const next = (documentEpoch.get(pdfAssetId) ?? 0) + 1;
  documentEpoch.set(pdfAssetId, next);
  return next;
}

// --- Helper Functions ---
function safeCreateObjectURL(blob: Blob): string {
  try {
    return URL.createObjectURL(blob);
  } catch {
    return `blob:glassnote/${Math.random().toString(36).slice(2)}`;
  }
}

function safeRevokeObjectURL(url: string): void {
  try {
    URL.revokeObjectURL(url);
  } catch {
    /* ignore in headless/test environments */
  }
}

function makeCacheKey(pdfAssetId: ID, page: number, bucket: number): string {
  return `${pdfAssetId}:${page}:${bucket}`;
}

// --- Resolution Bucketing ---

/**
 * Computes the discrete pixel width bucket for a given display width and DPR:
 * Math.max(256, Math.ceil((width * dpr * 1.5) / 256) * 256)
 */
export function computeBucketWidth(
  displayWidth: number,
  dpr: number = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
): number {
  const safeWidth = Math.max(1, displayWidth || 400);
  const safeDpr = Math.max(0.5, dpr);
  const targetPx = safeWidth * safeDpr * RESOLUTION_OVERSAMPLE;
  return Math.max(BUCKET_CHUNK_SIZE, Math.ceil(targetPx / BUCKET_CHUNK_SIZE) * BUCKET_CHUNK_SIZE);
}

export const computeBucket = computeBucketWidth;

/**
 * Normalizes an arbitrary pixel width into a valid bucket (multiple of 256 px).
 */
export function normalizeBucket(widthPx: number): number {
  const safePx = Math.max(1, widthPx);
  return Math.max(BUCKET_CHUNK_SIZE, Math.ceil(safePx / BUCKET_CHUNK_SIZE) * BUCKET_CHUNK_SIZE);
}

// --- LRU Eviction Logic ---

function touchEntry(key: string, entry: PageCacheEntry): void {
  pageCache.delete(key);
  entry.lastAccessedAt = Date.now();
  pageCache.set(key, entry);
}

function ensureCapacity(neededBytes: number): void {
  while (totalCacheBytes + neededBytes > maxCacheBytes && pageCache.size > 0) {
    const oldestKey = pageCache.keys().next().value;
    if (!oldestKey) break;
    const entry = pageCache.get(oldestKey);
    if (entry) {
      safeRevokeObjectURL(entry.blobUrl);
      totalCacheBytes -= entry.bytes;
      pageCache.delete(oldestKey);
    } else {
      pageCache.delete(oldestKey);
    }
  }
}

// --- Document Pool Lifecycle ---

async function acquireDocument(pdfAssetId: ID): Promise<PDFDocumentProxy> {
  const cached = documentPool.get(pdfAssetId);
  if (cached) {
    if (cached.idleTimer) {
      clearTimeout(cached.idleTimer);
      cached.idleTimer = null;
    }
    cached.refCount++;
    cached.lastUsedAt = Date.now();
    return cached.doc;
  }

  const startEpoch = documentEpoch.get(pdfAssetId) ?? 0;
  let pending = pendingDocuments.get(pdfAssetId);
  if (!pending) {
    pending = (async () => {
      const storedAsset = await getAsset(pdfAssetId);
      if (!storedAsset || !storedAsset.blob) {
        throw new Error(`Asset PDF non trovato: ${pdfAssetId}`);
      }
      return openPdfDocument(storedAsset.blob);
    })();
    pendingDocuments.set(pdfAssetId, pending);
  }

  try {
    const doc = await pending;
    if ((documentEpoch.get(pdfAssetId) ?? 0) !== startEpoch) {
      await destroyPdfDocument(doc);
      throw new DOMException('Documento PDF chiuso', 'AbortError');
    }
    let entry = documentPool.get(pdfAssetId);
    if (!entry) {
      entry = {
        doc,
        refCount: 1,
        idleTimer: null,
        lastUsedAt: Date.now(),
      };
      documentPool.set(pdfAssetId, entry);
    } else {
      entry.refCount++;
      entry.lastUsedAt = Date.now();
    }
    return doc;
  } finally {
    if (pendingDocuments.get(pdfAssetId) === pending) {
      pendingDocuments.delete(pdfAssetId);
    }
  }
}

function releaseDocumentReference(pdfAssetId: ID): void {
  const cached = documentPool.get(pdfAssetId);
  if (!cached) return;
  cached.refCount = Math.max(0, cached.refCount - 1);
  if (cached.refCount === 0 && !cached.idleTimer) {
    cached.idleTimer = setTimeout(() => {
      closeDocument(pdfAssetId);
    }, documentIdleTimeoutMs);
  }
}

async function closeDocument(pdfAssetId: ID): Promise<void> {
  const cached = documentPool.get(pdfAssetId);
  if (!cached) return;
  if (cached.idleTimer) {
    clearTimeout(cached.idleTimer);
    cached.idleTimer = null;
  }
  documentPool.delete(pdfAssetId);
  await destroyPdfDocument(cached.doc);
}

// --- Queue Scheduler ---

function pumpQueue(): void {
  while (activeWorkers < maxConcurrency && renderQueue.length > 0) {
    // Sort by priority descending (higher numbers first)
    renderQueue.sort((a, b) => b.priority - a.priority);
    const task = renderQueue.shift();
    if (!task) break;

    if (task.job.subscribers.size === 0) {
      continue;
    }

    activeWorkers++;
    executeRenderJob(task.job).finally(() => {
      activeWorkers--;
      pumpQueue();
    });
  }
}

async function executeRenderJob(job: InFlightJob): Promise<void> {
  let doc: PDFDocumentProxy | null = null;
  let pageProxy: PDFPageProxy | null = null;
  let surface: (CanvasPair & { getDigest?: () => number }) | null = null;
  const abortController = new AbortController();

  job.cancelRender = () => {
    abortController.abort();
  };

  try {
    if (job.subscribers.size === 0 || abortController.signal.aborted) return;

    doc = await acquireDocument(job.pdfAssetId);
    if (job.subscribers.size === 0 || abortController.signal.aborted) return;

    if (job.page < 1 || job.page > doc.numPages) {
      throw new Error(`Numero pagina non valido: ${job.page} (totale: ${doc.numPages})`);
    }

    pageProxy = await doc.getPage(job.page);
    if (job.subscribers.size === 0 || abortController.signal.aborted) return;

    // Viewport calculation matching bucket width
    const baseViewport = pageProxy.getViewport({ scale: 1 });
    let scale = job.bucket / baseViewport.width;

    // Browser canvas limits guard
    const limits = detectCanvasLimits();
    let width = Math.max(1, Math.floor(baseViewport.width * scale));
    let height = Math.max(1, Math.floor(baseViewport.height * scale));

    if (width > limits.maxSide || height > limits.maxSide) {
      const sideScale = Math.min(limits.maxSide / baseViewport.width, limits.maxSide / baseViewport.height);
      if (sideScale < scale) scale = sideScale;
    }
    if (baseViewport.width * scale * baseViewport.height * scale > limits.maxArea) {
      const areaFactor = Math.sqrt(limits.maxArea / (baseViewport.width * scale * baseViewport.height * scale));
      scale = scale * areaFactor;
    }

    width = Math.max(1, Math.floor(baseViewport.width * scale));
    height = Math.max(1, Math.floor(baseViewport.height * scale));

    // Render surface with abort signal
    surface = await renderPageOntoSurface(pageProxy, scale, width, height, abortController.signal);
    if (job.subscribers.size === 0 || abortController.signal.aborted) {
      if (surface) releaseCanvasSurface(surface);
      return;
    }

    // Encode to lossless PNG Blob
    const { blob } = await encodeCanvasLossless(surface, 'png');
    releaseCanvasSurface(surface);
    surface = null;

    const blobUrl = safeCreateObjectURL(blob);
    const estimatedBytes = width * height * 4;

    // Cache in LRU
    ensureCapacity(estimatedBytes);
    const entry: PageCacheEntry = {
      key: job.key,
      pdfAssetId: job.pdfAssetId,
      page: job.page,
      bucket: job.bucket,
      blobUrl,
      widthPx: width,
      heightPx: height,
      bytes: estimatedBytes,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
    };
    pageCache.set(job.key, entry);
    totalCacheBytes += estimatedBytes;

    // Resolve all active subscribers
    for (const sub of job.subscribers) {
      if (sub.signal && sub.onAbort) {
        sub.signal.removeEventListener('abort', sub.onAbort);
      }
      sub.resolve(blobUrl);
    }
  } catch (err: unknown) {
    if (surface) {
      releaseCanvasSurface(surface);
      surface = null;
    }
    for (const sub of job.subscribers) {
      if (sub.signal && sub.onAbort) {
        sub.signal.removeEventListener('abort', sub.onAbort);
      }
      sub.reject(err);
    }
  } finally {
    if (surface) {
      releaseCanvasSurface(surface);
    }
    if (doc) {
      releaseDocumentReference(job.pdfAssetId);
    }
    if (inFlightJobs.get(job.key) === job) {
      inFlightJobs.delete(job.key);
    }
  }
}

// --- Public API ---

/**
 * Returns cached URL synchronously if available in LRU cache, touching the entry.
 */
export function getCachedPdfPageUrl(pdfAssetId: ID, page: number, bucketWidth: number): string | undefined {
  const bucket = normalizeBucket(bucketWidth);
  const key = makeCacheKey(pdfAssetId, page, bucket);
  const cached = pageCache.get(key);
  if (cached) {
    touchEntry(key, cached);
    return cached.blobUrl;
  }
  return undefined;
}

/**
 * Retrieves a rendered page as a blob URL.
 * Automatically checks the LRU cache, deduplicates in-flight renders,
 * enqueues through the max-2 concurrency queue, and manages AbortSignal.
 */
export function getPdfPageUrl(
  pdfAssetId: ID,
  page: number,
  targetWidthPx: number,
  signal?: AbortSignal,
  options?: RenderOptions,
): Promise<string> {
  const bucket = normalizeBucket(targetWidthPx);
  const key = makeCacheKey(pdfAssetId, page, bucket);

  // 1. Check LRU Cache Hit
  const cached = pageCache.get(key);
  if (cached) {
    touchEntry(key, cached);
    return Promise.resolve(cached.blobUrl);
  }

  // 2. Pre-aborted signal check
  if (signal?.aborted) {
    return Promise.reject(new DOMException('Operazione annullata', 'AbortError'));
  }

  // 3. In-flight deduplication / registration
  return new Promise<string>((resolve, reject) => {
    let job = inFlightJobs.get(key);
    const subscriber: InFlightSubscriber = {
      signal,
      resolve,
      reject,
    };

    if (signal) {
      subscriber.onAbort = () => {
        if (job) {
          job.subscribers.delete(subscriber);
          if (job.subscribers.size === 0) {
            // Cancel queue task if queued
            const qIdx = renderQueue.findIndex((t) => t.job === job);
            if (qIdx !== -1) {
              renderQueue.splice(qIdx, 1);
            }
            if (job.cancelRender) job.cancelRender();
            if (inFlightJobs.get(key) === job) {
              inFlightJobs.delete(key);
            }
          }
        }
        reject(new DOMException('Operazione annullata', 'AbortError'));
      };
      signal.addEventListener('abort', subscriber.onAbort, { once: true });
    }

    if (job) {
      job.subscribers.add(subscriber);
    } else {
      job = {
        key,
        pdfAssetId,
        page,
        bucket,
        subscribers: new Set([subscriber]),
      };
      inFlightJobs.set(key, job);

      const queueTask: QueueTask = {
        id: `${key}_${Date.now()}_${Math.random()}`,
        job,
        priority: options?.priority ?? 0,
      };
      renderQueue.push(queueTask);
      pumpQueue();
    }
  });
}

/**
 * Cleanly releases all resources associated with a PDF document:
 * 1. Cancels any pending or active render tasks for this asset.
 * 2. Destroys the cached PDFDocumentProxy.
 * 3. Evicts and revokes all cached blob URLs for this asset.
 */
export function releasePdfDocument(pdfAssetId: ID): void {
  bumpDocumentEpoch(pdfAssetId);
  pendingDocuments.delete(pdfAssetId);
  // Cancel queued jobs
  for (let i = renderQueue.length - 1; i >= 0; i--) {
    if (renderQueue[i].job.pdfAssetId === pdfAssetId) {
      const task = renderQueue.splice(i, 1)[0];
      for (const sub of task.job.subscribers) {
        if (sub.signal && sub.onAbort) {
          sub.signal.removeEventListener('abort', sub.onAbort);
        }
        sub.reject(new DOMException('Documento PDF chiuso', 'AbortError'));
      }
      inFlightJobs.delete(task.job.key);
    }
  }

  // Cancel in-flight active renders
  for (const [key, job] of inFlightJobs.entries()) {
    if (job.pdfAssetId === pdfAssetId) {
      if (job.cancelRender) job.cancelRender();
      for (const sub of job.subscribers) {
        if (sub.signal && sub.onAbort) {
          sub.signal.removeEventListener('abort', sub.onAbort);
        }
        sub.reject(new DOMException('Documento PDF chiuso', 'AbortError'));
      }
      inFlightJobs.delete(key);
    }
  }

  // Evict cached blob URLs
  for (const [key, entry] of pageCache.entries()) {
    if (entry.pdfAssetId === pdfAssetId) {
      safeRevokeObjectURL(entry.blobUrl);
      totalCacheBytes -= entry.bytes;
      pageCache.delete(key);
    }
  }

  // Close and destroy document proxy
  closeDocument(pdfAssetId);
}

/**
 * Clears the entire cache, revokes all blob URLs, and destroys all open documents.
 * Intended for test cleanup, memory warnings, and workspace resets.
 */
export function clearPageCache(): void {
  for (const pdfAssetId of pendingDocuments.keys()) {
    bumpDocumentEpoch(pdfAssetId);
  }
  pendingDocuments.clear();
  // Clear queued jobs
  for (const task of renderQueue) {
    for (const sub of task.job.subscribers) {
      if (sub.signal && sub.onAbort) {
        sub.signal.removeEventListener('abort', sub.onAbort);
      }
      sub.reject(new DOMException('Cache pagina cancellata', 'AbortError'));
    }
  }
  renderQueue.length = 0;

  // Cancel in-flight jobs
  for (const job of inFlightJobs.values()) {
    if (job.cancelRender) job.cancelRender();
    for (const sub of job.subscribers) {
      if (sub.signal && sub.onAbort) {
        sub.signal.removeEventListener('abort', sub.onAbort);
      }
      sub.reject(new DOMException('Cache pagina cancellata', 'AbortError'));
    }
  }
  inFlightJobs.clear();

  // Revoke all blob URLs
  for (const entry of pageCache.values()) {
    safeRevokeObjectURL(entry.blobUrl);
  }
  pageCache.clear();
  totalCacheBytes = 0;

  // Destroy all open documents
  for (const pdfAssetId of Array.from(documentPool.keys())) {
    bumpDocumentEpoch(pdfAssetId);
    closeDocument(pdfAssetId);
  }
}

/**
 * Returns current cache metrics for testing, diagnostics, and performance monitoring.
 */
export function getPageCacheStats(): CacheStats {
  return {
    size: pageCache.size,
    totalBytes: totalCacheBytes,
    maxBytes: maxCacheBytes,
    activeJobs: activeWorkers,
    queuedJobs: renderQueue.length,
    openDocuments: documentPool.size,
  };
}

/**
 * Configures cache limits (primarily for testing low-memory scenarios).
 */
export function configurePageCache(config: {
  maxBytes?: number;
  maxConcurrency?: number;
  idleTimeoutMs?: number;
}): void {
  if (config.maxBytes !== undefined) maxCacheBytes = config.maxBytes;
  if (config.maxConcurrency !== undefined) maxConcurrency = config.maxConcurrency;
  if (config.idleTimeoutMs !== undefined) documentIdleTimeoutMs = config.idleTimeoutMs;
}

/**
 * React hook to retrieve the on-demand rendered PDF page blob URL.
 * Automatically synchronizes with the LRU cache, gates execution based on viewport proximity (`enabled`),
 * and safely aborts tasks via `AbortController` when unmounted or scrolled away.
 */
export function usePdfPageUrl(
  source: PdfSourceAttr | null | undefined,
  displayWidth: number,
  enabled: boolean = true,
): UsePdfPageUrlResult {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const bucketWidth = computeBucketWidth(displayWidth, dpr);

  const isValidSource = Boolean(
    source &&
      source.type === 'pdf' &&
      typeof source.assetId === 'string' &&
      source.assetId.trim().length > 0 &&
      typeof source.page === 'number' &&
      source.page >= 1,
  );

  const assetId = isValidSource && source ? source.assetId : '';
  const page = isValidSource && source ? source.page : 0;
  const currentKey = `${assetId}:${page}:${bucketWidth}`;

  const cached = enabled && isValidSource ? getCachedPdfPageUrl(assetId, page, bucketWidth) : undefined;

  const [asyncState, setAsyncState] = useState<{
    key: string;
    url: string | null;
    error: Error | null;
  }>({
    key: '',
    url: null,
    error: null,
  });

  useEffect(() => {
    if (!enabled || !isValidSource) return;

    // Check if cache already has it
    if (getCachedPdfPageUrl(assetId, page, bucketWidth)) {
      return;
    }

    const controller = new AbortController();
    const { signal } = controller;

    getPdfPageUrl(assetId, page, bucketWidth, signal, { priority: 1 })
      .then((url) => {
        if (!signal.aborted) {
          setAsyncState({ key: currentKey, url, error: null });
        }
      })
      .catch((err: unknown) => {
        if (signal.aborted) return;
        const error = err instanceof Error ? err : new Error(String(err));
        if (error.name === 'AbortError' || error.name === 'RenderingCancelledException') {
          return;
        }
        setAsyncState({ key: currentKey, url: null, error });
      });

    return () => {
      controller.abort();
    };
  }, [enabled, isValidSource, assetId, page, bucketWidth, currentKey]);

  if (!enabled || !isValidSource) {
    return { url: null, loading: false, error: null };
  }

  if (cached) {
    return { url: cached, loading: false, error: null };
  }

  const isCurrent = asyncState.key === currentKey;
  if (isCurrent && asyncState.error) {
    return { url: null, loading: false, error: asyncState.error };
  }
  if (isCurrent && asyncState.url) {
    return { url: asyncState.url, loading: false, error: null };
  }

  return { url: null, loading: true, error: null };
}
