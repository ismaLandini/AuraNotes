import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { render, fireEvent } from '@testing-library/react';
import { getExtensions } from './extensions';
import { docToHTML } from './StaticRichText';
import { htmlToDoc } from '../canvas/actions';
import { getParagraphFormatState } from './paragraphFormat';
import { ParagraphPanel } from '../components/ParagraphPanel';

describe('ParagraphFormat TipTap extension', () => {
  const createTestEditor = (content?: string) => {
    return new Editor({
      extensions: getExtensions(),
      content: content || '<p>Primo paragrafo</p>',
    });
  };

  it('applies and persists line height, spaces, indents, alignment, and letter-spacing', () => {
    const editor = createTestEditor('<p>Testo formattato</p>');

    editor.commands.setParagraphFormat({
      lineHeight: '1.5',
      spaceBefore: 12,
      spaceAfter: 18,
      leftIndent: 24,
      firstLineIndent: 10,
      letterSpacing: 1.5,
      textAlign: 'center',
    });

    const json = editor.getJSON();
    const p = json.content![0];
    expect(p.attrs?.lineHeight).toBe('1.5');
    expect(p.attrs?.spaceBefore).toBe(12);
    expect(p.attrs?.spaceAfter).toBe(18);
    expect(p.attrs?.leftIndent).toBe(24);
    expect(p.attrs?.firstLineIndent).toBe(10);
    expect(p.attrs?.letterSpacing).toBe(1.5);
    expect(p.attrs?.textAlign).toBe('center');

    // Check HTML serialization (which is also used by print/PDF export)
    const html = docToHTML(json);
    expect(html).toContain('line-height: 1.5');
    expect(html).toContain('margin-top: 12pt');
    expect(html).toContain('margin-bottom: 18pt');
    expect(html).toContain('padding-left: 24pt');
    expect(html).toContain('text-indent: 10pt');
    expect(html).toContain('letter-spacing: 1.5pt');
    expect(html).toContain('text-align: center');

    // Check round-trip from HTML back to doc
    const roundTrip = htmlToDoc(html)!;
    const restoredP = roundTrip.content![0];
    expect(restoredP.attrs?.lineHeight).toBe('1.5');
    expect(restoredP.attrs?.spaceBefore).toBe(12);
    expect(restoredP.attrs?.spaceAfter).toBe(18);
    expect(restoredP.attrs?.leftIndent).toBe(24);
    expect(restoredP.attrs?.firstLineIndent).toBe(10);
    expect(restoredP.attrs?.letterSpacing).toBe(1.5);
    expect(restoredP.attrs?.textAlign).toBe('center');
  });

  it('inherits settings when pressing Enter', () => {
    const editor = createTestEditor('<p>Paragrafo 1</p>');

    editor.commands.setParagraphFormat({
      lineHeight: '1.15',
      spaceBefore: 6,
      spaceAfter: 10,
      leftIndent: 15,
      firstLineIndent: 8,
      letterSpacing: 0.5,
      textAlign: 'justify',
    });

    // Place cursor inside paragraph and press Enter
    editor.commands.focus('end');
    editor.commands.keyboardShortcut('Enter');

    const json = editor.getJSON();
    expect(json.content).toHaveLength(2);

    const p1 = json.content![0];
    const p2 = json.content![1];

    expect(p2.attrs?.lineHeight).toBe(p1.attrs?.lineHeight);
    expect(p2.attrs?.spaceBefore).toBe(p1.attrs?.spaceBefore);
    expect(p2.attrs?.spaceAfter).toBe(p1.attrs?.spaceAfter);
    expect(p2.attrs?.leftIndent).toBe(p1.attrs?.leftIndent);
    expect(p2.attrs?.firstLineIndent).toBe(p1.attrs?.firstLineIndent);
    expect(p2.attrs?.letterSpacing).toBe(p1.attrs?.letterSpacing);
    expect(p2.attrs?.textAlign).toBe(p1.attrs?.textAlign);
  });

  it('undoes paragraph format changes with Cmd+Z as a single operation', () => {
    const editor = createTestEditor('<p>Testo iniziale</p>');

    editor.commands.setParagraphFormat({
      lineHeight: '2.0',
      spaceBefore: 20,
    });

    expect(editor.getJSON().content![0].attrs?.lineHeight).toBe('2.0');
    expect(editor.getJSON().content![0].attrs?.spaceBefore).toBe(20);

    // Undo
    editor.commands.undo();

    expect(editor.getJSON().content![0].attrs?.lineHeight).toBeNull();
    expect(editor.getJSON().content![0].attrs?.spaceBefore).toBeNull();

    // Redo
    editor.commands.redo();

    expect(editor.getJSON().content![0].attrs?.lineHeight).toBe('2.0');
    expect(editor.getJSON().content![0].attrs?.spaceBefore).toBe(20);
  });

  it('resets all formatting with resetParagraphFormat', () => {
    const editor = createTestEditor('<p>Testo formattato</p>');

    editor.commands.setParagraphFormat({
      lineHeight: '2.0',
      spaceBefore: 14,
      spaceAfter: 14,
      leftIndent: 20,
      firstLineIndent: 10,
      letterSpacing: 2,
      textAlign: 'right',
    });

    editor.commands.resetParagraphFormat();

    const p = editor.getJSON().content![0];
    expect(p.attrs?.lineHeight).toBeNull();
    expect(p.attrs?.spaceBefore).toBeNull();
    expect(p.attrs?.spaceAfter).toBeNull();
    expect(p.attrs?.leftIndent).toBeNull();
    expect(p.attrs?.firstLineIndent).toBeNull();
    expect(p.attrs?.letterSpacing).toBeNull();
    expect(p.attrs?.textAlign).toBeNull();
    expect(p.attrs?.indent).toBe(0);
  });

  it('detects mixed values across selected paragraphs', () => {
    const editor = createTestEditor('<p>Paragrafo A</p><p>Paragrafo B</p>');

    // Apply different settings to first and second paragraph
    editor.commands.setTextSelection({ from: 1, to: 5 });
    editor.commands.setParagraphFormat({ lineHeight: '1.15', spaceBefore: 8 });

    editor.commands.setTextSelection({ from: 15, to: 20 });
    editor.commands.setParagraphFormat({ lineHeight: '2.0', spaceBefore: 8 });

    // Select across both paragraphs
    editor.commands.selectAll();

    const state = getParagraphFormatState(editor);
    expect(state.lineHeight).toBe('mixed');
    expect(state.spaceBefore).toBe(8); // both have spaceBefore 8, so not mixed
  });

  it('does not apply line-height or letter-spacing to image blocks, but respects alignment', () => {
    const docWithImage = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Paragrafo' }] },
        {
          type: 'imageBlock',
          attrs: {
            assetId: 'ast-1',
            width: 300,
            naturalWidth: 600,
            naturalHeight: 400,
          },
        },
      ],
    };

    const editor = new Editor({
      extensions: getExtensions(),
      content: docWithImage,
    });

    // Select the entire document including image
    editor.commands.selectAll();

    editor.commands.setParagraphFormat({
      lineHeight: '2.0',
      letterSpacing: 3,
      textAlign: 'center',
    });

    const json = editor.getJSON();
    const p = json.content![0];
    const img = json.content![1];

    expect(p.attrs?.lineHeight).toBe('2.0');
    expect(p.attrs?.letterSpacing).toBe(3);
    expect(p.attrs?.textAlign).toBe('center');

    // Image block receives alignment but NOT lineHeight or letterSpacing
    expect(img.attrs?.textAlign).toBe('center');
    expect(img.attrs?.lineHeight).toBeUndefined();
    expect(img.attrs?.letterSpacing).toBeUndefined();
  });
});

