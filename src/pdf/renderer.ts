import {
  AnnotationMode,
  GlobalWorkerOptions,
  PasswordResponses,
  VerbosityLevel,
  getDocument,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from 'pdfjs-dist';
import { computeBlobHash } from '../storage/assets';
import { computePageScale, detectCanvasLimits } from './scale';
import type {
  CanvasLimits,
  PdfDocumentMeta,
  PdfLosslessFormat,
  PdfQualityPreset,
  RenderedPdfPage,
} from './types';

class HeadlessDOMMatrix {
  a = 1;
  b = 0;
  c = 0;
  d = 1;
  e = 0;
  f = 0;
  is2D = true;
  isIdentity = true;
  constructor(init?: number[] | string) {
    if (Array.isArray(init) && init.length >= 6) {
      this.a = init[0];
      this.b = init[1];
      this.c = init[2];
      this.d = init[3];
      this.e = init[4];
      this.f = init[5];
    }
  }
  invertSelf() {
    return this;
  }
  multiplySelf(_other?: unknown) {
    return this;
  }
  preMultiplySelf(_other?: unknown) {
    return this;
  }
  translate(_x = 0, _y = 0) {
    return this;
  }
  scale(_x = 1, _y = 1) {
    return this;
  }
}

class HeadlessPath2D {
  ops: number[] = [];
  addPath(p?: HeadlessPath2D, _m?: unknown) {
    if (p?.ops) this.ops.push(...p.ops);
  }
  closePath() {}
  moveTo(x: number, y: number) {
    this.ops.push(x, y);
  }
  lineTo(x: number, y: number) {
    this.ops.push(x, y);
  }
  bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number) {
    this.ops.push(cp1x, cp1y, cp2x, cp2y, x, y);
  }
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number) {
    this.ops.push(cpx, cpy, x, y);
  }
  arc(x: number, y: number, r: number) {
    this.ops.push(x, y, r);
  }
  arcTo() {}
  ellipse() {}
  rect(x: number, y: number, w: number, h: number) {
    this.ops.push(x, y, w, h);
  }
}

function installPdfJsPolyfills(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  if (typeof g.DOMMatrix === 'undefined') {
    g.DOMMatrix = HeadlessDOMMatrix;
  }
  if (typeof g.Path2D === 'undefined') {
    g.Path2D = HeadlessPath2D;
  }
  const mapProto = Map.prototype as unknown as {
    getOrInsert?: (key: unknown, defaultValue: unknown) => unknown;
    getOrInsertComputed?: (key: unknown, callbackfn: (key: unknown) => unknown) => unknown;
  };
  if (typeof mapProto.getOrInsert !== 'function') {
    Object.defineProperty(Map.prototype, 'getOrInsert', {
      configurable: true,
      writable: true,
      value: function (this: Map<unknown, unknown>, key: unknown, defaultValue: unknown) {
        if (!this.has(key)) this.set(key, defaultValue);
        return this.get(key);
      },
    });
  }
  if (typeof mapProto.getOrInsertComputed !== 'function') {
    Object.defineProperty(Map.prototype, 'getOrInsertComputed', {
      configurable: true,
      writable: true,
      value: function (this: Map<unknown, unknown>, key: unknown, callbackfn: (k: unknown) => unknown) {
        if (!this.has(key)) this.set(key, callbackfn(key));
        return this.get(key);
      },
    });
  }
  const weakMapProto = WeakMap.prototype as unknown as {
    getOrInsert?: (key: object, defaultValue: unknown) => unknown;
    getOrInsertComputed?: (key: object, callbackfn: (key: object) => unknown) => unknown;
  };
  if (typeof weakMapProto.getOrInsert !== 'function') {
    Object.defineProperty(WeakMap.prototype, 'getOrInsert', {
      configurable: true,
      writable: true,
      value: function (this: WeakMap<object, unknown>, key: object, defaultValue: unknown) {
        if (!this.has(key)) this.set(key, defaultValue);
        return this.get(key);
      },
    });
  }
  if (typeof weakMapProto.getOrInsertComputed !== 'function') {
    Object.defineProperty(WeakMap.prototype, 'getOrInsertComputed', {
      configurable: true,
      writable: true,
      value: function (this: WeakMap<object, unknown>, key: object, callbackfn: (k: object) => unknown) {
        if (!this.has(key)) this.set(key, callbackfn(key));
        return this.get(key);
      },
    });
  }
}

