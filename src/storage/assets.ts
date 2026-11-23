import { useEffect, useState } from 'react';
import type { ID, Workspace } from '../types';
import { deleteAssets, getAsset, getAssetByHash, getDB, listAssetIds, loadAllPages, putAsset } from './db';
import { referencedAssets } from '../model/pageOps';
import { newId } from '../model/workspaceOps';


const urlCache = new Map<ID, string>();
const pending = new Map<ID, Promise<string | null>>();

function safeCreateObjectURL(blob: Blob): string {
  try {
    return URL.createObjectURL(blob);
  } catch {
    return `blob:glassnote/${newId()}`;
  }
}

export function clearAssetUrlCache(): void {
  for (const url of urlCache.values()) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      /* ignore */
    }
  }
  urlCache.clear();
  pending.clear();
}

export function revokeAssetUrl(id: ID): void {
  const cached = urlCache.get(id);
  if (cached) {
    try {
      URL.revokeObjectURL(cached);
    } catch {
      /* ignore */
    }
    urlCache.delete(id);
  }
  pending.delete(id);
}

export async function getAssetUrl(id: ID): Promise<string | null> {
  const cached = urlCache.get(id);
  if (cached) return cached;
  let p = pending.get(id);
  if (!p) {
    p = getAsset(id).then((a) => {
      pending.delete(id);
      if (!a) return null;
      const url = safeCreateObjectURL(a.blob);
      urlCache.set(id, url);
      return url;
    });
    pending.set(id, p);
  }
  return p;
}

export function getCachedAssetUrl(id: ID): string | undefined {
  return urlCache.get(id);
}

export function useAssetUrl(id: ID): { url: string | null; missing: boolean } {
  const cached = urlCache.get(id);
  const [asyncState, setAsyncState] = useState<{ url: string | null; missing: boolean }>({
    url: null,
    missing: false,
  });

  useEffect(() => {
    if (urlCache.has(id)) return;
    let alive = true;
    getAssetUrl(id)
      .then((url) => alive && setAsyncState({ url, missing: !url }))
      .catch(() => alive && setAsyncState({ url: null, missing: true }));
    return () => {
      alive = false;
    };
  }, [id]);

  if (cached) return { url: cached, missing: false };
  return asyncState;
}

export const SUPPORTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml', 'image/avif', 'image/bmp'];

export interface ImportedImage {
  assetId: ID;
  width: number;
  height: number;
  mime: string;
  hash?: string;
  deduplicated?: boolean;
}

async function readBlobBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') {
    return new Uint8Array(await blob.arrayBuffer());
  }
  return new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error('Impossibile leggere il Blob'));
    reader.readAsArrayBuffer(blob);
  });
}

/** Computes a SHA-256 hex digest of a Blob, ArrayBuffer, or Uint8Array. */
export async function computeBlobHash(input: Blob | ArrayBuffer | Uint8Array): Promise<string> {
  let bytes: Uint8Array;
  if (input instanceof Uint8Array) {
    bytes = input;
  } else if (ArrayBuffer.isView(input)) {
    bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  } else if (input instanceof ArrayBuffer || Object.prototype.toString.call(input) === '[object ArrayBuffer]') {
    bytes = new Uint8Array(input as ArrayBuffer);
  } else {
    bytes = await readBlobBytes(input as Blob);
  }
  if (typeof crypto !== 'undefined' && crypto.subtle?.digest) {
    const buf = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buf).set(bytes);
    const digest = await crypto.subtle.digest('SHA-256', buf);
    const arr = new Uint8Array(digest);
    let hex = '';
    for (let i = 0; i < arr.length; i++) {
      hex += arr[i].toString(16).padStart(2, '0');
    }
    return hex;
  }
  // Fallback FNV-1a 64-bit x4 if SubtleCrypto is missing
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h1 = Math.imul(h1 ^ bytes[i], 0x01000193);
    h2 = Math.imul(h2 ^ ((bytes[i] + i) & 0xff), 0x01000193);
  }
  return `${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}-${bytes.length}`;
}

