import type { JSONContent } from '@tiptap/core';
import { getDB, loadAllPages } from './db';
import { garbageCollectAssets } from './assets';
import * as P from '../model/pageOps';
import type { ID, PageContent, Workspace } from '../types';

export interface LegacyCleanupOptions {
  /** When true, scans and calculates stats without mutating IndexedDB. Defaults to false. */
  dryRun?: boolean;
  /** When true, forces execution and overwrites pre-cleanup backup if one already exists. */
  force?: boolean;
}

export interface LegacyCleanupResult {
  pagesScanned: number;
  blocksRemoved: number;
  orphanAssetsReclaimed: number;
  modifiedPageIds: ID[];
}

export interface PreLegacyCleanupBackup {
  ws: Workspace | null;
  pages: PageContent[];
  backedUpAt: number;
  blocksRemovedTotal: number;
}

/**
 * Determines whether a TipTap JSON node is a legacy raster PDF block.
 * - Must be of type 'imageBlock'.
 * - attrs.source must exist and have type === 'pdf'.
 * - attrs.assetId must be a non-empty string (the raster PNG/WebP blob ID).
 *
 * NOTE: Live PDF blocks (M2) have attrs.assetId === '', so they return false.
 * Normal user images have source === null/undefined, so they return false.
 */
export function isLegacyPdfRasterBlock(node: JSONContent | null | undefined): boolean {
  if (!node || typeof node !== 'object') return false;
  if (node.type !== 'imageBlock' || !node.attrs || typeof node.attrs !== 'object') return false;
  const { source, assetId } = node.attrs;
  const isPdfSource = !!source && typeof source === 'object' && (source as { type?: unknown }).type === 'pdf';
  const hasRasterAsset = typeof assetId === 'string' && assetId.trim().length > 0;
  return isPdfSource && hasRasterAsset;
}

function isEmptyParagraph(node: JSONContent | null | undefined): boolean {
  if (!node || typeof node !== 'object' || node.type !== 'paragraph') return false;
  if (!node.content || !Array.isArray(node.content) || node.content.length === 0) return true;
  if (node.content.length === 1) {
    const firstChild = node.content[0];
    if (firstChild && typeof firstChild === 'object' && firstChild.type === 'text') {
      const text = firstChild.text;
      return typeof text === 'string' && text.trim().length === 0;
    }
  }
  return false;
}

/**
 * Cleans legacy raster PDF blocks from a TipTap document AST.
 * Also removes empty spacer paragraphs immediately following legacy PDF blocks.
 */
export function cleanDocAst(doc: JSONContent): { cleanedDoc: JSONContent; removedCount: number } {
  let removedCount = 0;

  function cleanNodes(nodes: JSONContent[]): JSONContent[] {
    const result: JSONContent[] = [];
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (!node || typeof node !== 'object') {
        result.push(node);
        continue;
      }

      if (isLegacyPdfRasterBlock(node)) {
        removedCount++;
        // If immediately followed by an empty spacer paragraph, prune it too
        const next = nodes[i + 1];
        if (next && isEmptyParagraph(next)) {
          i++; // Skip spacer paragraph
        }
        continue;
      }

      if (node.content && Array.isArray(node.content)) {
        const cleanedChildren = cleanNodes(node.content);
        result.push({
          ...node,
          content: cleanedChildren.length > 0 ? cleanedChildren : [{ type: 'paragraph' }],
        });
      } else {
        result.push(node);
      }
    }
    return result;
  }

  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.content)) {
    return { cleanedDoc: doc, removedCount: 0 };
  }

  const cleanedContent = cleanNodes(doc.content);
  return {
    cleanedDoc: {
      ...doc,
      content: cleanedContent.length > 0 ? cleanedContent : [{ type: 'paragraph' }],
    },
    removedCount,
  };
}

/**
 * Retrieves the snapshot saved prior to legacy cleanup in kv.pre_legacy_cleanup_backup.
 */
export async function getPreLegacyCleanupBackup(): Promise<PreLegacyCleanupBackup | undefined> {
  const db = await getDB();
  return db.get('kv', 'pre_legacy_cleanup_backup') as Promise<PreLegacyCleanupBackup | undefined>;
}

export interface RestorePreLegacyCleanupBackupResult {
  restored: boolean;
  pagesRestored: number;
}

/**
 * Restores the workspace and pages snapshot created prior to legacy PDF cleanup.
 * Performs a full atomic rollback from kv.pre_legacy_cleanup_backup into IndexedDB.
 * Returns { restored: true, pagesRestored: N } on success, or { restored: false, pagesRestored: 0 }
 * if no pre-cleanup backup exists.
 */
