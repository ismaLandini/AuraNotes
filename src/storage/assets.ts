import { useEffect, useState } from 'react';
import type { ID } from '../types';
import { getAsset, putAsset } from './db';
import { newId } from '../model/workspaceOps';

const urlCache = new Map<ID, string>();
const pending = new Map<ID, Promise<string | null>>();

export async function getAssetUrl(id: ID): Promise<string | null> {
  const cached = urlCache.get(id);
  if (cached) return cached;
  let p = pending.get(id);
  if (!p) {
    p = getAsset(id).then((a) => {
      pending.delete(id);
      if (!a) return null;
      const url = URL.createObjectURL(a.blob);
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
  const [state, setState] = useState<{ url: string | null; missing: boolean }>(() => ({
    url: urlCache.get(id) ?? null,
    missing: false,
  }));
  useEffect(() => {
    let alive = true;
    if (urlCache.has(id)) {
      setState({ url: urlCache.get(id)!, missing: false });
      return;
    }
    getAssetUrl(id)
      .then((url) => alive && setState({ url, missing: !url }))
      .catch(() => alive && setState({ url: null, missing: true }));
    return () => {
      alive = false;
    };
  }, [id]);
  return state;
}

export const SUPPORTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml', 'image/avif', 'image/bmp'];

export interface ImportedImage {
  assetId: ID;
  width: number;
  height: number;
  mime: string;
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

/** Stores an image blob persistently and returns its metadata. */
export async function importImageBlob(blob: Blob): Promise<ImportedImage> {
  if (!blob.type.startsWith('image/')) throw new Error(`Formato non supportato: ${blob.type || 'sconosciuto'}`);
  const { width, height } = await measure(blob);
  const assetId = newId();
  await putAsset({ id: assetId, blob, mime: blob.type, createdAt: Date.now() });
  const url = URL.createObjectURL(blob);
  urlCache.set(assetId, url);
  return { assetId, width, height, mime: blob.type };
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
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
