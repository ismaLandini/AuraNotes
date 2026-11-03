import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { getAsset, loadPage, loadWorkspace, putAsset, resetDBConnection, saveAll, migrateWorkspace, getDB, getV1Backup, getV2Backup, getPreOcrRemovalBackup, listAssetIds } from './db';
import { clearAssetUrlCache, computeBlobHash, importAssetBlob, importImageBlob } from './assets';
import { buildBackup, mergeWorkspaces, remapBackup, validateBackup, BackupValidationError } from './backup';
import * as W from '../model/workspaceOps';
import * as P from '../model/pageOps';
import { SCHEMA_VERSION, type ConnectorItem, type ImageItem, type NoteContainerItem, type PageContent } from '../types';

beforeEach(async () => {
  clearAssetUrlCache();
  await resetDBConnection();
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
});

function fixture() {
  let ws = W.emptyWorkspace();
  ws = W.createNotebook(ws, 'Fisica', 'nb');
  ws = W.createSection(ws, 'nb', 'Meccanica', 's');
  ws = W.createPage(ws, 's', 'Cinematica', 'p');
  const img: ImageItem = { id: 'i', type: 'image', x: 0, y: 0, w: 100, h: 80, rotation: 0, assetId: 'asset1', naturalWidth: 100, naturalHeight: 80, mime: 'image/png' };
  const page: PageContent = P.addItems(P.emptyPage('p'), [
    { id: 't', type: 'text', x: 10, y: 10, w: 200, h: 40, doc: P.textDocFromPlain('v = s / t'), variant: 'plain' },
    img,
    { id: 'a', type: 'stroke', parentId: 'i', points: [0.1, 0.2, 0.3, 0.4], color: '#f00', width: 2, opacity: 1, tool: 'pen' },
    { id: 'c', type: 'connector', fromId: 't', toId: 'i', fromAnchor: 'auto', toAnchor: 'auto', arrow: 'end', color: '#00f', width: 2, layer: 'back' },
  ]);
  return { ws, page };
}

describe('IndexedDB persistence', () => {
  it('saves and reloads the workspace and page content', async () => {
    const { ws, page } = fixture();
    await saveAll(ws, [page]);
    const loaded = await loadWorkspace();
    expect(loaded?.pages.p.title).toBe('Cinematica');
    const p = await loadPage('p');
    expect(Object.keys(p!.items).sort()).toEqual(['a', 'c', 'i', 't']);
    expect((p!.items.a as { parentId?: string }).parentId).toBe('i');
  });

  it('stores image blobs persistently', async () => {
    await putAsset({ id: 'asset1', blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }), mime: 'image/png', createdAt: 1 });
    const a = await getAsset('asset1');
    expect(a?.mime).toBe('image/png');
    expect(a?.blob.size).toBe(3);
  });

  it('rejects unknown snapshots during migration', () => {
    expect(migrateWorkspace(null)).toBeNull();
    expect(migrateWorkspace({ foo: 1 })).toBeNull();
    expect(migrateWorkspace({ ...W.emptyWorkspace(), trash: undefined })?.trash).toEqual([]);
  });
});

describe('backup', () => {
  it('builds a self-contained backup that validates', async () => {
    const { ws, page } = fixture();
    await putAsset({ id: 'asset1', blob: new Blob(['png-bytes'], { type: 'image/png' }), mime: 'image/png', createdAt: 1 });
    await saveAll(ws, [page]);
    const b = await buildBackup(ws, {});
    expect(b.pages).toHaveLength(1);
    expect(b.assets).toHaveLength(1);
    expect(b.assets[0].data.startsWith('data:image/png')).toBe(true);
    const roundTrip = validateBackup(JSON.parse(JSON.stringify(b)));
    expect(roundTrip.workspace.pages.p.title).toBe('Cinematica');
  });

  it('rejects invalid files with a readable message', () => {
    expect(() => validateBackup({ hello: 'world' })).toThrow(BackupValidationError);
    expect(() => validateBackup({ format: 'glassnote-backup', schemaVersion: 1, workspace: W.emptyWorkspace(), pages: [{ id: 'x', items: { a: { id: 'a', type: 'bogus' } }, order: [] }], assets: [] })).toThrow(/danneggiato/);
  });

  it('remaps ids so a merge never collides with existing data', async () => {
    const { ws, page } = fixture();
    const backup = { format: 'glassnote-backup' as const, schemaVersion: 1, exportedAt: '', workspace: ws, pages: [page], assets: [{ id: 'asset1', mime: 'image/png', data: 'data:image/png;base64,AAAA' }] };
    const r = remapBackup(backup);
    const newPage = r.pages[0];
    expect(newPage.id).not.toBe('p');
    const items = Object.values(newPage.items);
    const img = items.find((i) => i.type === 'image') as ImageItem;
    const ann = items.find((i) => i.type === 'stroke')!;
    const c = items.find((i) => i.type === 'connector')!;
    expect(img.assetId).toBe(r.assets[0].id);
    expect(ann.parentId).toBe(img.id);
    expect(c.type === 'connector' && c.toId === img.id).toBe(true);
    const merged = mergeWorkspaces(ws, r.workspace);
    expect(merged.notebookIds).toHaveLength(2);
    expect(Object.keys(merged.pages)).toHaveLength(2);
  });
});