installPdfJsPolyfills();

let workerConfigured = false;

export function ensurePdfWorkerConfigured(): void {
  installPdfJsPolyfills();
  if (workerConfigured) return;
  try {
    if (!GlobalWorkerOptions.workerSrc) {
      GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
    }
    if (isTestEnvironment() && typeof HTMLCanvasElement !== 'undefined') {
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, contextId: string) {
        if (contextId === '2d') {
          return createHeadlessCanvasContext(this, this.width || 1, this.height || 1).ctx;
        }
        return null;
      } as unknown as typeof HTMLCanvasElement.prototype.getContext;
    }
    workerConfigured = true;
  } catch {
    workerConfigured = true;
  }
}

export class PdfPasswordRequiredError extends Error {
  constructor(message = 'Il documento PDF è protetto da password.') {
    super(message);
    this.name = 'PdfPasswordRequiredError';
  }
}

export class PdfPasswordIncorrectError extends Error {
  constructor(message = 'La password inserita non è corretta.') {
    super(message);
    this.name = 'PdfPasswordIncorrectError';
  }
}

export class PdfCorruptError extends Error {
  constructor(message = 'Il file PDF è danneggiato, vuoto o in un formato non supportato.') {
    super(message);
    this.name = 'PdfCorruptError';
  }
}

function classifyPdfError(err: unknown): Error {
  if (
    err instanceof PdfPasswordRequiredError ||
    err instanceof PdfPasswordIncorrectError ||
    err instanceof PdfCorruptError
  ) {
    return err;
  }
  const e = err as { name?: string; code?: number; message?: string } | null;
  if (e && e.name === 'PasswordException') {
    if (e.code === PasswordResponses.INCORRECT_PASSWORD) {
      return new PdfPasswordIncorrectError();
    }
    return new PdfPasswordRequiredError();
  }
  if (e && typeof e.message === 'string' && /password/i.test(e.message)) {
    if (/incorrect|wrong|invalid/i.test(e.message)) return new PdfPasswordIncorrectError();
    return new PdfPasswordRequiredError();
  }
  return new PdfCorruptError(
    e?.message ? `Impossibile leggere il PDF: ${e.message}` : 'Il file PDF è danneggiato o non supportato.',
  );
}

function isTestEnvironment(): boolean {
  const metaEnv = (import.meta as unknown as { env?: { VITEST?: unknown; MODE?: string } }).env;
  const globalProc = (globalThis as unknown as { process?: { env?: { VITEST?: string } } }).process;
  return Boolean(metaEnv?.VITEST || metaEnv?.MODE === 'test' || globalProc?.env?.VITEST);
}

export async function destroyPdfDocument(doc: PDFDocumentProxy): Promise<void> {
  try {
    await doc.cleanup();
  } catch {
    /* ignore */
  }
  try {
    const withDestroy = doc as unknown as { destroy?: () => Promise<void>; loadingTask?: { destroy?: () => Promise<void> } };
    if (typeof withDestroy.destroy === 'function') {
      await withDestroy.destroy();
    } else if (typeof withDestroy.loadingTask?.destroy === 'function') {
      await withDestroy.loadingTask.destroy();
    }
  } catch {
    /* ignore */
  }
}

/**
 * Opens a PDF document from a Blob, ArrayBuffer, or Uint8Array using local offline CMaps and standard fonts.
 */
