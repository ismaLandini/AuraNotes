import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
  getAsset,
  listAssetIds,
  loadPage,
  putAsset,
  resetDBConnection,
  saveAll,
} from '../db';
import { clearAssetUrlCache, garbageCollectAssets } from '../assets';
import {
  cleanDocAst,
  cleanupLegacyPdfRasterBlocks,
  getPreLegacyCleanupBackup,
  isLegacyPdfRasterBlock,
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
  ws = W.createNotebook(ws, 'Test Notebook', notebookId);
  ws = W.createSection(ws, notebookId, 'Test Section', sectionId);
  ws = W.createPage(ws, sectionId, 'Test Page', pageId);
  return ws;
}

describe('Adversarial Challenge Suite: Legacy PDF Raster Cleanup', () => {
  describe('1. AST Robustness, Malformed Nodes, and Deep Nesting', () => {
    it('handles malformed AST inputs gracefully without crashing', () => {
      // Null / undefined / primitive inputs
      expect(cleanDocAst(null as unknown as JSONContent)).toEqual({ cleanedDoc: null, removedCount: 0 });
      expect(cleanDocAst(undefined as unknown as JSONContent)).toEqual({ cleanedDoc: undefined, removedCount: 0 });
      expect(cleanDocAst({} as unknown as JSONContent)).toEqual({ cleanedDoc: {}, removedCount: 0 });
      expect(cleanDocAst({ type: 'doc' } as unknown as JSONContent)).toEqual({ cleanedDoc: { type: 'doc' }, removedCount: 0 });
      expect(cleanDocAst({ type: 'doc', content: 'invalid' as unknown as JSONContent[] })).toEqual({
        cleanedDoc: { type: 'doc', content: 'invalid' },
        removedCount: 0,
      });

      // Malformed nodes inside content array
      const malformedDoc: JSONContent = {
        type: 'doc',
        content: [
          null as unknown as JSONContent,
          undefined as unknown as JSONContent,
          {} as unknown as JSONContent,
          { type: undefined } as unknown as JSONContent,
          { type: 'unknown_type', content: [{ type: 'text', text: 'hello' }] },
          {
            type: 'imageBlock',
            attrs: null as unknown as Record<string, unknown>,
          },
          {
            type: 'imageBlock',
            attrs: { source: 'not-an-object', assetId: 'abc' },
          },
          {
            type: 'imageBlock',
            attrs: { source: { type: 123 }, assetId: 'abc' },
          },
          {
            type: 'imageBlock',
            attrs: { source: { type: 'pdf' }, assetId: null },
          },
          {
            type: 'imageBlock',
            attrs: { source: { type: 'pdf' }, assetId: '   ' }, // whitespace only
          },
        ],
      };

      // cleanDocAst should safely process these without throwing
      let res: { cleanedDoc: JSONContent; removedCount: number } | undefined;
      expect(() => {
        res = cleanDocAst(malformedDoc);
      }).not.toThrow();
      expect(res?.removedCount).toBe(0);
    });

    it('processes deeply nested AST nodes (15 levels deep) and removes legacy blocks', () => {
      // Build a 15-level deeply nested structure: doc -> blockquote -> bulletList -> listItem -> ...
      let currentInner: JSONContent = {
        type: 'imageBlock',
        attrs: {
          assetId: 'deep-raster',
          source: { type: 'pdf', assetId: 'deep-pdf', page: 1 },
        },
      };

      for (let level = 15; level >= 1; level--) {
        currentInner = {
          type: level % 2 === 0 ? 'blockquote' : 'bulletList',
          content: [
            currentInner,
            { type: 'paragraph', content: [{ type: 'text', text: `Level ${level} note` }] },
          ],
        };
      }

      const deepDoc: JSONContent = {
        type: 'doc',
        content: [currentInner],
      };

      const { cleanedDoc, removedCount } = cleanDocAst(deepDoc);
      expect(removedCount).toBe(1);

      // Verify deep raster block is gone
      const json = JSON.stringify(cleanedDoc);
      expect(json).not.toContain('deep-raster');
      // Verify level 1 note survived
      expect(json).toContain('Level 1 note');
      expect(json).toContain('Level 15 note');
    });

    it('handles empty containers and containers with only empty spacer paragraphs', async () => {
      const ws = createTestWorkspace('p1');
      const page: PageContent = P.addItems(P.emptyPage('p1'), [
        {
          id: 'c-empty-doc',
          type: 'container',
          x: 0,
          y: 0,
          w: 200,
          h: 200,
          doc: { type: 'doc', content: [] },
        },
        {
          id: 'c-legacy-only',
          type: 'container',
          x: 0,
          y: 250,
          w: 200,
          h: 200,
          doc: {
            type: 'doc',
            content: [
              {
                type: 'imageBlock',
                attrs: { assetId: 'r-only', source: { type: 'pdf', assetId: 'pdf-only', page: 1 } },
              },
              { type: 'paragraph', content: [] }, // empty spacer
            ],
          },
        },
      ]);

      await putAsset({
        id: 'r-only',
        blob: new Blob(['x'], { type: 'image/png' }),
        mime: 'image/png',
        createdAt: 1,
      });
      await putAsset({
        id: 'pdf-only',
        blob: new Blob(['pdf'], { type: 'application/pdf' }),
        mime: 'application/pdf',
        createdAt: 1,
      });
      await saveAll(ws, [page]);

      const res = await cleanupLegacyPdfRasterBlocks();
      expect(res.blocksRemoved).toBe(1);
      expect(res.orphanAssetsReclaimed).toBe(2);

      const updated = await loadPage('p1');
      // c-legacy-only became empty so it should be deleted
      expect(updated?.items['c-legacy-only']).toBeUndefined();
      // c-empty-doc didn't have legacy blocks, so it should not be touched by legacy cleanup
      expect(updated?.items['c-empty-doc']).toBeDefined();
    });
  });

  describe('2. Mixed Content: Formatting, Math, Code Blocks, and Tables', () => {
    it('preserves bold, italic, strikethrough, math inline/blocks, code blocks, and tables', async () => {
      const ws = createTestWorkspace('p1');
      const complexDoc: JSONContent = {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 1 },
            content: [
              { type: 'text', text: 'Lezione di ' },
              { type: 'text', marks: [{ type: 'bold' }], text: 'Meccanica Quantistica' },
            ],
          },
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Formula fondamentale: ' },
              { type: 'mathInline', attrs: { latex: 'i\\hbar\\frac{\\partial}{\\partial t}\\Psi = \\hat{H}\\Psi' } },
            ],
          },
          {
            type: 'imageBlock',
            attrs: {
              assetId: 'r-mixed',
              source: { type: 'pdf', assetId: 'pdf-mixed', page: 1 },
            },
          },
          { type: 'paragraph' }, // Spacer
          {
            type: 'mathBlock',
            attrs: { latex: '\\nabla \\times \\mathbf{B} = \\mu_0\\mathbf{J} + \\mu_0\\epsilon_0\\frac{\\partial\\mathbf{E}}{\\partial t}' },
          },
          {
            type: 'codeBlock',
            attrs: { language: 'python' },
            content: [{ type: 'text', text: 'def wave_function(x, t):\n    return np.exp(1j * (k * x - omega * t))' }],
          },
          {
            type: 'table',
            content: [
              {
                type: 'tableRow',
                content: [
                  {
                    type: 'tableHeader',
                    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Parametro' }] }],
                  },
                  {
                    type: 'tableHeader',
                    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Valore' }] }],
                  },
                ],
              },
              {
                type: 'tableRow',
                content: [
                  {
                    type: 'tableCell',
                    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'h-bar' }] }],
                  },
                  {
                    type: 'tableCell',
                    content: [{ type: 'paragraph', content: [{ type: 'text', text: '1.054e-34 J s' }] }],
                  },
                ],
              },
            ],
          },
        ],
      };

      const container: NoteContainerItem = {
        id: 'c-complex',
        type: 'container',
        x: 10,
        y: 10,
        w: 700,
        h: 900,
        doc: complexDoc,
      };

      const page: PageContent = P.addItems(P.emptyPage('p1'), [container]);
      await putAsset({
        id: 'r-mixed',
        blob: new Blob(['img'], { type: 'image/png' }),
        mime: 'image/png',
        createdAt: 1,
      });
      await putAsset({
        id: 'pdf-mixed',
        blob: new Blob(['pdf'], { type: 'application/pdf' }),
        mime: 'application/pdf',
        createdAt: 1,
      });
      await saveAll(ws, [page]);

      const result = await cleanupLegacyPdfRasterBlocks();
      expect(result.blocksRemoved).toBe(1);
      expect(result.orphanAssetsReclaimed).toBe(2);

      const updated = await loadPage('p1');
      const updatedContainer = updated?.items['c-complex'] as NoteContainerItem;
      expect(updatedContainer).toBeDefined();

      const docJson = JSON.stringify(updatedContainer.doc);
      // Legacy raster image is gone
      expect(docJson).not.toContain('r-mixed');
      // All other content preserved intact
      expect(docJson).toContain('Meccanica Quantistica');
      expect(docJson).toContain('i\\\\hbar');
      expect(docJson).toContain('def wave_function');
      expect(docJson).toContain('1.054e-34 J s');
      expect(docJson).toContain('tableHeader');
    });

    it('correctly prunes spacer paragraphs only when empty', () => {
      const docWithSpacers: JSONContent = {
        type: 'doc',
        content: [
          {
            type: 'imageBlock',
            attrs: { assetId: 'r1', source: { type: 'pdf', assetId: 'p', page: 1 } },
          },
          {
            type: 'paragraph', // Empty spacer: should be pruned
            content: [],
          },
          {
            type: 'imageBlock',
            attrs: { assetId: 'r2', source: { type: 'pdf', assetId: 'p', page: 2 } },
          },
          {
            type: 'paragraph', // Whitespace text: should be pruned as empty paragraph
            content: [{ type: 'text', text: '   ' }],
          },
          {
            type: 'imageBlock',
            attrs: { assetId: 'r3', source: { type: 'pdf', assetId: 'p', page: 3 } },
          },
          {
            type: 'paragraph', // Non-empty: MUST be preserved
            content: [{ type: 'text', text: 'Nota importante!' }],
          },
        ],
      };

      const { cleanedDoc, removedCount } = cleanDocAst(docWithSpacers);
      expect(removedCount).toBe(3);
      expect(cleanedDoc.content?.length).toBe(1);
      expect(cleanedDoc.content?.[0].content?.[0].text).toBe('Nota importante!');
    });
  });

  describe('3. Scale Testing: 100+ Pages and 1,000+ Items', () => {
    it('efficiently cleans 105 pages with 1,050 containers', async () => {
      let ws = W.emptyWorkspace();
      ws = W.createNotebook(ws, 'Large Notebook', 'nb-large');
      ws = W.createSection(ws, 'nb-large', 'Large Section', 's-large');

      const pages: PageContent[] = [];
      const TOTAL_PAGES = 105;
      const ASSETS_TO_PUT: string[] = [];

      for (let p = 1; p <= TOTAL_PAGES; p++) {
        const pageId = `page-${p}`;
        ws = W.createPage(ws, 's-large', `Page ${p}`, pageId);

        // 10 containers per page: 5 legacy PDF containers, 3 text containers, 2 user image containers
        const items: NoteContainerItem[] = [];
        for (let c = 1; c <= 10; c++) {
          const itemId = `c-${p}-${c}`;
          if (c <= 5) {
            // Legacy raster PDF container
            const rasterId = `raster-${p}-${c}`;
            ASSETS_TO_PUT.push(rasterId);
            items.push({
              id: itemId,
              type: 'container',
              x: c * 50,
              y: c * 50,
              w: 400,
              h: 300,
              freeImage: true,
              doc: {
                type: 'doc',
                content: [
                  {
                    type: 'imageBlock',
                    attrs: {
                      assetId: rasterId,
                      source: { type: 'pdf', assetId: 'shared-pdf-105', page: p },
                    },
                  },
                ],
              },
            });
          } else if (c <= 8) {
            // Text container
            items.push({
              id: itemId,
              type: 'container',
              x: c * 50,
              y: c * 50,
              w: 300,
              h: 150,
              doc: P.textDocFromPlain(`Appunto ${p}-${c}`),
            });
          } else {
            // User image container
            const userImgId = `user-photo-${p}-${c}`;
            ASSETS_TO_PUT.push(userImgId);
            items.push({
              id: itemId,
              type: 'container',
              x: c * 50,
              y: c * 50,
              w: 300,
              h: 200,
              freeImage: true,
              doc: {
                type: 'doc',
                content: [
                  {
                    type: 'imageBlock',
                    attrs: { assetId: userImgId },
                  },
                ],
              },
            });
          }
        }

        pages.push(P.addItems(P.emptyPage(pageId), items));
      }

      // Populate assets
      ASSETS_TO_PUT.push('shared-pdf-105');
      for (const aid of ASSETS_TO_PUT) {
        await putAsset({
          id: aid,
          blob: new Blob(['sample'], { type: aid.includes('pdf') ? 'application/pdf' : 'image/png' }),
          mime: aid.includes('pdf') ? 'application/pdf' : 'image/png',
          createdAt: 1,
        });
      }

      await saveAll(ws, pages);

      const startTime = performance.now();
      const result = await cleanupLegacyPdfRasterBlocks();
      const elapsedMs = performance.now() - startTime;

      expect(result.pagesScanned).toBe(105);
      expect(result.blocksRemoved).toBe(105 * 5); // 525 legacy blocks
      expect(result.modifiedPageIds.length).toBe(105);
      // 525 legacy raster assets + 1 shared-pdf-105 reclaimed = 526 assets
      expect(result.orphanAssetsReclaimed).toBe(526);
      expect(elapsedMs).toBeLessThan(5000); // Should run comfortably under 5 seconds

      // Verify that user image assets (105 * 2 = 210) remain intact in IDB
      const remainingAssets = await listAssetIds();
      expect(remainingAssets.length).toBe(105 * 2);
      expect(remainingAssets.every((id) => id.startsWith('user-photo-'))).toBe(true);

      // Verify that text containers remain intact
      const samplePage = await loadPage('page-42');
      expect(samplePage?.items['c-42-6']).toBeDefined();
      expect(samplePage?.items['c-42-9']).toBeDefined(); // user photo
      expect(samplePage?.items['c-42-1']).toBeUndefined(); // legacy block deleted
    });
  });

  describe('4. Concurrency, Re-entrancy, and Rapid Re-runs', () => {
    it('handles rapid re-runs and multiple concurrent cleanup calls safely', async () => {
      const ws = createTestWorkspace('p1');
      const page: PageContent = P.addItems(P.emptyPage('p1'), [
        {
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
                attrs: { assetId: 'r-race', source: { type: 'pdf', assetId: 'pdf-race', page: 1 } },
              },
            ],
          },
        },
      ]);

      await putAsset({
        id: 'r-race',
        blob: new Blob(['raster'], { type: 'image/png' }),
        mime: 'image/png',
        createdAt: 1,
      });
      await putAsset({
        id: 'pdf-race',
        blob: new Blob(['pdf'], { type: 'application/pdf' }),
        mime: 'application/pdf',
        createdAt: 1,
      });
      await saveAll(ws, [page]);

      // Fire 3 cleanup calls concurrently
      const results = await Promise.all([
        cleanupLegacyPdfRasterBlocks(),
        cleanupLegacyPdfRasterBlocks(),
        cleanupLegacyPdfRasterBlocks(),
      ]);

      // At least one cleans it up; total blocks removed across runs should not result in corrupted state
      const totalBlocksRemoved = results.reduce((sum, r) => sum + r.blocksRemoved, 0);
      expect(totalBlocksRemoved).toBeGreaterThanOrEqual(1);

      // Verify final state in DB is consistent and clean
      const updatedPage = await loadPage('p1');
      expect(updatedPage?.items.c1).toBeUndefined();

      const remainingAssets = await listAssetIds();
      expect(remainingAssets).toEqual([]);

      // Check pre-cleanup backup exists and is valid
      const backup = await getPreLegacyCleanupBackup();
      expect(backup).toBeDefined();
      expect(backup?.pages.length).toBe(1);
    });
  });

  describe('5. Asset Garbage Collection & Cross-Page References', () => {
    it('preserves shared PDF asset if another page references it via live mode or normal reference', async () => {
      let ws = W.emptyWorkspace();
      ws = W.createNotebook(ws, 'Nb', 'nb');
      ws = W.createSection(ws, 'nb', 'Sec', 'sec');
      ws = W.createPage(ws, 'sec', 'Page 1', 'p1');
      ws = W.createPage(ws, 'sec', 'Page 2', 'p2');

      const sharedPdfId = 'pdf-shared-asset';
      const p1RasterId = 'raster-p1';

      // Page 1: Legacy raster block pointing to sharedPdfId
      const p1: PageContent = P.addItems(P.emptyPage('p1'), [
        {
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
                attrs: { assetId: p1RasterId, source: { type: 'pdf', assetId: sharedPdfId, page: 1 } },
              },
            ],
          },
        },
      ]);

      // Page 2: Live PDF block pointing to the SAME sharedPdfId
      const p2: PageContent = P.addItems(P.emptyPage('p2'), [
        {
          id: 'c2',
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
                attrs: { assetId: '', source: { type: 'pdf', assetId: sharedPdfId, page: 2, mode: 'live' } },
              },
            ],
          },
        },
      ]);

      await putAsset({
        id: p1RasterId,
        blob: new Blob(['raster'], { type: 'image/png' }),
        mime: 'image/png',
        createdAt: 1,
      });
      await putAsset({
        id: sharedPdfId,
        blob: new Blob(['pdf-content'], { type: 'application/pdf' }),
        mime: 'application/pdf',
        createdAt: 1,
      });
      await saveAll(ws, [p1, p2]);

      const res = await cleanupLegacyPdfRasterBlocks();
      expect(res.blocksRemoved).toBe(1);
      // Only the raster asset should be reclaimed! The shared PDF must NOT be reclaimed!
      expect(res.orphanAssetsReclaimed).toBe(1);

      const remainingAssets = await listAssetIds();
      expect(remainingAssets).toEqual([sharedPdfId]);

      const sharedAsset = await getAsset(sharedPdfId);
      expect(sharedAsset).toBeDefined();

      const loadedP2 = await loadPage('p2');
      expect(loadedP2?.items.c2).toBeDefined();
    });

    it('probes whether TextItem (type: text) with doc image blocks protects assets during GC', async () => {
      // In AuraNotes, CanvasItem can be NoteContainerItem OR TextItem (both have doc: JSONContent)
      const ws = createTestWorkspace('p1');
      const textItemWithImage: TextItem = {
        id: 't1',
        type: 'text',
        x: 10,
        y: 10,
        w: 300,
        h: 200,
        variant: 'plain',
        doc: {
          type: 'doc',
          content: [
            {
              type: 'imageBlock',
              attrs: { assetId: 'img-in-text-item' },
            },
          ],
        },
      };

      const page: PageContent = P.addItems(P.emptyPage('p1'), [textItemWithImage]);
      await putAsset({
        id: 'img-in-text-item',
        blob: new Blob(['data'], { type: 'image/png' }),
        mime: 'image/png',
        createdAt: 1,
      });
      await saveAll(ws, [page]);

      // Check what referencedAssets(page) returns
      const refs = P.referencedAssets(page);
      expect(refs.has('img-in-text-item')).toBe(true);

      // Run GC
      const reclaimed = await garbageCollectAssets();
      expect(reclaimed).toBe(0);

      const stillThere = await getAsset('img-in-text-item');
      expect(stillThere).toBeDefined();
    });
  });

  describe('6. Exhaustive False Positive and False Negative Matrix', () => {
    it('tests all permutations of node attributes to ensure zero false positives/negatives', () => {
      const cases: Array<{
        name: string;
        node: JSONContent;
        expectedLegacy: boolean;
      }> = [
        {
          name: 'Classic legacy raster block',
          node: {
            type: 'imageBlock',
            attrs: { assetId: 'asset-1', source: { type: 'pdf', assetId: 'pdf-1', page: 1 } },
          },
          expectedLegacy: true,
        },
        {
          name: 'Live PDF block (M2 specification: assetId is empty string)',
          node: {
            type: 'imageBlock',
            attrs: { assetId: '', source: { type: 'pdf', assetId: 'pdf-1', page: 1, mode: 'live' } },
          },
          expectedLegacy: false,
        },
        {
          name: 'Live PDF block without mode attr but assetId is empty string',
          node: {
            type: 'imageBlock',
            attrs: { assetId: '', source: { type: 'pdf', assetId: 'pdf-1', page: 1 } },
          },
          expectedLegacy: false,
        },
        {
          name: 'Live PDF block with null assetId',
          node: {
            type: 'imageBlock',
            attrs: { assetId: null, source: { type: 'pdf', assetId: 'pdf-1', page: 1 } },
          },
          expectedLegacy: false,
        },
        {
          name: 'Live PDF block with undefined assetId',
          node: {
            type: 'imageBlock',
            attrs: { source: { type: 'pdf', assetId: 'pdf-1', page: 1 } },
          },
          expectedLegacy: false,
        },
        {
          name: 'Normal user photo (no source attribute)',
          node: {
            type: 'imageBlock',
            attrs: { assetId: 'photo-1' },
          },
          expectedLegacy: false,
        },
        {
          name: 'Normal user photo with empty object source',
          node: {
            type: 'imageBlock',
            attrs: { assetId: 'photo-1', source: {} },
          },
          expectedLegacy: false,
        },
        {
          name: 'Normal user photo with source.type non-pdf (e.g. camera, web)',
          node: {
            type: 'imageBlock',
            attrs: { assetId: 'photo-1', source: { type: 'web', url: 'https://example.com' } },
          },
          expectedLegacy: false,
        },
        {
          name: 'Legacy block with whitespace-padded assetId',
          node: {
            type: 'imageBlock',
            attrs: { assetId: '  asset-1  ', source: { type: 'pdf', assetId: 'pdf-1', page: 1 } },
          },
          expectedLegacy: true,
        },
        {
          name: 'Block with whitespace-only assetId',
          node: {
            type: 'imageBlock',
            attrs: { assetId: '   ', source: { type: 'pdf', assetId: 'pdf-1', page: 1 } },
          },
          expectedLegacy: false, // whitespace-only is treated as empty raster
        },
        {
          name: 'Block with uppercase source type (PDF)',
          node: {
            type: 'imageBlock',
            attrs: { assetId: 'asset-1', source: { type: 'PDF', assetId: 'pdf-1', page: 1 } },
          },
          expectedLegacy: false, // Strict type check === 'pdf'
        },
        {
          name: 'Non-imageBlock node (paragraph with legacy-like attrs)',
          node: {
            type: 'paragraph',
            attrs: { assetId: 'asset-1', source: { type: 'pdf', assetId: 'pdf-1', page: 1 } },
          },
          expectedLegacy: false,
        },
      ];

      for (const tc of cases) {
        expect(isLegacyPdfRasterBlock(tc.node), tc.name).toBe(tc.expectedLegacy);
      }
    });
  });
});
