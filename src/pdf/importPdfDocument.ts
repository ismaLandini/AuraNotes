import type { ID, PageContent, SheetDef } from '../types';
import { SCHEMA_VERSION } from '../types';
import { newId } from '../model/workspaceOps';
import * as W from '../model/workspaceOps';
import { importAssetBlob } from '../storage/assets';
import { destroyPdfDocument, openPdfDocument } from './renderer';
import { A4_WIDTH } from '../lib/page';
import { useStore } from '../store/useStore';
import { flush } from '../storage/autosave';

export interface ImportPdfDocumentResult {
  pageId: ID;
  title: string;
  sheetCount: number;
}

/**
 * Imports an entire PDF document into a single multi-sheet Page within the specified section.
 * Each PDF page is preserved with its native aspect ratio and resolution.
 */
export async function importPdfAsDocument(
  file: File | Blob,
  fileName: string,
  sectionId: ID,
): Promise<ImportPdfDocumentResult> {
  const { assetId } = await importAssetBlob(file, 'application/pdf');
  const doc = await openPdfDocument(file);

  const sheets: SheetDef[] = [];
  const numPages = doc.numPages;

  try {
    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      const page = await doc.getPage(pageNum);
      const vp = page.getViewport({ scale: 1 });
      const isLandscape = vp.width > vp.height;

      let width: number;
      let height: number;

      if (isLandscape) {
        // Landscape (e.g. 16:9 slides): comfortable desk width of ~1040px
        width = 1040;
        height = Math.round(1040 * (vp.height / vp.width));
      } else {
        // Portrait (e.g. standard A4/Letter): match standard A4 width
        width = A4_WIDTH;
        height = Math.round(A4_WIDTH * (vp.height / vp.width));
      }

      sheets.push({
        id: newId(),
        width,
        height,
        type: 'pdf',
        pdfPage: pageNum,
        pdfAssetId: assetId,
      });
    }
  } finally {
    await destroyPdfDocument(doc);
  }

  const cleanTitle = fileName.replace(/\.pdf$/i, '').trim() || 'Documento PDF';
  const pid = newId();

  const pageContent: PageContent = {
    id: pid,
    schemaVersion: SCHEMA_VERSION,
    items: {},
    order: [],
    sheets,
    pdfAssetId: assetId,
  };

  const store = useStore.getState();
  store.mutateWorkspace((ws) =>
    W.setPageMeta(W.createPage(ws, sectionId, cleanTitle, pid), pid, {
      sheetCount: sheets.length,
      firstSheetType: 'pdf',
      pdfAssetId: assetId,
    }),
  );

  useStore.setState((s) => ({
    pages: { ...s.pages, [pid]: pageContent },
  }));

  store.markDirty(pid);
  await flush().catch(() => undefined);
  return { pageId: pid, title: cleanTitle, sheetCount: sheets.length };
}