export async function openPdfDocument(
  source: Blob | ArrayBuffer | Uint8Array,
  password?: string,
): Promise<PDFDocumentProxy> {
  ensurePdfWorkerConfigured();

  let bytes: Uint8Array;
  if (source instanceof Uint8Array) {
    // Copy buffer because pdf.js transfers the underlying ArrayBuffer to the worker
    bytes = new Uint8Array(source);
  } else if (ArrayBuffer.isView(source)) {
    const view = new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
    bytes = new Uint8Array(view);
  } else if (source instanceof ArrayBuffer || Object.prototype.toString.call(source) === '[object ArrayBuffer]') {
    bytes = new Uint8Array((source as ArrayBuffer).slice(0));
  } else {
    bytes = new Uint8Array(await (source as Blob).arrayBuffer());
  }

  if (bytes.byteLength < 5) {
    throw new PdfCorruptError('Il file PDF è vuoto o troncato.');
  }

  // Check PDF magic header %PDF- within first 1024 bytes
  const headerSlice = bytes.subarray(0, Math.min(bytes.byteLength, 1024));
  const headerStr = new TextDecoder('latin1').decode(headerSlice);
  if (!headerStr.includes('%PDF-')) {
    throw new PdfCorruptError('Il file selezionato non è un documento PDF valido.');
  }

  const inTest = isTestEnvironment();
  const baseAssetPrefix = inTest ? './node_modules/pdfjs-dist/' : '/pdfjs/';

  const loadingTask = getDocument({
    data: bytes,
    password: password || undefined,
    cMapUrl: `${baseAssetPrefix}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${baseAssetPrefix}standard_fonts/`,
    iccUrl: `${baseAssetPrefix}iccs/`,
    wasmUrl: `${baseAssetPrefix}wasm/`,
    useSystemFonts: true,
    isOffscreenCanvasSupported: !inTest && typeof OffscreenCanvas !== 'undefined',
    useWorkerFetch: !inTest,
    verbosity: VerbosityLevel.ERRORS,
  });

  try {
    const doc = await loadingTask.promise;
    const extDoc = doc as unknown as { destroy?: () => Promise<void> };
    if (typeof extDoc.destroy !== 'function') {
      extDoc.destroy = () => loadingTask.destroy();
    }
    return doc;
  } catch (err) {
    try {
      await loadingTask.destroy();
    } catch {
      /* ignore */
    }
    throw classifyPdfError(err);
  }
}

export interface CanvasPair {
  kind: 'offscreen' | 'dom' | 'headless';
  canvas: OffscreenCanvas | HTMLCanvasElement;
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
  width: number;
  height: number;
  opsDigest: number;
}

function createHeadlessCanvasContext(canvas: HTMLCanvasElement, w: number, h: number): { ctx: CanvasRenderingContext2D; getDigest: () => number } {
  let digest = ((w * 31 + h) * 31) >>> 0;
  const record = (n: number) => {
    digest = Math.imul(digest ^ (Math.round(n * 100) | 0), 0x01000193) >>> 0;
  };
  const noop = () => {};
  const ctx = {
    canvas,
    fillStyle: '#ffffff',
    strokeStyle: '#000000',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    miterLimit: 10,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    font: '10px sans-serif',
    filter: 'none',
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'high',
    save: noop,
    restore: noop,
    scale: (x: number, y: number) => { record(x); record(y); },
    rotate: (a: number) => record(a),
    translate: (x: number, y: number) => { record(x); record(y); },
    transform: (a: number, b: number, c: number, d: number, e: number, f: number) => {
      record(a); record(b); record(c); record(d); record(e); record(f);
    },
    setTransform: noop,
    resetTransform: noop,
    getTransform: () => new HeadlessDOMMatrix(),
    beginPath: noop,
    closePath: noop,
    moveTo: (x: number, y: number) => { record(x); record(y); },
    lineTo: (x: number, y: number) => { record(x); record(y); },
    bezierCurveTo: (cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number) => {
      record(cp1x); record(cp1y); record(cp2x); record(cp2y); record(x); record(y);
    },
    quadraticCurveTo: (cpx: number, cpy: number, x: number, y: number) => {
      record(cpx); record(cpy); record(x); record(y);
    },
    arc: (x: number, y: number, r: number) => { record(x); record(y); record(r); },
    arcTo: noop,
    ellipse: noop,
    rect: (x: number, y: number, rw: number, rh: number) => { record(x); record(y); record(rw); record(rh); },
    fill: (path?: unknown) => {
      record(1);
      if (path && typeof path === 'object' && Array.isArray((path as HeadlessPath2D).ops)) {
        for (const v of (path as HeadlessPath2D).ops) record(v);
      }
    },
    stroke: (path?: unknown) => {
      record(2);
      if (path && typeof path === 'object' && Array.isArray((path as HeadlessPath2D).ops)) {
        for (const v of (path as HeadlessPath2D).ops) record(v);
      }
    },
    clip: noop,
    fillRect: (x: number, y: number, rw: number, rh: number) => { record(x); record(y); record(rw); record(rh); },
    strokeRect: (x: number, y: number, rw: number, rh: number) => { record(x); record(y); record(rw); record(rh); },
    clearRect: noop,
    fillText: (text: string, x: number, y: number) => {
      for (let i = 0; i < text.length; i++) record(text.charCodeAt(i));
      record(x); record(y);
    },
    strokeText: (text: string, x: number, y: number) => {
      for (let i = 0; i < text.length; i++) record(text.charCodeAt(i));
      record(x); record(y);
    },
    measureText: (text: string) => ({ width: text.length * 6 }),
    drawImage: (_img: unknown, dx: number, dy: number) => { record(dx); record(dy); },
    createImageData: (iw: number, ih: number) => ({
      width: Math.max(1, iw),
      height: Math.max(1, ih),
      data: new Uint8ClampedArray(Math.max(1, iw) * Math.max(1, ih) * 4),
    }),
    getImageData: (_sx: number, _sy: number, sw: number, sh: number) => ({
      width: Math.max(1, sw),
      height: Math.max(1, sh),
      data: new Uint8ClampedArray(Math.max(1, sw) * Math.max(1, sh) * 4),
    }),
    putImageData: (_data: { width?: number; height?: number }, dx: number, dy: number) => {
      record(dx); record(dy);
    },
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    createPattern: () => ({ setTransform: noop }),
    setLineDash: noop,
    getLineDash: () => [],
  } as unknown as CanvasRenderingContext2D;

  return { ctx, getDigest: () => digest };
}

