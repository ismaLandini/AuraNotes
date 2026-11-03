import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
  getDB,
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
import type { CanvasItem, NoteContainerItem, PageContent, TextItem } from '../../types';

beforeEach(async () => {
  clearAssetUrlCache();
  await resetDBConnection();
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
});

function createTestWorkspace(pageId = 'p1', sectionId = 's1', notebookId = 'nb1') {
  let ws = W.emptyWorkspace();
  ws = W.createNotebook(ws, 'Test Notebook', notebookId);
  ws = W.createSection(ws, notebookId, 'Test Section', sectionId);
  ws = W.createPage(ws, sectionId, 'Test Page', pageId);
  return ws;
}

describe('M1 R2 Empirical Challenger Probes', () => {
  describe('Probe 1: referencedAssets with TextItems and Edge Cases', () => {
    it('1.1. handles empty text items (null, undefined, empty doc, empty content)', () => {
      const pageEmptyDocs: PageContent = P.addItems(P.emptyPage('p1'), [
        {
          id: 't_no_doc',
          type: 'text',
          x: 0,
          y: 0,
          w: 100,
          h: 50,
          variant: 'plain',
          doc: undefined as unknown as JSONContent,
        },
        {
          id: 't_null_doc',
          type: 'text',
          x: 0,
          y: 60,
          w: 100,
          h: 50,
          variant: 'plain',
          doc: null as unknown as JSONContent,
        },
        {
          id: 't_empty_content',
          type: 'text',
          x: 0,
          y: 120,
          w: 100,
          h: 50,
          variant: 'plain',
          doc: { type: 'doc', content: [] },
        },
        {
          id: 't_empty_para',
          type: 'text',
          x: 0,
          y: 180,
          w: 100,
          h: 50,
          variant: 'plain',
          doc: { type: 'doc', content: [{ type: 'paragraph' }] },
        },
      ]);

      let assets: Set<string> | undefined;
      expect(() => {
        assets = P.referencedAssets(pageEmptyDocs);
      }).not.toThrow();
      expect(assets?.size).toBe(0);
    });

    it('1.2. handles TextItems containing mixed formatting (bold, italic, math, code, table, lists)', () => {
      const mixedDoc: JSONContent = {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 2 },
            content: [
              { type: 'text', text: 'Section ' },
              { type: 'text', marks: [{ type: 'bold' }], text: 'One' },
              { type: 'text', marks: [{ type: 'italic' }], text: ' (italic)' },
            ],
          },
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Euler formula: ' },
              { type: 'mathInline', attrs: { latex: 'e^{i\\pi} + 1 = 0' } },
            ],
          },
          {
            type: 'codeBlock',
            attrs: { language: 'typescript' },
            content: [{ type: 'text', text: 'const x = 42;' }],
          },
          {
            type: 'bulletList',
            content: [
              {
                type: 'listItem',
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'Bullet item with image:' }],
                  },
                  {
                    type: 'imageBlock',
                    attrs: { assetId: 'img-in-bullet-list' },
                  },
                ],
              },
            ],
          },
          {
            type: 'table',
            content: [
              {
                type: 'tableRow',
                content: [
                  {
                    type: 'tableCell',
                    content: [
                      {
                        type: 'imageBlock',
                        attrs: { assetId: 'img-in-table-cell' },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      };

      const page: PageContent = P.addItems(P.emptyPage('p1'), [
        {
          id: 't_mixed',
          type: 'text',
          x: 0,
          y: 0,
          w: 500,
          h: 500,
          variant: 'plain',
          doc: mixedDoc,
        },
      ]);

      const assets = P.referencedAssets(page);
      expect(assets.has('img-in-bullet-list')).toBe(true);
      expect(assets.has('img-in-table-cell')).toBe(true);
      expect(assets.size).toBe(2);
    });

    it('1.3. handles TextItems with multiple image blocks (both top-level and nested)', () => {
      const multiImgDoc: JSONContent = {
        type: 'doc',
        content: [
          { type: 'imageBlock', attrs: { assetId: 'img-top-1' } },
          { type: 'paragraph', content: [{ type: 'text', text: 'Middle paragraph' }] },
          { type: 'imageBlock', attrs: { assetId: 'img-top-2' } },
          {
            type: 'blockquote',
            content: [
              { type: 'imageBlock', attrs: { assetId: 'img-in-quote' } },
            ],
          },
          { type: 'imageBlock', attrs: { assetId: 'img-top-3' } },
        ],
      };

      const page: PageContent = P.addItems(P.emptyPage('p1'), [
        {
          id: 't_multi',
          type: 'text',
          x: 0,
          y: 0,
          w: 400,
          h: 600,
          variant: 'plain',
          doc: multiImgDoc,
        },
      ]);

      const assets = P.referencedAssets(page);
      expect(assets).toEqual(new Set(['img-top-1', 'img-top-2', 'img-in-quote', 'img-top-3']));
    });

    it('1.4. handles non-pdf vs pdf images (normal image, legacy pdf raster, live pdf)', () => {
      const docWithDiverseImages: JSONContent = {
        type: 'doc',
        content: [
          // 1. Normal user photo (only assetId)
          {
            type: 'imageBlock',
            attrs: { assetId: 'normal-user-photo' },
          },
          // 2. Normal user photo with non-pdf source
          {
            type: 'imageBlock',
            attrs: { assetId: 'camera-photo', source: { type: 'camera' } },
          },
          // 3. Legacy PDF raster block (both raster assetId and pdf source assetId)
          {
            type: 'imageBlock',
            attrs: {
              assetId: 'legacy-raster-id',
              source: { type: 'pdf', assetId: 'legacy-pdf-id', page: 1 },
            },
          },
          // 4. Live PDF block (empty assetId, pdf source assetId)
          {
            type: 'imageBlock',
            attrs: {
              assetId: '',
              source: { type: 'pdf', assetId: 'live-pdf-id', page: 2, mode: 'live' },
            },
          },
          // 5. ImageBlock with empty string assetId and no source (edge case)
          {
            type: 'imageBlock',
            attrs: { assetId: '' },
          },
          // 6. ImageBlock with undefined source assetId
          {
            type: 'imageBlock',
            attrs: { assetId: 'img-with-broken-source', source: { type: 'pdf' } },
          },
        ],
      };

      const page: PageContent = P.addItems(P.emptyPage('p1'), [
        {
          id: 't1',
          type: 'text',
          x: 0,
          y: 0,
          w: 400,
          h: 600,
          variant: 'plain',
          doc: docWithDiverseImages,
        },
      ]);

      const assets = P.referencedAssets(page);
      // Expected references:
      // - normal-user-photo
      // - camera-photo
      // - legacy-raster-id
      // - legacy-pdf-id
      // - live-pdf-id
      // - img-with-broken-source
      // Note: empty string '' should NOT be in the set
      expect(assets.has('')).toBe(false);
      expect(assets.has('normal-user-photo')).toBe(true);
      expect(assets.has('camera-photo')).toBe(true);
      expect(assets.has('legacy-raster-id')).toBe(true);
      expect(assets.has('legacy-pdf-id')).toBe(true);
      expect(assets.has('live-pdf-id')).toBe(true);
      expect(assets.has('img-with-broken-source')).toBe(true);
      expect(assets.size).toBe(6);
    });
  });

  describe('Probe 2: cleanDocAst and cleanupLegacyPdfRasterBlocks with Malformed Nodes', () => {
    it('2.1. cleanDocAst processes malformed primitives and empty objects inside doc.content without crashing', () => {
      const malformedDoc: JSONContent = {
        type: 'doc',
        content: [
          null as unknown as JSONContent,
          undefined as unknown as JSONContent,
          42 as unknown as JSONContent,
          true as unknown as JSONContent,
          false as unknown as JSONContent,
          'unexpected string' as unknown as JSONContent,
          {} as unknown as JSONContent,
          { type: 'imageBlock', attrs: { assetId: 'r1', source: { type: 'pdf', assetId: 'pdf1', page: 1 } } },
          null as unknown as JSONContent,
          { type: 'paragraph', content: [{ type: 'text', text: 'Valid Note' }] },
          {} as unknown as JSONContent,
        ],
      };

      let result: { cleanedDoc: JSONContent; removedCount: number } | undefined;
      expect(() => {
        result = cleanDocAst(malformedDoc);
      }).not.toThrow();

      expect(result?.removedCount).toBe(1);
      expect(result?.cleanedDoc).toBeDefined();
      expect(Array.isArray(result?.cleanedDoc.content)).toBe(true);

      // Verify the legacy imageBlock was removed
      const legacyFound = result?.cleanedDoc.content?.some((n) => isLegacyPdfRasterBlock(n));
      expect(legacyFound).toBe(false);
    });

    it('2.2. cleanupLegacyPdfRasterBlocks processes a page containing malformed AST nodes inside doc.content', async () => {
      const ws = createTestWorkspace('p1');
      const malformedDoc: JSONContent = {
        type: 'doc',
        content: [
          null as unknown as JSONContent,
          undefined as unknown as JSONContent,
          100 as unknown as JSONContent,
          true as unknown as JSONContent,
          {} as unknown as JSONContent,
          {
            type: 'imageBlock',
            attrs: { assetId: 'r-malformed', source: { type: 'pdf', assetId: 'pdf-malformed', page: 1 } },
          },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Surviving text note' }],
          },
        ],
      };

      const container: NoteContainerItem = {
        id: 'c_malformed',
        type: 'container',
        x: 10,
        y: 10,
        w: 500,
        h: 400,
        doc: malformedDoc,
      };

      const page: PageContent = P.addItems(P.emptyPage('p1'), [container]);
      await putAsset({
        id: 'r-malformed',
        blob: new Blob(['raster'], { type: 'image/png' }),
        mime: 'image/png',
        createdAt: 1,
      });
      await putAsset({
        id: 'pdf-malformed',
        blob: new Blob(['pdf'], { type: 'application/pdf' }),
        mime: 'application/pdf',
        createdAt: 1,
      });
      await saveAll(ws, [page]);

      // Check whether cleanupLegacyPdfRasterBlocks crashes or survives!
      let cleanupResult: unknown;
      let error: unknown = null;
      try {
        cleanupResult = await cleanupLegacyPdfRasterBlocks();
      } catch (err) {
        error = err;
      }

      // If it throws an error (e.g. from docToText in pageSearchText), we capture it!
      if (error) {
        console.error('PROBE 2.2 FAILED WITH ERROR:', error);
      }
      expect(error).toBeNull();
      expect(cleanupResult).toBeDefined();
    });

    it('2.3. probes docToText on the cleanedDoc produced by cleanDocAst with null/malformed nodes', () => {
      const malformedDoc: JSONContent = {
        type: 'doc',
        content: [
          null as unknown as JSONContent,
          { type: 'imageBlock', attrs: { assetId: 'r1', source: { type: 'pdf', assetId: 'pdf1', page: 1 } } },
          { type: 'paragraph', content: [{ type: 'text', text: 'Preserved Text' }] },
        ],
      };

      const { cleanedDoc } = cleanDocAst(malformedDoc);
      // cleanDocAst left null in cleanedDoc.content
      expect(cleanedDoc.content?.[0]).toBeNull();

      // Now verify if docToText survives or throws on cleanedDoc!
      let textResult: string | undefined;
      let textError: unknown = null;
      try {
        textResult = P.docToText(cleanedDoc);
      } catch (err) {
        textError = err;
      }

      if (textError) {
        console.error('PROBE 2.3 FAILED WITH ERROR:', textError);
      }
      expect(textError).toBeNull();
      expect(textResult).toBe('Preserved Text');
    });
  });

  describe('Probe 3: restorePreLegacyCleanupBackup Full Round-Trip and Bit-for-Bit Fidelity', () => {
    it('3.1. verifies exact bit-for-bit restore of pages, items, order, metadata, and workspace', async () => {
      let ws = createTestWorkspace('p1', 's1', 'nb1');
      ws = W.createPage(ws, 's1', 'Page 2', 'p2');

      const legacyBlock1 = {
        type: 'imageBlock',
        attrs: { assetId: 'r1', source: { type: 'pdf', assetId: 'pdf1', page: 1 }, width: 500 },
      };
      const legacyBlock2 = {
        type: 'imageBlock',
        attrs: { assetId: 'r2', source: { type: 'pdf', assetId: 'pdf1', page: 2 }, width: 500 },
      };

      // Page 1 has:
      // - c1: pure legacy block (will be deleted by cleanup)
      // - c2: mixed container (legacy block + user text)
      // - stroke1: freehand stroke attached to c1
      // - conn1: connector from c1 to c2
      const c1: NoteContainerItem = {
        id: 'c1',
        type: 'container',
        x: 10,
        y: 10,
        w: 500,
        h: 400,
        freeImage: true,
        doc: { type: 'doc', content: [legacyBlock1] },
      };
      const c2: NoteContainerItem = {
        id: 'c2',
        type: 'container',
        x: 10,
        y: 450,
        w: 500,
        h: 300,
        doc: {
          type: 'doc',
          content: [
            legacyBlock2,
            { type: 'paragraph', content: [{ type: 'text', text: 'Important lecture remarks' }] },
          ],
        },
      };
      const stroke1: CanvasItem = {
        id: 'stroke1',
        type: 'stroke',
        parentId: 'c1',
        points: [0.1, 0.2, 0.3, 0.4],
        color: '#ff0000',
        width: 2,
        opacity: 0.9,
        tool: 'highlighter',
      };
      const conn1: CanvasItem = {
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
      };

      const page1: PageContent = P.addItems(P.emptyPage('p1'), [c1, c2, stroke1, conn1]);

      // Page 2 has a text item and a normal user image
      const t2: TextItem = {
        id: 't2',
        type: 'text',
        x: 50,
        y: 50,
        w: 300,
        h: 200,
        variant: 'plain',
        doc: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Page 2 notes' }] }],
        },
      };
      const page2: PageContent = P.addItems(P.emptyPage('p2'), [t2]);

      // Custom search text in workspace
      ws = {
        ...ws,
        pages: {
          ...ws.pages,
          p1: { ...ws.pages.p1, searchText: 'Original Search Text For Page 1' },
          p2: { ...ws.pages.p2, searchText: 'Original Search Text For Page 2' },
        },
      };

      await putAsset({ id: 'r1', blob: new Blob(['r1']), mime: 'image/png', createdAt: 1 });
      await putAsset({ id: 'r2', blob: new Blob(['r2']), mime: 'image/png', createdAt: 1 });
      await putAsset({ id: 'pdf1', blob: new Blob(['pdf1']), mime: 'application/pdf', createdAt: 1 });
      await saveAll(ws, [page1, page2]);

      // Deep snapshot of original state in memory for bit-for-bit comparison
      const preCleanRawP1 = await (await getDB()).get('pages', 'p1');
      const preCleanRawP2 = await (await getDB()).get('pages', 'p2');
      const preCleanLoadedP1 = await loadPage('p1');
      const preCleanLoadedP2 = await loadPage('p2');
      const originalWsSnapshot = structuredClone(ws);

      // STEP 1: Execute cleanup
      const cleanRes = await cleanupLegacyPdfRasterBlocks();
      expect(cleanRes.blocksRemoved).toBe(2);
      expect(cleanRes.modifiedPageIds).toEqual(['p1']);

      // Verify that DB state was changed
      const postCleanP1 = await loadPage('p1');
      expect(postCleanP1?.items.c1).toBeUndefined(); // deleted
      expect(postCleanP1?.items.stroke1).toBeUndefined(); // dangling stroke removed
      expect(postCleanP1?.items.conn1).toBeUndefined(); // dangling connector removed

      // STEP 2: Restore from backup
      const restoreRes = await restorePreLegacyCleanupBackup();
      expect(restoreRes.restored).toBe(true);
      expect(restoreRes.pagesRestored).toBe(2);

      // STEP 3: Verify bit-for-bit identity against raw and loaded snapshots
      const db = await getDB();
      const restoredRawP1 = await db.get('pages', 'p1');
      const restoredRawP2 = await db.get('pages', 'p2');
      const restoredLoadedP1 = await loadPage('p1');
      const restoredLoadedP2 = await loadPage('p2');
      const restoredWs = await loadWorkspace();

      // Raw IndexedDB records match bit-for-bit
      expect(restoredRawP1).toEqual(preCleanRawP1);
      expect(restoredRawP2).toEqual(preCleanRawP2);

      // Loaded pages match bit-for-bit with pre-cleanup loaded pages
      expect(restoredLoadedP1).toEqual(preCleanLoadedP1);
      expect(restoredLoadedP2).toEqual(preCleanLoadedP2);
      expect(restoredWs).toEqual(originalWsSnapshot);
    });

    it('3.2. preserves the pre-cleanup backup across subsequent cleanup runs when force is not specified', async () => {
      const ws = createTestWorkspace('p1');
      const legacyBlock = {
        type: 'imageBlock',
        attrs: { assetId: 'r-persist', source: { type: 'pdf', assetId: 'pdf-persist', page: 1 } },
      };
      const container: NoteContainerItem = {
        id: 'c1',
        type: 'container',
        x: 0,
        y: 0,
        w: 400,
        h: 300,
        freeImage: true,
        doc: { type: 'doc', content: [legacyBlock] },
      };
      const page = P.addItems(P.emptyPage('p1'), [container]);

      await putAsset({ id: 'r-persist', blob: new Blob(['r']), mime: 'image/png', createdAt: 1 });
      await putAsset({ id: 'pdf-persist', blob: new Blob(['p']), mime: 'application/pdf', createdAt: 1 });
      await saveAll(ws, [page]);

      // Run 1: cleans legacy block and creates backup
      const run1 = await cleanupLegacyPdfRasterBlocks();
      expect(run1.blocksRemoved).toBe(1);

      const backup1 = await getPreLegacyCleanupBackup();
      expect(backup1).toBeDefined();
      expect(backup1?.blocksRemovedTotal).toBe(1);

      // Run 2: idempotent run
      const run2 = await cleanupLegacyPdfRasterBlocks();
      expect(run2.blocksRemoved).toBe(0);

      const backup2 = await getPreLegacyCleanupBackup();
      expect(backup2?.backedUpAt).toBe(backup1?.backedUpAt);
      expect(backup2?.blocksRemovedTotal).toBe(1);

      // Restore should still restore the original pre-cleanup state!
      const restoreRes = await restorePreLegacyCleanupBackup();
      expect(restoreRes.restored).toBe(true);

      const restoredPage = await loadPage('p1');
      expect(restoredPage?.items.c1).toBeDefined();
    });
  });
});
