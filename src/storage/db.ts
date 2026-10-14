import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { ID, PageContent, Workspace } from '../types';
import { SCHEMA_VERSION } from '../types';
import { repairPage } from '../model/pageOps';

export interface StoredAsset {
  id: ID;
  blob: Blob;
  mime: string;
  createdAt: number;
}

interface GlassNoteDB extends DBSchema {
  kv: { key: string; value: unknown };
  pages: { key: ID; value: PageContent };
  assets: { key: ID; value: StoredAsset };
}

const DB_NAME = 'glassnote';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<GlassNoteDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<GlassNoteDB>> {
  if (!dbPromise) {
    dbPromise = openDB<GlassNoteDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('pages')) db.createObjectStore('pages', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets', { keyPath: 'id' });
      },
      blocked() {
        console.warn('GlassNote: database upgrade blocked by another tab');
      },
    });
  }
  return dbPromise;
}

/** For tests: forget the cached connection. */
export async function resetDBConnection(): Promise<void> {
  if (dbPromise) (await dbPromise).close();
  dbPromise = null;
}

/** Migrates older workspace snapshots to the current schema. */
export function migrateWorkspace(raw: unknown): Workspace | null {
  if (!raw || typeof raw !== 'object') return null;
  const ws = raw as Workspace;
  if (typeof ws.schemaVersion !== 'number') return null;
  // Future migrations go here: if (ws.schemaVersion < 2) { ... }
  return { ...ws, schemaVersion: SCHEMA_VERSION, trash: ws.trash ?? [] };
}

export function migratePage(raw: PageContent): PageContent {
  return repairPage({ ...raw, schemaVersion: SCHEMA_VERSION, items: raw.items ?? {}, order: raw.order ?? [] });
}

export async function loadWorkspace(): Promise<Workspace | null> {
  const db = await getDB();
  return migrateWorkspace(await db.get('kv', 'workspace'));
}

export async function saveAll(ws: Workspace | null, pages: PageContent[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['kv', 'pages'], 'readwrite');
  const writes: Promise<unknown>[] = [];
  for (const p of pages) writes.push(tx.objectStore('pages').put(p));
  if (ws) writes.push(tx.objectStore('kv').put(ws, 'workspace'));
  await Promise.all([...writes, tx.done]);
}

export async function loadPage(id: ID): Promise<PageContent | undefined> {
  const db = await getDB();
  const p = await db.get('pages', id);
  return p ? migratePage(p) : undefined;
}

export async function loadAllPages(): Promise<PageContent[]> {
  const db = await getDB();
  return (await db.getAll('pages')).map(migratePage);
}

export async function deletePages(ids: ID[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('pages', 'readwrite');
  await Promise.all([...ids.map((id) => tx.store.delete(id)), tx.done]);
}

export async function putAsset(asset: StoredAsset): Promise<void> {
  const db = await getDB();
  await db.put('assets', asset);
}

export async function getAsset(id: ID): Promise<StoredAsset | undefined> {
  const db = await getDB();
  return db.get('assets', id);
}

export async function listAssetIds(): Promise<ID[]> {
  const db = await getDB();
  return db.getAllKeys('assets');
}

export async function deleteAssets(ids: ID[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('assets', 'readwrite');
  await Promise.all([...ids.map((id) => tx.store.delete(id)), tx.done]);
}

/** Replaces the entire database content (used by "replace" import). */
export async function replaceAll(ws: Workspace, pages: PageContent[], assets: StoredAsset[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['kv', 'pages', 'assets'], 'readwrite');
  await tx.objectStore('pages').clear();
  await tx.objectStore('assets').clear();
  const writes: Promise<unknown>[] = [];
  for (const p of pages) writes.push(tx.objectStore('pages').put(p));
  for (const a of assets) writes.push(tx.objectStore('assets').put(a));
  writes.push(tx.objectStore('kv').put(ws, 'workspace'));
  await Promise.all([...writes, tx.done]);
}

export function isQuotaError(e: unknown): boolean {
  return e instanceof DOMException && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED');
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
  const e = await navigator.storage.estimate();
  return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
}

export async function requestPersistence(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
  try {
    return (await navigator.storage.persisted()) || (await navigator.storage.persist());
  } catch {
    return false;
  }
}
