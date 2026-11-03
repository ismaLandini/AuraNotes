import type { JSONContent } from '@tiptap/core';
import type { ID, ImageBlockAttrs, NoteContainerItem, PageContent } from '../types';
import type {
  PdfImportOptions,
  PdfImportResult,
  PdfLosslessFormat,
  PdfQualityPreset,
} from './types';
import { estimatePdfImportBytes } from './scale';
import { destroyPdfDocument, openPdfDocument, renderPdfPageToBlob } from './renderer';
import { importAssetBlob, importImageBlob } from '../storage/assets';
import { requestPersistence, storageEstimate } from '../storage/db';
import { useStore } from '../store/useStore';
import * as P from '../model/pageOps';
import { newId } from '../model/workspaceOps';

export class PdfStorageQuotaError extends Error {
  readonly estimatedBytes: number;
  readonly availableBytes: number;
  constructor(message: string, estimatedBytes: number, availableBytes: number) {
    super(message);
    this.name = 'PdfStorageQuotaError';
    this.estimatedBytes = estimatedBytes;
    this.availableBytes = availableBytes;
  }
}

export interface StorageQuotaCheck {
  ok: boolean;
  estimatedBytes: number;
  availableBytes: number;
  persisted: boolean;
  warningMessage?: string;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

/**
 * Checks available storage via navigator.storage.estimate() and requests persistence
 * via navigator.storage.persist() before starting a PDF import.
 */
export async function checkPdfStorageQuota(
  pageCount: number,
  fileSize: number,
  quality: PdfQualityPreset,
  format: PdfLosslessFormat,
): Promise<StorageQuotaCheck> {
  const persisted = await requestPersistence().catch(() => false);
  const est = await storageEstimate().catch(() => null);
  const estimatedBytes = estimatePdfImportBytes(pageCount, fileSize, quality, format);

  if (!est || est.quota <= 0) {
    return {
      ok: true,
      estimatedBytes,
      availableBytes: Number.POSITIVE_INFINITY,
      persisted,
    };
  }

  const availableBytes = Math.max(0, est.quota - est.usage);
  if (estimatedBytes > availableBytes) {
    return {
      ok: false,
      estimatedBytes,
      availableBytes,
      persisted,
      warningMessage: `Spazio di archiviazione insufficiente: l’importazione richiede circa ${formatBytes(estimatedBytes)}, ma sono disponibili solo ${formatBytes(availableBytes)}.`,
    };
  }

  return {
    ok: true,
    estimatedBytes,
    availableBytes,
    persisted,
  };
}

async function readBlobBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') {
    const ab = await blob.arrayBuffer();
    return new Uint8Array(ab);
  }
  return new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error('Impossibile leggere il file PDF'));
    reader.readAsArrayBuffer(blob);
  });
}

function stripPdfExtension(fileName: string): string {
  const trimmed = fileName.trim() || 'Documento';
  return trimmed.replace(/\.pdf$/i, '') || 'Documento';
}

function getCurrentHeapBytes(): number {
  const perf = performance as unknown as { memory?: { usedJSHeapSize?: number } };
  if (perf?.memory && typeof perf.memory.usedJSHeapSize === 'number') {
    return perf.memory.usedJSHeapSize;
  }
  return 0;
}

export const DEFAULT_PDF_CONTAINER_WIDTH = 680;
export const DEFAULT_PDF_FREE_WIDTH = 640;
export const PDF_COLUMN_GAP = 28;

/**
 * Progressively imports a PDF document into the current GlassNote page.
 *
 * - Stores original PDF blob in IndexedDB (deduplicated by SHA-256 hash).
 * - Renders 1 page at a time at the selected DPI preset, encodes lossless PNG/WebP,
 *   releases canvas immediately, and stores each page blob in IndexedDB (deduplicated by SHA-256).
 * - Inserts standard `imageBlock` nodes with `source: { type: 'pdf', assetId, page }`
 *   and prefilled `alt: "<Nome file>, pagina N di M"`.
 * - Records a single undo step via `commitFrom(beforePage)` so one Cmd+Z undoes everything.
 */