describe('ParagraphPanel UI component', () => {
  it('renders paragraph controls and updates editor when clicked/typed', () => {
    const editor = new Editor({
      extensions: getExtensions(),
      content: '<p>Testo per il pannello</p>',
    });

    const { getByRole, getByLabelText, getByText } = render(<ParagraphPanel editor={editor} />);

    // Check header
    expect(getByText('Paragrafo')).toBeDefined();

    // Check alignment button group
    const alignGroup = getByRole('group', { name: 'Allineamento' });
    expect(alignGroup).toBeDefined();

    // Change alignment
    const centerBtn = getByRole('button', { name: 'Centra' });
    fireEvent.click(centerBtn);
    expect(editor.getJSON().content![0].attrs?.textAlign).toBe('center');

    // Change line-height
    const lhSelect = getByLabelText('Interlinea') as HTMLSelectElement;
    fireEvent.change(lhSelect, { target: { value: '1.5' } });
    expect(editor.getJSON().content![0].attrs?.lineHeight).toBe('1.5');

    // Click reset
    const resetBtn = getByText('Ripristina predefiniti');
    fireEvent.click(resetBtn);
    expect(editor.getJSON().content![0].attrs?.lineHeight).toBeNull();
    expect(editor.getJSON().content![0].attrs?.textAlign).toBeNull();
  });
});