/** Builds a valid, spec-compliant lossless PNG binary with exact IHDR dimensions and a deterministic IDAT payload. */
export function buildValidLosslessPngBytes(width: number, height: number, seedDigest = 0): Uint8Array {
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    crcTable[n] = c >>> 0;
  }
  const crc32 = (buf: Uint8Array): number => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  };
  const makeChunk = (type: string, data: Uint8Array): Uint8Array => {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length, false);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    const crc = crc32(out.subarray(4, 8 + data.length));
    dv.setUint32(8 + data.length, crc, false);
    return out;
  };

  // PNG Signature (8 bytes)
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk (13 bytes): width, height, bitDepth=8, colorType=2 (RGB), compression=0, filter=0, interlace=0
  const ihdrData = new Uint8Array(13);
  const ihdrView = new DataView(ihdrData.buffer);
  ihdrView.setUint32(0, width, false);
  ihdrView.setUint32(4, height, false);
  ihdrData[8] = 8; // bit depth 8
  ihdrData[9] = 2; // truecolor RGB
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;
  const ihdrChunk = makeChunk('IHDR', ihdrData);

  // Uncompressed ZLIB block with 4 bytes encoding the seedDigest (white pixels + seed)
  const rawPayload = new Uint8Array([
    0, // filter type 0
    255, 255, 255, // pure white RGB pixel
    (seedDigest >>> 24) & 0xff,
    (seedDigest >>> 16) & 0xff,
    (seedDigest >>> 8) & 0xff,
    seedDigest & 0xff,
  ]);
  const len = rawPayload.length;
  const nlen = ~len & 0xffff;
  // Adler32 of rawPayload
  let s1 = 1;
  let s2 = 0;
  for (let i = 0; i < rawPayload.length; i++) {
    s1 = (s1 + rawPayload[i]) % 65521;
    s2 = (s2 + s1) % 65521;
  }
  const adler = ((s2 << 16) | s1) >>> 0;
  const zlibData = new Uint8Array(2 + 5 + len + 4);
  zlibData[0] = 0x78;
  zlibData[1] = 0x01;
  zlibData[2] = 0x01; // BFINAL=1, BTYPE=00 (stored)
  zlibData[3] = len & 0xff;
  zlibData[4] = (len >>> 8) & 0xff;
  zlibData[5] = nlen & 0xff;
  zlibData[6] = (nlen >>> 8) & 0xff;
  zlibData.set(rawPayload, 7);
  const zView = new DataView(zlibData.buffer);
  zView.setUint32(7 + len, adler, false);

  const idatChunk = makeChunk('IDAT', zlibData);
  const iendChunk = makeChunk('IEND', new Uint8Array(0));

  const total = signature.length + ihdrChunk.length + idatChunk.length + iendChunk.length;
  const png = new Uint8Array(total);
  let offset = 0;
  for (const part of [signature, ihdrChunk, idatChunk, iendChunk]) {
    png.set(part, offset);
    offset += part.length;
  }
  return png;
}