describe('Schema migration V1 to V2', () => {
  it('migrates legacy text and image items to NoteContainer items', () => {
    const rawV1Page: PageContent = {
      id: 'page1',
      schemaVersion: 1,
      items: {
        t1: { id: 't1', type: 'text', x: 20, y: 30, w: 300, h: 50, doc: P.textDocFromPlain('Appunti di Fisica'), variant: 'plain', customW: true },
        img1: { id: 'img1', type: 'image', x: 100, y: 200, w: 400, h: 250, rotation: 90, assetId: 'ast-1', naturalWidth: 800, naturalHeight: 500, mime: 'image/jpeg' },
        ann1: { id: 'ann1', type: 'stroke', parentId: 'img1', points: [0.1, 0.1, 0.9, 0.9], color: '#f00', width: 2, opacity: 1, tool: 'pen' },
        conn1: { id: 'conn1', type: 'connector', fromId: 't1', toId: 'img1', fromAnchor: 'auto', toAnchor: 'auto', arrow: 'end', color: '#000', width: 2, layer: 'back' },
      },
      order: ['t1', 'img1', 'ann1', 'conn1'],
    };

    const v2 = P.migratePageV1toV2(rawV1Page);
    expect(v2.schemaVersion).toBe(2);
    expect(v2.order).toEqual(['t1', 'img1', 'ann1', 'conn1']);

    // Check text container
    const t = v2.items.t1 as NoteContainerItem;
    expect(t.type).toBe('container');
    expect(t.x).toBe(20);
    expect(t.y).toBe(30);
    expect(t.w).toBe(300);
    expect(t.customW).toBe(true);
    expect(P.docToText(t.doc)).toBe('Appunti di Fisica');

    // Check image container
    const img = v2.items.img1 as NoteContainerItem;
    expect(img.type).toBe('container');
    expect(img.freeImage).toBe(true);
    expect(img.x).toBe(100);
    expect(img.y).toBe(200);
    expect(img.w).toBe(400);
    expect(img.h).toBe(250);
    expect(img.doc.type).toBe('doc');
    const imageBlock = img.doc.content?.[0];
    expect(imageBlock?.type).toBe('imageBlock');
    expect(imageBlock?.attrs?.assetId).toBe('ast-1');
    expect(imageBlock?.attrs?.rotation).toBe(90);
    expect(imageBlock?.attrs?.naturalWidth).toBe(800);
    expect(imageBlock?.attrs?.naturalHeight).toBe(500);
    expect(imageBlock?.attrs?.annotations).toHaveLength(1);
    expect(imageBlock?.attrs?.annotations[0].id).toBe('ann1');

    // Connectors still intact
    const conn = v2.items.conn1 as ConnectorItem;
    expect(conn.fromId).toBe('t1');
    expect(conn.toId).toBe('img1');
  });

  it('performs automatic backup of v1 workspace before migration', async () => {
    const { ws, page } = fixture();
    const v1ws = { ...ws, schemaVersion: 1 };
    const db = await getDB();
    await db.put('kv', v1ws, 'workspace');
    await db.put('pages', { ...page, schemaVersion: 1 });

    const loaded = await loadWorkspace();
    expect(loaded?.schemaVersion).toBe(SCHEMA_VERSION);

    const backup = await getV1Backup();
    expect(backup).toBeDefined();
    expect(backup?.ws.schemaVersion).toBe(1);
    expect(backup?.pages).toHaveLength(1);
  });

  it('referencedAssets extracts image assets from both ImageItem and container imageBlock', () => {
    const page: PageContent = {
      id: 'p1',
      schemaVersion: 2,
      items: {
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
              { type: 'paragraph', content: [{ type: 'text', text: 'hello' }] },
              { type: 'imageBlock', attrs: { assetId: 'embedded-asset-123' } },
            ],
          },
        },
      },
      order: ['c1'],
    };

    const assets = P.referencedAssets(page);
    expect(assets.has('embedded-asset-123')).toBe(true);
  });

  it('docToText and pageSearchText do not index OCR text, but preserve manual alt text', () => {
    const page: PageContent = {
      id: 'p1',
      schemaVersion: 2,
      items: {
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
              { type: 'paragraph', content: [{ type: 'text', text: 'Nota' }] },
              {
                type: 'imageBlock',
                attrs: {
                  assetId: 'a1',
                  alt: 'Descrizione accessibile manuale',
                  ocr: { text: 'Testo rilevato da OCR scanner' },
                  highlights: [{ id: 'h1', text: 'evidenziato' }],
                },
              },
            ],
          },
        },
      },
      order: ['c1'],
    };

    const search = P.pageSearchText(page);
    expect(search).toContain('Nota');
    expect(search).toContain('Descrizione accessibile manuale');
    expect(search).not.toContain('Testo rilevato da OCR scanner');
    expect(search).not.toContain('evidenziato');
  });

  it('removes legacy OCR cache and strips OCR attributes from pages while preserving all content and creating backup', async () => {
    const { ws, page } = fixture();
    const db = await getDB();

    // 1. Seed legacy OCR cache in 'kv'
    await db.put('kv', { text: 'vecchio testo ocr', lines: [] }, 'ocr:samplehash123');
    await db.put('kv', { text: 'altro ocr', lines: [] }, 'ocr:samplehash456');

    // 2. Seed a page with an imageBlock containing legacy ocr and highlights attributes
    const legacyPage: PageContent = {
      ...page,
      items: {
        ...page.items,
        c_legacy: {
          id: 'c_legacy',
          type: 'container',
          x: 50,
          y: 60,
          w: 300,
          h: 200,
          doc: {
            type: 'doc',
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'Testo nota' }] },
              {
                type: 'imageBlock',
                attrs: {
                  assetId: 'asset1',
                  alt: 'Didascalia',
                  ocr: { text: 'Da rimuovere' },
                  highlights: [{ id: 'hl1', text: 'evidenziazione' }],
                  annotations: [{ id: 'strk1', tool: 'pen', points: [0, 0, 1, 1], color: '#f00', width: 2, opacity: 1 }],
                },
              },
            ],
          },
        },
      },
      order: [...page.order, 'c_legacy'],
    };

    await db.put('kv', ws, 'workspace');
    await db.put('pages', legacyPage);

    // 3. Trigger loadWorkspace which executes backupBeforeOcrRemovalIfNeeded and cleanupOcrDataFromDB
    const loadedWs = await loadWorkspace();
    expect(loadedWs).toBeDefined();

    // 4. Verify backup was created
    const backup = await getPreOcrRemovalBackup();
    expect(backup).toBeDefined();
    expect(backup?.pages).toHaveLength(1);
    expect(backup?.pages[0].id).toBe('p');

    // 5. Verify kv ocr:* keys were removed
    const ocr1 = await db.get('kv', 'ocr:samplehash123');
    const ocr2 = await db.get('kv', 'ocr:samplehash456');
    expect(ocr1).toBeUndefined();
    expect(ocr2).toBeUndefined();

    // 6. Verify page in DB was cleaned: ocr and highlights stripped, everything else intact
    const loadedPage = await loadPage('p');
    expect(loadedPage).toBeDefined();
    const container = loadedPage!.items.c_legacy as NoteContainerItem;
    expect(container).toBeDefined();
    expect(container.x).toBe(50);
    expect(container.y).toBe(60);
    expect(container.w).toBe(300);

    const docContent = container.doc.content!;
    expect(docContent[0]).toEqual({ type: 'paragraph', content: [{ type: 'text', text: 'Testo nota' }] });

    const imgBlock = docContent[1];
    expect(imgBlock.type).toBe('imageBlock');
    expect(imgBlock.attrs?.assetId).toBe('asset1');
    expect(imgBlock.attrs?.alt).toBe('Didascalia');
    expect(imgBlock.attrs?.annotations).toEqual([{ id: 'strk1', tool: 'pen', points: [0, 0, 1, 1], color: '#f00', width: 2, opacity: 1 }]);
    expect(imgBlock.attrs?.ocr).toBeUndefined();
    expect(imgBlock.attrs?.highlights).toBeUndefined();

    // Verify existing non-container items (strokes, connectors, images) remain 100% intact
    expect(loadedPage!.items.t).toBeDefined();
    expect(loadedPage!.items.i).toBeDefined();
    expect(loadedPage!.items.a).toBeDefined();
    expect(loadedPage!.items.c).toBeDefined();

    // 7. Verify idempotence: second run does not fail or overwrite backup
    const backupTimestamp = backup?.backedUpAt;
    await loadWorkspace();
    const backupAfter = await getPreOcrRemovalBackup();
    expect(backupAfter?.backedUpAt).toBe(backupTimestamp);
  });
});

