import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';
import App from '../App';
import { useStore } from '../store/useStore';
import { useUI } from '../store/ui';
import { useActiveEditor } from '../editor/activeEditor';
import { createVectorFormulasPdf, pdfBytesToFile } from '../pdf/pdfTestFixtures';
import { importPdfAsDocument } from '../pdf/importPdfDocument';
import {
  copySelectionToInternal,
  createTextBlock,
  duplicateSelection,
  finishEditing,
  handlePaste,
  htmlToDoc,
  pasteFromInternal,
} from './actions';
import { setVp } from './viewport';
import { computeSheetLayouts } from '../lib/page';
import type { NoteContainerItem } from '../types';

function makeClipboardEvent(
  data: Record<string, string>,
  files: File[] = [],
): ClipboardEvent {
  const store = { ...data };
  const items = files.map((f) => ({
    kind: 'file',
    type: f.type,
    getAsFile: () => f,
  })) as unknown as DataTransferItem[];
  const dt = {
    items,
    files: files as unknown as FileList,
    getData: (mime: string) => store[mime] ?? '',
    setData: (mime: string, val: string) => {
      store[mime] = val;
    },
  };
  const ev = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(ev, 'clipboardData', { value: dt });
  return ev;
}

describe('PDF sheet insertion and external paste workflow', () => {
  beforeAll(() => {
    const emptyRects = () => [] as unknown as DOMRectList;
    const zeroRect = () => new DOMRect(0, 0, 0, 0);
    if (typeof Range !== 'undefined') {
      Range.prototype.getClientRects ??= emptyRects;
      Range.prototype.getBoundingClientRect ??= zeroRect;
    }
    if (typeof Element !== 'undefined') {
      Element.prototype.getClientRects ??= emptyRects;
    }
    if (typeof Text !== 'undefined') {
      (Text.prototype as unknown as { getClientRects?: () => DOMRectList }).getClientRects ??= emptyRects;
    }
  });

  beforeEach(async () => {
    useUI.getState().set({
      homeOpen: false,
      confirm: null,
      prompt: null,
      searchOpen: false,
      settingsOpen: false,
      shortcutsOpen: false,
      exportOpen: false,
      trashOpen: false,
      pdfDialogOpen: false,
      templatePickerOpen: false,
    });
    if (!useStore.getState().loaded) {
      await useStore.getState().init();
    }
  });

  it('adds a blank sheet to an imported PDF, pastes external HTML/text onto the new sheet, and keeps tools & selection responsive', async () => {
    const pdfBytes = createVectorFormulasPdf(2);
    const file = pdfBytesToFile(pdfBytes, 'Dispense.pdf');
    const secId = useStore.getState().sectionId!;
    const { pageId } = await importPdfAsDocument(file, file.name, secId);
    await useStore.getState().openPage(pageId);

    render(<App />);
    const canvasEl = await waitFor(
      () => document.querySelector('[data-testid="canvas"]') as HTMLDivElement,
    );
    Object.defineProperty(canvasEl, 'clientWidth', { value: 1280, configurable: true });
    Object.defineProperty(canvasEl, 'clientHeight', { value: 900, configurable: true });

    const addBtn = await waitFor(
      () => document.querySelector('[data-testid="add-sheet-below-1"]') as HTMLButtonElement,
    );
    expect(addBtn).toBeTruthy();

    // Wrapper between sheets must not intercept canvas pointer events
    const wrap = addBtn.parentElement!;
    expect(wrap.hasAttribute('data-ui')).toBe(false);

    // Simulate user having pen tool selected before adding a sheet and pasting external text
    useStore.getState().setTool('pen');
    fireEvent.click(addBtn);

    const pageAfterInsert = useStore.getState().pages[pageId];
    expect(pageAfterInsert.sheets).toHaveLength(3);
    expect(pageAfterInsert.sheets![0].type).toBe('pdf');
    expect(pageAfterInsert.sheets![1].type).toBe('blank');
    expect(pageAfterInsert.sheets![1].width).toBe(pageAfterInsert.sheets![0].width);
    expect(pageAfterInsert.sheets![1].height).toBe(pageAfterInsert.sheets![0].height);

    // Paste external rich text copied from a browser/macOS app (includes <head>/<style> and formatted HTML)
    const externalHtml =
      '<!DOCTYPE html><html><head><meta charset="utf-8"><style>p.p1 {margin: 0; font: 12px Helvetica}</style></head>' +
      '<body><p class="p1">Appunti esterni copiati dal PDF</p></body></html>';
    const pasteEv = makeClipboardEvent({
      'text/html': externalHtml,
      'text/plain': 'Appunti esterni copiati dal PDF',
    });
    document.dispatchEvent(pasteEv);

    await waitFor(() => expect(useStore.getState().pages[pageId].order.length).toBe(1));
    const stAfterPaste = useStore.getState();
    const pastedId = stAfterPaste.pages[pageId].order[0];
    const pastedItem = stAfterPaste.pages[pageId].items[pastedId] as NoteContainerItem;

    // Pasted block lands inside the newly inserted blank sheet (sheet index 1), not in the gap above it
    const layouts = computeSheetLayouts(stAfterPaste.pages[pageId]);
    expect(pastedItem.y).toBeGreaterThanOrEqual(layouts[1].y);
    expect(pastedItem.y).toBeLessThan(layouts[1].y + layouts[1].h);
    expect(JSON.stringify(pastedItem.doc)).toContain('Appunti esterni copiati dal PDF');
    expect(JSON.stringify(pastedItem.doc)).not.toContain('font: 12px Helvetica');

    // Tool switched to select and pasted block is selected; tool shortcuts continue working cleanly
    expect(stAfterPaste.tool).toBe('select');
    expect(stAfterPaste.selection).toEqual([pastedId]);
    expect(stAfterPaste.editingId).toBeNull();

    // Switching tools via keyboard shortcuts ('p' for pen, 'v' for select) works without lockup
    fireEvent.keyDown(window, { key: 'p', code: 'KeyP' });
    expect(useStore.getState().tool).toBe('pen');
    fireEvent.keyDown(window, { key: 'v', code: 'KeyV' });
    expect(useStore.getState().tool).toBe('select');
  });

  it('prefers text/html over bundled clipboard image snapshot when external rich text is copied', async () => {
    const pid = useStore.getState().pageId!;
    useStore.getState().setEditing(null);
    const before = useStore.getState().pages[pid].order.length;

    const fakeSnapshot = new File([new Uint8Array([137, 80, 78, 71])], 'image.png', { type: 'image/png' });
    const ev = makeClipboardEvent(
      {
        'text/html': '<p>Testo copiato da app esterna</p>',
        'text/plain': 'Testo copiato da app esterna',
      },
      [fakeSnapshot],
    );
    await handlePaste(ev);

    const page = useStore.getState().pages[pid];
    expect(page.order.length).toBe(before + 1);
    const created = page.items[page.order[page.order.length - 1]] as NoteContainerItem;
    expect(JSON.stringify(created.doc)).toContain('Testo copiato da app esterna');
    expect(created.freeImage).toBeUndefined();
  });

  it('falls back to plain text when external HTML yields an empty ProseMirror doc', () => {
    expect(htmlToDoc('<style>.a { color: red; }</style><div></div>')).toBeNull();
  });

  it('preserves recently typed content when finishEditing runs before debounce flush and unblocks orphaned editingId on tool shortcut', async () => {
    render(<App />);
    await waitFor(() => expect(document.querySelector('[data-testid="canvas"]')).toBeTruthy());

    const pid = useStore.getState().pageId!;
    const id = createTextBlock({ x: 100, y: 100 }, { edit: true })!;
    await waitFor(() => expect(useActiveEditor.getState().editor).not.toBeNull());

    const ed = useActiveEditor.getState().editor!;
    // Type into editor without waiting for the 250ms debounce flush
    ed.commands.insertContent('Testo immediato');
    finishEditing(id);

    const saved = useStore.getState().pages[pid].items[id] as NoteContainerItem | undefined;
    expect(saved).toBeDefined();
    expect(JSON.stringify(saved!.doc)).toContain('Testo immediato');
    expect(useStore.getState().editingId).toBeNull();

    // Simulate orphaned editingId (e.g. focus moved to body after switching apps) and press 'p'
    const id2 = createTextBlock({ x: 100, y: 200 }, { edit: true })!;
    await waitFor(() => expect(useStore.getState().editingId).toBe(id2));
    (document.activeElement as HTMLElement | null)?.blur?.();
    document.body.focus();

    fireEvent.keyDown(window, { key: 'p', code: 'KeyP' });
    expect(useStore.getState().editingId).toBeNull();
    expect(useStore.getState().tool).toBe('pen');
  });

  it('removes an added sheet via right-click context menu and keeps duplicates/pastes inside sheet bounds', async () => {
    const { container } = render(<App />);
    const canvasEl = await waitFor(() => {
      const el = container.querySelector('[data-testid="canvas"]') as HTMLDivElement | null;
      expect(el).toBeTruthy();
      return el!;
    });
    Object.defineProperty(canvasEl, 'clientWidth', { value: 1280, configurable: true });
    Object.defineProperty(canvasEl, 'clientHeight', { value: 900, configurable: true });
    Object.defineProperty(canvasEl, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 1280, height: 900, right: 1280, bottom: 900 }),
      configurable: true,
    });

    const pid = useStore.getState().pageId!;
    const beforeSheets = useStore.getState().pages[pid].sheets?.length ?? 1;
    useStore.getState().addSheetToCurrentPage();
    expect(useStore.getState().pages[pid].sheets).toHaveLength(beforeSheets + 1);

    const layouts = computeSheetLayouts(useStore.getState().pages[pid]);
    const lastIdx = layouts.length - 1;
    // Place an item near the bottom-right corner of sheet 1 and duplicate it
    const id1 = createTextBlock({ x: layouts[0].x + layouts[0].w - 220, y: layouts[0].y + layouts[0].h - 60 }, { w: 220, edit: false })!;
    useStore.getState().setSelection([id1]);
    duplicateSelection();

    const dupId = useStore.getState().selection[0];
    const dupItem = useStore.getState().pages[pid].items[dupId] as NoteContainerItem;
    expect(dupItem.x + dupItem.w).toBeLessThanOrEqual(layouts[0].x + layouts[0].w);
    expect(dupItem.y).toBeLessThan(layouts[0].y + layouts[0].h);

    // Copy item from sheet 1, scroll viewport onto the last (newly added) sheet, and paste: should land inside that sheet
    useStore.getState().setSelection([id1]);
    copySelectionToInternal();
    setVp({ x: layouts[lastIdx].x - 100, y: layouts[lastIdx].y, zoom: 1 });
    expect(pasteFromInternal()).toBe(true);

    const pastedId = useStore.getState().selection[0];
    const pastedItem = useStore.getState().pages[pid].items[pastedId] as NoteContainerItem;
    expect(pastedItem.y).toBeGreaterThanOrEqual(layouts[lastIdx].y);
    expect(pastedItem.y).toBeLessThan(layouts[lastIdx].y + layouts[lastIdx].h);

    // Right-click inside the last sheet and remove it via context menu
    const sheetEl = await waitFor(() => {
      const el = container.querySelector(`[data-testid="canvas-sheet-${lastIdx + 1}"]`) as HTMLElement | null;
      expect(el).toBeTruthy();
      return el!;
    });
    fireEvent.contextMenu(sheetEl, { clientX: 400, clientY: 200 });
    const removeBtn = await waitFor(() => {
      const btn = document.querySelector('[data-testid="sheet-ctx-remove"]') as HTMLButtonElement | null;
      expect(btn).toBeTruthy();
      return btn!;
    });
    expect(removeBtn).not.toBeDisabled();
    fireEvent.click(removeBtn);

    expect(useStore.getState().pages[pid].sheets).toHaveLength(beforeSheets);
    expect(useStore.getState().pages[pid].items[pastedId]).toBeUndefined();
  });

  it('selects items added on a newly inserted sheet below rather than items on the sheet above', async () => {
    const { container } = render(<App />);
    const canvasEl = await waitFor(() => {
      const el = container.querySelector('[data-testid="canvas"]') as HTMLDivElement | null;
      expect(el).toBeTruthy();
      return el!;
    });
    Object.defineProperty(canvasEl, 'clientWidth', { value: 1280, configurable: true });
    Object.defineProperty(canvasEl, 'clientHeight', { value: 900, configurable: true });
    Object.defineProperty(canvasEl, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 1280, height: 900, right: 1280, bottom: 900 }),
      configurable: true,
    });
    canvasEl.setPointerCapture = () => {};
    canvasEl.releasePointerCapture = () => {};

    const pid = useStore.getState().pageId!;
    useStore.getState().setTool('select');
    const beforeSheets = computeSheetLayouts(useStore.getState().pages[pid]).length;
    // Add an item on sheet 1 at y = 100
    const topId = createTextBlock({ x: 100, y: 100 }, { w: 240, edit: false })!;
    expect(topId).toBeTruthy();

    const addBtn = await waitFor(
      () => document.querySelector('[data-testid="add-sheet-below-1"]') as HTMLButtonElement,
    );
    fireEvent.click(addBtn);

    const layouts = computeSheetLayouts(useStore.getState().pages[pid]);
    expect(layouts).toHaveLength(beforeSheets + 1);

    // Add an item on sheet 2 at y = layouts[1].y + 100
    const bottomY = layouts[1].y + 100;
    const bottomId = createTextBlock({ x: 100, y: bottomY }, { w: 240, edit: false })!;
    useStore.getState().setSelection([]);

    // Simulate an accidental scroll event on the canvas container (e.g. from editor focus)
    canvasEl.scrollTop = 1000;
    fireEvent.scroll(canvasEl);
    expect(canvasEl.scrollTop).toBe(0);

    // Click on the item on sheet 2 in screen coordinates
    const vp = useStore.getState().viewports[pid]!;
    const clientX = (150 - vp.x) * vp.zoom;
    const clientY = (bottomY + 12 - vp.y) * vp.zoom;
    fireEvent.pointerDown(canvasEl, { clientX, clientY, button: 0, pointerId: 1 });
    fireEvent.pointerUp(canvasEl, { clientX, clientY, button: 0, pointerId: 1 });

    expect(useStore.getState().selection).toEqual([bottomId]);
    expect(useStore.getState().selection).not.toContain(topId);
  });
});
