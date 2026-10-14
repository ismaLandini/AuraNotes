import { describe, expect, it } from 'vitest';
import * as W from './workspaceOps';
import * as P from './pageOps';
import type { CanvasItem, ImageItem, PageContent, ShapeItem, StrokeItem, TextItem } from '../types';

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
    expect(P.isDocEmpty(P.textDocFromPlain('ciao'))).toBe(false);
  });
});
