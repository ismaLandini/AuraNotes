import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { ID, PageContent, Workspace } from '../types';
import { SCHEMA_VERSION } from '../types';
import { migratePageV1toV2, migratePageV2toV3, stripOcrFromPage } from '../model/pageOps';

export interface StoredAsset {
  id: ID;
  blob: Blob;
  mime: string;
  createdAt: number;
  hash?: string;
}

interface GlassNoteDB extends DBSchema {
  kv: { key: string; value: unknown };
  pages: { key: ID; value: PageContent };
  assets: {
    key: ID;
    value: StoredAsset;
    indexes: { 'by-hash': string };
  };
}

const DB_NAME = 'glassnote';
const DB_VERSION = 3;

let dbPromise: Promise<IDBPDatabase<GlassNoteDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<GlassNoteDB>> {
  if (!dbPromise) {
    dbPromise = openDB<GlassNoteDB>(DB_NAME, DB_VERSION, {
      upgrade(db, _oldVersion, _newVersion, tx) {
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('pages')) db.createObjectStore('pages', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('assets')) {
          const store = db.createObjectStore('assets', { keyPath: 'id' });
          store.createIndex('by-hash', 'hash');
        } else {
          const store = tx.objectStore('assets');
          if (!store.indexNames.contains('by-hash')) {
            store.createIndex('by-hash', 'hash');
          }
        }
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

/**
 * Creates an automatic snapshot of schema v1 workspace and pages in kv
 * before applying the migration to schema v2, if not already backed up.
 */
export async function backupBeforeMigrationIfNeeded(): Promise<void> {
  const db = await getDB();
  const existingBackup = await db.get('kv', 'workspace_v1_backup');
  if (existingBackup) return;
  const wsRaw = await db.get('kv', 'workspace');
  if (!wsRaw || typeof wsRaw !== 'object') return;
  const ws = wsRaw as Workspace;
  if (typeof ws.schemaVersion === 'number' && ws.schemaVersion < 2) {
    console.info('GlassNote: backing up schema v1 workspace before migration to v2...');
    const pages = await db.getAll('pages');
    await db.put('kv', { ws, pages, backedUpAt: Date.now() }, 'workspace_v1_backup');
    console.info('GlassNote: schema v1 backup saved to kv.workspace_v1_backup');
  }
}

/** Retrieves the automatic schema v1 backup if present. */
export async function getV1Backup(): Promise<{ ws: Workspace; pages: PageContent[]; backedUpAt: number } | undefined> {
  const db = await getDB();
  return db.get('kv', 'workspace_v1_backup') as Promise<{ ws: Workspace; pages: PageContent[]; backedUpAt: number } | undefined>;
}

/**
 * Creates an automatic snapshot of schema v2 workspace and pages in kv
 * before applying the migration to schema v3, if not already backed up.
 */
export async function backupBeforeV3MigrationIfNeeded(): Promise<void> {
  const db = await getDB();
  const existingBackup = await db.get('kv', 'workspace_v2_backup');
  if (existingBackup) return;
  const wsRaw = await db.get('kv', 'workspace');
  if (!wsRaw || typeof wsRaw !== 'object') return;
  const ws = wsRaw as Workspace;
  if (typeof ws.schemaVersion === 'number' && ws.schemaVersion < 3) {
    const pages = await db.getAll('pages');
    await db.put('kv', { ws, pages, backedUpAt: Date.now() }, 'workspace_v2_backup');
  }
}

/** Retrieves the automatic schema v2 backup if present. */
export async function getV2Backup(): Promise<{ ws: Workspace; pages: PageContent[]; backedUpAt: number } | undefined> {
  const db = await getDB();
  return db.get('kv', 'workspace_v2_backup') as Promise<{ ws: Workspace; pages: PageContent[]; backedUpAt: number } | undefined>;
}

/**
 * Creates an automatic snapshot of workspace and pages in kv before
 * OCR and highlighting removal migration, if not already backed up.
 */
export async function backupBeforeOcrRemovalIfNeeded(): Promise<void> {
  const db = await getDB();
  const existingBackup = await db.get('kv', 'pre_ocr_removal_backup');
  if (existingBackup) return;
  const wsRaw = await db.get('kv', 'workspace');
  if (!wsRaw || typeof wsRaw !== 'object') return;
  const pages = await db.getAll('pages');
  await db.put('kv', { ws: wsRaw as Workspace, pages, backedUpAt: Date.now() }, 'pre_ocr_removal_backup');
}

/** Retrieves the automatic pre-OCR removal backup if present. */
export async function getPreOcrRemovalBackup(): Promise<{ ws: Workspace; pages: PageContent[]; backedUpAt: number } | undefined> {
  const db = await getDB();
  return db.get('kv', 'pre_ocr_removal_backup') as Promise<{ ws: Workspace; pages: PageContent[]; backedUpAt: number } | undefined>;
}

/**
 * Idempotent migration that removes legacy OCR cache entries (ocr:* in kv)
 * and strips any ocr/highlights attributes from imageBlock nodes in saved pages.
 */
export async function cleanupOcrDataFromDB(): Promise<void> {
  const db = await getDB();
  const allKeys = await db.getAllKeys('kv');
  const ocrKeys = allKeys.filter((k) => typeof k === 'string' && k.startsWith('ocr:'));

  const allPages = await db.getAll('pages');
  const dirtyPages = allPages.filter((p) => {
    const cleaned = stripOcrFromPage(p);
    return cleaned !== p;
  });

  if (ocrKeys.length === 0 && dirtyPages.length === 0) return;

  const tx = db.transaction(['kv', 'pages'], 'readwrite');
  for (const k of ocrKeys) {
    await tx.objectStore('kv').delete(k);
  }
  for (const p of dirtyPages) {
    await tx.objectStore('pages').put(stripOcrFromPage(p));
  }
  await tx.done;
}

/** Migrates older workspace snapshots to the current schema. */
export function migrateWorkspace(raw: unknown): Workspace | null {
  if (!raw || typeof raw !== 'object') return null;
  const ws = raw as Workspace;
  if (typeof ws.schemaVersion !== 'number') return null;
  // Upgrades older schemas to SCHEMA_VERSION (3)
  return { ...ws, schemaVersion: SCHEMA_VERSION, trash: ws.trash ?? [] };
}

export function migratePage(raw: PageContent): PageContent {
  const v2 = stripOcrFromPage(migratePageV1toV2(raw));
  return migratePageV2toV3(v2);
}

export async function loadWorkspace(): Promise<Workspace | null> {
  await backupBeforeMigrationIfNeeded();
  await backupBeforeV3MigrationIfNeeded();
  await backupBeforeOcrRemovalIfNeeded();
  await cleanupOcrDataFromDB();
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

export async function getAssetByHash(hash: string): Promise<StoredAsset | undefined> {
  if (!hash) return undefined;
  const db = await getDB();
  return db.getFromIndex('assets', 'by-hash', hash);
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
