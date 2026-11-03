import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { importPdfDocument, checkPdfStorageQuota } from './pdfImporter';
import {
  createVectorFormulasPdf,
  createRotatedPagesPdf,
  createManyPagesPdf,
  pdfBytesToFile,
} from './pdfTestFixtures';
import { clearAssetUrlCache } from '../storage/assets';
import { getAsset, listAssetIds, resetDBConnection } from '../storage/db';
import { buildBackup, remapBackup } from '../storage/backup';
import { useStore } from '../store/useStore';
import * as W from '../model/workspaceOps';
import * as P from '../model/pageOps';
import type { ImageBlockAttrs, NoteContainerItem } from '../types';

beforeEach(async () => {
  clearAssetUrlCache();
  await resetDBConnection();
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();

  let ws = W.emptyWorkspace();
  ws = W.createNotebook(ws, 'Quaderno', 'nb1');
  ws = W.createSection(ws, 'nb1', 'Sezione', 'sec1');
  ws = W.createPage(ws, 'sec1', 'Pagina Test', 'page1');
  const page = P.emptyPage('page1');

  useStore.setState({
    loaded: true,
    loadError: null,
    workspace: ws,
    notebookId: 'nb1',
    sectionId: 'sec1',
    pageId: 'page1',
    pages: { page1: page },
    history: { page1: { past: [], future: [] } },
    selection: [],
    editingId: null,
  });
});