export async function restorePreLegacyCleanupBackup(): Promise<RestorePreLegacyCleanupBackupResult> {
  const backup = await getPreLegacyCleanupBackup();
  if (!backup || !Array.isArray(backup.pages)) {
    return { restored: false, pagesRestored: 0 };
  }

  const db = await getDB();
  const tx = db.transaction(['pages', 'kv'], 'readwrite');
  const pagesStore = tx.objectStore('pages');

  for (const page of backup.pages) {
    await pagesStore.put(page);
  }

  if (backup.ws) {
    await tx.objectStore('kv').put(backup.ws, 'workspace');
  }

  await tx.done;

  return {
    restored: true,
    pagesRestored: backup.pages.length,
  };
}

/**
 * Scans all pages in IndexedDB, removes legacy raster PDF blocks and empty container
 * wrappers, preserves user notes and normal images, updates search indexes, and reclaims
 * unreferenced assets.
 */
export async function cleanupLegacyPdfRasterBlocks(
  options?: LegacyCleanupOptions,
): Promise<LegacyCleanupResult> {
  const db = await getDB();
  const rawPages = await db.getAll('pages');
  const allPages = await loadAllPages();

  let totalBlocksRemoved = 0;
  const modifiedPages: PageContent[] = [];
  const modifiedPageIds: ID[] = [];

  for (const page of allPages) {
    let pageModified = false;
    let pageBlocksRemoved = 0;
    const nextItems = { ...page.items };
    const containersToDelete: ID[] = [];

    for (const [itemId, item] of Object.entries(page.items)) {
      if ((item.type === 'container' || item.type === 'text') && item.doc) {
        const { cleanedDoc, removedCount } = cleanDocAst(item.doc);
        if (removedCount > 0) {
          pageModified = true;
          pageBlocksRemoved += removedCount;
          if (P.isDocEmpty(cleanedDoc)) {
            containersToDelete.push(itemId);
          } else {
            if (item.type === 'container') {
              nextItems[itemId] = {
                ...item,
                doc: cleanedDoc,
                freeImage: P.isFreeImageContainer({ ...item, doc: cleanedDoc }),
              };
            } else {
              nextItems[itemId] = {
                ...item,
                doc: cleanedDoc,
              };
            }
          }
        }
      }
    }

    if (pageModified) {
      let updatedPage: PageContent = { ...page, items: nextItems };
      if (containersToDelete.length > 0) {
        updatedPage = P.deleteItems(updatedPage, containersToDelete);
      }
      updatedPage = P.repairPage(updatedPage);

      totalBlocksRemoved += pageBlocksRemoved;
      modifiedPages.push(updatedPage);
      modifiedPageIds.push(page.id);
    }
  }

  // 1. Snapshot backup in kv before applying mutations
  if (totalBlocksRemoved > 0 && !options?.dryRun) {
    const existingBackup = await db.get('kv', 'pre_legacy_cleanup_backup');
    if (!existingBackup || options?.force) {
      const wsRaw = ((await db.get('kv', 'workspace')) as Workspace | undefined) ?? null;
      await db.put(
        'kv',
        {
          ws: wsRaw,
          pages: rawPages,
          backedUpAt: Date.now(),
          blocksRemovedTotal: totalBlocksRemoved,
        },
        'pre_legacy_cleanup_backup',
      );
    }
  }

  // 2. Persist modified pages & synchronize search text in kv.workspace
  if (modifiedPages.length > 0 && !options?.dryRun) {
    const tx = db.transaction(['pages', 'kv'], 'readwrite');
    const pagesStore = tx.objectStore('pages');
    for (const p of modifiedPages) {
      await pagesStore.put(p);
    }

    const ws = (await tx.objectStore('kv').get('workspace')) as Workspace | undefined;
    if (ws && ws.pages) {
      let wsModified = false;
      for (const p of modifiedPages) {
        if (ws.pages[p.id]) {
          ws.pages[p.id] = {
            ...ws.pages[p.id],
            searchText: P.pageSearchText(p),
            updatedAt: Date.now(),
          };
          wsModified = true;
        }
      }
      if (wsModified) {
        await tx.objectStore('kv').put(ws, 'workspace');
      }
    }
    await tx.done;
  }

  // 3. Asset garbage collection to reclaim orphan raster images and PDF assets
  let orphanAssetsReclaimed = 0;
  if (!options?.dryRun) {
    orphanAssetsReclaimed = await garbageCollectAssets(true);
  }

  return {
    pagesScanned: allPages.length,
    blocksRemoved: totalBlocksRemoved,
    orphanAssetsReclaimed,
    modifiedPageIds,
  };
}