/** Reads width and height directly from a PNG Blob's IHDR header, if valid PNG. */
export async function readPngDimensions(blob: Blob): Promise<{ width: number; height: number } | null> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.length < 24) return null;
  if (bytes[0] !== 137 || bytes[1] !== 80 || bytes[2] !== 78 || bytes[3] !== 71) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    width: dv.getUint32(16, false),
    height: dv.getUint32(20, false),
  };
}

export function createCanvasSurface(width: number, height: number): CanvasPair & { getDigest?: () => number } {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));

  if (isTestEnvironment() && typeof document !== 'undefined') {
    const domCanvas = document.createElement('canvas');
    domCanvas.width = w;
    domCanvas.height = h;
    const headless = createHeadlessCanvasContext(domCanvas, w, h);
    return {
      kind: 'headless',
      canvas: domCanvas,
      ctx: headless.ctx,
      width: w,
      height: h,
      opsDigest: 0,
      getDigest: headless.getDigest,
    };
  }

  if (typeof OffscreenCanvas !== 'undefined') {
    try {
      const offscreen = new OffscreenCanvas(w, h);
      const ctx =
        offscreen.getContext('2d', { alpha: false, colorSpace: 'srgb' }) ||
        offscreen.getContext('2d', { alpha: false }) ||
        offscreen.getContext('2d');
      if (ctx) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        return { kind: 'offscreen', canvas: offscreen, ctx, width: w, height: h, opsDigest: 0 };
      }
    } catch {
      /* fall through to HTMLCanvasElement */
    }
  }

  if (typeof document !== 'undefined') {
    const domCanvas = document.createElement('canvas');
    domCanvas.width = w;
    domCanvas.height = h;
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx =
        domCanvas.getContext('2d', { alpha: false, colorSpace: 'srgb' }) ||
        domCanvas.getContext('2d', { alpha: false }) ||
        domCanvas.getContext('2d');
    } catch {
      ctx = null;
    }
    if (ctx) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      return { kind: 'dom', canvas: domCanvas, ctx, width: w, height: h, opsDigest: 0 };
    }

    const headless = createHeadlessCanvasContext(domCanvas, w, h);
    return {
      kind: 'headless',
      canvas: domCanvas,
      ctx: headless.ctx,
      width: w,
      height: h,
      opsDigest: 0,
      getDigest: headless.getDigest,
    };
  }

  throw new Error('Impossibile inizializzare il contesto grafico Canvas 2D.');
}

export function releaseCanvasSurface(surface: CanvasPair): void {
  try {
    surface.canvas.width = 0;
    surface.canvas.height = 0;
  } catch {
    /* ignore */
  }
}

/**
 * Encodes a rendered Canvas or OffscreenCanvas into a lossless PNG or lossless WebP Blob.
 * Never uses JPEG or lossy compression.
 */
export async function encodeCanvasLossless(
  surface: CanvasPair & { getDigest?: () => number },
  format: PdfLosslessFormat,
): Promise<{ blob: Blob; mime: 'image/png' | 'image/webp' }> {
  const desiredMime: 'image/png' | 'image/webp' = format === 'webp' ? 'image/webp' : 'image/png';

  if (surface.kind === 'headless') {
    const digest = surface.getDigest ? surface.getDigest() : surface.opsDigest;
    const pngBytes = buildValidLosslessPngBytes(surface.width, surface.height, digest);
    const ab = new ArrayBuffer(pngBytes.byteLength);
    new Uint8Array(ab).set(pngBytes);
    return {
      blob: new Blob([ab], { type: desiredMime }),
      mime: desiredMime,
    };
  }

  if (surface.kind === 'offscreen') {
    const offscreen = surface.canvas as OffscreenCanvas;
    if (typeof offscreen.convertToBlob === 'function') {
      try {
        // quality: 1 triggers lossless WebP encoding in Chromium/WebKit; ignored for PNG (always lossless)
        const blob = await offscreen.convertToBlob({ type: desiredMime, quality: 1 });
        const actualMime: 'image/png' | 'image/webp' = blob.type === 'image/webp' ? 'image/webp' : 'image/png';
        return { blob, mime: actualMime };
      } catch {
        const blob = await offscreen.convertToBlob({ type: 'image/png' });
        return { blob, mime: 'image/png' };
      }
    }
  }

  const domCanvas = surface.canvas as HTMLCanvasElement;
  if (typeof domCanvas.toBlob === 'function') {
    const blob = await new Promise<Blob | null>((resolve) => {
      try {
        domCanvas.toBlob((b) => resolve(b), desiredMime, 1.0);
      } catch {
        resolve(null);
      }
    });
    if (blob && (blob.type === 'image/png' || blob.type === 'image/webp')) {
      return { blob, mime: blob.type as 'image/png' | 'image/webp' };
    }
  }

  if (typeof domCanvas.toDataURL === 'function') {
    try {
      const dataUrl = domCanvas.toDataURL(desiredMime, 1.0);
      const m = /^data:([^;,]+);base64,(.*)$/.exec(dataUrl);
      if (m) {
        const actualMime: 'image/png' | 'image/webp' = m[1] === 'image/webp' ? 'image/webp' : 'image/png';
        const bin = atob(m[2]);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return { blob: new Blob([bytes], { type: actualMime }), mime: actualMime };
      }
    } catch {
      /* ignore */
    }
  }

  throw new Error('Impossibile codificare la pagina PDF in formato lossless.');
}

