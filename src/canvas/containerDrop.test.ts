import { describe, expect, it } from 'vitest';
import {
  createContainerDropCache,
  findTargetContainerAt,
  computeBlockDropPosition,
} from './containerDrop';
import * as P from '../model/pageOps';
import { newId } from '../model/workspaceOps';
import { useStore } from '../store/useStore';
import type { ImageBlockAttrs, NoteContainerItem, PageContent } from '../types';

function createMockPage(): { page: PageContent; cText: NoteContainerItem; cFree: NoteContainerItem } {
  const page = P.emptyPage('p1');
  const cText: NoteContainerItem = {
    id: 'cText',
    type: 'container',
    x: 100,
    y: 100,
    w: 500,
    h: 120,
    variant: 'plain',
    doc: {
      type: 'doc',
      content: [
        { type: 'paragraph', attrs: { indent: 1 }, content: [{ type: 'text', text: 'Paragrafo uno' }] },
        { type: 'paragraph', attrs: { indent: 2 }, content: [{ type: 'text', text: 'Paragrafo due' }] },
      ],
    },
  };

  const imageAttrs: ImageBlockAttrs = {
    id: 'img1',
    assetId: 'ast-123',
    width: 400,
    naturalWidth: 800,
    naturalHeight: 600,
    mime: 'image/png',
    rotation: 0,
    indent: 0,
    alt: 'Diagramma',
    annotations: [{ id: 'ann-1', type: 'stroke', points: [0.1, 0.1, 0.9, 0.9], color: '#f00', width: 2, opacity: 1, tool: 'pen' }],
  };

  const cFree: NoteContainerItem = {
    id: 'cFree',
    type: 'container',
    x: 700,
    y: 100,
    w: 400,
    h: 300,
    variant: 'plain',
    doc: {
      type: 'doc',
      content: [
        { type: 'imageBlock', attrs: imageAttrs },
      ],
    },
  };

  const withItems = P.addItems(page, [cText, cFree]);
  return { page: withItems, cText, cFree };
}

describe('containerDrop: cache & hit-testing', () => {
  it('creates drop cache excluding the dragged container and sorted by z-index', () => {
    const { page } = createMockPage();
    const cache = createContainerDropCache(page, 'cFree');
    expect(cache).toHaveLength(1);
    expect(cache[0].id).toBe('cText');
    expect(cache[0].rect.w).toBe(500);
    // Extends height by bottom drop padding (+40)
    expect(cache[0].rect.h).toBe(120 + 40);
  });

  it('finds target container under pointer, including bottom padding', () => {
    const { page } = createMockPage();
    const cache = createContainerDropCache(page, 'cFree');

    // Inside text container
    const hitInside = findTargetContainerAt(cache, { x: 200, y: 150 });
    expect(hitInside?.id).toBe('cText');

    // In bottom padding zone (100 + 120 + 20 = 240)
    const hitPadding = findTargetContainerAt(cache, { x: 200, y: 240 });
    expect(hitPadding?.id).toBe('cText');

    // Outside
    const hitOutside = findTargetContainerAt(cache, { x: 50, y: 50 });
    expect(hitOutside).toBeNull();
  });
});

describe('containerDrop: block boundary calculation', () => {
  it('computes insert position at beginning, middle, and bottom', () => {
    const { cText } = createMockPage();

    // 1. Point near top -> insertIndex 0, indent 0
    const topPos = computeBlockDropPosition(cText, { x: 150, y: 105 });
    expect(topPos.insertIndex).toBe(0);
    expect(topPos.inheritedIndent).toBe(0);

    // 2. Point in second block -> insertIndex 1 or 2 depending on half
    const midPos = computeBlockDropPosition(cText, { x: 150, y: 150 });
    expect(midPos.insertIndex).toBeGreaterThanOrEqual(1);

    // 3. Point below container content -> insertIndex at end (2)
    const bottomPos = computeBlockDropPosition(cText, { x: 150, y: 235 });
    expect(bottomPos.insertIndex).toBe(2);
    // Inherits indent of last block (2)
    expect(bottomPos.inheritedIndent).toBe(2);
  });

  it('computes insert position for empty container', () => {
    const emptyContainer: NoteContainerItem = {
      id: 'cEmpty',
      type: 'container',
      x: 50,
      y: 50,
      w: 300,
      h: 40,
      doc: { type: 'doc', content: [] },
    };

    const pos = computeBlockDropPosition(emptyContainer, { x: 70, y: 60 });
    expect(pos.insertIndex).toBe(0);
    expect(pos.inheritedIndent).toBe(0);
    expect(pos.line.x1).toBe(58);
  });
});