export async function importPdfDocument(options: PdfImportOptions): Promise<PdfImportResult> {
  const st = useStore.getState();
  const targetPageId = st.pageId;
  const initialPage = st.currentPage();
  if (!targetPageId || !initialPage) {
    throw new Error('Apri o crea una pagina prima di importare un PDF.');
  }

  const rawFileName =
    options.fileName || (typeof File !== 'undefined' && options.file instanceof File ? options.file.name : 'Documento.pdf');
  const baseName = stripPdfExtension(rawFileName);
  const format: PdfLosslessFormat = options.format ?? 'png';

  const pdfBytes = await readBlobBytes(options.file);
  const doc = await openPdfDocument(pdfBytes, options.password);

  try {
    const totalDocPages = doc.numPages;
    const requestedPages =
      options.pages && options.pages.length > 0
        ? options.pages.filter((p) => Number.isInteger(p) && p >= 1 && p <= totalDocPages)
        : Array.from({ length: totalDocPages }, (_, i) => i + 1);

    if (requestedPages.length === 0) {
      throw new Error('Nessuna pagina valida selezionata per l’importazione.');
    }

    if (!options.skipQuotaCheck) {
      const quota = await checkPdfStorageQuota(requestedPages.length, options.file.size, options.quality, format);
      if (!quota.ok) {
        throw new PdfStorageQuotaError(
          quota.warningMessage ?? 'Spazio di archiviazione insufficiente per importare il PDF.',
          quota.estimatedBytes,
          quota.availableBytes,
        );
      }
    }

    // Exit active text editing so progressive updates to container docs are reflected cleanly.
    if (useStore.getState().editingId) {
      useStore.getState().setEditing(null);
    }

    // Snapshot page state BEFORE any modification so a single Cmd+Z undoes the entire import.
    const beforePage: PageContent = structuredClone(useStore.getState().pages[targetPageId] ?? initialPage);

    // Store original PDF in IndexedDB assets (deduplicated by SHA-256 content hash).
    const pdfBlob = new Blob([pdfBytes as unknown as BlobPart], { type: 'application/pdf' });
    const pdfAsset = await importAssetBlob(pdfBlob, 'application/pdf');

    const containerIds: ID[] = [];
    const pageAssetIds: ID[] = [];
    const clampedPages: number[] = [];
    let importedPages = 0;
    let cancelled = false;
    let peakMemoryBytes = getCurrentHeapBytes();

    const targetAt = options.target?.at ?? options.at;
    const resolvedTargetContainerId = options.target?.containerId ?? options.targetContainerId ?? null;
    const resolvedInsertIndex = options.target?.insertIndex ?? options.insertIndex;

    // State for 'single-container' mode
    let singleContainerId: ID | null = resolvedTargetContainerId;
    let insertCursor: number | undefined = resolvedInsertIndex;

    // State for 'one-per-container' mode
    const startX = Math.round(targetAt?.x ?? 76);
    let nextFreeY = Math.round(targetAt?.y ?? 96);

    for (let i = 0; i < requestedPages.length; i++) {
      if (options.signal?.aborted) {
        cancelled = true;
        break;
      }

      const pageNumber = requestedPages[i];
      peakMemoryBytes = Math.max(peakMemoryBytes, getCurrentHeapBytes());
      options.onProgress?.({
        currentPage: pageNumber,
        completedPages: i,
        totalPages: requestedPages.length,
        clampedPages: [...clampedPages],
        peakMemoryBytes,
      });

      const rendered = await renderPdfPageToBlob(
        doc,
        pageNumber,
        options.quality,
        format,
        options.canvasLimits,
      );

      if (options.signal?.aborted) {
        cancelled = true;
        break;
      }

      if (rendered.clampedByCanvasLimit) {
        clampedPages.push(pageNumber);
      }

      const storedImg = await importImageBlob(
        rendered.blob,
        {
          width: rendered.width,
          height: rendered.height,
        },
        rendered.hash,
      );
      pageAssetIds.push(storedImg.assetId);

      const altText = `${baseName}, pagina ${pageNumber} di ${totalDocPages}`;
      const aspectRatio = rendered.width / Math.max(1, rendered.height);

      if (options.mode === 'single-container') {
        useStore.getState().updatePage(
          (curPage) => {
            const existingTarget = singleContainerId ? curPage.items[singleContainerId] : undefined;
            if (existingTarget && (existingTarget.type === 'container' || existingTarget.type === 'text')) {
              const containerW = Math.max(240, existingTarget.w || DEFAULT_PDF_CONTAINER_WIDTH);
              const usefulW = Math.max(120, containerW - 24);
              const proportionalW = Math.round((rendered.widthPoints / 595.28) * usefulW);
              const displayW = Math.min(usefulW, Math.max(160, proportionalW));

              const content: JSONContent[] = existingTarget.doc.content ? [...existingTarget.doc.content] : [];
              const isSingleEmptyParagraph =
                importedPages === 0 &&
                insertCursor === undefined &&
                content.length === 1 &&
                content[0].type === 'paragraph' &&
                (!content[0].content || content[0].content.length === 0);

              const idx = isSingleEmptyParagraph
                ? 0
                : insertCursor !== undefined && insertCursor >= 0 && insertCursor <= content.length
                  ? insertCursor
                  : content.length;

              const prevNode = idx > 0 ? content[idx - 1] : undefined;
              const inheritedIndent = Number(prevNode?.attrs?.indent || 0);
              const indentedW = Math.max(80, displayW - inheritedIndent * 24);

              const blockAttrs: ImageBlockAttrs = {
                id: newId(),
                assetId: storedImg.assetId,
                width: indentedW,
                naturalWidth: rendered.width,
                naturalHeight: rendered.height,
                mime: rendered.mime,
                rotation: 0,
                alt: altText,
                indent: inheritedIndent,
                source: {
                  type: 'pdf',
                  assetId: pdfAsset.assetId,
                  page: pageNumber,
                },
              };

              const imageNode: JSONContent = { type: 'imageBlock', attrs: blockAttrs };
              const spacerParagraph: JSONContent = {
                type: 'paragraph',
                ...(inheritedIndent ? { attrs: { indent: inheritedIndent } } : {}),
              };

              if (isSingleEmptyParagraph) {
                content.splice(0, 1, imageNode, spacerParagraph);
                insertCursor = 2;
              } else {
                content.splice(idx, 0, imageNode, spacerParagraph);
                insertCursor = idx + 2;
              }

              const approxAddedH = Math.round(indentedW / aspectRatio) + 28;
              const updatedContainer: NoteContainerItem = {
                ...(existingTarget as NoteContainerItem),
                type: 'container',
                freeImage: false,
                w: containerW,
                h: Math.max(existingTarget.h, (existingTarget.h || 32) + approxAddedH),
                doc: {
                  type: 'doc',
                  content,
                },
              };
              if (!containerIds.includes(updatedContainer.id)) containerIds.push(updatedContainer.id);
              return P.updateItems(curPage, { [updatedContainer.id]: updatedContainer });
            }

            // Create a new container on the first page
            const newContainerId = newId();
            singleContainerId = newContainerId;
            containerIds.push(newContainerId);
            const containerW = DEFAULT_PDF_CONTAINER_WIDTH;
            const usefulW = containerW - 24;
            const proportionalW = Math.round((rendered.widthPoints / 595.28) * usefulW);
            const displayW = Math.min(usefulW, Math.max(160, proportionalW));
            const displayH = Math.max(40, Math.round(displayW / aspectRatio));

            const blockAttrs: ImageBlockAttrs = {
              id: newId(),
              assetId: storedImg.assetId,
              width: displayW,
              naturalWidth: rendered.width,
              naturalHeight: rendered.height,
              mime: rendered.mime,
              rotation: 0,
              alt: altText,
              indent: 0,
              source: {
                type: 'pdf',
                assetId: pdfAsset.assetId,
                page: pageNumber,
              },
            };

            const newContainer: NoteContainerItem = {
              id: newContainerId,
              type: 'container',
              x: startX,
              y: nextFreeY,
              w: containerW,
              h: displayH + 36,
              customW: true,
              variant: 'plain',
              doc: {
                type: 'doc',
                content: [
                  { type: 'imageBlock', attrs: blockAttrs },
                  { type: 'paragraph' },
                ],
              },
            };
            insertCursor = 2;
            return P.addItems(curPage, [newContainer]);
          },
          false,
          targetPageId,
        );
      } else {
        // Mode: 'one-per-container' (each page as a freeImage container in a vertical column)
        const proportionalW = Math.round((rendered.widthPoints / 595.28) * DEFAULT_PDF_FREE_WIDTH);
        const displayW = Math.min(960, Math.max(200, proportionalW));
        const displayH = Math.max(60, Math.round(displayW / aspectRatio));
        const freeId = newId();
        containerIds.push(freeId);

        const blockAttrs: ImageBlockAttrs = {
          id: newId(),
          assetId: storedImg.assetId,
          width: displayW,
          naturalWidth: rendered.width,
          naturalHeight: rendered.height,
          mime: rendered.mime,
          rotation: 0,
          alt: altText,
          indent: 0,
          source: {
            type: 'pdf',
            assetId: pdfAsset.assetId,
            page: pageNumber,
          },
        };

        const freeContainer: NoteContainerItem = {
          id: freeId,
          type: 'container',
          x: startX,
          y: nextFreeY,
          w: displayW,
          h: displayH,
          freeImage: true,
          variant: 'plain',
          doc: {
            type: 'doc',
            content: [{ type: 'imageBlock', attrs: blockAttrs }],
          },
        };

        nextFreeY += displayH + PDF_COLUMN_GAP;
        useStore.getState().updatePage((curPage) => P.addItems(curPage, [freeContainer]), false, targetPageId);
      }

      importedPages++;
      peakMemoryBytes = Math.max(peakMemoryBytes, getCurrentHeapBytes());
      options.onProgress?.({
        currentPage: pageNumber,
        completedPages: importedPages,
        totalPages: requestedPages.length,
        clampedPages: [...clampedPages],
        peakMemoryBytes,
      });

      // Yield to the macrotask queue so the UI stays responsive and renders progress
      if (i + 1 < requestedPages.length) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }

    if (importedPages > 0) {
      const store = useStore.getState();
      if (store.pageId === targetPageId) {
        store.commitFrom(beforePage);
        store.setSelection(containerIds);
        store.setTool('select');
      }
    } else {
      // Nothing was imported (e.g. aborted before page 1 finished); clean up unreferenced PDF asset
      await useStore.getState().garbageCollectAssets(true);
    }

    return {
      pdfAssetId: pdfAsset.assetId,
      pdfDeduplicated: pdfAsset.deduplicated,
      importedPages,
      totalRequested: requestedPages.length,
      cancelled,
      clampedPages,
      containerIds,
      pageAssetIds,
      peakMemoryBytes,
    };
  } finally {
    await destroyPdfDocument(doc);
  }
}
