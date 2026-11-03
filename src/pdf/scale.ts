import { PDF_QUALITY_PRESETS, type CanvasLimits, type PageScaleResult, type PdfLosslessFormat, type PdfQualityPreset } from './types';

export const PDF_POINTS_PER_INCH = 72;

/**
 * Conservative cross-browser canvas limits.
 * Safari/WebKit enforces a 16,777,216 px (4096 x 4096) maximum canvas area,
 * while Chromium/Firefox allow up to 16384 px per side.
 * Using 16,777,216 px area and 8192 px max side guarantees zero silent black canvases on macOS/Safari.
 */
export const SAFARI_SAFE_CANVAS_LIMITS: CanvasLimits = {
  maxSide: 8192,
  maxArea: 16_777_216, // 4096 * 4096
};

export const CHROMIUM_CANVAS_LIMITS: CanvasLimits = {
  maxSide: 16384,
  maxArea: 67_108_864, // 8192 * 8192
};

export function detectCanvasLimits(): CanvasLimits {
  if (typeof navigator !== 'undefined') {
    const ua = navigator.userAgent || '';
    const isSafari = /Safari/i.test(ua) && !/Chrome|Chromium|Edg/i.test(ua);
    if (isSafari) return SAFARI_SAFE_CANVAS_LIMITS;
  }
  return CHROMIUM_CANVAS_LIMITS;
}

/** Normalizes any PDF page rotation angle to 0, 90, 180, or 270 degrees. */
export function normalizeRotation(deg: number): 0 | 90 | 180 | 270 {
  const mod = ((Math.round(deg) % 360) + 360) % 360;
  if (mod === 90 || mod === 180 || mod === 270) return mod;
  return 0;
}

/**
 * Computes the effective rendering scale, pixel dimensions, DPI, and tiling grid
 * for a PDF page given its base dimensions in PDF points (at scale 1, before or after rotation).
 *
 * @param widthPt Base page width in PDF points (1/72 inch, already accounting for CropBox & UserUnit)
 * @param heightPt Base page height in PDF points
 * @param preset Quality preset ('standard' | 'high' | 'maximum')
 * @param rotation Page rotation in degrees (0, 90, 180, 270). If provided, swaps width/height on 90/270.
 * @param limits Browser canvas limits (maxSide and maxArea)
 */
export function computePageScale(
  widthPt: number,
  heightPt: number,
  preset: PdfQualityPreset = 'high',
  rotation = 0,
  limits: CanvasLimits = SAFARI_SAFE_CANVAS_LIMITS,
): PageScaleResult {
  const normRot = normalizeRotation(rotation);
  const rotatedWidthPt = normRot === 90 || normRot === 270 ? heightPt : widthPt;
  const rotatedHeightPt = normRot === 90 || normRot === 270 ? widthPt : heightPt;

  const safeW = Math.max(1, rotatedWidthPt);
  const safeH = Math.max(1, rotatedHeightPt);

  const spec = PDF_QUALITY_PRESETS[preset];
  let requestedScale = spec.dpi / PDF_POINTS_PER_INCH;

  // For 'high' (220 DPI): enforce minimum 2000 px on the short side of the page
  if (spec.minShortSidePx > 0) {
    const shortSidePt = Math.min(safeW, safeH);
    const shortSidePxAtBaseDpi = shortSidePt * requestedScale;
    if (shortSidePxAtBaseDpi < spec.minShortSidePx) {
      requestedScale = spec.minShortSidePx / shortSidePt;
    }
  }

  let effectiveScale = requestedScale;
  let clampedByCanvasLimit = false;

  const reqW = safeW * requestedScale;
  const reqH = safeH * requestedScale;

  // Clamp by maximum side length
  if (reqW > limits.maxSide || reqH > limits.maxSide) {
    const sideScale = Math.min(limits.maxSide / safeW, limits.maxSide / safeH);
    if (sideScale < effectiveScale) {
      effectiveScale = sideScale;
      clampedByCanvasLimit = true;
    }
  }

  // Clamp by maximum total pixel area
  const afterSideW = safeW * effectiveScale;
  const afterSideH = safeH * effectiveScale;
  if (afterSideW * afterSideH > limits.maxArea) {
    const areaFactor = Math.sqrt(limits.maxArea / (afterSideW * afterSideH));
    effectiveScale = effectiveScale * areaFactor;
    clampedByCanvasLimit = true;
  }

  const width = Math.max(1, Math.floor(safeW * effectiveScale));
  const height = Math.max(1, Math.floor(safeH * effectiveScale));
  const effectiveDpi = Math.round(effectiveScale * PDF_POINTS_PER_INCH);

  // Compute tiles if either dimension exceeds 2048px so large pages can be rendered in tiles if needed
  const maxTileSide = 2048;
  let tiles: Array<{ x: number; y: number; w: number; h: number }> | undefined;
  if (width > maxTileSide || height > maxTileSide) {
    tiles = [];
    for (let y = 0; y < height; y += maxTileSide) {
      for (let x = 0; x < width; x += maxTileSide) {
        tiles.push({
          x,
          y,
          w: Math.min(maxTileSide, width - x),
          h: Math.min(maxTileSide, height - y),
        });
      }
    }
  }

  return {
    requestedScale,
    effectiveScale,
    width,
    height,
    effectiveDpi,
    clampedByCanvasLimit,
    tiles,
  };
}

