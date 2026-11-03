import { describe, expect, it } from 'vitest';
import {
  PdfCorruptError,
  PdfPasswordIncorrectError,
  PdfPasswordRequiredError,
  destroyPdfDocument,
  inspectPdfDocument,
  openPdfDocument,
  readPngDimensions,
  renderPdfPageToBlob,
} from './renderer';
import {
  createCorruptPdf,
  createHugeA0PosterPdf,
  createManyPagesPdf,
  createMixedSizesPdf,
  createPasswordProtectedPdf,
  createRasterScanPdf,
  createRotatedPagesPdf,
  createVectorFormulasPdf,
} from './pdfTestFixtures';
import { SAFARI_SAFE_CANVAS_LIMITS } from './scale';

function toBlob(bytes: Uint8Array): Blob {
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  return new Blob([ab], { type: 'application/pdf' });
}

describe('PDF renderer with pdfjs-dist', () => {
  it('opens and renders vector PDF with formulas at Standard (150), High (220, min 2000px), and Maximum (300) DPI', async () => {
    const pdfBytes = createVectorFormulasPdf(3);
    const meta = await inspectPdfDocument(toBlob(pdfBytes));
    expect(meta.numPages).toBe(3);
    expect(meta.firstPageWidthPt).toBe(720);
    expect(meta.firstPageHeightPt).toBe(405);

    const doc = await openPdfDocument(pdfBytes);
    try {
      // Standard: 150 DPI -> 720 * 150/72 = 1500, 405 * 150/72 = 843
      const stdPage = await renderPdfPageToBlob(doc, 1, 'standard', 'png');
      expect(stdPage.width).toBe(1500);
      expect(stdPage.height).toBe(843);
      expect(stdPage.mime).toBe('image/png');
      const pngDimsStd = await readPngDimensions(stdPage.blob);
      expect(pngDimsStd).toEqual({ width: 1500, height: 843 });

      // High: 220 DPI with min 2000px on short side (405 pt -> 2000 px, so width = floor(720 * 2000/405) = 3555 px)
      const highPage = await renderPdfPageToBlob(doc, 1, 'high', 'png');
      expect(Math.min(highPage.width, highPage.height)).toBe(2000);
      expect(highPage.width).toBe(Math.floor(720 * (2000 / 405)));

      // Maximum: 300 DPI -> 720 * 300/72 = 3000, 405 * 300/72 = 1687
      const maxPage = await renderPdfPageToBlob(doc, 1, 'maximum', 'png');
      expect(maxPage.width).toBe(3000);
      expect(maxPage.height).toBe(1687);
    } finally {
      await destroyPdfDocument(doc);
    }
  });

  it('renders raster scan PDF and WebP lossless alternative', async () => {
    const doc = await openPdfDocument(createRasterScanPdf());
    try {
      expect(doc.numPages).toBe(2);
      const p1 = await renderPdfPageToBlob(doc, 1, 'standard', 'webp');
      expect(p1.mime).toBe('image/webp');
      expect(p1.width).toBe(Math.floor(595 * (150 / 72)));
      expect(p1.height).toBe(Math.floor(842 * (150 / 72)));
    } finally {
      await destroyPdfDocument(doc);
    }
  });

  it('renders rotated pages (0, 90, 180, 270) with correct orientation and proportions', async () => {
    const doc = await openPdfDocument(createRotatedPagesPdf());
    try {
      expect(doc.numPages).toBe(4);
      const r0 = await renderPdfPageToBlob(doc, 1, 'standard', 'png');
      const r90 = await renderPdfPageToBlob(doc, 2, 'standard', 'png');
      const r180 = await renderPdfPageToBlob(doc, 3, 'standard', 'png');
      const r270 = await renderPdfPageToBlob(doc, 4, 'standard', 'png');

      // 0 and 180 are portrait (width < height)
      expect(r0.width).toBeLessThan(r0.height);
      expect(r180.width).toBe(r0.width);
      expect(r180.height).toBe(r0.height);

      // 90 and 270 are landscape (width > height, swapped)
      expect(r90.width).toBe(r0.height);
      expect(r90.height).toBe(r0.width);
      expect(r270.width).toBe(r0.height);
      expect(r270.height).toBe(r0.width);
    } finally {
      await destroyPdfDocument(doc);
    }
  });

  it('respects mixed page sizes and CropBox in the same document', async () => {
    const doc = await openPdfDocument(createMixedSizesPdf());
    try {
      expect(doc.numPages).toBe(4);
      const p1 = await renderPdfPageToBlob(doc, 1, 'standard', 'png'); // 595x842
      const p2 = await renderPdfPageToBlob(doc, 2, 'standard', 'png'); // 842x595
      const p3 = await renderPdfPageToBlob(doc, 3, 'standard', 'png'); // 960x540
      const p4 = await renderPdfPageToBlob(doc, 4, 'standard', 'png'); // CropBox [50, 50, 550, 750] => 500x700

      expect(p1.width).toBeLessThan(p1.height);
      expect(p2.width).toBeGreaterThan(p2.height);
      expect(p3.width / p3.height).toBeCloseTo(16 / 9, 2);
      expect(p4.width).toBe(Math.floor(500 * (150 / 72)));
      expect(p4.height).toBe(Math.floor(700 * (150 / 72)));
    } finally {
      await destroyPdfDocument(doc);
    }
  });

  it('handles huge A0 page (2384 x 3370 pt) by clamping/tiling within canvas limits and flagging clampedByCanvasLimit', async () => {
    const doc = await openPdfDocument(createHugeA0PosterPdf());
    try {
      const a0 = await renderPdfPageToBlob(doc, 1, 'high', 'png', SAFARI_SAFE_CANVAS_LIMITS);
      expect(a0.clampedByCanvasLimit).toBe(true);
      expect(a0.width * a0.height).toBeLessThanOrEqual(SAFARI_SAFE_CANVAS_LIMITS.maxArea);
      expect(a0.width / a0.height).toBeCloseTo(2384 / 3370, 2);
    } finally {
      await destroyPdfDocument(doc);
    }
  });

  it('handles password-protected PDFs (missing password, wrong password, and valid password)', async () => {
    const encryptedBytes = createPasswordProtectedPdf('glassnote');

    await expect(openPdfDocument(encryptedBytes)).rejects.toBeInstanceOf(PdfPasswordRequiredError);
    await expect(openPdfDocument(encryptedBytes, 'wrong-pass')).rejects.toBeInstanceOf(PdfPasswordIncorrectError);

    const unlocked = await openPdfDocument(encryptedBytes, 'glassnote');
    try {
      expect(unlocked.numPages).toBe(2);
      const p1 = await renderPdfPageToBlob(unlocked, 1, 'standard', 'png');
      expect(p1.width).toBeGreaterThan(1000);
    } finally {
      await destroyPdfDocument(unlocked);
    }
  });

  it('rejects corrupt or invalid PDFs with a clear PdfCorruptError', async () => {
    await expect(openPdfDocument(new Uint8Array([1, 2]))).rejects.toBeInstanceOf(PdfCorruptError);
    await expect(openPdfDocument(new TextEncoder().encode('NOT A PDF FILE'))).rejects.toBeInstanceOf(PdfCorruptError);
    await expect(openPdfDocument(createCorruptPdf())).rejects.toBeInstanceOf(PdfCorruptError);
  });

  it('opens 100+ page PDFs and renders pages on demand without loading all pages into memory', async () => {
    const doc = await openPdfDocument(createManyPagesPdf(105));
    try {
      expect(doc.numPages).toBe(105);
      const p105 = await renderPdfPageToBlob(doc, 105, 'standard', 'png');
      expect(p105.pageNumber).toBe(105);
      expect(p105.width).toBe(Math.floor(595 * (150 / 72)));
    } finally {
      await destroyPdfDocument(doc);
    }
  });
});
