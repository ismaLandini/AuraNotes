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
  restorePreLegacyCleanupBackup,
} from '../legacyCleanup';
import * as W from '../../model/workspaceOps';
import * as P from '../../model/pageOps';
import type { JSONContent } from '@tiptap/core';
import type { CanvasItem, ID, ImageBlockAttrs, NoteContainerItem, PageContent } from '../../types';
import { SCHEMA_VERSION } from '../../types';

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

describe('M1 R3 Adversarial Challenger Stress Harness', () => {
  describe('Suite 1: Extreme AST Null & Primitive Resilience in pageOps', () => {
    it('1.1. docToText survives completely hostile doc representations', () => {
      const hostileDocs = [
        null,
        undefined,
        0,
        1,
        NaN,
        Infinity,
        '',
        'plain string',
        true,
        false,
        {},
        { type: null },
        { type: undefined },
        { type: 123 },
        { content: null },
        { content: undefined },
        { content: 'not an array' },
        { content: 12345 },
        { content: {} },
        {
          type: 'doc',
          content: [
            null,
            undefined,
            true,
            false,
            0,
            -1,
            '',
            'text',
            {},
            { type: null },
            { type: 'text', text: null },
            { type: 'text', text: undefined },
            { type: 'text', text: 123 as unknown as string },
            { type: 'mathInline', attrs: null },
            { type: 'mathInline', attrs: { latex: null } },
            { type: 'mathInline', attrs: { latex: 42 } },
            { type: 'imageBlock', attrs: null },
            { type: 'imageBlock', attrs: { alt: null } },
            { type: 'imageBlock', attrs: { alt: 'image description' } },
            {
              type: 'paragraph',
              content: [
                null,
                undefined,
                { type: 'text', text: 'Hello ' },
                { type: 'text', text: 'World' },
              ],
            },
            {
              type: 'blockquote',
              content: 'invalid content' as unknown as JSONContent[],
            },
          ],
        },
      ];

      for (const d of hostileDocs) {
        expect(() => {
          const res = P.docToText(d as unknown as JSONContent);
          expect(typeof res).toBe('string');
        }).not.toThrow();
      }

      // Verify legitimate text was extracted despite the surrounding chaos
      const hostileDoc = hostileDocs[hostileDocs.length - 1] as JSONContent;
      const text = P.docToText(hostileDoc);
      expect(text).toContain('image description');
      expect(text).toContain('Hello World');
    });

    it('1.2. stripOcrFromDoc survives hostile nodes and preserves valid content without mutation if unchanged', () => {
      const hostileDoc: JSONContent = {
        type: 'doc',
        content: [
          null as unknown as JSONContent,
          undefined as unknown as JSONContent,
          123 as unknown as JSONContent,
          'bad' as unknown as JSONContent,
          {} as unknown as JSONContent,
          {
            type: 'imageBlock',
            attrs: {
              assetId: 'img1',
              ocr: { text: 'legacy ocr to strip' },
              highlights: [{ id: 'h1' }],
              keepMe: 'present',
            },
          },
          {
            type: 'imageBlock',
            attrs: null as unknown as Record<string, unknown>,
          },
          {
            type: 'bulletList',
            content: [
              null as unknown as JSONContent,
              {
                type: 'listItem',
                content: [
                  {
                    type: 'imageBlock',
                    attrs: {
                      assetId: 'img2',
                      ocr: 'string ocr',
                      highlights: [],
                    },
                  },
                ],
              },
            ],
          },
        ],
      };

      let cleaned: JSONContent | undefined;
      expect(() => {
        cleaned = P.stripOcrFromDoc(hostileDoc);
      }).not.toThrow();

      expect(cleaned).toBeDefined();
      expect(cleaned).not.toBe(hostileDoc); // was modified

      // Top-level imageBlock should have ocr and highlights removed, keepMe retained
      const topImg = cleaned?.content?.[5];
      expect(topImg?.attrs?.keepMe).toBe('present');
      expect(topImg?.attrs?.ocr).toBeUndefined();
      expect(topImg?.attrs?.highlights).toBeUndefined();

      // Nested imageBlock in bulletList
      const nestedList = cleaned?.content?.[7];
      const nestedItem = nestedList?.content?.[1];
      const nestedImg = nestedItem?.content?.[0];
      expect(nestedImg?.attrs?.ocr).toBeUndefined();
      expect(nestedImg?.attrs?.highlights).toBeUndefined();

      // Running stripOcrFromDoc on already clean doc returns same object reference
      const idempotent = P.stripOcrFromDoc(cleaned!);
      expect(idempotent).toBe(cleaned);
    });

    it('1.3. removeImageBlockFromDoc survives hostile doc and malformed content arrays', () => {
      const hostileDoc: JSONContent = {
        type: 'doc',
        content: [
          null as unknown as JSONContent,
          {} as unknown as JSONContent,
          { type: 'imageBlock', attrs: null as unknown as Record<string, unknown> },
          { type: 'imageBlock', attrs: { assetId: 'target-asset', id: 'block-1' } },
          {
            type: 'paragraph',
            content: [
              null as unknown as JSONContent,
              { type: 'imageBlock', attrs: { assetId: 'nested-target', id: 'block-2' } },
            ],
          },
        ],
      };

      let res1: JSONContent | undefined;
      expect(() => {
        res1 = P.removeImageBlockFromDoc(hostileDoc, 'target-asset');
      }).not.toThrow();
      expect(res1?.content?.length).toBe(4); // target-asset removed, null & {} kept

      let res2: JSONContent | undefined;
      expect(() => {
        res2 = P.removeImageBlockFromDoc(hostileDoc, '', 'block-1');
      }).not.toThrow();
      expect(res2?.content?.some((n) => n?.attrs?.id === 'block-1')).toBe(false);

      let res3: JSONContent | undefined;
      expect(() => {
        res3 = P.removeImageBlockFromDoc(hostileDoc, 'nested-target');
      }).not.toThrow();
      const para = res3?.content?.find((n) => n?.type === 'paragraph');
      expect(para?.content?.some((n) => n?.attrs?.assetId === 'nested-target')).toBe(false);

      // Completely non-object doc returns gracefully
      expect(P.removeImageBlockFromDoc(null as unknown as JSONContent, 'a')).toBeNull();
      expect(P.removeImageBlockFromDoc('string' as unknown as JSONContent, 'a')).toBe('string');
    });

    it('1.4. insertImageBlockIntoDoc handles invalid / null docs safely', () => {
      const badDocs = [null, undefined, 42, 'str', {}];
      const dummyAttrs: ImageBlockAttrs = {
        assetId: 'new-asset',
        width: 400,
        naturalWidth: 400,
        naturalHeight: 300,
      };
      for (const bad of badDocs) {
        expect(() => {
          const res = P.insertImageBlockIntoDoc(
            bad as unknown as JSONContent,
            dummyAttrs,
            0,
          );
          expect(res.content?.length).toBe(1);
          expect(res.content?.[0].type).toBe('imageBlock');
        }).not.toThrow();
      }
    });

    it('1.5. isDocEmpty handles nulls, malformed nodes, and empty paragraphs', () => {
      expect(P.isDocEmpty(null)).toBe(true);
      expect(P.isDocEmpty(undefined)).toBe(true);
      expect(P.isDocEmpty({} as JSONContent)).toBe(true);
      expect(P.isDocEmpty({ type: 'doc' })).toBe(true);
      expect(P.isDocEmpty({ type: 'doc', content: [] })).toBe(true);
      expect(
        P.isDocEmpty({
          type: 'doc',
          content: [null as unknown as JSONContent, undefined as unknown as JSONContent, {} as unknown as JSONContent],
        }),
      ).toBe(true);
      expect(
        P.isDocEmpty({
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: '   \n  ' }] }],
        }),
      ).toBe(true);
      expect(
        P.isDocEmpty({
          type: 'doc',
          content: [
            null as unknown as JSONContent,
            { type: 'paragraph', content: [{ type: 'text', text: 'Non-empty' }] },
          ],
        }),
      ).toBe(false);
      expect(
        P.isDocEmpty({
          type: 'doc',
          content: [{ type: 'imageBlock', attrs: { assetId: 'a1' } }],
        }),
      ).toBe(false);
    });

    it('1.6. referencedAssets and extractDocAssets survive hostile pages and items', () => {
      expect(P.referencedAssets(null as unknown as PageContent).size).toBe(0);
      expect(P.referencedAssets({} as unknown as PageContent).size).toBe(0);

      const hostilePage: PageContent = {
        id: 'p1',
        schemaVersion: SCHEMA_VERSION,
        order: ['bad1', 'bad2', 't1', 'c1', 'img1', 'nonexistent'],
        items: {
          bad1: null as unknown as CanvasItem,
          bad2: {} as unknown as CanvasItem,
          t1: {
            id: 't1',
            type: 'text',
            x: 0,
            y: 0,
            w: 100,
            h: 100,
            variant: 'plain',
            doc: {
              type: 'doc',
              content: [
                null as unknown as JSONContent,
                { type: 'imageBlock', attrs: { assetId: 'from-text-1' } },
                {
                  type: 'imageBlock',
                  attrs: { assetId: '', source: { type: 'pdf', assetId: 'pdf-live-1', mode: 'live' } },
                },
              ],
            },
          },
          c1: {
            id: 'c1',
            type: 'container',
            x: 0,
            y: 0,
            w: 100,
            h: 100,
            doc: {
              type: 'doc',
              content: [
                undefined as unknown as JSONContent,
                {
                  type: 'imageBlock',
                  attrs: {
                    assetId: 'raster-legacy-1',
                    source: { type: 'pdf', assetId: 'pdf-legacy-1', page: 1 },
                  },
                },
              ],
            },
          },
          img1: {
            id: 'img1',
            type: 'image',
            x: 0,
            y: 0,
            w: 100,
            h: 100,
            rotation: 0,
            naturalWidth: 100,
            naturalHeight: 100,
            mime: 'image/png',
            assetId: 'raw-image-1',
          },
        },
      };

      let assets: Set<string> | undefined;
      expect(() => {
        assets = P.referencedAssets(hostilePage);
      }).not.toThrow();

      expect(assets).toEqual(
        new Set(['from-text-1', 'pdf-live-1', 'raster-legacy-1', 'pdf-legacy-1', 'raw-image-1']),
      );
    });

    it('1.7. pageSearchText survives null and malformed items in page', () => {
      const hostilePage: PageContent = {
        id: 'p1',
        schemaVersion: SCHEMA_VERSION,
        order: ['bad1', 'c1'],
        items: {
          bad1: { id: 'bad1', type: 'container', x: 0, y: 0, w: 100, h: 100, doc: null as unknown as JSONContent },
          c1: {
            id: 'c1',
            type: 'container',
            x: 0,
            y: 0,
            w: 100,
            h: 100,
            doc: {
              type: 'doc',
              content: [
                null as unknown as JSONContent,
                { type: 'paragraph', content: [{ type: 'text', text: 'Extracted Searchable Content' }] },
              ],
            },
          },
        },
      };

      let text: string | undefined;
      expect(() => {
        text = P.pageSearchText(hostilePage);
      }).not.toThrow();
      expect(text).toContain('Extracted Searchable Content');
    });

    it('1.8. deep recursive AST (50 levels deep) with interspersed nulls does not overflow stack or throw', () => {
      let current: JSONContent = {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Deepest Text' }],
      };

      for (let i = 0; i < 50; i++) {
        current = {
          type: 'bulletList',
          content: [
            null as unknown as JSONContent,
            {
              type: 'listItem',
              content: [current],
            },
            undefined as unknown as JSONContent,
          ],
        };
      }

      const deepDoc: JSONContent = {
        type: 'doc',
        content: [current],
      };

      expect(() => {
        const text = P.docToText(deepDoc);
        expect(text).toBe('Deepest Text');
      }).not.toThrow();

      expect(() => {
        const stripped = P.stripOcrFromDoc(deepDoc);
        expect(stripped).toBeDefined();
      }).not.toThrow();

      expect(() => {
        const cleaned = cleanDocAst(deepDoc);
        expect(cleaned.removedCount).toBe(0);
      }).not.toThrow();
    });
  });

  describe('Suite 2: cleanDocAst & cleanupLegacyPdfRasterBlocks Adversarial Scenarios', () => {
    it('2.1. cleanDocAst handles sparse arrays, nulls, and consecutive legacy blocks with spacers', () => {
      // Sparse array: length 10 with holes
      const sparseContent: JSONContent[] = new Array(8);
      sparseContent[1] = {
        type: 'imageBlock',
        attrs: { assetId: 'legacy-1', source: { type: 'pdf', assetId: 'pdf-1', page: 1 } },
      };
      sparseContent[2] = { type: 'paragraph', content: [{ type: 'text', text: '   ' }] }; // spacer
      sparseContent[4] = {
        type: 'imageBlock',
        attrs: { assetId: 'legacy-2', source: { type: 'pdf', assetId: 'pdf-1', page: 2 } },
      };
      sparseContent[5] = {
        type: 'imageBlock',
        attrs: { assetId: 'legacy-3', source: { type: 'pdf', assetId: 'pdf-1', page: 3 } },
      };
      sparseContent[7] = {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Important Survivor Text' }],
      };

      const doc: JSONContent = {
        type: 'doc',
        content: sparseContent,
      };

      let result: { cleanedDoc: JSONContent; removedCount: number } | undefined;
      expect(() => {
        result = cleanDocAst(doc);
      }).not.toThrow();

      expect(result?.removedCount).toBe(3);
      const text = P.docToText(result!.cleanedDoc);
      expect(text).toBe('Important Survivor Text');
    });

    it('2.2. cleanDocAst does not touch live PDF blocks (assetId === "") even if source is pdf', () => {
      const docWithLivePdf: JSONContent = {
        type: 'doc',
        content: [
          {
            type: 'imageBlock',
            attrs: {
              assetId: '',
              source: { type: 'pdf', assetId: 'live-pdf-doc', page: 1, mode: 'live' },
            },
          },
          {
            type: 'imageBlock',
            attrs: {
              assetId: 'legacy-raster',
              source: { type: 'pdf', assetId: 'legacy-pdf-doc', page: 1 },
            },
          },
        ],
      };

      const { cleanedDoc, removedCount } = cleanDocAst(docWithLivePdf);
      expect(removedCount).toBe(1);
      expect(cleanedDoc.content?.length).toBe(1);
      const remainingBlock = cleanedDoc.content?.[0];
      expect(remainingBlock?.attrs?.source?.assetId).toBe('live-pdf-doc');
      expect(remainingBlock?.attrs?.assetId).toBe('');
    });

    it('2.3. full cleanup pipeline on multi-page database with mixed valid, legacy, malformed, and orphan data', async () => {
      const ws = createTestWorkspace('p1');
      const wsWith2Pages = W.createPage(ws, 's1', 'Page 2', 'p2');
      const wsWith3Pages = W.createPage(wsWith2Pages, 's1', 'Page 3', 'p3');

      // Page 1: pure legacy container + stroke attached
      const page1: PageContent = P.addItems(P.emptyPage('p1'), [
        {
          id: 'c_legacy',
          type: 'container',
          x: 0,
          y: 0,
          w: 400,
          h: 400,
          freeImage: true,
          doc: {
            type: 'doc',
            content: [
              {
                type: 'imageBlock',
                attrs: { assetId: 'raster-1', source: { type: 'pdf', assetId: 'pdf-common', page: 1 } },
              },
            ],
          },
        },
        {
          id: 'stroke_c_legacy',
          type: 'stroke',
          parentId: 'c_legacy',
          tool: 'pen',
          points: [1, 2, 3, 4],
          color: '#ff0000',
          width: 2,
          opacity: 1,
        },
      ]);

      // Page 2: mixed container (legacy block + malformed null + surviving text) + live PDF block
      const page2: PageContent = P.addItems(P.emptyPage('p2'), [
        {
          id: 'c_mixed',
          type: 'container',
          x: 50,
          y: 50,
          w: 500,
          h: 500,
          doc: {
            type: 'doc',
            content: [
              null as unknown as JSONContent,
              {
                type: 'imageBlock',
                attrs: { assetId: 'raster-2', source: { type: 'pdf', assetId: 'pdf-common', page: 2 } },
              },
              {
                type: 'imageBlock',
                attrs: { assetId: '', source: { type: 'pdf', assetId: 'pdf-live', page: 1, mode: 'live' } },
              },
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Important User Annotations on Page 2' }],
              },
            ],
          },
        },
      ]);

      // Page 3: purely normal notes, no legacy blocks
      const page3: PageContent = P.addItems(P.emptyPage('p3'), [
        {
          id: 't_clean',
          type: 'text',
          x: 10,
          y: 10,
          w: 200,
          h: 100,
          variant: 'plain',
          doc: {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Page 3 Normal Notes' }] }],
          },
        },
      ]);

      // Populate assets
      await putAsset({ id: 'raster-1', blob: new Blob(['r1']), mime: 'image/png', createdAt: 1 });
      await putAsset({ id: 'raster-2', blob: new Blob(['r2']), mime: 'image/png', createdAt: 1 });
      await putAsset({ id: 'pdf-common', blob: new Blob(['p-common']), mime: 'application/pdf', createdAt: 1 });
      await putAsset({ id: 'pdf-live', blob: new Blob(['p-live']), mime: 'application/pdf', createdAt: 1 });
      await putAsset({ id: 'orphan-unrelated', blob: new Blob(['orphan']), mime: 'image/png', createdAt: 1 });

      await saveAll(wsWith3Pages, [page1, page2, page3]);

      // Step A: Dry run test
      const dryRunResult = await cleanupLegacyPdfRasterBlocks({ dryRun: true });
      expect(dryRunResult.pagesScanned).toBe(3);
      expect(dryRunResult.blocksRemoved).toBe(2);
      expect(dryRunResult.orphanAssetsReclaimed).toBe(0);
      expect(dryRunResult.modifiedPageIds.sort()).toEqual(['p1', 'p2']);

      // Verify dry-run did not mutate IndexedDB
      const db = await getDB();
      const dryRunP1 = await loadPage('p1');
      expect(dryRunP1?.items.c_legacy).toBeDefined();

      // Step B: Live execution
      const liveResult = await cleanupLegacyPdfRasterBlocks();
      expect(liveResult.pagesScanned).toBe(3);
      expect(liveResult.blocksRemoved).toBe(2);
      expect(liveResult.orphanAssetsReclaimed).toBe(4); // raster-1, raster-2, pdf-common, orphan-unrelated
      expect(liveResult.modifiedPageIds.sort()).toEqual(['p1', 'p2']);

      // Step C: Verify post-cleanup state in DB
      const postP1 = await loadPage('p1');
      expect(postP1?.items.c_legacy).toBeUndefined(); // deleted
      expect(postP1?.items.stroke_c_legacy).toBeUndefined(); // repaired (dangling parentId)

      const postP2 = await loadPage('p2');
      expect(postP2?.items.c_mixed).toBeDefined();
      const p2Text = P.pageSearchText(postP2!);
      expect(p2Text).toContain('Important User Annotations on Page 2');

      // Verify live asset was preserved
      const liveAsset = await db.get('assets', 'pdf-live');
      expect(liveAsset).toBeDefined();

      // Verify reclaimed assets were deleted
      expect(await db.get('assets', 'raster-1')).toBeUndefined();
      expect(await db.get('assets', 'raster-2')).toBeUndefined();
      expect(await db.get('assets', 'pdf-common')).toBeUndefined();
      expect(await db.get('assets', 'orphan-unrelated')).toBeUndefined();

      // Step D: Verify workspace search text was updated
      const loadedWs = await loadWorkspace();
      expect(loadedWs!.pages.p2.searchText).toContain('Important User Annotations on Page 2');

      // Step E: Verify pre-cleanup backup and restore
      const backup = await getPreLegacyCleanupBackup();
      expect(backup).toBeDefined();
      expect(backup?.blocksRemovedTotal).toBe(2);

      const restoreResult = await restorePreLegacyCleanupBackup();
      expect(restoreResult.restored).toBe(true);
      expect(restoreResult.pagesRestored).toBe(3);

      const restoredP1 = await loadPage('p1');
      expect(restoredP1?.items.c_legacy).toBeDefined();
      expect(restoredP1?.items.stroke_c_legacy).toBeDefined();
    });

    it('2.4. cleanup handles damaged or empty workspace gracefully', async () => {
      // Empty DB with no pages
      const emptyResult = await cleanupLegacyPdfRasterBlocks();
      expect(emptyResult.pagesScanned).toBe(0);
      expect(emptyResult.blocksRemoved).toBe(0);
      expect(emptyResult.orphanAssetsReclaimed).toBe(0);
      expect(emptyResult.modifiedPageIds).toEqual([]);
    });
  });

  describe('Suite 3: Container Operations & Migrations with Adversarial Nodes', () => {
    it('3.1. moveImageToCanvas handles empty, single-paragraph, and null-laden docs', () => {
      const pageWithImg: PageContent = {
        id: 'p1',
        schemaVersion: SCHEMA_VERSION,
        order: ['c1'],
        items: {
          c1: {
            id: 'c1',
            type: 'container',
            x: 10,
            y: 10,
            w: 300,
            h: 300,
            doc: {
              type: 'doc',
              content: [
                null as unknown as JSONContent,
                { type: 'imageBlock', attrs: { assetId: 'img-to-move', width: 250, naturalWidth: 250, naturalHeight: 180 } },
              ],
            },
          },
        },
      };

      let result: { page: PageContent; newId: ID } | undefined;
      expect(() => {
        result = P.moveImageToCanvas(
          pageWithImg,
          'c1',
          { assetId: 'img-to-move', width: 250, naturalWidth: 250, naturalHeight: 180 },
          { x: 100, y: 100 },
        );
      }).not.toThrow();

      expect(result).toBeDefined();
      const movedPage = result!.page;
      const freeContainer = Object.values(movedPage.items).find(
        (it) => it.type === 'container' && (it as NoteContainerItem).freeImage,
      );
      expect(freeContainer).toBeDefined();
      expect(freeContainer?.id).toBe(result!.newId);
    });

    it('3.2. migratePageV1toV2 and migratePageV2toV3 survive malformed items and docs', () => {
      const hostilePage: PageContent = {
        id: 'p_mig',
        schemaVersion: 1,
        order: ['img1', 'c1'],
        items: {
          img1: {
            id: 'img1',
            type: 'image',
            x: 0,
            y: 0,
            w: 100,
            h: 100,
            rotation: 0,
            naturalWidth: 100,
            naturalHeight: 100,
            mime: 'image/png',
            assetId: 'raw-img',
          },
          c1: {
            id: 'c1',
            type: 'container',
            x: 0,
            y: 0,
            w: 200,
            h: 200,
            doc: {
              type: 'doc',
              content: [
                null as unknown as JSONContent,
                {
                  type: 'imageBlock',
                  attrs: {
                    assetId: 'img-mig',
                    source: { type: 'camera' },
                  },
                },
              ],
            },
          },
        },
      };

      let v2: PageContent | undefined;
      expect(() => {
        v2 = P.migratePageV1toV2(hostilePage);
      }).not.toThrow();
      expect(v2?.items.img1.type).toBe('container');

      let v3: PageContent | undefined;
      expect(() => {
        v3 = P.migratePageV2toV3(v2!);
      }).not.toThrow();
      expect(v3).toBeDefined();
    });
  });

  describe('Suite 4: High-Volume Adversarial Stress (1,000 AST Nodes)', () => {
    it('4.1. cleanDocAst, docToText, and stripOcrFromDoc scale linearly on 1,000 mixed malformed nodes', () => {
      const nodes: JSONContent[] = [];
      let expectedLegacyCount = 0;

      for (let i = 0; i < 1000; i++) {
        const mod = i % 5;
        if (mod === 0) {
          nodes.push(null as unknown as JSONContent);
        } else if (mod === 1) {
          nodes.push(undefined as unknown as JSONContent);
        } else if (mod === 2) {
          nodes.push({ type: 'imageBlock', attrs: { assetId: `raster-${i}`, source: { type: 'pdf', assetId: `pdf-${i}`, page: 1 } } });
          expectedLegacyCount++;
        } else if (mod === 3) {
          nodes.push({
            type: 'imageBlock',
            attrs: { assetId: `img-${i}`, ocr: 'ocr data', highlights: [] },
          });
        } else {
          nodes.push({
            type: 'paragraph',
            content: [{ type: 'text', text: `Sentence ${i}. ` }],
          });
        }
      }

      const hugeDoc: JSONContent = {
        type: 'doc',
        content: nodes,
      };

      const start = performance.now();
      const { cleanedDoc, removedCount } = cleanDocAst(hugeDoc);
      const cleanDuration = performance.now() - start;

      expect(removedCount).toBe(expectedLegacyCount);
      expect(cleanDuration).toBeLessThan(500); // Must be fast (< 500ms)

      const startStrip = performance.now();
      const stripped = P.stripOcrFromDoc(cleanedDoc);
      const stripDuration = performance.now() - startStrip;

      expect(stripped).toBeDefined();
      expect(stripDuration).toBeLessThan(500);

      const startText = performance.now();
      const text = P.docToText(stripped);
      const textDuration = performance.now() - startText;

      expect(text.length).toBeGreaterThan(1000);
      expect(textDuration).toBeLessThan(500);
    });
  });
});