describe('importPdfDocument', () => {
  it('imports a PDF in single-container mode with interleaved paragraphs, source metadata, and alt text', async () => {
    const file = pdfBytesToFile(createVectorFormulasPdf(), 'Slide Lezione 1.pdf');
    const result = await importPdfDocument({
      file,
      quality: 'standard',
      mode: 'single-container',
      at: { x: 80, y: 100 },
    });

    expect(result.cancelled).toBe(false);
    expect(result.importedPages).toBe(4);
    expect(result.containerIds).toHaveLength(1);

    const page = useStore.getState().currentPage()!;
    const container = page.items[result.containerIds[0]] as NoteContainerItem;
    expect(container).toBeDefined();
    expect(container.type).toBe('container');
    expect(container.freeImage).toBeFalsy();

    const content = container.doc.content ?? [];
    // 4 imageBlocks + 4 paragraphs (one after each page so user can type between pages)
    const imageNodes = content.filter((n) => n.type === 'imageBlock');
    const paragraphNodes = content.filter((n) => n.type === 'paragraph');
    expect(imageNodes).toHaveLength(4);
    expect(paragraphNodes).toHaveLength(4);

    for (let i = 0; i < 4; i++) {
      const attrs = imageNodes[i].attrs as ImageBlockAttrs;
      expect(attrs.alt).toBe(`Slide Lezione 1, pagina ${i + 1} di 4`);
      expect(attrs.source).toEqual({
        type: 'pdf',
        assetId: result.pdfAssetId,
        page: i + 1,
      });
      expect(attrs.naturalWidth).toBe(1500);
      expect(attrs.naturalHeight).toBe(843);
    }

    // Verify original PDF is stored in IndexedDB assets
    const pdfAsset = await getAsset(result.pdfAssetId);
    expect(pdfAsset).toBeDefined();
    expect(pdfAsset?.mime).toBe('application/pdf');
  });

  it('inserts PDF pages at the specified drop index inside an existing container', async () => {
    // Create an existing container with two paragraphs
    const existingContainer: NoteContainerItem = {
      id: 'c-existing',
      type: 'container',
      x: 80,
      y: 100,
      w: 600,
      h: 120,
      variant: 'plain',
      doc: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Prima nota' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'Seconda nota' }] },
        ],
      },
    };
    useStore.getState().updatePage((p) => P.addItems(p, [existingContainer]));

    const file = pdfBytesToFile(createVectorFormulasPdf(), 'Dispensa.pdf');
    const result = await importPdfDocument({
      file,
      quality: 'standard',
      mode: 'single-container',
      targetContainerId: 'c-existing',
      insertIndex: 1,
      pages: [1, 2],
    });

    expect(result.importedPages).toBe(2);
    const updated = useStore.getState().currentPage()!.items['c-existing'] as NoteContainerItem;
    const types = (updated.doc.content ?? []).map((n) => n.type);
    // Paragraph 1 -> Image 1 -> Spacer Paragraph -> Image 2 -> Spacer Paragraph -> Paragraph 2
    expect(types).toEqual([
      'paragraph',
      'imageBlock',
      'paragraph',
      'imageBlock',
      'paragraph',
      'paragraph',
    ]);
  });

  it('imports a PDF in one-per-container mode as freeImage objects arranged in a column and supports dragging into a container', async () => {
    const file = pdfBytesToFile(createRotatedPagesPdf(), 'Ruotate.pdf');
    const result = await importPdfDocument({
      file,
      quality: 'standard',
      mode: 'one-per-container',
      at: { x: 100, y: 120 },
    });

    expect(result.importedPages).toBe(4);
    expect(result.containerIds).toHaveLength(4);

    let page = useStore.getState().currentPage()!;
    const containers = result.containerIds.map((id) => page.items[id] as NoteContainerItem);
    for (let i = 0; i < containers.length; i++) {
      expect(containers[i].freeImage).toBe(true);
      expect(containers[i].x).toBe(100);
      if (i > 0) {
        expect(containers[i].y).toBeGreaterThan(containers[i - 1].y + containers[i - 1].h);
      }
    }

    // Drag page 2 into a text container
    const noteContainer: NoteContainerItem = {
      id: 'target-note',
      type: 'container',
      x: 500,
      y: 120,
      w: 600,
      h: 100,
      variant: 'plain',
      doc: P.textDocFromPlain('Appunti'),
    };
    useStore.getState().updatePage((p) => P.addItems(p, [noteContainer]));
    page = useStore.getState().currentPage()!;
    const freePage2 = page.items[result.containerIds[1]] as NoteContainerItem;
    const attrs2 = freePage2.doc.content![0].attrs as ImageBlockAttrs;

    useStore.getState().updatePage((p) => P.moveImageIntoContainer(p, freePage2.id, 'target-note', attrs2));
    page = useStore.getState().currentPage()!;
    expect(page.items[freePage2.id]).toBeUndefined();
    const targetAfter = page.items['target-note'] as NoteContainerItem;
    const movedBlock = targetAfter.doc.content?.find((n) => n.type === 'imageBlock');
    expect(movedBlock?.attrs?.source).toEqual({
      type: 'pdf',
      assetId: result.pdfAssetId,
      page: 2,
    });
  });

  it('deduplicates both the original PDF asset and rendered page blobs when importing the same PDF twice', async () => {
    const bytes = createVectorFormulasPdf();
    const file1 = pdfBytesToFile(bytes, 'Copia1.pdf');
    const file2 = pdfBytesToFile(bytes, 'Copia2.pdf');

    const res1 = await importPdfDocument({
      file: file1,
      quality: 'standard',
      mode: 'single-container',
    });
    const assetsAfterFirst = await listAssetIds();
    // 1 PDF + 4 distinct page PNGs = 5 assets
    expect(assetsAfterFirst).toHaveLength(5);

    const res2 = await importPdfDocument({
      file: file2,
      quality: 'standard',
      mode: 'one-per-container',
    });
    const assetsAfterSecond = await listAssetIds();

    expect(res2.pdfAssetId).toBe(res1.pdfAssetId);
    expect(res2.pageAssetIds).toEqual(res1.pageAssetIds);
    expect(assetsAfterSecond).toHaveLength(5);
  });

  it('supports progressive import of 110+ pages, mid-import cancellation via AbortController, and single Cmd+Z undo with asset cleanup', async () => {
    const file = pdfBytesToFile(createManyPagesPdf(110), 'Libro110.pdf');
    const abortController = new AbortController();
    const progressSteps: number[] = [];

    const result = await importPdfDocument({
      file,
      quality: 'standard',
      mode: 'single-container',
      signal: abortController.signal,
      onProgress: (p) => {
        progressSteps.push(p.completedPages);
        if (p.completedPages === 5) {
          abortController.abort();
        }
      },
    });

    expect(result.cancelled).toBe(true);
    expect(result.importedPages).toBe(5);
    expect(progressSteps).toContain(5);

    const pageAfterImport = useStore.getState().currentPage()!;
    expect(Object.keys(pageAfterImport.items)).toHaveLength(1);
    const assetsDuring = await listAssetIds();
    expect(assetsDuring.length).toBeGreaterThan(1);

    // Single Cmd+Z undoes the entire 5-page progressive import and garbage-collects orphan assets
    const undone = useStore.getState().undo();
    expect(undone).toBe(true);
    await useStore.getState().garbageCollectAssets(true);

    const pageAfterUndo = useStore.getState().currentPage()!;
    expect(Object.keys(pageAfterUndo.items)).toHaveLength(0);
    const assetsAfterUndo = await listAssetIds();
    expect(assetsAfterUndo).toHaveLength(0);
  });

  it('includes original PDF assets and remaps source.assetId in notebook backups', async () => {
    const file = pdfBytesToFile(createVectorFormulasPdf(), 'dispensa.pdf');
    const res = await importPdfDocument({
      file,
      quality: 'standard',
      mode: 'single-container',
      pages: [1],
    });

    const st = useStore.getState();
    const backup = await buildBackup(st.workspace, st.pages);
    const pdfBackupEntry = backup.assets.find((a) => a.id === res.pdfAssetId);
    expect(pdfBackupEntry).toBeDefined();
    expect(pdfBackupEntry?.mime).toBe('application/pdf');

    const remapped = remapBackup(backup);
    const remappedContainer = Object.values(remapped.pages[0].items)[0] as NoteContainerItem;
    const remappedBlock = remappedContainer.doc.content?.find((n) => n.type === 'imageBlock');
    const newPdfAssetId = remappedBlock?.attrs?.source?.assetId;
    expect(newPdfAssetId).toBeDefined();
    expect(newPdfAssetId).not.toBe(res.pdfAssetId);
    expect(remapped.assets.some((a) => a.id === newPdfAssetId && a.mime === 'application/pdf')).toBe(true);
  });

  it('checks storage quota before import', async () => {
    const check = await checkPdfStorageQuota(5, 100_000, 'high', 'png');
    expect(check.ok).toBe(true);
    expect(check.estimatedBytes).toBeGreaterThan(100_000);
  });
});
