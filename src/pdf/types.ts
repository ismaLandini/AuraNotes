import type { ID, Point } from '../types';

export type PdfQualityPreset = 'standard' | 'high' | 'maximum';
export type PdfLosslessFormat = 'png' | 'webp';
export type PdfInsertMode = 'single-container' | 'one-per-container';

export interface PdfQualitySpec {
  preset: PdfQualityPreset;
  label: string;
  dpi: number;
  minShortSidePx: number;
  description: string;
}

export const PDF_QUALITY_PRESETS: Record<PdfQualityPreset, PdfQualitySpec> = {
  standard: {
    preset: 'standard',
    label: 'Standard (150 DPI)',
    dpi: 150,
    minShortSidePx: 0,
    description: 'Buona nitidezza, file più leggeri',
  },
  high: {
    preset: 'high',
    label: 'Alta (220 DPI · consigliata)',
    dpi: 220,
    minShortSidePx: 2000,
    description: 'Testo e formule nitidissimi anche con zoom elevato (min 2000 px lato corto)',
  },
  maximum: {
    preset: 'maximum',
    label: 'Massima (300 DPI)',
    dpi: 300,
    minShortSidePx: 0,
    description: 'Qualità da stampa tipografica per tavole tecniche e grafici densi',
  },
};

export interface CanvasLimits {
  maxSide: number;
  maxArea: number;
}

export interface PageScaleResult {
  /** Requested scale before browser canvas clamping. */
  requestedScale: number;
  /** Effective scale used for rendering (may be clamped if page exceeds browser canvas limits). */
  effectiveScale: number;
  /** Target pixel width (integer >= 1). */
  width: number;
  /** Target pixel height (integer >= 1). */
  height: number;
  /** Effective DPI after any minShortSide boost or canvas limit clamp. */
  effectiveDpi: number;
  /** True when the page exceeded browser canvas limits and was clamped/tiled. */
  clampedByCanvasLimit: boolean;
  /** Optional tiling grid when rendering large formats in tiles before compositing. */
  tiles?: Array<{ x: number; y: number; w: number; h: number }>;
}

export interface PdfDocumentMeta {
  numPages: number;
  title?: string;
  fingerprints?: string[];
  firstPagePreviewUrl: string | null;
  firstPageWidthPt: number;
  firstPageHeightPt: number;
}

export interface RenderedPdfPage {
  pageNumber: number;
  blob: Blob;
  hash: string;
  width: number;
  height: number;
  widthPoints: number;
  heightPoints: number;
  mime: 'image/png' | 'image/webp';
  clampedByCanvasLimit: boolean;
  effectiveDpi: number;
}

export interface PdfImportTarget {
  /** Drop or paste point on canvas (world coordinates). */
  at?: Point;
  /** Target NoteContainer ID if dropped or pasted inside an existing container. */
  containerId?: ID;
  /** Insertion index within the target container's document flow. */
  insertIndex?: number;
}

export interface PdfImportOptions {
  file: File | Blob;
  fileName?: string;
  pages?: number[]; // 1-based page numbers in order (defaults to all pages)
  quality: PdfQualityPreset;
  format?: PdfLosslessFormat;
  mode: PdfInsertMode;
  password?: string;
  target?: PdfImportTarget;
  at?: Point;
  targetContainerId?: ID;
  insertIndex?: number;
  canvasLimits?: CanvasLimits;
  skipQuotaCheck?: boolean;
  onProgress?: (progress: PdfImportProgress) => void;
  signal?: AbortSignal;
}

export interface PdfImportProgress {
  completedPages: number;
  totalPages: number;
  currentPage: number;
  clampedPages: number[];
  peakMemoryBytes: number;
}

export interface PdfImportResult {
  pdfAssetId: ID;
  pdfDeduplicated: boolean;
  importedPages: number;
  totalRequested: number;
  cancelled: boolean;
  clampedPages: number[];
  containerIds: ID[];
  pageAssetIds: ID[];
  peakMemoryBytes: number;
}
