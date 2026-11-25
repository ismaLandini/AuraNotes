import { describe, expect, it } from 'vitest';
import { extractMathAwarePlainText, hasMathNodes, parseTextWithMath } from './mathPaste';

describe('mathPaste', () => {
  it('converts inline \\(...\\) and $...$ formulas while preserving surrounding text', () => {
    const doc = parseTextWithMath('Sia \\(f(x) = x^2\\) e $g(x) = \\sin(x)$ continue.');
    expect(hasMathNodes(doc)).toBe(true);
    expect(doc.content).toEqual([
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Sia ' },
          { type: 'mathInline', attrs: { latex: 'f(x) = x^2' } },
          { type: 'text', text: ' e ' },
          { type: 'mathInline', attrs: { latex: 'g(x) = \\sin(x)' } },
          { type: 'text', text: ' continue.' },
        ],
      },
    ]);
  });

  it('splits block \\[...\\] and $$...$$ formulas into separate mathBlock nodes even when mixed with text', () => {
    const doc = parseTextWithMath('Formula di Eulero: \\[e^{i\\pi} + 1 = 0\\] segue $$\\int_0^1 x\\,dx = \\frac{1}{2}$$ fine.');
    expect(doc.content).toEqual([
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Formula di Eulero:' }],
      },
      { type: 'mathBlock', attrs: { latex: 'e^{i\\pi} + 1 = 0' } },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'segue' }],
      },
      { type: 'mathBlock', attrs: { latex: '\\int_0^1 x\\,dx = \\frac{1}{2}' } },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'fine.' }],
      },
    ]);
  });

  it('formats numeric and adjacent-number $...$ expressions (e.g. $4$, $4 e 4$, 4$x$, $x$4) while still protecting escaped dollars and code spans', () => {
    const numericDoc = parseTextWithMath('Valore $4$, intervallo $4 e 4$, prodotto 4$x$ e $y$4, più \\$100 + $x + \\$5$ e singolo $4 finale.');
    expect(numericDoc.content).toEqual([
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Valore ' },
          { type: 'mathInline', attrs: { latex: '4' } },
          { type: 'text', text: ', intervallo ' },
          { type: 'mathInline', attrs: { latex: '4 e 4' } },
          { type: 'text', text: ', prodotto 4' },
          { type: 'mathInline', attrs: { latex: 'x' } },
          { type: 'text', text: ' e ' },
          { type: 'mathInline', attrs: { latex: 'y' } },
          { type: 'text', text: '4, più \\$100 + ' },
          { type: 'mathInline', attrs: { latex: 'x + \\$5' } },
          { type: 'text', text: ' e singolo $4 finale.' },
        ],
      },
    ]);

    const codeDoc = parseTextWithMath('Inline `\\(a+b\\)` e blocco:\n```\n\\[c+d\\]\n```\nMa \\(e+f\\) converte.');
    expect(codeDoc.content).toEqual([
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Inline `\\(a+b\\)` e blocco:' }],
      },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: '```' }],
      },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: '\\[c+d\\]' }],
      },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: '```' }],
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Ma ' },
          { type: 'mathInline', attrs: { latex: 'e+f' } },
          { type: 'text', text: ' converte.' },
        ],
      },
    ]);
  });

  it('extracts KaTeX/MathJax annotations from HTML when plain text lacks delimiters', () => {
    const html =
      '<p>Energia <span class="katex"><math><semantics><annotation encoding="application/x-tex">E = mc^2</annotation></semantics></math></span></p>' +
      '<div class="katex-display"><math display="block"><semantics><annotation encoding="application/x-tex">\\sum_{i=1}^n i</annotation></semantics></math></div>';
    const extracted = extractMathAwarePlainText('Energia E = mc2', html);
    expect(extracted).toContain('\\(E = mc^2\\)');
    expect(extracted).toContain('\\[\\sum_{i=1}^n i\\]');

    // When plain text already has delimiters, keep it directly.
    expect(extractMathAwarePlainText('Già \\(x^2\\)', html)).toBe('Già \\(x^2\\)');
  });
});