/**
 * Stores an arbitrary blob (e.g. a PDF document or lossless image) in IndexedDB,
 * deduplicating by content SHA-256 hash.
 */
export async function importAssetBlob(
  blob: Blob,
  mimeOverride?: string,
  precomputedHash?: string,
): Promise<{ assetId: ID; hash: string; deduplicated: boolean }> {
  const mime = mimeOverride || blob.type || 'application/octet-stream';
  const hash = precomputedHash || (await computeBlobHash(blob));
  const existing = await getAssetByHash(hash);
  if (existing) {
    if (!urlCache.has(existing.id)) {
      urlCache.set(existing.id, safeCreateObjectURL(existing.blob));
    }
    return { assetId: existing.id, hash, deduplicated: true };
  }
  const assetId = newId();
  await putAsset({ id: assetId, blob, mime, createdAt: Date.now(), hash });
  urlCache.set(assetId, safeCreateObjectURL(blob));
  return { assetId, hash, deduplicated: false };
}

async function measure(blob: Blob): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap === 'function' && blob.type !== 'image/svg+xml') {
    try {
      const bmp = await createImageBitmap(blob);
      const r = { width: bmp.width, height: bmp.height };
      bmp.close();
      return r;
    } catch {
      /* fall through to <img> */
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth || 400, height: img.naturalHeight || 300 });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Immagine non leggibile'));
    };
    img.src = url;
  });
}

/** Stores an image blob persistently (deduplicating by SHA-256 hash) and returns its metadata. */
export async function importImageBlob(
  blob: Blob,
  knownDimensions?: { width: number; height: number },
  precomputedHash?: string,
): Promise<ImportedImage> {
  if (!blob.type.startsWith('image/')) throw new Error(`Formato non supportato: ${blob.type || 'sconosciuto'}`);
  const { width, height } = knownDimensions ?? (await measure(blob));
  const { assetId, hash, deduplicated } = await importAssetBlob(blob, blob.type, precomputedHash);
  return { assetId, width, height, mime: blob.type, hash, deduplicated };
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = await readBlobBytes(blob);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(bin)}`;
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl);
  if (!m) throw new Error('Data URL non valido');
  const mime = m[1] || 'application/octet-stream';
  if (m[2]) {
    const bin = atob(m[3]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }
  return new Blob([decodeURIComponent(m[3])], { type: mime });
}

/**
 * Scans all pages in IndexedDB and removes assets that are no longer referenced by any page.
 * Also revokes object URLs in the in-memory urlCache.
 *
 * @param _excludeFuture Retained for API compatibility with useStore signature
 * @param extraReferenced Optional set of asset IDs referenced in-memory (e.g. undo history)
 * @returns The number of reclaimed orphan assets.
 */
export async function garbageCollectAssets(
  _excludeFuture = false,
  extraReferenced?: Iterable<ID>,
): Promise<number> {
  const all = await loadAllPages();
  const referenced = new Set<ID>(extraReferenced);
  for (const p of all) {
    for (const a of referencedAssets(p)) {
      referenced.add(a);
    }
  }
  try {
    const db = await getDB();
    const ws = (await db.get('kv', 'workspace')) as Workspace | undefined;
    if (ws && typeof ws === 'object') {
      if (ws.pages) {
        for (const meta of Object.values(ws.pages)) {
          if (meta?.pdfAssetId) referenced.add(meta.pdfAssetId);
        }
      }
      if (Array.isArray(ws.trash)) {
        for (const entry of ws.trash) {
          if (entry?.page?.pdfAssetId) referenced.add(entry.page.pdfAssetId);
        }
      }
    }
  } catch {
    /* ignore */
  }
  const stored = await listAssetIds();
  const orphan = stored.filter((a) => !referenced.has(a));
  if (orphan.length > 0) {
    for (const id of orphan) revokeAssetUrl(id);
    await deleteAssets(orphan);
  }
  return orphan.length;
}

