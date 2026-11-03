import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
  getAsset,
  listAssetIds,
  loadPage,
  loadWorkspace,
  putAsset,
  resetDBConnection,
  saveAll,
} from '../db';
import { clearAssetUrlCache } from '../assets';
import {
  cleanDocAst,
  cleanupLegacyPdfRasterBlocks,
  getPreLegacyCleanupBackup,
  isLegacyPdfRasterBlock,
  restorePreLegacyCleanupBackup,
} from '../legacyCleanup';
import * as W from '../../model/workspaceOps';
import * as P from '../../model/pageOps';
import type { JSONContent } from '@tiptap/core';
import type { NoteContainerItem, PageContent, TextItem } from '../../types';

beforeEach(async () => {
  clearAssetUrlCache();
  await resetDBConnection();
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
});

function createTestWorkspace(pageId = 'p1', sectionId = 's1', notebookId = 'nb1') {
  let ws = W.emptyWorkspace();
  ws = W.createNotebook(ws, 'Fisica', notebookId);
  ws = W.createSection(ws, notebookId, 'Meccanica', sectionId);
  ws = W.createPage(ws, sectionId, 'Cinematica', pageId);
  return ws;
}

describe('Legacy PDF Raster Cleanup Utility', () => {
  it('correctly classifies legacy raster blocks vs live blocks and user images', () => {
    // Legacy raster block
    expect(
      isLegacyPdfRasterBlock({
        type: 'imageBlock',
        attrs: {
          assetId: 'raster-asset-123',
          source: { type: 'pdf', assetId: 'pdf-doc-123', page: 1 },
        },
      }),
    ).toBe(true);

    // Live vector PDF block (M2 format: assetId is empty string)
    expect(
      isLegacyPdfRasterBlock({
        type: 'imageBlock',
        attrs: {
          assetId: '',
          source: { type: 'pdf', assetId: 'pdf-doc-123', page: 1, mode: 'live' },
        },
      }),
    ).toBe(false);

    // Normal user image (no source attr)
    expect(
      isLegacyPdfRasterBlock({
        type: 'imageBlock',
        attrs: {
          assetId: 'user-photo-123',
        },
      }),
    ).toBe(false);

    // User image with non-pdf source
    expect(
      isLegacyPdfRasterBlock({
        type: 'imageBlock',
        attrs: {
          assetId: 'user-photo-123',
          source: { type: 'camera' },
        },
      }),
    ).toBe(false);

    // Other block types
    expect(isLegacyPdfRasterBlock({ type: 'paragraph' })).toBe(false);
  });

  it('1. purges legacy raster PDF blocks and empty freeImage containers', async () => {
    const ws = createTestWorkspace('p1');
    const legacyBlock = {
      type: 'imageBlock',
      attrs: {
        assetId: 'raster-1',
        source: { type: 'pdf', assetId: 'pdf-1', page: 1 },
        width: 600,
        naturalWidth: 1200,
        naturalHeight: 800,
      },
    };
    const container: NoteContainerItem = {
      id: 'c1',
      type: 'container',
      x: 50,
      y: 50,
      w: 600,
      h: 400,
      freeImage: true,
      doc: {
        type: 'doc',
        content: [legacyBlock],
      },
    };
    const page: PageContent = P.addItems(P.emptyPage('p1'), [container]);

    await putAsset({
      id: 'raster-1',
      blob: new Blob(['png-bytes'], { type: 'image/png' }),
      mime: 'image/png',
      createdAt: 1,
    });
    await putAsset({
      id: 'pdf-1',
      blob: new Blob(['pdf-bytes'], { type: 'application/pdf' }),
      mime: 'application/pdf',
      createdAt: 1,
    });
    await saveAll(ws, [page]);

    const result = await cleanupLegacyPdfRasterBlocks();
    expect(result.pagesScanned).toBe(1);
    expect(result.blocksRemoved).toBe(1);
    expect(result.orphanAssetsReclaimed).toBe(2);
    expect(result.modifiedPageIds).toEqual(['p1']);

    const updatedPage = await loadPage('p1');
    expect(updatedPage?.items.c1).toBeUndefined();
    expect(updatedPage?.order).not.toContain('c1');

    const remainingAssets = await listAssetIds();
    expect(remainingAssets).toEqual([]);
  });

  it('2. preserves user notes in mixed containers', async () => {
    const ws = createTestWorkspace('p1');
    const legacyBlock = {
      type: 'imageBlock',
      attrs: {
        assetId: 'raster-1',
        source: { type: 'pdf', assetId: 'pdf-1', page: 1 },
        width: 600,
        naturalWidth: 1200,
        naturalHeight: 800,
      },
    };
    const container: NoteContainerItem = {
      id: 'c1',
      type: 'container',
      x: 50,
      y: 50,
      w: 600,
      h: 500,
      doc: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Appunti Lezione 1' }] },
          legacyBlock,
          { type: 'paragraph' }, // empty spacer
          { type: 'paragraph', content: [{ type: 'text', text: 'Domande d esame importanti' }] },
        ],
      },
    };
    const page: PageContent = P.addItems(P.emptyPage('p1'), [container]);

    await putAsset({
      id: 'raster-1',
      blob: new Blob(['png-bytes'], { type: 'image/png' }),
      mime: 'image/png',
      createdAt: 1,
    });
    await saveAll(ws, [page]);

    const result = await cleanupLegacyPdfRasterBlocks();
    expect(result.blocksRemoved).toBe(1);
    expect(result.orphanAssetsReclaimed).toBe(1);

    const updatedPage = await loadPage('p1');
    expect(updatedPage?.items.c1).toBeDefined();

    const updatedContainer = updatedPage?.items.c1 as NoteContainerItem;
    const content = updatedContainer.doc.content || [];
    expect(content.some((n) => n.type === 'imageBlock')).toBe(false);

    // Verify user notes were preserved
    const texts = content
      .flatMap((n) => n.content || [])
      .filter((n) => n.type === 'text')
      .map((n) => n.text);
    expect(texts).toContain('Appunti Lezione 1');
    expect(texts).toContain('Domande d esame importanti');
  });

  it('3. does NOT modify or delete normal user images', async () => {
    const ws = createTestWorkspace('p1');
    const userImageBlock = {
      type: 'imageBlock',
      attrs: {
        assetId: 'user-photo-1',
        width: 400,
        naturalWidth: 800,
        naturalHeight: 600,
      },
    };
    const container: NoteContainerItem = {
      id: 'c1',
      type: 'container',
      x: 20,
      y: 20,
      w: 400,
      h: 300,
      freeImage: true,
      doc: {
        type: 'doc',
        content: [userImageBlock],
      },
    };
    const page: PageContent = P.addItems(P.emptyPage('p1'), [container]);

    await putAsset({
      id: 'user-photo-1',
      blob: new Blob(['photo-bytes'], { type: 'image/jpeg' }),
      mime: 'image/jpeg',
      createdAt: 1,
    });
    await saveAll(ws, [page]);

    const result = await cleanupLegacyPdfRasterBlocks();
    expect(result.blocksRemoved).toBe(0);
    expect(result.orphanAssetsReclaimed).toBe(0);
    expect(result.modifiedPageIds).toEqual([]);

    const updatedPage = await loadPage('p1');
    expect(updatedPage?.items.c1).toBeDefined();

    const storedAsset = await getAsset('user-photo-1');
    expect(storedAsset).toBeDefined();
  });

  it('4. does NOT modify or delete live vector PDF blocks (M2 format)', async () => {
    const ws = createTestWorkspace('p1');
    const livePdfBlock = {
      type: 'imageBlock',
      attrs: {
        assetId: '',
        source: { type: 'pdf', assetId: 'pdf-vector-1', page: 1, mode: 'live' },
        width: 600,
        naturalWidth: 1200,
        naturalHeight: 800,
      },
    };
    const container: NoteContainerItem = {
      id: 'c1',
      type: 'container',
      x: 30,
      y: 30,
      w: 600,
      h: 400,
      freeImage: true,
      doc: {
        type: 'doc',
        content: [livePdfBlock],
      },
    };
    const page: PageContent = P.addItems(P.emptyPage('p1'), [container]);

    await putAsset({
      id: 'pdf-vector-1',
      blob: new Blob(['pdf-bytes'], { type: 'application/pdf' }),
      mime: 'application/pdf',
      createdAt: 1,
    });
    await saveAll(ws, [page]);

    const result = await cleanupLegacyPdfRasterBlocks();
    expect(result.blocksRemoved).toBe(0);
    expect(result.orphanAssetsReclaimed).toBe(0);
    expect(result.modifiedPageIds).toEqual([]);

    const updatedPage = await loadPage('p1');
    expect(updatedPage?.items.c1).toBeDefined();

    const storedPdf = await getAsset('pdf-vector-1');
    expect(storedPdf).toBeDefined();
  });

  it('5. is completely idempotent on multiple consecutive runs', async () => {
    const ws = createTestWorkspace('p1');
    const page: PageContent = P.addItems(P.emptyPage('p1'), [
      {
        id: 'c1',
        type: 'container',
        x: 0,
        y: 0,
        w: 500,
        h: 400,
        freeImage: true,
        doc: {
          type: 'doc',
          content: [
            {
              type: 'imageBlock',
              attrs: {
                assetId: 'raster-a',
                source: { type: 'pdf', assetId: 'pdf-doc', page: 1 },
              },
            },
          ],
        },
      },
      {
        id: 'c2',
        type: 'container',
        x: 0,
        y: 450,
        w: 500,
        h: 400,
        freeImage: true,
        doc: {
          type: 'doc',
          content: [
            {
              type: 'imageBlock',
              attrs: {
                assetId: 'raster-b',
                source: { type: 'pdf', assetId: 'pdf-doc', page: 2 },
              },
            },
          ],
        },
      },
    ]);

    await putAsset({
      id: 'raster-a',
      blob: new Blob(['a'], { type: 'image/png' }),
      mime: 'image/png',
      createdAt: 1,
    });
    await putAsset({
      id: 'raster-b',
      blob: new Blob(['b'], { type: 'image/png' }),
      mime: 'image/png',
      createdAt: 1,
    });
    await putAsset({
      id: 'pdf-doc',
      blob: new Blob(['pdf'], { type: 'application/pdf' }),
      mime: 'application/pdf',
      createdAt: 1,
    });
    await saveAll(ws, [page]);

    // First run: cleans both legacy blocks and reclaims 3 assets
    const res1 = await cleanupLegacyPdfRasterBlocks();
    expect(res1.blocksRemoved).toBe(2);
    expect(res1.orphanAssetsReclaimed).toBe(3);

    // Second run: no-op, fully idempotent
    const res2 = await cleanupLegacyPdfRasterBlocks();
    expect(res2.pagesScanned).toBe(1);
    expect(res2.blocksRemoved).toBe(0);
    expect(res2.orphanAssetsReclaimed).toBe(0);
    expect(res2.modifiedPageIds).toEqual([]);
  });

  it('6. creates an automatic pre-cleanup snapshot in kv.pre_legacy_cleanup_backup', async () => {
    const ws = createTestWorkspace('p1');
    const container: NoteContainerItem = {
      id: 'c1',
      type: 'container',
      x: 10,
      y: 10,
      w: 400,
      h: 300,
      freeImage: true,
      doc: {
        type: 'doc',
        content: [
          {
            type: 'imageBlock',
            attrs: {
              assetId: 'raster-x',
              source: { type: 'pdf', assetId: 'pdf-x', page: 1 },
            },
          },
        ],
      },
    };
    const page: PageContent = P.addItems(P.emptyPage('p1'), [container]);

    await putAsset({
      id: 'raster-x',
      blob: new Blob(['x'], { type: 'image/png' }),
      mime: 'image/png',
      createdAt: 1,
    });
    await saveAll(ws, [page]);

    // Pre-cleanup backup should not exist before running
    expect(await getPreLegacyCleanupBackup()).toBeUndefined();

    await cleanupLegacyPdfRasterBlocks();

    // Verify backup was created
    const backup = await getPreLegacyCleanupBackup();
    expect(backup).toBeDefined();
    expect(backup?.blocksRemovedTotal).toBe(1);
    expect(backup?.pages.length).toBe(1);
    expect(backup?.pages[0].items.c1).toBeDefined();
    expect(backup?.backedUpAt).toBeGreaterThan(0);
  });

  it('7. handles multi-page documents and mixed modes', async () => {
    let ws = W.emptyWorkspace();
    ws = W.createNotebook(ws, 'Quaderno 1', 'nb1');
    ws = W.createSection(ws, 'nb1', 'Sezione 1', 's1');
    ws = W.createPage(ws, 's1', 'Pagina 1', 'p1');
    ws = W.createPage(ws, 's1', 'Pagina 2', 'p2');
    ws = W.createPage(ws, 's1', 'Pagina 3', 'p3');

    // Page 1: Single container with 2 legacy PDF pages + spacers
    const page1: PageContent = P.addItems(P.emptyPage('p1'), [
      {
        id: 'c1',
        type: 'container',
        x: 0,
        y: 0,
        w: 600,
        h: 800,
        doc: {
          type: 'doc',
          content: [
            {
              type: 'imageBlock',
              attrs: { assetId: 'r1', source: { type: 'pdf', assetId: 'pdf-shared', page: 1 } },
            },
            { type: 'paragraph' },
            {
              type: 'imageBlock',
              attrs: { assetId: 'r2', source: { type: 'pdf', assetId: 'pdf-shared', page: 2 } },
            },
            { type: 'paragraph' },
          ],
        },
      },
    ]);

    // Page 2: 2 freeImage containers
    const page2: PageContent = P.addItems(P.emptyPage('p2'), [
      {
        id: 'c2a',
        type: 'container',
        x: 0,
        y: 0,
        w: 500,
        h: 300,
        freeImage: true,
        doc: {
          type: 'doc',
          content: [
            {
              type: 'imageBlock',
              attrs: { assetId: 'r3', source: { type: 'pdf', assetId: 'pdf-shared', page: 3 } },
            },
          ],
        },
      },
      {
        id: 'c2b',
        type: 'container',
        x: 0,
        y: 350,
        w: 500,
        h: 300,
        freeImage: true,
        doc: {
          type: 'doc',
          content: [
            {
              type: 'imageBlock',
              attrs: { assetId: 'r4', source: { type: 'pdf', assetId: 'pdf-shared', page: 4 } },
            },
          ],
        },
      },
    ]);

    // Page 3: Pure text page with handwritten notes (strokes)
    const page3: PageContent = P.addItems(P.emptyPage('p3'), [
      {
        id: 'text1',
        type: 'text',
        x: 10,
        y: 10,
        w: 300,
        h: 100,
        doc: P.textDocFromPlain('Appunti scritti a mano'),
        variant: 'plain',
      },
      {
        id: 'stroke1',
        type: 'stroke',
        points: [10, 20, 30, 40],
        color: '#ff0000',
        width: 3,
        opacity: 1,
        tool: 'pen',
      },
    ]);

    for (const id of ['r1', 'r2', 'r3', 'r4']) {
      await putAsset({
        id,
        blob: new Blob([id], { type: 'image/png' }),
        mime: 'image/png',
        createdAt: 1,
      });
    }
    await putAsset({
      id: 'pdf-shared',
      blob: new Blob(['pdf-shared'], { type: 'application/pdf' }),
      mime: 'application/pdf',
      createdAt: 1,
    });
    await saveAll(ws, [page1, page2, page3]);

    const result = await cleanupLegacyPdfRasterBlocks();
    expect(result.pagesScanned).toBe(3);
    expect(result.blocksRemoved).toBe(4);
    expect(result.orphanAssetsReclaimed).toBe(5); // r1, r2, r3, r4 and pdf-shared
    expect(result.modifiedPageIds.sort()).toEqual(['p1', 'p2']);

    const updatedP3 = await loadPage('p3');
    expect(updatedP3?.items.text1).toBeDefined();
    expect(updatedP3?.items.stroke1).toBeDefined();
  });

  it('8. supports dryRun mode without modifying DB or deleting assets', async () => {
    const ws = createTestWorkspace('p1');
    const container: NoteContainerItem = {
      id: 'c1',
      type: 'container',
      x: 0,
      y: 0,
      w: 400,
      h: 300,
      freeImage: true,
      doc: {
        type: 'doc',
        content: [
          {
            type: 'imageBlock',
            attrs: {
              assetId: 'raster-dry',
              source: { type: 'pdf', assetId: 'pdf-dry', page: 1 },
            },
          },
        ],
      },
    };
    const page: PageContent = P.addItems(P.emptyPage('p1'), [container]);

    await putAsset({
      id: 'raster-dry',
      blob: new Blob(['data'], { type: 'image/png' }),
      mime: 'image/png',
      createdAt: 1,
    });
    await putAsset({
      id: 'pdf-dry',
      blob: new Blob(['pdf'], { type: 'application/pdf' }),
      mime: 'application/pdf',
      createdAt: 1,
    });
    await saveAll(ws, [page]);

    const result = await cleanupLegacyPdfRasterBlocks({ dryRun: true });
    expect(result.blocksRemoved).toBe(1);
    expect(result.orphanAssetsReclaimed).toBe(0);
    expect(result.modifiedPageIds).toEqual(['p1']);

    // Check that DB is untouched
    const pageAfter = await loadPage('p1');
    expect(pageAfter?.items.c1).toBeDefined();

    const storedAssets = await listAssetIds();
    expect(storedAssets.sort()).toEqual(['pdf-dry', 'raster-dry']);

    expect(await getPreLegacyCleanupBackup()).toBeUndefined();
  });

  it('9. cleans up dangling connectors and annotations attached to removed containers', async () => {
    const ws = createTestWorkspace('p1');
    const legacyContainer: NoteContainerItem = {
      id: 'c1',
      type: 'container',
      x: 0,
      y: 0,
      w: 400,
      h: 300,
      freeImage: true,
      doc: {
        type: 'doc',
        content: [
          {
            type: 'imageBlock',
            attrs: {
              assetId: 'raster-conn',
              source: { type: 'pdf', assetId: 'pdf-conn', page: 1 },
            },
          },
        ],
      },
    };
    const noteContainer: NoteContainerItem = {
      id: 'c2',
      type: 'container',
      x: 500,
      y: 0,
      w: 300,
      h: 200,
      doc: P.textDocFromPlain('Osservazioni sulle slide'),
    };

    const page: PageContent = P.addItems(P.emptyPage('p1'), [
      legacyContainer,
      noteContainer,
      {
        id: 'stroke-ann',
        type: 'stroke',
        parentId: 'c1',
        points: [0.1, 0.2, 0.3, 0.4],
        color: '#ff0000',
        width: 2,
        opacity: 1,
        tool: 'pen',
      },
      {
        id: 'conn1',
        type: 'connector',
        fromId: 'c1',
        toId: 'c2',
        fromAnchor: 'auto',
        toAnchor: 'auto',
        arrow: 'end',
        color: '#0000ff',
        width: 2,
        layer: 'back',
      },
    ]);

    await putAsset({
      id: 'raster-conn',
      blob: new Blob(['raster'], { type: 'image/png' }),
      mime: 'image/png',
      createdAt: 1,
    });
    await putAsset({
      id: 'pdf-conn',
      blob: new Blob(['pdf'], { type: 'application/pdf' }),
      mime: 'application/pdf',
      createdAt: 1,
    });
    await saveAll(ws, [page]);

    await cleanupLegacyPdfRasterBlocks();

    const updated = await loadPage('p1');
    expect(updated?.items.c1).toBeUndefined();
    expect(updated?.items['stroke-ann']).toBeUndefined();
    expect(updated?.items.conn1).toBeUndefined();

    // Container c2 must be intact
    expect(updated?.items.c2).toBeDefined();
  });

  it('10. synchronizes page search text in kv.workspace', async () => {
    let ws = createTestWorkspace('p1');
    const legacyBlock = {
      type: 'imageBlock',
      attrs: {
        assetId: 'raster-search',
        source: { type: 'pdf', assetId: 'pdf-search', page: 1 },
        alt: 'Algoritmi e Strutture Dati, pagina 1 di 45',
      },
    };
    const container: NoteContainerItem = {
      id: 'c1',
      type: 'container',
      x: 0,
      y: 0,
      w: 600,
      h: 400,
      freeImage: true,
      doc: {
        type: 'doc',
        content: [legacyBlock],
      },
    };
    const page: PageContent = P.addItems(P.emptyPage('p1'), [container]);

    // Initial search text in workspace includes the alt text
    ws = {
      ...ws,
      pages: {
        ...ws.pages,
        p1: {
          ...ws.pages.p1,
          searchText: 'Algoritmi e Strutture Dati, pagina 1 di 45',
        },
      },
    };

    await putAsset({
      id: 'raster-search',
      blob: new Blob(['img'], { type: 'image/png' }),
      mime: 'image/png',
      createdAt: 1,
    });
    await putAsset({
      id: 'pdf-search',
      blob: new Blob(['pdf'], { type: 'application/pdf' }),
      mime: 'application/pdf',
      createdAt: 1,
    });
    await saveAll(ws, [page]);

    await cleanupLegacyPdfRasterBlocks();

    const loadedWs = await loadWorkspace();
    const updatedSearchText = loadedWs?.pages.p1.searchText;
    expect(updatedSearchText).not.toContain('Algoritmi e Strutture Dati');
    expect(updatedSearchText).toBe('');
  });

  it('cleanDocAst handles nested doc nodes and preserves surrounding content', () => {
    const ast = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Titolo Sezione' }],
        },
        {
          type: 'imageBlock',
          attrs: {
            assetId: 'r1',
            source: { type: 'pdf', assetId: 'pdf1', page: 1 },
          },
        },
        {
          type: 'paragraph',
          content: [],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Nota successiva' }],
        },
      ],
    };

    const { cleanedDoc, removedCount } = cleanDocAst(ast);
    expect(removedCount).toBe(1);
    expect(cleanedDoc.content?.length).toBe(2);
    expect(cleanedDoc.content?.[0].type).toBe('heading');
    expect(cleanedDoc.content?.[1].type).toBe('paragraph');
  });

  it('correctly handles null, undefined, primitives, and malformed objects in isLegacyPdfRasterBlock and cleanDocAst', () => {
    expect(isLegacyPdfRasterBlock(null)).toBe(false);
    expect(isLegacyPdfRasterBlock(undefined)).toBe(false);
    expect(isLegacyPdfRasterBlock('' as unknown as JSONContent)).toBe(false);
    expect(isLegacyPdfRasterBlock(42 as unknown as JSONContent)).toBe(false);
    expect(isLegacyPdfRasterBlock({} as unknown as JSONContent)).toBe(false);
    expect(isLegacyPdfRasterBlock({ type: 'imageBlock' })).toBe(false);
    expect(isLegacyPdfRasterBlock({ type: 'imageBlock', attrs: null as unknown as Record<string, unknown> })).toBe(false);

    expect(cleanDocAst(null as unknown as JSONContent)).toEqual({ cleanedDoc: null, removedCount: 0 });
    expect(cleanDocAst(undefined as unknown as JSONContent)).toEqual({ cleanedDoc: undefined, removedCount: 0 });
    expect(cleanDocAst({ type: 'doc', content: [null as unknown as JSONContent] })).toEqual({
      cleanedDoc: { type: 'doc', content: [null] },
      removedCount: 0,
    });
  });

  it('restorePreLegacyCleanupBackup returns false if no pre-cleanup backup exists', async () => {
    const res = await restorePreLegacyCleanupBackup();
    expect(res).toEqual({ restored: false, pagesRestored: 0 });
  });

  it('restorePreLegacyCleanupBackup performs full atomic rollback of modified containers, deleted containers, and workspace search text', async () => {
    let ws = createTestWorkspace('p1');
    const legacyBlock = {
      type: 'imageBlock',
      attrs: {
        assetId: 'r1',
        source: { type: 'pdf', assetId: 'pdf1', page: 1 },
      },
    };
    const c1: NoteContainerItem = {
      id: 'c1',
      type: 'container',
      x: 0,
      y: 0,
      w: 400,
      h: 300,
      freeImage: true,
      doc: { type: 'doc', content: [legacyBlock] },
    };
    const c2: NoteContainerItem = {
      id: 'c2',
      type: 'container',
      x: 0,
      y: 350,
      w: 400,
      h: 300,
      doc: {
        type: 'doc',
        content: [
          legacyBlock,
          { type: 'paragraph', content: [{ type: 'text', text: 'Preserved Note' }] },
        ],
      },
    };

    const page = P.addItems(P.emptyPage('p1'), [c1, c2]);
    ws = {
      ...ws,
      pages: {
        ...ws.pages,
        p1: {
          ...ws.pages.p1,
          searchText: 'Original search text',
        },
      },
    };

    await putAsset({
      id: 'r1',
      blob: new Blob(['r1'], { type: 'image/png' }),
      mime: 'image/png',
      createdAt: 1,
    });
    await putAsset({
      id: 'pdf1',
      blob: new Blob(['pdf1'], { type: 'application/pdf' }),
      mime: 'application/pdf',
      createdAt: 1,
    });
    await saveAll(ws, [page]);

    // Perform cleanup
    const cleanRes = await cleanupLegacyPdfRasterBlocks();
    expect(cleanRes.blocksRemoved).toBe(2);

    // After cleanup: c1 was deleted, c2 was modified
    const cleanedPage = await loadPage('p1');
    expect(cleanedPage?.items.c1).toBeUndefined();
    expect(cleanedPage?.items.c2).toBeDefined();

    // Now perform restore
    const restoreRes = await restorePreLegacyCleanupBackup();
    expect(restoreRes).toEqual({ restored: true, pagesRestored: 1 });

    // Verify rollback in DB
    const restoredPage = await loadPage('p1');
    expect(restoredPage?.items.c1).toBeDefined();
    expect(restoredPage?.items.c2).toBeDefined();
    const restoredC2 = restoredPage?.items.c2 as NoteContainerItem;
    expect(restoredC2.doc.content?.some((n) => n.type === 'imageBlock')).toBe(true);

    const loadedWs = await loadWorkspace();
    expect(loadedWs?.pages.p1.searchText).toBe('Original search text');
  });

  it('preserves TextItem assets during legacy cleanup and asset garbage collection', async () => {
    const ws = createTestWorkspace('p1');
    const legacyBlock = {
      type: 'imageBlock',
      attrs: {
        assetId: 'r-legacy',
        source: { type: 'pdf', assetId: 'pdf-legacy', page: 1 },
      },
    };
    const legacyContainer: NoteContainerItem = {
      id: 'c1',
      type: 'container',
      x: 0,
      y: 0,
      w: 400,
      h: 300,
      freeImage: true,
      doc: { type: 'doc', content: [legacyBlock] },
    };
    const textItem: TextItem = {
      id: 't1',
      type: 'text',
      x: 500,
      y: 0,
      w: 300,
      h: 200,
      variant: 'plain',
      doc: {
        type: 'doc',
        content: [
          {
            type: 'imageBlock',
            attrs: { assetId: 'img-in-text' },
          },
        ],
      },
    };

    const page = P.addItems(P.emptyPage('p1'), [legacyContainer, textItem]);
    await putAsset({
      id: 'r-legacy',
      blob: new Blob(['r'], { type: 'image/png' }),
      mime: 'image/png',
      createdAt: 1,
    });
    await putAsset({
      id: 'pdf-legacy',
      blob: new Blob(['p'], { type: 'application/pdf' }),
      mime: 'application/pdf',
      createdAt: 1,
    });
    await putAsset({
      id: 'img-in-text',
      blob: new Blob(['img'], { type: 'image/png' }),
      mime: 'image/png',
      createdAt: 1,
    });
    await saveAll(ws, [page]);

    const result = await cleanupLegacyPdfRasterBlocks();
    expect(result.blocksRemoved).toBe(1);
    expect(result.orphanAssetsReclaimed).toBe(2); // r-legacy and pdf-legacy reclaimed

    // TextItem image asset must still exist in IndexedDB!
    const textAsset = await getAsset('img-in-text');
    expect(textAsset).toBeDefined();

    const storedAssets = await listAssetIds();
    expect(storedAssets).toEqual(['img-in-text']);

    const updated = await loadPage('p1');
    expect(updated?.items.t1).toBeDefined();
  });
});
