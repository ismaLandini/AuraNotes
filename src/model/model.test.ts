import { describe, expect, it } from 'vitest';
import * as W from './workspaceOps';
import * as P from './pageOps';
import type { CanvasItem, ImageItem, NoteContainerItem, PageContent, ShapeItem, StrokeItem, TextItem } from '../types';

function setup() {
  let ws = W.emptyWorkspace();
  ws = W.createNotebook(ws, 'Analisi', 'nb1');
  ws = W.createSection(ws, 'nb1', 'Lezioni', 's1');
  ws = W.createSection(ws, 'nb1', 'Esercizi', 's2');
  ws = W.createPage(ws, 's1', 'Limiti', 'p1');
  ws = W.createPage(ws, 's1', 'Derivate', 'p2');
  ws = W.createPage(ws, 's2', 'Esercizio 1', 'p3');
  return ws;
}

describe('workspace operations', () => {
  it('creates the notebook → section → page hierarchy', () => {
    const ws = setup();
    expect(ws.notebookIds).toEqual(['nb1']);
    expect(ws.notebooks.nb1.sectionIds).toEqual(['s1', 's2']);
    expect(ws.sections.s1.pageIds).toEqual(['p1', 'p2']);
    expect(ws.pages.p3.sectionId).toBe('s2');
  });

  it('renames entities', () => {
    let ws = setup();
    ws = W.renameNotebook(ws, 'nb1', 'Analisi 1');
    ws = W.renameSection(ws, 's1', 'Teoria');
    ws = W.renamePage(ws, 'p1', 'Limiti notevoli');
    expect(ws.notebooks.nb1.name).toBe('Analisi 1');
    expect(ws.sections.s1.name).toBe('Teoria');
    expect(ws.pages.p1.title).toBe('Limiti notevoli');
  });

  it('reorders notebooks, sections and pages', () => {
    let ws = setup();
    ws = W.createNotebook(ws, 'Fisica', 'nb2');
    ws = W.reorderNotebook(ws, 'nb2', 0);
    expect(ws.notebookIds).toEqual(['nb2', 'nb1']);
    ws = W.reorderSection(ws, 's2', 0);
    expect(ws.notebooks.nb1.sectionIds).toEqual(['s2', 's1']);
    ws = W.movePage(ws, 'p2', 's1', 0);
    expect(ws.sections.s1.pageIds).toEqual(['p2', 'p1']);
  });

  it('moves a page between sections', () => {
    let ws = setup();
    ws = W.movePage(ws, 'p1', 's2', 0);
    expect(ws.sections.s1.pageIds).toEqual(['p2']);
    expect(ws.sections.s2.pageIds).toEqual(['p1', 'p3']);
    expect(ws.pages.p1.sectionId).toBe('s2');
  });

  it('moves a section into another notebook', () => {
    let ws = setup();
    ws = W.createNotebook(ws, 'Fisica', 'nb2');
    ws = W.moveSection(ws, 's2', 'nb2');
    expect(ws.notebooks.nb1.sectionIds).toEqual(['s1']);
    expect(ws.notebooks.nb2.sectionIds).toEqual(['s2']);
    expect(ws.sections.s2.notebookId).toBe('nb2');
    expect(ws.sections.s2.pageIds).toEqual(['p3']);
    // same notebook: nothing changes
    expect(W.moveSection(ws, 's1', 'nb1')).toBe(ws);
  });

  it('trashes and restores pages', () => {
    let ws = setup();
    ws = W.trashPage(ws, 'p1');
    expect(ws.pages.p1).toBeUndefined();
    expect(ws.sections.s1.pageIds).toEqual(['p2']);
    expect(ws.trash[0].page.id).toBe('p1');
    const r = W.restorePage(ws, 'p1', null);
    expect(r.sectionId).toBe('s1');
    expect(r.ws.sections.s1.pageIds).toContain('p1');
    expect(r.ws.trash).toHaveLength(0);
  });

  it('deleting a section or notebook sends its pages to the trash', () => {
    let ws = setup();
    ws = W.deleteSection(ws, 's1');
    expect(ws.sections.s1).toBeUndefined();
    expect(ws.trash.map((t) => t.page.id).sort()).toEqual(['p1', 'p2']);
    ws = W.deleteNotebook(ws, 'nb1');
    expect(ws.notebookIds).toEqual([]);
    expect(ws.trash).toHaveLength(3);
    // restore into a fallback section when the original is gone
    ws = W.createNotebook(ws, 'Nuovo', 'nb9');
    ws = W.createSection(ws, 'nb9', 'Recupero', 's9');
    const r = W.restorePage(ws, 'p3', 's9');
    expect(r.sectionId).toBe('s9');
  });

  it('repairs dangling references', () => {
    const ws = setup();
    const broken = { ...ws, notebookIds: [...ws.notebookIds, 'ghost'], sections: { ...ws.sections, s1: { ...ws.sections.s1, pageIds: ['p1', 'missing'] } } };
    const fixed = W.repairWorkspace(broken);
    expect(fixed.notebookIds).toEqual(['nb1']);
    expect(fixed.sections.s1.pageIds).toEqual(['p1']);
    expect(fixed.pages.p2).toBeUndefined();
  });

  it('manages page tags and collects workspace tags', () => {
    let ws = setup();
    expect(W.normalizeTag('  #Esame Finale!  ')).toBe('esame-finale');
    ws = W.addPageTag(ws, 'p1', '#Esame');
    ws = W.addPageTag(ws, 'p1', 'importante');
    ws = W.addPageTag(ws, 'p2', 'esame');
    expect(ws.pages.p1.tags).toEqual(['esame', 'importante']);
    expect(W.allWorkspaceTags(ws, 's1')).toEqual(['esame', 'importante']);
    ws = W.removePageTag(ws, 'p1', 'esame');
    expect(ws.pages.p1.tags).toEqual(['importante']);
    ws = W.removePageTag(ws, 'p1', 'importante');
    expect(ws.pages.p1.tags).toBeUndefined();
  });

  it('toggles favorite stars on notebooks, sections, and pages', () => {
    let ws = setup();
    ws = W.toggleNotebookStar(ws, 'nb1');
    ws = W.toggleSectionStar(ws, 's1');
    ws = W.togglePageStar(ws, 'p1');
    expect(ws.notebooks.nb1.starred).toBe(true);
    expect(ws.sections.s1.starred).toBe(true);
    expect(ws.pages.p1.starred).toBe(true);
    ws = W.toggleNotebookStar(ws, 'nb1');
    expect(ws.notebooks.nb1.starred).toBe(false);
  });

  it('extracts wiki-links, resolves target pages, and finds backlinks', () => {
    let ws = setup();
    expect(W.extractWikiLinks('Vedi [[Derivate]] e anche [[derivate]] o [[Esercizio 1]].')).toEqual(['Derivate', 'Esercizio 1']);
    expect(W.resolveWikiLink(ws, 'derivate', 's1')?.id).toBe('p2');
    expect(W.resolveWikiLink(ws, 'Inesistente', 's1')).toBeNull();

    ws = W.setPageMeta(ws, 'p1', { searchText: 'Appunti collegati a [[Derivate]] per il ripasso.' });
    ws = W.setPageMeta(ws, 'p3', { searchText: 'Riferimento incrociato con [[derivate]].' });
    const backlinks = W.findBacklinks(ws, 'p2');
    expect(backlinks.map((b) => b.page.id)).toEqual(['p1', 'p3']);
    expect(backlinks[0].snippet).toContain('[[Derivate]]');
  });

  it('sorts section pages by title, creation date, and update date, maintains sort on create/rename, and resets to manual on movePage', () => {
    let ws = setup();
    ws = W.createPage(ws, 's1', 'Asintoti', 'p4');
    ws = W.setPageMeta(ws, 'p1', { createdAt: 2000, updatedAt: 5000 });
    ws = W.setPageMeta(ws, 'p2', { createdAt: 1000, updatedAt: 7000 });
    ws = W.setPageMeta(ws, 'p4', { createdAt: 3000, updatedAt: 4000 });

    ws = W.sortSectionPages(ws, 's1', 'title-asc');
    expect(ws.sections.s1.pageSort).toBe('title-asc');
    expect(ws.sections.s1.pageIds).toEqual(['p4', 'p2', 'p1']);

    // Creating a new page without explicit index keeps the active title-asc sort
    ws = W.createPage(ws, 's1', 'Integrali', 'p5');
    expect(ws.sections.s1.pageIds).toEqual(['p4', 'p2', 'p5', 'p1']);

    // Renaming a page while sorted by title keeps the sorted order
    ws = W.renamePage(ws, 'p1', 'Algebra');
    expect(ws.sections.s1.pageIds).toEqual(['p1', 'p4', 'p2', 'p5']);

    ws = W.sortSectionPages(ws, 's1', 'title-desc');
    expect(ws.sections.s1.pageSort).toBe('title-desc');
    expect(ws.sections.s1.pageIds).toEqual(['p5', 'p2', 'p4', 'p1']);

    ws = W.setPageMeta(ws, 'p5', { createdAt: 4000, updatedAt: 8000 });
    ws = W.setPageMeta(ws, 'p1', { updatedAt: 5000 });

    ws = W.sortSectionPages(ws, 's1', 'created-desc');
    expect(ws.sections.s1.pageIds).toEqual(['p5', 'p4', 'p1', 'p2']);

    ws = W.sortSectionPages(ws, 's1', 'created-asc');
    expect(ws.sections.s1.pageIds).toEqual(['p2', 'p1', 'p4', 'p5']);

    ws = W.sortSectionPages(ws, 's1', 'updated-desc');
    expect(ws.sections.s1.pageIds).toEqual(['p5', 'p2', 'p1', 'p4']);

    ws = W.sortSectionPages(ws, 's1', 'updated-asc');
    expect(ws.sections.s1.pageIds).toEqual(['p4', 'p1', 'p2', 'p5']);

    // Manual reordering resets pageSort back to 'manual'
    ws = W.movePage(ws, 'p5', 's1', 0);
    expect(ws.sections.s1.pageSort).toBe('manual');
    expect(ws.sections.s1.pageIds).toEqual(['p5', 'p4', 'p1', 'p2']);

    ws = W.sortSectionPages(ws, 's1', 'manual');
    expect(ws.sections.s1.pageSort).toBe('manual');
    expect(ws.sections.s1.pageIds).toEqual(['p5', 'p4', 'p1', 'p2']);
  });
});

