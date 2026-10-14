import type { CanvasItem, ID, PageContent, Workspace } from '../types';
import { SCHEMA_VERSION } from '../types';
import { getAsset, loadAllPages, type StoredAsset } from './db';
import { blobToDataUrl, dataUrlToBlob } from './assets';
import { newId, repairWorkspace } from '../model/workspaceOps';
import { referencedAssets } from '../model/pageOps';

export const BACKUP_FORMAT = 'glassnote-backup';

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  schemaVersion: number;
  exportedAt: string;
  workspace: Workspace;
  pages: PageContent[];
  assets: Array<{ id: ID; mime: string; data: string }>;
}

/** Builds a self-contained backup (JSON with images embedded as data URLs). */
export async function buildBackup(ws: Workspace, inMemory: Record<ID, PageContent>): Promise<BackupFile> {
  const stored = await loadAllPages();
  const byId = new Map(stored.map((p) => [p.id, p]));
  for (const [id, p] of Object.entries(inMemory)) byId.set(id, p);
  const liveIds = new Set([...Object.keys(ws.pages), ...ws.trash.map((t) => t.page.id)]);
  const pages = [...byId.values()].filter((p) => liveIds.has(p.id));
  const assetIds = new Set<ID>();
  for (const p of pages) for (const a of referencedAssets(p)) assetIds.add(a);
  const assets: BackupFile['assets'] = [];
  for (const id of assetIds) {
    const a = await getAsset(id);
    if (a) assets.push({ id, mime: a.mime, data: await blobToDataUrl(a.blob) });
  }
  return { format: BACKUP_FORMAT, schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), workspace: ws, pages, assets };
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export class BackupValidationError extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const ITEM_TYPES = new Set(['text', 'image', 'stroke', 'shape', 'connector']);

function validateItem(it: unknown): it is CanvasItem {
  if (!isObj(it) || typeof it.id !== 'string' || !ITEM_TYPES.has(String(it.type))) return false;
  switch (it.type) {
    case 'text':
      return typeof it.x === 'number' && typeof it.y === 'number' && typeof it.w === 'number' && isObj(it.doc);
    case 'image':
      return typeof it.assetId === 'string' && typeof it.w === 'number' && typeof it.h === 'number';
    case 'stroke':
      return Array.isArray(it.points) && it.points.every((n) => typeof n === 'number');
    case 'shape':
      return ['x1', 'y1', 'x2', 'y2'].every((k) => typeof it[k] === 'number');
    case 'connector':
      return typeof it.fromId === 'string' && typeof it.toId === 'string';
  }
  return false;
}

/** Validates a parsed backup. Throws BackupValidationError with a readable message. */
export function validateBackup(raw: unknown): BackupFile {
  if (!isObj(raw) || raw.format !== BACKUP_FORMAT) throw new BackupValidationError('Il file non è un backup di GlassNote.');
  if (typeof raw.schemaVersion !== 'number' || raw.schemaVersion > SCHEMA_VERSION) throw new BackupValidationError('Il backup proviene da una versione più recente dell’app.');
  const ws = raw.workspace;
  if (!isObj(ws) || !Array.isArray(ws.notebookIds) || !isObj(ws.notebooks) || !isObj(ws.sections) || !isObj(ws.pages)) throw new BackupValidationError('Struttura dei blocchi appunti non valida.');
  if (!Array.isArray(raw.pages) || !Array.isArray(raw.assets)) throw new BackupValidationError('Contenuto delle pagine mancante.');
  for (const p of raw.pages) {
    if (!isObj(p) || typeof p.id !== 'string' || !isObj(p.items) || !Array.isArray(p.order)) throw new BackupValidationError('Una pagina del backup è danneggiata.');
    for (const it of Object.values(p.items)) if (!validateItem(it)) throw new BackupValidationError('Un oggetto di una pagina è danneggiato.');
  }
  for (const a of raw.assets) {
    if (!isObj(a) || typeof a.id !== 'string' || typeof a.data !== 'string' || !a.data.startsWith('data:')) throw new BackupValidationError('Un’immagine del backup è danneggiata.');
  }
  return raw as unknown as BackupFile;
}

export function backupToAssets(b: BackupFile): StoredAsset[] {
  return b.assets.map((a) => ({ id: a.id, blob: dataUrlToBlob(a.data), mime: a.mime, createdAt: Date.now() }));
}

/**
 * Re-identifies every entity of a backup so it can be merged into an existing workspace without collisions.
 */
export function remapBackup(b: BackupFile): BackupFile {
  const map = new Map<string, string>();
  const m = (id: string) => {
    let v = map.get(id);
    if (!v) {
      v = newId();
      map.set(id, v);
    }
    return v;
  };
  const ws = repairWorkspace(b.workspace);
  const out: Workspace = { schemaVersion: SCHEMA_VERSION, notebookIds: [], notebooks: {}, sections: {}, pages: {}, trash: [] };
  for (const nid of ws.notebookIds) {
    const nb = ws.notebooks[nid];
    const nn = m(nid);
    out.notebookIds.push(nn);
    out.notebooks[nn] = { ...nb, id: nn, sectionIds: nb.sectionIds.map(m) };
    for (const sid of nb.sectionIds) {
      const s = ws.sections[sid];
      out.sections[m(sid)] = { ...s, id: m(sid), notebookId: nn, pageIds: s.pageIds.map(m) };
      for (const pid of s.pageIds) out.pages[m(pid)] = { ...ws.pages[pid], id: m(pid), sectionId: m(sid) };
    }
  }
  const livePages = new Set(Object.keys(ws.pages));
  const pages: PageContent[] = b.pages
    .filter((p) => livePages.has(p.id))
    .map((p) => {
      const items: Record<ID, CanvasItem> = {};
      for (const it of Object.values(p.items)) {
        const c = structuredClone(it) as CanvasItem;
        c.id = m(it.id);
        if (c.parentId) c.parentId = m(c.parentId);
        if (c.type === 'image') c.assetId = m(c.assetId);
        if (c.type === 'connector') {
          c.fromId = m(c.fromId);
          c.toId = m(c.toId);
        }
        items[c.id] = c;
      }
      return { ...p, id: m(p.id), items, order: p.order.map(m) };
    });
  const assets = b.assets.map((a) => ({ ...a, id: m(a.id) }));
  return { ...b, workspace: out, pages, assets };
}

export function mergeWorkspaces(base: Workspace, add: Workspace): Workspace {
  return {
    ...base,
    notebookIds: [...base.notebookIds, ...add.notebookIds],
    notebooks: { ...base.notebooks, ...add.notebooks },
    sections: { ...base.sections, ...add.sections },
    pages: { ...base.pages, ...add.pages },
  };
}
