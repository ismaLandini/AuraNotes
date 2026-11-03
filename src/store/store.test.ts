import { beforeAll, describe, expect, it } from 'vitest';
import { dirty, useStore } from './useStore';
import { flush } from '../storage/autosave';
import { loadPage, loadWorkspace } from '../storage/db';
import * as P from '../model/pageOps';
import type { TextItem } from '../types';
import { createTextBlock } from '../canvas/actions';

beforeAll(async () => {
  localStorage.clear();
  await useStore.getState().init();
});

describe('store', () => {
  it('starts with the example notebook on first run', () => {
    const s = useStore.getState();
    expect(s.loaded).toBe(true);
    expect(s.workspace.notebookIds.length).toBe(1);
    expect(s.pageId).toBeTruthy();
  });

  it('creates notebooks, sections and pages and navigates to them', async () => {
    const s = useStore.getState();
    const nb = s.addNotebook('Statistica');
    expect(useStore.getState().notebookId).toBe(nb);
    const sid = useStore.getState().addSection(nb, 'Probabilità');
    expect(useStore.getState().sectionId).toBe(sid);
    const pid = useStore.getState().addPage(sid, 'Bayes')!;
    await Promise.resolve();
    expect(useStore.getState().pageId).toBe(pid);
    expect(useStore.getState().workspace.sections[sid].pageIds).toContain(pid);
  });

  it('records undo/redo history for canvas edits', () => {
    const s = useStore.getState();
    const item: TextItem = { id: 'undo-me', type: 'text', x: 0, y: 0, w: 100, h: 30, doc: P.textDocFromPlain('x'), variant: 'plain' };
    s.updatePage((p) => P.addItems(p, [item]));
    expect(useStore.getState().currentPage()!.items['undo-me']).toBeTruthy();
    expect(useStore.getState().undo()).toBe(true);
    expect(useStore.getState().currentPage()!.items['undo-me']).toBeUndefined();
    expect(useStore.getState().redo()).toBe(true);
    expect(useStore.getState().currentPage()!.items['undo-me']).toBeTruthy();
  });

  it('commits a gesture as a single undo step', () => {
    const s = useStore.getState();
    const before = s.currentPage()!;
    for (let i = 1; i <= 5; i++) s.updatePage((p) => P.updateItems(p, { 'undo-me': { x: i * 10 } }), false);
    useStore.getState().commitFrom(before);
    expect((useStore.getState().currentPage()!.items['undo-me'] as TextItem).x).toBe(50);
    useStore.getState().undo();
    expect((useStore.getState().currentPage()!.items['undo-me'] as TextItem).x).toBe(0);
  });

  it('autosaves to IndexedDB and reports the status only after success', async () => {
    useStore.getState().markDirty();
    expect(useStore.getState().saveStatus).toBe('unsaved');
    await flush();
    expect(useStore.getState().saveStatus).toBe('saved');
    expect(dirty.ws).toBe(false);
    const ws = await loadWorkspace();
    expect(Object.values(ws!.notebooks).map((n) => n.name)).toContain('Statistica');
    const page = await loadPage(useStore.getState().pageId!);
    expect(page?.items['undo-me']).toBeTruthy();
    // search text is refreshed on save
    expect(useStore.getState().workspace.pages[useStore.getState().pageId!].searchText).toContain('x');
  });

  it('duplicates pages including their content', async () => {
    const src = useStore.getState().pageId!;
    const copy = await useStore.getState().duplicatePage(src);
    expect(copy).toBeTruthy();
    const c = useStore.getState().pages[copy!];
    expect(Object.values(c.items).some((i) => i.type === 'text')).toBe(true);
    expect(Object.keys(c.items)).not.toContain('undo-me');
  });

  it('moves deleted pages to the trash and restores them', async () => {
    const pid = useStore.getState().pageId!;
    useStore.getState().deletePage(pid);
    expect(useStore.getState().workspace.pages[pid]).toBeUndefined();
    expect(useStore.getState().workspace.trash.some((t) => t.page.id === pid)).toBe(true);
    expect(await useStore.getState().restorePage(pid)).toBe(true);
    expect(useStore.getState().workspace.pages[pid]).toBeTruthy();
    await useStore.getState().emptyTrash();
  });

  it('creates text blocks with the 4x conventional width (480px)', () => {
    const id = createTextBlock({ x: 50, y: 50 });
    expect(id).toBeTruthy();
    const item = useStore.getState().currentPage()!.items[id!] as TextItem;
    expect(item.w).toBe(480);
  });
});
