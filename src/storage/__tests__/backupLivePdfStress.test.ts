import { describe, expect, it } from 'vitest';
import { BACKUP_FORMAT, remapBackup, type BackupFile } from '../backup';
import * as W from '../../model/workspaceOps';
import * as P from '../../model/pageOps';
import { SCHEMA_VERSION, type CanvasItem, type ConnectorItem, type ImageItem, type NoteContainerItem } from '../../types';

describe('Adversarial Stress Test: Backup Remapping Invariants (Milestone 2)', () => {
  it('preserves assetId: \'\' across complex multi-page, multi-container structures with shared PDF assets', () => {
    const pdfAsset1 = 'pdf-raw-chem-101';
    const pdfAsset2 = 'pdf-raw-phys-202';
    const rasterAsset1 = 'raster-user-photo-1';
    const rasterAsset2 = 'raster-user-diagram-2';

    let ws = W.emptyWorkspace();
    // Create 3 notebooks, each with 2 sections, each with 2 pages (total 12 pages)
    const pageIds: string[] = [];
    for (let nbIdx = 1; nbIdx <= 3; nbIdx++) {
      const nbId = `nb-${nbIdx}`;
      ws = W.createNotebook(ws, `Notebook ${nbIdx}`, nbId);
      for (let secIdx = 1; secIdx <= 2; secIdx++) {
        const secId = `sec-${nbIdx}-${secIdx}`;
        ws = W.createSection(ws, nbId, `Section ${nbIdx}.${secIdx}`, secId);
        for (let pageIdx = 1; pageIdx <= 2; pageIdx++) {
          const pageId = `page-${nbIdx}-${secIdx}-${pageIdx}`;
          ws = W.createPage(ws, secId, `Page ${nbIdx}.${secIdx}.${pageIdx}`, pageId);
          pageIds.push(pageId);
        }
      }
    }

    const pages = pageIds.map((pid, idx) => {
      let page = P.emptyPage(pid);
      const items: CanvasItem[] = [];

      // Item 1: Container with multiple live vector PDF blocks referencing pdfAsset1
      const container1: NoteContainerItem = {
        id: `c-live-${idx}`,
        type: 'container',
        x: 100,
        y: 100,
        w: 700,
        h: 900,
        doc: {
          type: 'doc',
          content: [
            {
              type: 'heading',
              attrs: { level: 1 },
              content: [{ type: 'text', text: `Lecture Notes ${idx}` }],
            },
            {
              type: 'imageBlock',
              attrs: {
                id: `ib-live-1-${idx}`,
                assetId: '', // Live vector PDF invariant
                width: 700,
                naturalWidth: 1400,
                naturalHeight: 1800,
                mime: 'application/pdf',
                source: {
                  type: 'pdf',
                  assetId: pdfAsset1,
                  page: (idx % 10) + 1,
                  mode: 'live',
                },
              },
            },
            // Nested block inside a blockquote
            {
              type: 'blockquote',
              content: [
                {
                  type: 'imageBlock',
                  attrs: {
                    id: `ib-live-nested-${idx}`,
                    assetId: '', // Live vector PDF invariant
                    width: 500,
                    naturalWidth: 1000,
                    naturalHeight: 1200,
                    source: {
                      type: 'pdf',
                      assetId: pdfAsset2,
                      page: ((idx + 2) % 10) + 1,
                      mode: 'live',
                    },
                  },
                },
              ],
            },
          ],
        },
      };
      items.push(container1);

      // Item 2: Container with traditional raster image (assetId MUST be remapped)
      const container2: NoteContainerItem = {
        id: `c-raster-${idx}`,
        type: 'container',
        x: 850,
        y: 100,
        w: 400,
        h: 500,
        doc: {
          type: 'doc',
          content: [
            {
              type: 'imageBlock',
              attrs: {
                id: `ib-raster-${idx}`,
                assetId: rasterAsset1, // Traditional raster asset
                width: 400,
                naturalWidth: 800,
                naturalHeight: 600,
              },
            },
          ],
        },
      };
      items.push(container2);

      // Item 3: Standalone image item on the canvas
      const standaloneImg: ImageItem = {
        id: `img-standalone-${idx}`,
        type: 'image',
        x: 100,
        y: 1050,
        w: 300,
        h: 200,
        rotation: 0,
        assetId: rasterAsset2,
        naturalWidth: 600,
        naturalHeight: 400,
        mime: 'image/png',
      };
      items.push(standaloneImg);

      // Item 4: Connector between container1 and container2
      const connector: ConnectorItem = {
        id: `conn-${idx}`,
        type: 'connector',
        fromId: `c-live-${idx}`,
        toId: `c-raster-${idx}`,
        fromAnchor: 'auto',
        toAnchor: 'auto',
        arrow: 'end',
        color: '#000000',
        width: 2,
        layer: 'back',
      };
      items.push(connector);

      return P.addItems(page, items);
    });

    const backup: BackupFile = {
      format: BACKUP_FORMAT,
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      workspace: ws,
      pages,
      assets: [
        { id: pdfAsset1, mime: 'application/pdf', data: 'data:application/pdf;base64,PDF1' },
        { id: pdfAsset2, mime: 'application/pdf', data: 'data:application/pdf;base64,PDF2' },
        { id: rasterAsset1, mime: 'image/png', data: 'data:image/png;base64,PNG1' },
        { id: rasterAsset2, mime: 'image/png', data: 'data:image/png;base64,PNG2' },
      ],
    };

    // Execute remapping
    const remapped = remapBackup(backup);

    // 1. Verify assets remapping map
    expect(remapped.assets).toHaveLength(4);
    for (let i = 0; i < backup.assets.length; i++) {
      expect(remapped.assets[i].id).not.toBe(backup.assets[i].id);
      expect(remapped.assets[i].mime).toBe(backup.assets[i].mime);
      expect(remapped.assets[i].data).toBe(backup.assets[i].data);
    }
    const newPdfAsset1 = remapped.assets[0].id;
    const newPdfAsset2 = remapped.assets[1].id;
    const newRasterAsset1 = remapped.assets[2].id;
    const newRasterAsset2 = remapped.assets[3].id;

    expect(new Set([newPdfAsset1, newPdfAsset2, newRasterAsset1, newRasterAsset2]).size).toBe(4);

    // 2. Scan all 12 remapped pages and all containers
    expect(remapped.pages).toHaveLength(12);

    for (let i = 0; i < remapped.pages.length; i++) {
      const page = remapped.pages[i];
      const items = Object.values(page.items);

      const liveContainer = items.find((it) => it.type === 'container' && (it as any).doc?.content?.[1]?.attrs?.source?.mode === 'live') as NoteContainerItem;
      expect(liveContainer).toBeDefined();

      const liveDoc = liveContainer.doc as { content: Array<{ type: string; attrs?: any; content?: any[] }> };
      const liveBlock1 = liveDoc.content[1];
      expect(liveBlock1.type).toBe('imageBlock');
      // Invariant: attrs.assetId MUST remain strictly empty string ''
      expect(liveBlock1.attrs.assetId).toBe('');
      // Invariant: source.assetId MUST be mapped to newPdfAsset1 consistently
      expect(liveBlock1.attrs.source.assetId).toBe(newPdfAsset1);
      expect(liveBlock1.attrs.source.mode).toBe('live');

      // Nested live block inside blockquote
      const blockquote = liveDoc.content[2];
      expect(blockquote.type).toBe('blockquote');
      const nestedLiveBlock = blockquote.content![0];
      expect(nestedLiveBlock.type).toBe('imageBlock');
      expect(nestedLiveBlock.attrs.assetId).toBe('');
      expect(nestedLiveBlock.attrs.source.assetId).toBe(newPdfAsset2);
      expect(nestedLiveBlock.attrs.source.mode).toBe('live');

      // Raster container
      const rasterContainer = items.find((it) => it.type === 'container' && (it as any).doc?.content?.[0]?.attrs?.assetId === newRasterAsset1) as NoteContainerItem;
      expect(rasterContainer).toBeDefined();
      const rasterDoc = rasterContainer.doc as { content: Array<{ type: string; attrs?: any }> };
      expect(rasterDoc.content[0].attrs.assetId).toBe(newRasterAsset1);
      expect(rasterDoc.content[0].attrs.source).toBeUndefined();

      // Standalone image item
      const standalone = items.find((it) => it.type === 'image') as ImageItem;
      expect(standalone).toBeDefined();
      expect(standalone.assetId).toBe(newRasterAsset2);

      // Connector endpoints
      const connector = items.find((it) => it.type === 'connector') as ConnectorItem;
      expect(connector).toBeDefined();
      expect(connector.fromId).toBe(liveContainer.id);
      expect(connector.toId).toBe(rasterContainer.id);
    }
  });

  it('handles deep AST nesting (tables, cells, callouts) and multiple live PDF blocks in a single container', () => {
    const pdfAssetId = 'pdf-slides-deep';
    let ws = W.emptyWorkspace();
    ws = W.createNotebook(ws, 'Deep AST NB', 'nb-deep');
    ws = W.createSection(ws, 'nb-deep', 'Deep AST Sec', 'sec-deep');
    ws = W.createPage(ws, 'sec-deep', 'Deep AST Page', 'page-deep');

    // TipTap table containing image blocks in table cells
    const tableContainer: NoteContainerItem = {
      id: 'c-table',
      type: 'container',
      x: 50,
      y: 50,
      w: 800,
      h: 600,
      doc: {
        type: 'doc',
        content: [
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
                        attrs: {
                          assetId: '',
                          width: 300,
                          naturalWidth: 600,
                          naturalHeight: 400,
                          source: { type: 'pdf', assetId: pdfAssetId, page: 1, mode: 'live' },
                        },
                      },
                    ],
                  },
                  {
                    type: 'tableCell',
                    content: [
                      {
                        type: 'imageBlock',
                        attrs: {
                          assetId: '',
                          width: 300,
                          naturalWidth: 600,
                          naturalHeight: 400,
                          source: { type: 'pdf', assetId: pdfAssetId, page: 2, mode: 'live' },
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    };

    const page = P.addItems(P.emptyPage('page-deep'), [tableContainer]);
    const backup: BackupFile = {
      format: BACKUP_FORMAT,
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      workspace: ws,
      pages: [page],
      assets: [{ id: pdfAssetId, mime: 'application/pdf', data: 'data:application/pdf;base64,JVBERi0x' }],
    };

    const remapped = remapBackup(backup);
    const newPdfId = remapped.assets[0].id;

    const cell1Block = (remapped.pages[0].items[Object.keys(remapped.pages[0].items)[0]] as any).doc
      .content[0].content[0].content[0].content[0];
    const cell2Block = (remapped.pages[0].items[Object.keys(remapped.pages[0].items)[0]] as any).doc
      .content[0].content[0].content[1].content[0];

    expect(cell1Block.attrs.assetId).toBe('');
    expect(cell1Block.attrs.source.assetId).toBe(newPdfId);
    expect(cell1Block.attrs.source.page).toBe(1);

    expect(cell2Block.attrs.assetId).toBe('');
    expect(cell2Block.attrs.source.assetId).toBe(newPdfId);
    expect(cell2Block.attrs.source.page).toBe(2);
  });

  it('handles adversarial malformed attrs without crashing or corrupting structure', () => {
    let ws = W.emptyWorkspace();
    ws = W.createNotebook(ws, 'Edge NB', 'nb-edge');
    ws = W.createSection(ws, 'nb-edge', 'Edge Sec', 'sec-edge');
    ws = W.createPage(ws, 'sec-edge', 'Edge Page', 'page-edge');

    const edgeContainer: NoteContainerItem = {
      id: 'c-edge',
      type: 'container',
      x: 0,
      y: 0,
      w: 500,
      h: 500,
      doc: {
        type: 'doc',
        content: [
          // Missing attrs
          { type: 'imageBlock' },
          // attrs with null / undefined assetId
          { type: 'imageBlock', attrs: { assetId: null } },
          { type: 'imageBlock', attrs: { assetId: undefined } },
          // attrs with empty source
          { type: 'imageBlock', attrs: { assetId: '', source: null } },
          { type: 'imageBlock', attrs: { assetId: '', source: {} } },
          // attrs with source having empty assetId
          { type: 'imageBlock', attrs: { assetId: '', source: { type: 'pdf', assetId: '', page: 1 } } },
          // non-object content items
          null as unknown as any,
          undefined as unknown as any,
          'unexpected string' as unknown as any,
        ],
      },
    };

    const page = P.addItems(P.emptyPage('page-edge'), [edgeContainer]);
    const backup: BackupFile = {
      format: BACKUP_FORMAT,
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      workspace: ws,
      pages: [page],
      assets: [],
    };

    expect(() => remapBackup(backup)).not.toThrow();
    const remapped = remapBackup(backup);
    const content = (Object.values(remapped.pages[0].items)[0] as NoteContainerItem).doc.content!;

    expect(content[1].attrs?.assetId).toBeNull();
    expect(content[2].attrs?.assetId).toBeUndefined();
    expect(content[3].attrs?.assetId).toBe('');
    expect(content[5].attrs?.assetId).toBe('');
    expect((content[5].attrs?.source as Record<string, unknown> | undefined)?.assetId).toBe('');
  });

  it('is idempotent across multiple consecutive remap cycles', () => {
    const rawPdf = 'pdf-raw-cycle';
    let ws = W.emptyWorkspace();
    ws = W.createNotebook(ws, 'Cycle NB', 'nb-c');
    ws = W.createSection(ws, 'nb-c', 'Cycle Sec', 'sec-c');
    ws = W.createPage(ws, 'sec-c', 'Cycle Page', 'page-c');

    const container: NoteContainerItem = {
      id: 'c-cycle',
      type: 'container',
      x: 10,
      y: 10,
      w: 600,
      h: 800,
      doc: {
        type: 'doc',
        content: [
          {
            type: 'imageBlock',
            attrs: {
              assetId: '',
              source: { type: 'pdf', assetId: rawPdf, page: 5, mode: 'live' },
            },
          },
        ],
      },
    };

    const page = P.addItems(P.emptyPage('page-c'), [container]);
    const backup1: BackupFile = {
      format: BACKUP_FORMAT,
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      workspace: ws,
      pages: [page],
      assets: [{ id: rawPdf, mime: 'application/pdf', data: 'data:application/pdf;base64,AAA' }],
    };

    const backup2 = remapBackup(backup1);
    const backup3 = remapBackup(backup2);
    const backup4 = remapBackup(backup3);

    const getBlock = (b: BackupFile) => (Object.values(b.pages[0].items)[0] as NoteContainerItem).doc.content![0];

    expect(getBlock(backup2).attrs?.assetId).toBe('');
    expect(getBlock(backup3).attrs?.assetId).toBe('');
    expect(getBlock(backup4).attrs?.assetId).toBe('');

    expect(getBlock(backup4).attrs?.source.assetId).toBe(backup4.assets[0].id);
    expect(getBlock(backup4).attrs?.source.page).toBe(5);
    expect(getBlock(backup4).attrs?.source.mode).toBe('live');
  });
});
