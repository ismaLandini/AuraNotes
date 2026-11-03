import type { CanvasItem, ID, ImageBlockAttrs, NoteContainerItem, PageContent, Point, Rect } from '../types';
import { isFreeImageContainer } from '../model/pageOps';
import { zFor } from './render';

export interface CachedContainer {
  id: ID;
  zIndex: number;
  rect: Rect;
  item: NoteContainerItem;
}

export interface DropTargetResult {
  container: NoteContainerItem;
  insertIndex: number;
  inheritedIndent: number;
  line: { x1: number; y1: number; x2: number; y2: number };
  containerBounds: Rect;
}

/** Extra drop zone padding below the last line of a container (in world px). */
const BOTTOM_DROP_PADDING = 40;

/**
 * Creates a cache of all candidate destination containers on the page.
 * Sorted descending by zIndex so topmost containers are tested first.
 */
export function createContainerDropCache(page: PageContent, excludeId?: ID): CachedContainer[] {
  const result: CachedContainer[] = [];
  for (let i = 0; i < page.order.length; i++) {
    const id = page.order[i];
    if (id === excludeId) continue;
    const it = page.items[id];
    if (!it || (it.type !== 'container' && it.type !== 'text')) continue;
    const container = it as NoteContainerItem;
    const h = Math.max(container.h || 24, 24);
    result.push({
      id,
      zIndex: zFor(it, i),
      rect: {
        x: container.x,
        y: container.y,
        w: container.w,
        h: h + BOTTOM_DROP_PADDING,
      },
      item: container,
    });
  }
  return result.sort((a, b) => b.zIndex - a.zIndex);
}

/**
 * Finds the topmost candidate container under the world point `p`.
 */
export function findTargetContainerAt(
  cache: CachedContainer[],
  p: Point,
): CachedContainer | null {
  for (const entry of cache) {
    const r = entry.rect;
    if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) {
      return entry;
    }
  }
  return null;
}

/**
 * Calculates block boundary insertion index, inherited indent, and visual drop line
 * for a destination container based on the world pointer position.
 */
