import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';
import App from '../App';
import { EditableRichText } from '../editor/EditableRichText';
import { useActiveEditor } from '../editor/activeEditor';
import { useStore } from '../store/useStore';
import { useUI } from '../store/ui';
import { isMac } from '../shortcuts/registry';
import {
  consumeShiftPasteIntent,
  createTextBlock,
  handleCopy,
  handlePaste,
  markShiftPasteIntent,
  pastePlainText,
} from './actions';
import type { NoteContainerItem } from '../types';

function makeClipboardEvent(
  type: 'copy' | 'paste',
  data: Record<string, string>,
): ClipboardEvent {
  const store = { ...data };
  const dt = {
    items: [] as DataTransferItem[],
    files: [] as unknown as FileList,
    getData: (mime: string) => store[mime] ?? '',
    setData: (mime: string, val: string) => {
      store[mime] = val;
    },
  };
  const ev = new Event(type, { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(ev, 'clipboardData', { value: dt });
  return ev;
}

describe('Shift+Cmd+V paste with system format and colors', () => {
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
    consumeShiftPasteIntent();
  });

  it('strips external HTML colors, fonts, and marks on canvas when plain=true', async () => {
    const pid = useStore.getState().pageId!;
    const before = useStore.getState().pages[pid].order.length;

    const richHtml =
      '<p><span style="color: rgb(255, 0, 0); font-family: Georgia; font-size: 28px;"><strong>Titolo</strong></span> ' +
      '<mark data-color="#ffe066">evidenziato</mark></p>';

    // Regular paste preserves HTML formatting
    const normalEv = makeClipboardEvent('paste', {
      'text/html': richHtml,
      'text/plain': 'Titolo evidenziato',
    });
    await handlePaste(normalEv);
    const afterNormal = useStore.getState().pages[pid];
    expect(afterNormal.order.length).toBe(before + 1);
    const normalItem = afterNormal.items[afterNormal.order[afterNormal.order.length - 1]] as NoteContainerItem;
    expect(JSON.stringify(normalItem.doc)).toContain('bold');
    expect(JSON.stringify(normalItem.doc)).toContain('highlight');

    // Plain paste strips external formatting & colors, leaving clean system paragraphs
    const plainEv = makeClipboardEvent('paste', {
      'text/html': richHtml,
      'text/plain': 'Titolo evidenziato\nSeconda riga',
    });
    await handlePaste(plainEv, { plain: true });
    const afterPlain = useStore.getState().pages[pid];
    expect(afterPlain.order.length).toBe(before + 2);
    const plainItem = afterPlain.items[afterPlain.order[afterPlain.order.length - 1]] as NoteContainerItem;
    expect(plainItem.variant).toBe('plain');
    expect(plainItem.doc).toEqual({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Titolo evidenziato' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Seconda riga' }] },
      ],
    });
  });

  it('converts copied sticky/styled GlassNote blocks into plain system text when plain=true', async () => {
    const pid = useStore.getState().pageId!;
    const stickyId = createTextBlock(
      { x: 120, y: 120 },
      {
        variant: 'sticky',
        edit: false,
        doc: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Nota gialla', marks: [{ type: 'textStyle', attrs: { color: '#e5484d' } }] }],
            },
          ],
        },
      },
    )!;
    useStore.getState().setSelection([stickyId]);

    const copiedData: Record<string, string> = {};
    const copyEv = makeClipboardEvent('copy', copiedData);
    expect(handleCopy(copyEv, false)).toBe(true);

    const before = useStore.getState().pages[pid].order.length;
    const pasteEv = makeClipboardEvent('paste', {
      'text/plain': copyEv.clipboardData!.getData('text/plain'),
      'text/html': copyEv.clipboardData!.getData('text/html'),
    });
    await handlePaste(pasteEv, { plain: true });

    const page = useStore.getState().pages[pid];
    expect(page.order.length).toBe(before + 1);
    const pasted = page.items[page.order[page.order.length - 1]] as NoteContainerItem;
    expect(pasted.variant).toBe('plain');
    expect(pasted.bg).toBeUndefined();
    expect(pasted.doc).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Nota gialla' }] }],
    });
  });

  it('pastes plain text into EditableRichText via pastePlainText and Shift+Cmd+V without external colors', async () => {
    let latestDoc: unknown = null;
    const { unmount } = render(
      <EditableRichText
        id="block-1"
        initial={{
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Inizio ' }] }],
        }}
        onChange={(d) => {
          latestDoc = d;
        }}
        onExit={() => {}}
      />,
    );

    await waitFor(() => expect(useActiveEditor.getState().editor).not.toBeNull());
    const editor = useActiveEditor.getState().editor!;
    useStore.getState().setEditing('block-1');

    // 1. Direct pastePlainText (used by Tauri native menu Shift+Cmd+V)
    expect(pastePlainText('testo pulito')).toBe(true);
    await waitFor(() => expect(editor.getText()).toContain('Inizio testo pulito'));
    expect(JSON.stringify(editor.getJSON())).not.toContain('color');

    // 2. Keydown Shift+Cmd/Ctrl+V followed by paste event containing rich colored HTML
    const modProp = isMac ? { metaKey: true } : { ctrlKey: true };
    fireEvent.keyDown(editor.view.dom, { key: 'v', code: 'KeyV', shiftKey: true, ...modProp });
    const pasteEv = makeClipboardEvent('paste', {
      'text/html': '<span style="color: #ff0000; font-family: Arial; font-size: 30px;"><b>rosso</b></span>',
      'text/plain': ' rosso',
    });
    editor.view.dom.dispatchEvent(pasteEv);

    await waitFor(() => expect(editor.getText()).toContain('Inizio testo pulito rosso'));
    const jsonStr = JSON.stringify(editor.getJSON());
    expect(jsonStr).not.toContain('#ff0000');
    expect(jsonStr).not.toContain('Arial');
    expect(jsonStr).not.toContain('"bold"');
    void latestDoc;
    unmount();
    useStore.getState().setEditing(null);
  });

  it('handles Shift+Cmd+V keydown + paste on the Canvas in App', async () => {
    render(<App />);
    const canvas = await waitFor(() => document.querySelector('[data-testid="canvas"]') as HTMLElement);
    expect(canvas).toBeTruthy();
    useStore.getState().setEditing(null);

    const pid = useStore.getState().pageId!;
    const before = useStore.getState().pages[pid].order.length;

    const modProp = isMac ? { metaKey: true } : { ctrlKey: true };
    fireEvent.keyDown(window, { key: 'V', code: 'KeyV', shiftKey: true, ...modProp });
    const pasteEv = makeClipboardEvent('paste', {
      'text/html': '<p style="color: rgb(12, 34, 56); font-size: 26px;"><i>Testo da Word</i></p>',
      'text/plain': 'Testo da Word',
    });
    document.dispatchEvent(pasteEv);

    await waitFor(() => expect(useStore.getState().pages[pid].order.length).toBe(before + 1));
    const page = useStore.getState().pages[pid];
    const item = page.items[page.order[page.order.length - 1]] as NoteContainerItem;
    expect(item.variant).toBe('plain');
    expect(JSON.stringify(item.doc)).not.toContain('rgb(12, 34, 56)');
    expect(JSON.stringify(item.doc)).not.toContain('italic');
    expect(item.doc).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Testo da Word' }] }],
    });
  });

  it('inserts plain text into a focused input element', () => {
    const input = document.createElement('input');
    input.value = 'Ciao mondo';
    document.body.appendChild(input);
    input.focus();
    input.setSelectionRange(5, 10);

    expect(pastePlainText('sistema')).toBe(true);
    expect(input.value).toBe('Ciao sistema');
    input.remove();
  });

  it('expires shift paste intent cleanly after consume', () => {
    markShiftPasteIntent();
    expect(consumeShiftPasteIntent()).toBe(true);
    expect(consumeShiftPasteIntent()).toBe(false);
  });

  it('pastes plain text when desktop menu emits paste-match-style', async () => {
    const { initDesktop } = await import('../desktop');
    let menuHandler: ((cmd: string) => void) | undefined;
    const mockBridge = {
      platform: 'darwin',
      onFlushRequest: () => {},
      onMenu: (fn: (cmd: string) => void) => {
        menuHandler = fn;
      },
      writeBackup: async () => '',
      openBackups: async () => {},
      savePdf: async () => null,
      info: async () => ({ version: '2.0.0', userData: '', backups: '' }),
      setTheme: async () => {},
      readClipboardText: async () => 'Dal menu nativo',
    };
    (window as unknown as { auranotesDesktop?: unknown }).auranotesDesktop = mockBridge;
    initDesktop();

    const pid = useStore.getState().pageId!;
    const before = useStore.getState().pages[pid].order.length;
    expect(menuHandler).toBeDefined();
    (menuHandler as ((cmd: string) => void) | undefined)?.('paste-match-style');

    await waitFor(() => expect(useStore.getState().pages[pid].order.length).toBe(before + 1));
    const page = useStore.getState().pages[pid];
    const item = page.items[page.order[page.order.length - 1]] as NoteContainerItem;
    expect(item.doc).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Dal menu nativo' }] }],
    });
    delete (window as unknown as { auranotesDesktop?: unknown }).auranotesDesktop;
    document.documentElement.classList.remove('is-desktop');
  });

  it('converts inline and block formulas on Shift+Cmd+V (plain paste) on canvas and inside editor, leaving normal Cmd+V raw', async () => {
    const pid = useStore.getState().pageId!;
    useStore.getState().setEditing(null);

    // 1. Normal Cmd+V on canvas does NOT convert LaTeX delimiters
    const normalEv = makeClipboardEvent('paste', {
      'text/plain': 'Formula \\(a^2 + b^2\\) grezza',
    });
    expect(await handlePaste(normalEv)).toBe(true);
    const normalId = useStore.getState().selection[0];
    const normalItem = useStore.getState().pages[pid].items[normalId] as NoteContainerItem;
    expect(normalItem.doc).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Formula \\(a^2 + b^2\\) grezza' }] }],
    });

    // 2. Shift+Cmd+V on canvas converts both inline and block formulas
    const plainEv = makeClipboardEvent('paste', {
      'text/plain': 'Teorema: $a^2 + b^2 = c^2$ e \\[\\int_0^1 x\\,dx\\]',
    });
    expect(await handlePaste(plainEv, { plain: true })).toBe(true);
    const mathId = useStore.getState().selection[0];
    const mathItem = useStore.getState().pages[pid].items[mathId] as NoteContainerItem;
    expect(mathItem.doc).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Teorema: ' },
            { type: 'mathInline', attrs: { latex: 'a^2 + b^2 = c^2' } },
            { type: 'text', text: ' e' },
          ],
        },
        { type: 'mathBlock', attrs: { latex: '\\int_0^1 x\\,dx' } },
      ],
    });

    // 3. Shift+Cmd+V inside an active EditableRichText converts formulas into the editor
    const edId = createTextBlock({ x: 100, y: 300 }, { edit: true })!;
    const { unmount } = render(
      <EditableRichText
        id={edId}
        initial={{ type: 'doc', content: [{ type: 'paragraph' }] }}
        onChange={() => {}}
        onExit={() => {}}
      />,
    );
    await waitFor(() => expect(useActiveEditor.getState().editor).not.toBeNull());
    expect(pastePlainText('Valore \\(\\alpha\\) ok')).toBe(true);
    const edJson = useActiveEditor.getState().editor!.getJSON();
    expect(edJson.content?.[0].content).toEqual([
      { type: 'text', text: 'Valore ' },
      { type: 'mathInline', attrs: { latex: '\\alpha' } },
      { type: 'text', text: ' ok' },
    ]);
    unmount();
  });
});