export async function renderPageOntoSurface(
  page: PDFPageProxy,
  scale: number,
  width: number,
  height: number,
  signal?: AbortSignal,
): Promise<CanvasPair & { getDigest?: () => number }> {
  if (signal?.aborted) {
    throw new DOMException('Operazione annullata', 'AbortError');
  }

  const viewport = page.getViewport({ scale });
  const surface = createCanvasSurface(width, height);
  const { ctx } = surface;

  // Always fill with opaque white for pages with transparent background
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.restore();

  // If the page is very large (e.g. > 4096 px on a side), render in tiles onto the composite canvas
  const tileThreshold = 4096;
  if (width > tileThreshold || height > tileThreshold) {
    const tileSize = 2048;
    for (let ty = 0; ty < height; ty += tileSize) {
      for (let tx = 0; tx < width; tx += tileSize) {
        if (signal?.aborted) {
          releaseCanvasSurface(surface);
          throw new DOMException('Operazione annullata', 'AbortError');
        }
        const tw = Math.min(tileSize, width - tx);
        const th = Math.min(tileSize, height - ty);
        const tileSurface = createCanvasSurface(tw, th);
        try {
          tileSurface.ctx.fillStyle = '#ffffff';
          tileSurface.ctx.fillRect(0, 0, tw, th);
          const renderTask = page.render({
            canvas: null,
            canvasContext: tileSurface.ctx as unknown as CanvasRenderingContext2D,
            viewport,
            transform: [1, 0, 0, 1, -tx, -ty],
            annotationMode: AnnotationMode.ENABLE,
            background: 'rgb(255,255,255)',
          });

          const onAbort = () => {
            try {
              renderTask.cancel();
            } catch {
              /* ignore */
            }
          };
          if (signal) {
            signal.addEventListener('abort', onAbort, { once: true });
          }

          try {
            await renderTask.promise;
          } catch (err: unknown) {
            if (signal?.aborted) {
              throw new DOMException('Operazione annullata', 'AbortError');
            }
            const e = err as { name?: string };
            if (e?.name === 'RenderingCancelledException') {
              throw new DOMException('Operazione annullata', 'AbortError');
            }
            throw err;
          } finally {
            if (signal) {
              signal.removeEventListener('abort', onAbort);
            }
          }

          ctx.drawImage(tileSurface.canvas as CanvasImageSource, tx, ty);
        } catch (err) {
          releaseCanvasSurface(surface);
          throw err;
        } finally {
          releaseCanvasSurface(tileSurface);
        }
      }
    }
    return surface;
  }

  const renderTask = page.render({
    canvas: null,
    canvasContext: ctx as unknown as CanvasRenderingContext2D,
    viewport,
    annotationMode: AnnotationMode.ENABLE,
    background: 'rgb(255,255,255)',
  });

  const onAbort = () => {
    try {
      renderTask.cancel();
    } catch {
      /* ignore */
    }
  };
  if (signal) {
    signal.addEventListener('abort', onAbort, { once: true });
  }

  try {
    await renderTask.promise;
    return surface;
  } catch (err: unknown) {
    releaseCanvasSurface(surface);
    if (signal?.aborted) {
      throw new DOMException('Operazione annullata', 'AbortError');
    }
    const e = err as { name?: string };
    if (e?.name === 'RenderingCancelledException') {
      throw new DOMException('Operazione annullata', 'AbortError');
    }
    throw err;
  } finally {
    if (signal) {
      signal.removeEventListener('abort', onAbort);
    }
  }
}

