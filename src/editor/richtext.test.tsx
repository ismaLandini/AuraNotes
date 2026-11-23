import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { StaticRichText, docToHTML } from './StaticRichText';
import { stripMathDelimiters } from './extensions';
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

  it('strips outer LaTeX math delimiters when detecting a single formula', () => {
    expect(stripMathDelimiters('\\({q_1, q_2, \\dots, q_n}\\)')).toBe('{q_1, q_2, \\dots, q_n}');
    expect(stripMathDelimiters('  \\( f(x) = \\left( x + 1 \\right) \\)  ')).toBe('f(x) = \\left( x + 1 \\right)');
    expect(stripMathDelimiters('\\[\\int_0^1 x\\,dx\\]')).toBe('\\int_0^1 x\\,dx');
    expect(stripMathDelimiters('\\[\\begin{aligned} a &= 1 \\\\[2mm] b &= 2 \\end{aligned}\\]')).toBe(
      '\\begin{aligned} a &= 1 \\\\[2mm] b &= 2 \\end{aligned}',
    );
    expect(stripMathDelimiters('$$\\sum_{i=1}^n i$$')).toBe('\\sum_{i=1}^n i');
    expect(stripMathDelimiters('$x^2 + y^2$')).toBe('x^2 + y^2');
    expect(stripMathDelimiters('$x + \\$5$')).toBe('x + \\$5');
    // Multiple formulas or unmatched delimiters should remain unchanged
    expect(stripMathDelimiters('\\(a\\) + \\(b\\)')).toBe('\\(a\\) + \\(b\\)');
    expect(stripMathDelimiters('$100 + $200')).toBe('$100 + $200');
    expect(stripMathDelimiters('a^2 + b^2')).toBe('a^2 + b^2');
  });
});