const text = (id: string, x = 0, y = 0): TextItem => ({ id, type: 'text', x, y, w: 100, h: 40, doc: P.EMPTY_DOC, variant: 'plain' });
const image = (id: string): ImageItem => ({ id, type: 'image', x: 0, y: 0, w: 200, h: 100, rotation: 0, assetId: 'a1', naturalWidth: 400, naturalHeight: 200, mime: 'image/png' });
const stroke = (id: string, parentId?: string): StrokeItem => ({ id, type: 'stroke', points: [0.1, 0.1, 0.5, 0.5], color: '#000', width: 2, opacity: 1, tool: 'pen', ...(parentId ? { parentId } : {}) });

function page(items: CanvasItem[]): PageContent {
  return P.addItems(P.emptyPage('p'), items);
}

describe('page operations', () => {
  it('adds and updates items', () => {
    let p = page([text('t1')]);
    p = P.updateItems(p, { t1: { x: 50 } });
    expect((p.items.t1 as TextItem).x).toBe(50);
    expect(p.order).toEqual(['t1']);
  });

  it('deleting an image removes its annotations and connectors', () => {
    const p = page([text('t1'), image('i1'), stroke('s1', 'i1'), { id: 'c1', type: 'connector', fromId: 't1', toId: 'i1', fromAnchor: 'auto', toAnchor: 'auto', arrow: 'end', color: '#000', width: 2, layer: 'back' }]);
    const next = P.deleteItems(p, ['i1']);
    expect(Object.keys(next.items)).toEqual(['t1']);
    expect(next.order).toEqual(['t1']);
  });

  it('clones selections with fresh ids, remapping annotations and connectors', () => {
    const p = page([text('t1', 10, 10), image('i1'), stroke('s1', 'i1'), { id: 'c1', type: 'connector', fromId: 't1', toId: 'i1', fromAnchor: 'auto', toAnchor: 'auto', arrow: 'end', color: '#000', width: 2, layer: 'back' }]);
    const { items } = P.cloneItems(p.items, p.order, ['t1', 'i1'], 20, 20);
    expect(items).toHaveLength(4);
    const ids = new Set(items.map((i) => i.id));
    expect(ids.has('t1') || ids.has('i1')).toBe(false);
    const t = items.find((i) => i.type === 'text') as TextItem;
    expect(t.x).toBe(30);
    const ann = items.find((i) => i.type === 'stroke')!;
    expect(ids.has(ann.parentId!)).toBe(true);
    // annotation coordinates stay normalised (not translated)
    expect((ann as StrokeItem).points).toEqual([0.1, 0.1, 0.5, 0.5]);
    const c = items.find((i) => i.type === 'connector')!;
    expect(c.type === 'connector' && ids.has(c.fromId) && ids.has(c.toId)).toBe(true);
  });

  it('does not copy a connector when only one end is copied', () => {
    const p = page([text('t1'), text('t2'), { id: 'c1', type: 'connector', fromId: 't1', toId: 't2', fromAnchor: 'auto', toAnchor: 'auto', arrow: 'end', color: '#000', width: 2, layer: 'back' }]);
    const { items } = P.cloneItems(p.items, p.order, ['t1'], 0, 0);
    expect(items.map((i) => i.type)).toEqual(['text']);
  });

  it('translates every geometry type', () => {
    const sh: ShapeItem = { id: 'sh', type: 'shape', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 10, color: '#000', width: 1, opacity: 1, fill: null };
    expect(P.translateItem(sh, 5, 5)).toEqual({ x1: 5, y1: 5, x2: 15, y2: 15 });
    expect(P.translateItem({ ...stroke('s'), points: [1, 2, 3, 4] }, 1, 1)).toEqual({ points: [2, 3, 4, 5] });
    expect(P.translateItem(stroke('s', 'img'), 1, 1)).toEqual({});
  });

  it('reorders z-index', () => {
    const p = page([text('a'), text('b'), text('c')]);
    expect(P.reorderZ(p, ['a'], 'front').order).toEqual(['b', 'c', 'a']);
    expect(P.reorderZ(p, ['c'], 'back').order).toEqual(['c', 'a', 'b']);
    expect(P.reorderZ(p, ['a'], 'forward').order).toEqual(['b', 'a', 'c']);
    expect(P.reorderZ(p, ['c'], 'backward').order).toEqual(['a', 'c', 'b']);
  });

  it('extracts searchable text including equations', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Teorema' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Vale ' }, { type: 'mathInline', attrs: { latex: 'a^2+b^2=c^2' } }] },
      ],
    };
    const t = P.docToText(doc);
    expect(t).toContain('Teorema');
    expect(t).toContain('a^2+b^2=c^2');
    expect(P.isDocEmpty(P.EMPTY_DOC)).toBe(true);
    expect(P.isDocEmpty({ type: 'doc', content: [{ type: 'paragraph' }, { type: 'paragraph', content: [{ type: 'text', text: '   ' }] }] })).toBe(true);
    expect(P.isDocEmpty(P.textDocFromPlain('ciao'))).toBe(false);
  });

  it('prunes empty plain text boxes while keeping active or non-empty ones', () => {
    const p = page([
      text('empty1', 10, 10),
      text('empty2', 50, 50),
      { ...text('filled', 90, 90), doc: P.textDocFromPlain('Contenuto') },
    ]);
    const keepActive = P.pruneEmptyTextItems(p, 'empty1');
    expect(Object.keys(keepActive.items).sort()).toEqual(['empty1', 'filled']);
    const prunedAll = P.pruneEmptyTextItems(p, null);
    expect(Object.keys(prunedAll.items)).toEqual(['filled']);
  });

  describe('NoteContainer image drag & drop transactions', () => {
    it('moves an imageBlock out of a container to the canvas as a freeImage container', () => {
      const container: CanvasItem = {
        id: 'c1',
        type: 'container',
        x: 100,
        y: 100,
        w: 500,
        h: 300,
        doc: {
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Nota con immagine' }] },
            { type: 'imageBlock', attrs: { assetId: 'img1', width: 400, naturalWidth: 800, naturalHeight: 600 } },
          ],
        },
      };
      const p = P.emptyPage('p1');
      const pWithContainer = P.addItems(p, [container]);

      const { page: resultPage, newId } = P.moveImageToCanvas(
        pWithContainer,
        'c1',
        { assetId: 'img1', width: 400, naturalWidth: 800, naturalHeight: 600 },
        { x: 300, y: 400 },
      );

      // Source container still exists with only paragraph
      const updatedSource = resultPage.items.c1 as NoteContainerItem;
      expect(updatedSource).toBeDefined();
      expect(P.docToText(updatedSource.doc)).toContain('Nota con immagine');
      expect(updatedSource.doc.content?.some((n: any) => n.type === 'imageBlock')).toBe(false);

      // New free image container created on canvas
      const freeImgContainer = resultPage.items[newId] as NoteContainerItem;
      expect(freeImgContainer).toBeDefined();
      expect(freeImgContainer.type).toBe('container');
      expect(freeImgContainer.freeImage).toBe(true);
      expect(freeImgContainer.doc.content?.[0].type).toBe('imageBlock');
      expect(freeImgContainer.doc.content?.[0].attrs?.assetId).toBe('img1');
    });

    it('removes source container when its only block was the image being dragged out', () => {
      const container: CanvasItem = {
        id: 'c-only-img',
        type: 'container',
        x: 100,
        y: 100,
        w: 400,
        h: 300,
        doc: {
          type: 'doc',
          content: [
            { type: 'imageBlock', attrs: { assetId: 'img1', width: 400, naturalWidth: 800, naturalHeight: 600 } },
          ],
        },
      };
      const p = P.addItems(P.emptyPage('p1'), [container]);

      const { page: resultPage, newId } = P.moveImageToCanvas(
        p,
        'c-only-img',
        { assetId: 'img1', width: 400, naturalWidth: 800, naturalHeight: 600 },
        { x: 500, y: 500 },
      );

      expect(resultPage.items['c-only-img']).toBeUndefined();
      expect(resultPage.order).not.toContain('c-only-img');
      expect(resultPage.items[newId]).toBeDefined();
    });

    it('moves an imageBlock from canvas into another container at target index', () => {
      const freeContainer: CanvasItem = {
        id: 'free1',
        type: 'container',
        freeImage: true,
        x: 100,
        y: 100,
        w: 400,
        h: 300,
        doc: {
          type: 'doc',
          content: [
            { type: 'imageBlock', attrs: { assetId: 'img2', width: 400, naturalWidth: 800, naturalHeight: 600 } },
          ],
        },
      };
      const targetContainer: CanvasItem = {
        id: 'target1',
        type: 'container',
        x: 600,
        y: 100,
        w: 500,
        h: 400,
        doc: {
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Prima riga' }] },
            { type: 'paragraph', content: [{ type: 'text', text: 'Seconda riga' }] },
          ],
        },
      };

      const p = P.addItems(P.emptyPage('p1'), [freeContainer, targetContainer]);

      // Move into target at index 1 (between first and second paragraph)
      const resultPage = P.moveImageIntoContainer(
        p,
        'free1',
        'target1',
        { assetId: 'img2', width: 400, naturalWidth: 800, naturalHeight: 600 },
        1,
      );

      // free container is cleaned up
      expect(resultPage.items.free1).toBeUndefined();
      expect(resultPage.order).not.toContain('free1');

      // target container now has 3 nodes with imageBlock in the middle
      const updatedTarget = resultPage.items.target1 as NoteContainerItem;
      expect(updatedTarget.doc.content?.length).toBe(3);
      expect(updatedTarget.doc.content?.[0].content?.[0].text).toBe('Prima riga');
      expect(updatedTarget.doc.content?.[1].type).toBe('imageBlock');
      expect(updatedTarget.doc.content?.[1].attrs?.assetId).toBe('img2');
      expect(updatedTarget.doc.content?.[2].content?.[0].text).toBe('Seconda riga');
    });
  });

  it('removes a sheet, deletes items on it, shifts subsequent items up, and preserves the last sheet', () => {
    let p = P.emptyPage('p1');
    p = P.addSheet(p);
    p = P.addSheet(p);
    expect(p.sheets).toHaveLength(3);

    const h0 = p.sheets![0].height;
    const h1 = p.sheets![1].height;
    const GAP = 36;
    const sheet2Y = h0 + GAP + 20;
    const sheet3Y = h0 + GAP + h1 + GAP + 40;

    p = P.addItems(p, [text('on1', 20, 20), text('on2', 20, sheet2Y), text('on3', 20, sheet3Y)]);

    const removed = P.removeSheet(p, 1);
    expect(removed.sheets).toHaveLength(2);
    expect(removed.items.on1).toBeDefined();
    expect(removed.items.on2).toBeUndefined();
    expect(removed.items.on3).toBeDefined();
    expect((removed.items.on3 as TextItem).y).toBe(sheet3Y - (h1 + GAP));

    const oneLeft = P.removeSheet(removed, 1);
    expect(oneLeft.sheets).toHaveLength(1);
    const cannotRemoveLast = P.removeSheet(oneLeft, 0);
    expect(cannotRemoveLast.sheets).toHaveLength(1);
  });
});
