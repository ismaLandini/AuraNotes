import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { StaticRichText, docToHTML } from './StaticRichText';
import { htmlToDoc } from '../canvas/actions';

describe('rich text rendering', () => {
  const doc = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Titolo' }] },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'grassetto', marks: [{ type: 'bold' }] },
          { type: 'text', text: ' ' },
          { type: 'text', text: 'evidenziato', marks: [{ type: 'highlight', attrs: { color: '#ffe066' } }] },
          { type: 'text', text: ' H' },
          { type: 'text', text: '2', marks: [{ type: 'subscript' }] },
          { type: 'text', text: 'O ' },
          { type: 'mathInline', attrs: { latex: '\\alpha + \\beta' } },
        ],
      },
      { type: 'mathBlock', attrs: { latex: '\\int_0^1 x\\,dx' } },
      { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'fatto' }] }] }] },
      { type: 'codeBlock', attrs: { language: 'python' }, content: [{ type: 'text', text: 'def f(x):\n    return x' }] },
    ],
  };

  it('serialises formatting to HTML', () => {
    const html = docToHTML(doc);
    expect(html).toContain('<h2');
    expect(html).toContain('<strong>grassetto</strong>');
    expect(html).toContain('<mark');
    expect(html).toContain('<sub>2</sub>');
    expect(html).toContain('data-math-inline');
    expect(html).toContain('data-math-block');
  });

  it('renders equations with KaTeX and highlights code', () => {
    const { container } = render(<StaticRichText doc={doc} />);
    expect(container.querySelectorAll('.katex').length).toBe(2);
    expect(container.querySelector('code.hljs .hljs-keyword')?.textContent).toBe('def');
    expect(container.querySelector('input[type="checkbox"]')).toBeDisabled();
  });

  it('parses pasted HTML from browsers and word processors', () => {
    const parsed = htmlToDoc('<meta charset="utf-8"><h1>Capitolo</h1><p>Testo <b>forte</b> e <i>corsivo</i></p><ul><li>uno</li></ul>');
    const json = JSON.stringify(parsed);
    expect(json).toContain('"heading"');
    expect(json).toContain('"bold"');
    expect(json).toContain('"italic"');
    expect(json).toContain('"bulletList"');
  });

  it('round-trips equations through HTML', () => {
    const html = docToHTML(doc);
    const back = htmlToDoc(html)!;
    expect(JSON.stringify(back)).toContain('\\\\alpha + \\\\beta');
  });

  it('serialises and parses imageBlock in rich text document', () => {
    const docWithImage = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Diagramma:' }] },
        {
          type: 'imageBlock',
          attrs: {
            assetId: 'ast-xyz',
            width: 320,
            naturalWidth: 640,
            naturalHeight: 480,
            mime: 'image/png',
            indent: 1,
            alt: 'Schema del circuito',
          },
        },
      ],
    };

    const html = docToHTML(docWithImage);
    expect(html).toContain('data-type="image-block"');
    expect(html).toContain('data-asset-id="ast-xyz"');
    expect(html).toContain('data-width="320"');

    const parsed = htmlToDoc(html)!;
    const imgNode = parsed.content?.find((n) => n.type === 'imageBlock');
    expect(imgNode).toBeDefined();
    expect(imgNode?.attrs?.assetId).toBe('ast-xyz');
    expect(imgNode?.attrs?.width).toBe(320);
  });
});