/**
 * Parses a human-readable page range string (e.g. "1-5, 8, 11-13" or "" for all pages)
 * into a sorted, deduplicated array of 1-based page numbers.
 */
export function parsePageRange(input: string, numPages: number): { pages: number[]; error?: string } {
  if (numPages < 1) return { pages: [], error: 'Il documento non contiene pagine.' };
  const trimmed = input.trim().toLowerCase();
  if (!trimmed || trimmed === 'tutte' || trimmed === 'all' || trimmed === '*') {
    return { pages: Array.from({ length: numPages }, (_, i) => i + 1) };
  }

  const result = new Set<number>();
  const parts = trimmed.split(/[,;]+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) {
    return { pages: Array.from({ length: numPages }, (_, i) => i + 1) };
  }

  for (const part of parts) {
    const rangeMatch = /^(\d+)\s*-\s*(\d+)$/.exec(part);
    if (rangeMatch) {
      const start = Number(rangeMatch[1]);
      const end = Number(rangeMatch[2]);
      if (start < 1 || end < 1 || start > numPages || end > numPages) {
        return { pages: [], error: `Intervallo "${part}" fuori limite (1–${numPages}).` };
      }
      if (start > end) {
        return { pages: [], error: `Intervallo "${part}" non valido: l’inizio supera la fine.` };
      }
      for (let p = start; p <= end; p++) result.add(p);
      continue;
    }

    const singleMatch = /^(\d+)$/.exec(part);
    if (singleMatch) {
      const page = Number(singleMatch[1]);
      if (page < 1 || page > numPages) {
        return { pages: [], error: `Pagina ${page} fuori limite (1–${numPages}).` };
      }
      result.add(page);
      continue;
    }

    return { pages: [], error: `Formato intervallo non valido: "${part}". Usa es. "1-5, 8".` };
  }

  return { pages: Array.from(result).sort((a, b) => a - b) };
}

/**
 * Conservative estimate of required IndexedDB storage bytes for a PDF import,
 * including the original PDF asset + lossless page images.
 */
export function estimatePdfImportBytes(
  pageCount: number,
  pdfByteSize: number,
  quality: PdfQualityPreset,
  format: PdfLosslessFormat,
): number {
  const perPagePngBytes =
    quality === 'standard'
      ? 450 * 1024
      : quality === 'high'
        ? 1100 * 1024
        : 2000 * 1024;
  const formatFactor = format === 'webp' ? 0.65 : 1.0;
  return Math.round(pdfByteSize + pageCount * perPagePngBytes * formatFactor);
}