describe('Schema migration V2 to V3 and Asset Deduplication', () => {
  it('performs automatic backup of v2 workspace before migrating to v3, and is idempotent', async () => {
    const { ws, page } = fixture();
    const v2ws = { ...ws, schemaVersion: 2 };
    const v2page = { ...P.migratePageV1toV2(page), schemaVersion: 2 };
    const db = await getDB();
    await db.put('kv', v2ws, 'workspace');
    await db.put('pages', v2page);

    const loaded = await loadWorkspace();
    expect(loaded?.schemaVersion).toBe(3);

    const backup = await getV2Backup();
    expect(backup).toBeDefined();
    expect(backup?.ws.schemaVersion).toBe(2);
    expect(backup?.pages).toHaveLength(1);

    // Idempotent second run
    const ts = backup?.backedUpAt;
    await loadWorkspace();
    const backup2 = await getV2Backup();
    expect(backup2?.backedUpAt).toBe(ts);
  });

  it('preserves valid source attribute on imageBlock and safely ignores absent or invalid source', () => {
    const rawPage: PageContent = {
      id: 'p_pdf',
      schemaVersion: 2,
      items: {
        c1: {
          id: 'c1',
          type: 'container',
          x: 0,
          y: 0,
          w: 500,
          h: 600,
          doc: {
            type: 'doc',
            content: [
              {
                type: 'imageBlock',
                attrs: {
                  assetId: 'page-img-1',
                  width: 480,
                  naturalWidth: 1650,
                  naturalHeight: 2200,
                  source: { type: 'pdf', assetId: 'orig-pdf-1', page: 1 },
                },
              },
              {
                type: 'imageBlock',
                attrs: {
                  assetId: 'normal-img-2',
                  width: 400,
                  naturalWidth: 800,
                  naturalHeight: 600,
                },
              },
              {
                type: 'imageBlock',
                attrs: {
                  assetId: 'corrupt-src-img-3',
                  width: 400,
                  naturalWidth: 800,
                  naturalHeight: 600,
                  source: { type: 'invalid', assetId: 123 } as unknown as never,
                },
              },
            ],
          },
        },
      },
      order: ['c1'],
    };

    const migrated = P.migratePageV2toV3(rawPage);
    expect(migrated.schemaVersion).toBe(3);
    const blocks = (migrated.items.c1 as NoteContainerItem).doc.content!;
    expect(blocks[0].attrs?.source).toEqual({ type: 'pdf', assetId: 'orig-pdf-1', page: 1 });
    expect(blocks[1].attrs?.source).toBeUndefined();
    expect(blocks[2].attrs?.source).toBeUndefined();

    // referencedAssets includes both the image assets AND the original PDF asset
    const refs = P.referencedAssets(migrated);
    expect(refs.has('page-img-1')).toBe(true);
    expect(refs.has('orig-pdf-1')).toBe(true);
    expect(refs.has('normal-img-2')).toBe(true);
    expect(refs.has('corrupt-src-img-3')).toBe(true);
  });

  it('deduplicates assets by SHA-256 content hash', async () => {
    const content = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5]);
    const blob1 = new Blob([content], { type: 'image/png' });
    const blob2 = new Blob([content], { type: 'image/png' });
    const differentBlob = new Blob([new Uint8Array([9, 8, 7, 6])], { type: 'application/pdf' });

    const hash1 = await computeBlobHash(blob1);
    const hash2 = await computeBlobHash(blob2);
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);

    const res1 = await importImageBlob(blob1, { width: 1200, height: 1600 });
    expect(res1.deduplicated).toBe(false);

    const res2 = await importImageBlob(blob2, { width: 1200, height: 1600 });
    expect(res2.deduplicated).toBe(true);
    expect(res2.assetId).toBe(res1.assetId);

    const pdfRes1 = await importAssetBlob(differentBlob, 'application/pdf');
    expect(pdfRes1.deduplicated).toBe(false);
    const pdfRes2 = await importAssetBlob(differentBlob, 'application/pdf');
    expect(pdfRes2.deduplicated).toBe(true);
    expect(pdfRes2.assetId).toBe(pdfRes1.assetId);

    const allStoredIds = await listAssetIds();
    expect(allStoredIds).toHaveLength(2);
  });
});