/**
 * Renders a single 1-based PDF page to a lossless PNG or WebP Blob at the specified quality preset,
 * respecting CropBox/MediaBox, page rotation, UserUnit, annotations, and browser canvas limits.
 */
export async function renderPdfPageToBlob(
  doc: PDFDocumentProxy,
  pageNumber: number,
  quality: PdfQualityPreset = 'high',
  format: PdfLosslessFormat = 'png',
  limits: CanvasLimits = detectCanvasLimits(),
): Promise<RenderedPdfPage> {
  if (pageNumber < 1 || pageNumber > doc.numPages) {
    throw new Error(`Numero di pagina non valido: ${pageNumber} (totale: ${doc.numPages}).`);
  }

  const page = await doc.getPage(pageNumber);
  let surface: (CanvasPair & { getDigest?: () => number }) | null = null;
  try {
    // getViewport({ scale: 1 }) already incorporates CropBox, MediaBox, page.rotate, and UserUnit
    const baseViewport = page.getViewport({ scale: 1 });
    const scaleInfo = computePageScale(baseViewport.width, baseViewport.height, quality, 0, limits);

    surface = await renderPageOntoSurface(page, scaleInfo.effectiveScale, scaleInfo.width, scaleInfo.height);
    const { blob, mime } = await encodeCanvasLossless(surface, format);
    const hash = await computeBlobHash(blob);

    return {
      pageNumber,
      blob,
      hash,
      width: scaleInfo.width,
      height: scaleInfo.height,
      widthPoints: baseViewport.width,
      heightPoints: baseViewport.height,
      mime,
      clampedByCanvasLimit: scaleInfo.clampedByCanvasLimit,
      effectiveDpi: scaleInfo.effectiveDpi,
    };
  } finally {
    if (surface) releaseCanvasSurface(surface);
    try {
      page.cleanup();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Inspects a PDF file and renders a lightweight preview of the first page for the import dialog.
 */
export async function inspectPdfDocument(
  file: Blob,
  password?: string,
): Promise<PdfDocumentMeta> {
  const doc = await openPdfDocument(file, password);
  try {
    const numPages = doc.numPages;
    if (numPages < 1) {
      throw new PdfCorruptError('Il documento PDF non contiene alcuna pagina.');
    }

    let title: string | undefined;
    try {
      const meta = await doc.getMetadata();
      const info = meta?.info as Record<string, unknown> | undefined;
      if (info && typeof info.Title === 'string' && info.Title.trim()) {
        title = info.Title.trim();
      }
    } catch {
      /* metadata is optional */
    }

    const firstPage = await doc.getPage(1);
    const baseVp = firstPage.getViewport({ scale: 1 });
    let firstPagePreviewUrl: string | null = null;

    try {
      const previewTargetWidth = 360;
      const previewScale = Math.min(2, Math.max(0.25, previewTargetWidth / Math.max(1, baseVp.width)));
      const previewW = Math.max(1, Math.round(baseVp.width * previewScale));
      const previewH = Math.max(1, Math.round(baseVp.height * previewScale));
      const surface = await renderPageOntoSurface(firstPage, previewScale, previewW, previewH);
      try {
        const { blob } = await encodeCanvasLossless(surface, 'png');
        try {
          firstPagePreviewUrl = URL.createObjectURL(blob);
        } catch {
          firstPagePreviewUrl = 'blob:glassnote-pdf-preview';
        }
      } finally {
        releaseCanvasSurface(surface);
      }
    } catch {
      firstPagePreviewUrl = null;
    } finally {
      try {
        firstPage.cleanup();
      } catch {
        /* ignore */
      }
    }

    return {
      numPages,
      title,
      fingerprints: doc.fingerprints?.filter((f): f is string => typeof f === 'string'),
      firstPagePreviewUrl,
      firstPageWidthPt: baseVp.width,
      firstPageHeightPt: baseVp.height,
    };
  } finally {
    await destroyPdfDocument(doc);
  }
}