export function computeBlockDropPosition(
  target: NoteContainerItem,
  pointerWorld: Point,
  containerEl?: HTMLElement | null,
): DropTargetResult {
  const doc = target.doc ?? { type: 'doc', content: [] };
  const content = doc.content ?? [];
  const containerBounds: Rect = {
    x: target.x,
    y: target.y,
    w: target.w,
    h: Math.max(target.h || 24, 24),
  };

  // Case 1: Empty container
  if (content.length === 0) {
    return {
      container: target,
      insertIndex: 0,
      inheritedIndent: 0,
      line: {
        x1: target.x + 8,
        y1: target.y + 12,
        x2: target.x + target.w - 8,
        y2: target.y + 12,
      },
      containerBounds,
    };
  }

  // Case 2: Attempt DOM-based block hit-testing for pixel perfection
  const contentHost = containerEl?.querySelector('.rich') ?? containerEl?.querySelector('.ProseMirror');
  const domChildren = contentHost ? Array.from(contentHost.children) as HTMLElement[] : [];

  if (domChildren.length > 0 && domChildren.length === content.length) {
    // If pointer is above the first block
    const firstTop = target.y + domChildren[0].offsetTop;
    if (pointerWorld.y < firstTop) {
      return {
        container: target,
        insertIndex: 0,
        inheritedIndent: 0,
        line: {
          x1: target.x + 8,
          y1: Math.max(target.y + 4, firstTop - 2),
          x2: target.x + target.w - 8,
          y2: Math.max(target.y + 4, firstTop - 2),
        },
        containerBounds,
      };
    }

    // Check each block
    for (let i = 0; i < domChildren.length; i++) {
      const childEl = domChildren[i];
      const blockNode = content[i];
      const blockTop = target.y + childEl.offsetTop;
      const blockHeight = Math.max(childEl.offsetHeight, 20);
      const blockBottom = blockTop + blockHeight;
      const blockMid = blockTop + blockHeight / 2;

      // Handle lists (bulletList, orderedList, taskList)
      if (
        (blockNode.type === 'bulletList' || blockNode.type === 'orderedList' || blockNode.type === 'taskList') &&
        blockNode.content &&
        blockNode.content.length > 0
      ) {
        const listItems = Array.from(childEl.children) as HTMLElement[];
        if (listItems.length > 0 && pointerWorld.y >= blockTop && pointerWorld.y <= blockBottom) {
          for (let liIdx = 0; liIdx < listItems.length; liIdx++) {
            const liEl = listItems[liIdx];
            const liTop = target.y + childEl.offsetTop + liEl.offsetTop;
            const liHeight = Math.max(liEl.offsetHeight, 18);
            const liMid = liTop + liHeight / 2;

            if (pointerWorld.y < liMid) {
              // Before this listItem
              const indent = Number(blockNode.attrs?.indent || 0);
              return {
                container: target,
                insertIndex: i, // We'll split or place before
                inheritedIndent: indent,
                line: {
                  x1: target.x + 8 + indent * 24,
                  y1: liTop,
                  x2: target.x + target.w - 8,
                  y2: liTop,
                },
                containerBounds,
              };
            }
            if (liIdx === listItems.length - 1 || pointerWorld.y < liTop + liHeight) {
              // After this listItem
              const indent = Number(blockNode.attrs?.indent || 0);
              return {
                container: target,
                insertIndex: i + 1,
                inheritedIndent: indent,
                line: {
                  x1: target.x + 8 + indent * 24,
                  y1: liTop + liHeight,
                  x2: target.x + target.w - 8,
                  y2: liTop + liHeight,
                },
                containerBounds,
              };
            }
          }
        }
      }

      // Standard block (paragraph, heading, imageBlock, etc.)
      if (pointerWorld.y <= blockBottom) {
        if (pointerWorld.y < blockMid) {
          // Upper half -> insert before this block
          const prevBlock = i > 0 ? content[i - 1] : undefined;
          const indent = Number(prevBlock?.attrs?.indent || 0);
          return {
            container: target,
            insertIndex: i,
            inheritedIndent: indent,
            line: {
              x1: target.x + 8 + indent * 24,
              y1: blockTop,
              x2: target.x + target.w - 8,
              y2: blockTop,
            },
            containerBounds,
          };
        } else {
          // Lower half -> insert after this block
          const indent = Number(blockNode.attrs?.indent || 0);
          return {
            container: target,
            insertIndex: i + 1,
            inheritedIndent: indent,
            line: {
              x1: target.x + 8 + indent * 24,
              y1: blockBottom,
              x2: target.x + target.w - 8,
              y2: blockBottom,
            },
            containerBounds,
          };
        }
      }
    }

    // Pointer is below all blocks -> insert at bottom
    const lastEl = domChildren[domChildren.length - 1];
    const lastBottom = target.y + lastEl.offsetTop + lastEl.offsetHeight;
    const lastBlock = content[content.length - 1];
    const indent = Number(lastBlock?.attrs?.indent || 0);
    return {
      container: target,
      insertIndex: content.length,
      inheritedIndent: indent,
      line: {
        x1: target.x + 8 + indent * 24,
        y1: lastBottom + 4,
        x2: target.x + target.w - 8,
        y2: lastBottom + 4,
      },
      containerBounds,
    };
  }

  // Fallback: estimate linearly based on block count and target.h
  const approxBlockHeight = Math.max(28, (target.h || 24) / content.length);
  const relY = Math.max(0, pointerWorld.y - target.y);
  const estimatedBlockIndex = Math.min(content.length - 1, Math.floor(relY / approxBlockHeight));
  const blockRelY = relY - estimatedBlockIndex * approxBlockHeight;

  let insertIndex: number;
  let lineY: number;
  if (relY >= content.length * approxBlockHeight) {
    insertIndex = content.length;
    lineY = target.y + content.length * approxBlockHeight + 4;
  } else if (blockRelY < approxBlockHeight / 2) {
    insertIndex = estimatedBlockIndex;
    lineY = target.y + estimatedBlockIndex * approxBlockHeight;
  } else {
    insertIndex = estimatedBlockIndex + 1;
    lineY = target.y + (estimatedBlockIndex + 1) * approxBlockHeight;
  }

  const prevBlock = insertIndex > 0 ? content[insertIndex - 1] : undefined;
  const inheritedIndent = Number(prevBlock?.attrs?.indent || 0);

  return {
    container: target,
    insertIndex,
    inheritedIndent,
    line: {
      x1: target.x + 8 + inheritedIndent * 24,
      y1: lineY,
      x2: target.x + target.w - 8,
      y2: lineY,
    },
    containerBounds,
  };
}

/**
 * Checks if a given item is an image that should trigger container integration when dragged.
 */
export function canIntegrateImageItem(item: CanvasItem | null | undefined): boolean {
  return isFreeImageContainer(item);
}

/**
 * Extracts the single ImageBlockAttrs from a freeImage container.
 */
export function getImageBlockAttrsFromContainer(container: NoteContainerItem): ImageBlockAttrs | null {
  const content = container.doc?.content;
  if (!Array.isArray(content) || content.length !== 1 || content[0].type !== 'imageBlock') {
    return null;
  }
  return content[0].attrs as ImageBlockAttrs;
}