describe('freeImage derived state & atomic reintegration', () => {
  it('derives isFreeImageContainer dynamically based on doc content', () => {
    const { cText, cFree } = createMockPage();
    expect(P.isFreeImageContainer(cFree)).toBe(true);
    expect(P.isFreeImageContainer(cText)).toBe(false);

    // If text is added to cFree, it automatically becomes false
    const modifiedFree: NoteContainerItem = {
      ...cFree,
      doc: {
        type: 'doc',
        content: [
          ...cFree.doc.content!,
          { type: 'paragraph', content: [{ type: 'text', text: 'Nota aggiunta sotto' }] },
        ],
      },
    };
    expect(P.isFreeImageContainer(modifiedFree)).toBe(false);
  });

  it('integrates a free image back into a container atomically, preserving annotations and indent', () => {
    const { page, cFree } = createMockPage();
    const attrs = cFree.doc.content![0].attrs as ImageBlockAttrs;

    const integrated = P.moveImageIntoContainer(page, 'cFree', 'cText', attrs, 1);

    // 1. Source free container was deleted
    expect(integrated.items.cFree).toBeUndefined();
    expect(integrated.order).not.toContain('cFree');

    // 2. Target container contains the image block at index 1
    const target = integrated.items.cText as NoteContainerItem;
    expect(target).toBeDefined();
    const content = target.doc.content!;
    expect(content).toHaveLength(3);
    expect(content[1].type).toBe('imageBlock');

    // 3. Image block preserved assetId, alt, and annotations
    const droppedAttrs = content[1].attrs as ImageBlockAttrs;
    expect(droppedAttrs.assetId).toBe('ast-123');
    expect(droppedAttrs.alt).toBe('Diagramma');
    expect(droppedAttrs.annotations).toHaveLength(1);
    expect(droppedAttrs.annotations![0].id).toBe('ann-1');

    // 4. Inherited indent from preceding block (index 0 has indent 1)
    expect(droppedAttrs.indent).toBe(1);

    // 5. Target container is not freeImage
    expect(target.freeImage).toBe(false);
  });

  it('fuses two freeImage containers into a single container with 2 images', () => {
    const { page } = createMockPage();
    const secondFreeId = newId();
    const secondFree: NoteContainerItem = {
      id: secondFreeId,
      type: 'container',
      x: 800,
      y: 400,
      w: 300,
      h: 200,
      doc: {
        type: 'doc',
        content: [
          {
            type: 'imageBlock',
            attrs: {
              assetId: 'ast-second',
              width: 300,
              naturalWidth: 600,
              naturalHeight: 400,
            },
          },
        ],
      },
    };

    const pageWithTwoFree = P.addItems(page, [secondFree]);
    expect(P.isFreeImageContainer(pageWithTwoFree.items[secondFreeId])).toBe(true);

    const attrs = secondFree.doc.content![0].attrs as ImageBlockAttrs;
    const fusedPage = P.moveImageIntoContainer(pageWithTwoFree, secondFreeId, 'cFree', attrs, 1);

    // secondFree deleted
    expect(fusedPage.items[secondFreeId]).toBeUndefined();

    // cFree now has 2 image blocks
    const fused = fusedPage.items.cFree as NoteContainerItem;
    expect(fused.doc.content).toHaveLength(2);
    expect(fused.doc.content![0].type).toBe('imageBlock');
    expect(fused.doc.content![1].type).toBe('imageBlock');

    // cFree is now a normal container (freeImage: false) because it has 2 blocks
    expect(fused.freeImage).toBe(false);
    expect(P.isFreeImageContainer(fused)).toBe(false);
  });

  it('preserves data identically over 5 consecutive in/out cycles', () => {
    const { page } = createMockPage();
    let curPage = page;
    let targetContainerId = 'cText';
    let freeContainerId = 'cFree';

    const originalAttrs = curPage.items.cFree.type === 'container'
      ? (curPage.items.cFree as NoteContainerItem).doc.content![0].attrs as ImageBlockAttrs
      : null;
    expect(originalAttrs).toBeDefined();

    for (let cycle = 0; cycle < 5; cycle++) {
      // 1. Move free image INTO container
      const freeItem = curPage.items[freeContainerId] as NoteContainerItem;
      const attrs = freeItem.doc.content![0].attrs as ImageBlockAttrs;
      curPage = P.moveImageIntoContainer(curPage, freeContainerId, targetContainerId, attrs, 1);

      // Verify integrated
      expect(curPage.items[freeContainerId]).toBeUndefined();
      const containerAfterIn = curPage.items[targetContainerId] as NoteContainerItem;
      const imgBlock = containerAfterIn.doc.content?.find((n) => n.type === 'imageBlock');
      expect(imgBlock).toBeDefined();
      expect(imgBlock?.attrs?.assetId).toBe(originalAttrs?.assetId);
      expect(imgBlock?.attrs?.annotations).toHaveLength(1);

      // 2. Move image OUT of container to canvas
      const { page: nextPg, newId } = P.moveImageToCanvas(
        curPage,
        targetContainerId,
        imgBlock!.attrs as ImageBlockAttrs,
        { x: 600 + cycle * 10, y: 200 },
      );
      curPage = nextPg;
      freeContainerId = newId;

      // Verify it is a free image again
      const freeAfterOut = curPage.items[freeContainerId] as NoteContainerItem;
      expect(freeAfterOut).toBeDefined();
      expect(P.isFreeImageContainer(freeAfterOut)).toBe(true);
      expect(freeAfterOut.doc.content![0].attrs?.assetId).toBe(originalAttrs?.assetId);
      expect(freeAfterOut.doc.content![0].attrs?.annotations).toHaveLength(1);
      expect(freeAfterOut.doc.content![0].attrs?.annotations![0].id).toBe('ann-1');
    }

    // Zero orphaned items or leftover containers
    expect(Object.keys(curPage.items)).toHaveLength(2); // cText and the final free image
  });

  it('supports single Cmd+Z undo restoring the freeImage container at its original coordinates', () => {
    const { page, cFree } = createMockPage();
    useStore.setState((s) => ({
      pageId: page.id,
      pages: { ...s.pages, [page.id]: page },
      history: { ...s.history, [page.id]: { past: [], future: [] } },
    }));
    const st = useStore.getState();

    const beforeSnapshot = useStore.getState().pages[page.id];
    const attrs = cFree.doc.content![0].attrs as ImageBlockAttrs;

    // Simulate drop: atomic updatePage then commitFrom(beforeSnapshot)
    st.updatePage((p) => P.moveImageIntoContainer(p, 'cFree', 'cText', attrs, 1), false);
    st.commitFrom(beforeSnapshot);

    // Verify dropped state
    const afterDrop = useStore.getState().pages[page.id];
    expect(afterDrop.items.cFree).toBeUndefined();
    expect((afterDrop.items.cText as NoteContainerItem).doc.content).toHaveLength(3);

    // Single undo
    st.undo();
    const afterUndo = useStore.getState().pages[page.id];
    expect(afterUndo.items.cFree).toBeDefined();
    expect((afterUndo.items.cFree as NoteContainerItem).x).toBe(700);
    expect((afterUndo.items.cFree as NoteContainerItem).y).toBe(100);
    expect((afterUndo.items.cText as NoteContainerItem).doc.content).toHaveLength(2);

    // Redo
    st.redo();
    const afterRedo = useStore.getState().pages[page.id];
    expect(afterRedo.items.cFree).toBeUndefined();
    expect((afterRedo.items.cText as NoteContainerItem).doc.content).toHaveLength(3);
  });
});
