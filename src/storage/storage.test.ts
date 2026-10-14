import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { getAsset, loadPage, loadWorkspace, putAsset, resetDBConnection, saveAll, migrateWorkspace } from './db';
import { buildBackup, mergeWorkspaces, remapBackup, validateBackup, BackupValidationError } from './backup';
import * as W from '../model/workspaceOps';
import * as P from '../model/pageOps';
import type { ImageItem, PageContent } from '../types';

beforeEach(async () => {
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
