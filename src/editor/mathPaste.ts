import type { JSONContent } from '@tiptap/core';

interface ProtectedSpan {
  start: number;
  end: number;
}

type MathToken =
  | { kind: 'text'; value: string }
  | { kind: 'inline'; latex: string }
  | { kind: 'block'; latex: string };

/** Returns true if the character at `idx` is escaped by an odd number of preceding backslashes. */
function isEscaped(src: string, idx: number): boolean {
  let backslashes = 0;
  for (let i = idx - 1; i >= 0 && src[i] === '\\'; i--) {
    backslashes++;
  }
  return backslashes % 2 === 1;
}

/** Collects fenced code blocks (```...```) and inline code (`...`) spans that must not be parsed as math. */
function findCodeSpans(src: string): ProtectedSpan[] {
  const spans: ProtectedSpan[] = [];
  let i = 0;
  while (i < src.length) {
    if (src.startsWith('```', i)) {
      const close = src.indexOf('```', i + 3);
      if (close !== -1) {
        spans.push({ start: i, end: close + 3 });
        i = close + 3;
        continue;
      }
    }
    if (src[i] === '`' && !isEscaped(src, i)) {
      const close = src.indexOf('`', i + 1);
      if (close !== -1 && !src.slice(i + 1, close).includes('\n')) {
        spans.push({ start: i, end: close + 1 });
        i = close + 1;
        continue;
      }
    }
    i++;
  }
  return spans;
}

function findNextBlockDelimiter(src: string, from: number, open: '\\[' | '$$', close: '\\]' | '$$', limit: number): { end: number; latex: string } | null {
  const start = from + open.length;
  let pos = start;
  while (pos < limit) {
    const idx = src.indexOf(close, pos);
    if (idx === -1 || idx + close.length > limit) return null;
    if (!isEscaped(src, idx)) {
      const latex = src.slice(start, idx).trim();
      if (!latex) return null;
      return { end: idx + close.length, latex };
    }
    pos = idx + 1;
  }
  return null;
}

function findNextInlineParen(src: string, from: number, limit: number): { end: number; latex: string } | null {
  const start = from + 2;
  let pos = start;
  while (pos < limit) {
    const idx = src.indexOf('\\)', pos);
    if (idx === -1 || idx + 2 > limit) return null;
    if (!isEscaped(src, idx)) {
      const latex = src.slice(start, idx).trim();
      if (!latex) return null;
      return { end: idx + 2, latex };
    }
    pos = idx + 2;
  }
  return null;
}

function findNextInlineDollar(src: string, from: number, limit: number): { end: number; latex: string } | null {
  if (from + 1 >= limit || /\s/.test(src[from + 1]) || src[from + 1] === '$') return null;

  let pos = from + 1;
  while (pos < limit) {
    const ch = src[pos];
    if (ch === '\n' || ch === '\r') return null;
    if (ch === '$' && !isEscaped(src, pos)) {
      if (pos + 1 < src.length && src[pos + 1] === '$') {
        return null;
      }
      if (/\s/.test(src[pos - 1])) return null;
      const inner = src.slice(from + 1, pos);
      const latex = inner.trim();
      if (!latex) return null;
      return { end: pos + 1, latex };
    }
    pos++;
  }
  return null;
}

function tokenizeMathInRange(src: string, start: number, end: number, out: MathToken[]): void {
  let cursor = start;
  let i = start;

  const flushText = (upto: number) => {
    if (upto > cursor) {
      out.push({ kind: 'text', value: src.slice(cursor, upto) });
    }
  };

  while (i < end) {
    if (src[i] === '\\' && !isEscaped(src, i)) {
      if (i + 1 < end && src[i + 1] === '[') {
        const match = findNextBlockDelimiter(src, i, '\\[', '\\]', end);
        if (match) {
          flushText(i);
          out.push({ kind: 'block', latex: match.latex });
          i = match.end;
          cursor = i;
          continue;
        }
      }
      if (i + 1 < end && src[i + 1] === '(') {
        const match = findNextInlineParen(src, i, end);
        if (match) {
          flushText(i);
          out.push({ kind: 'inline', latex: match.latex });
          i = match.end;
          cursor = i;
          continue;
        }
      }
      i += 2;
      continue;
    }

    if (src[i] === '$' && !isEscaped(src, i)) {
      if (i + 1 < end && src[i + 1] === '$') {
        const match = findNextBlockDelimiter(src, i, '$$', '$$', end);
        if (match) {
          flushText(i);
          out.push({ kind: 'block', latex: match.latex });
          i = match.end;
          cursor = i;
          continue;
        }
      } else {
        const match = findNextInlineDollar(src, i, end);
        if (match) {
          flushText(i);
          out.push({ kind: 'inline', latex: match.latex });
          i = match.end;
          cursor = i;
          continue;
        }
      }
    }

    i++;
  }

  flushText(end);
}

function tokenizeTextWithMath(src: string): MathToken[] {
  const codeSpans = findCodeSpans(src);
  const tokens: MathToken[] = [];
  let pos = 0;

  for (const span of codeSpans) {
    if (span.start > pos) {
      tokenizeMathInRange(src, pos, span.start, tokens);
    }
    tokens.push({ kind: 'text', value: src.slice(span.start, span.end) });
    pos = span.end;
  }

  if (pos < src.length) {
    tokenizeMathInRange(src, pos, src.length, tokens);
  }

  return tokens;
}

/**
 * Parses plain text into a ProseMirror/TipTap JSONContent document, automatically
 * converting inline (`\(...\)`, `$...$`) and block (`\[...\]`, `$$...$$`) LaTeX
 * formulas into `mathInline` and `mathBlock` nodes.
 */
export function parseTextWithMath(text: string): JSONContent {
  const tokens = tokenizeTextWithMath(text);
  const blocks: JSONContent[] = [];
  let currentInline: JSONContent[] = [];
  let hasContentInCurrentLine = false;
  let justEmittedBlock = false;

  const pushTextToLine = (val: string) => {
    if (!val) return;
    const last = currentInline[currentInline.length - 1];
    if (last && last.type === 'text') {
      last.text = (last.text ?? '') + val;
    } else {
      currentInline.push({ type: 'text', text: val });
    }
    hasContentInCurrentLine = true;
  };

  const flushParagraph = (keepIfEmpty: boolean) => {
    if (currentInline.length > 0) {
      blocks.push({ type: 'paragraph', content: currentInline });
      currentInline = [];
      hasContentInCurrentLine = false;
    } else if (keepIfEmpty) {
      blocks.push({ type: 'paragraph' });
      hasContentInCurrentLine = false;
    }
  };

  for (const tok of tokens) {
    if (tok.kind === 'block') {
      // Trim trailing horizontal whitespace on the current line before splitting for a mathBlock.
      if (currentInline.length > 0) {
        const last = currentInline[currentInline.length - 1];
        if (last.type === 'text' && last.text) {
          last.text = last.text.replace(/[ \t]+$/, '');
          if (!last.text) currentInline.pop();
        }
      }
      if (currentInline.length > 0) {
        flushParagraph(false);
      }
      blocks.push({ type: 'mathBlock', attrs: { latex: tok.latex } });
      justEmittedBlock = true;
      continue;
    }

    if (tok.kind === 'inline') {
      justEmittedBlock = false;
      currentInline.push({ type: 'mathInline', attrs: { latex: tok.latex } });
      hasContentInCurrentLine = true;
      continue;
    }

    // tok.kind === 'text'
    let val = tok.value;
    if (justEmittedBlock) {
      // Consume the single newline or horizontal spaces immediately following a block formula
      // so we don't emit an extra blank paragraph around `\[...\]`.
      val = val.replace(/^[ \t]*(?:\r\n?|\n)/, '').replace(/^[ \t]+/, '');
      justEmittedBlock = false;
      if (!val) continue;
    }

    const lines = val.split(/\r\n?|\n/);
    for (let li = 0; li < lines.length; li++) {
      if (li > 0) {
        flushParagraph(!hasContentInCurrentLine || currentInline.length > 0);
      }
      if (lines[li]) {
        pushTextToLine(lines[li]);
      }
    }
  }

  if (currentInline.length > 0 || blocks.length === 0) {
    flushParagraph(true);
  } else if (hasContentInCurrentLine) {
    flushParagraph(false);
  }

  return { type: 'doc', content: blocks };
}

/** Returns true if a TipTap JSONContent document contains any mathInline or mathBlock node. */
export function hasMathNodes(doc: JSONContent | null | undefined): boolean {
  if (!doc) return false;
  if (doc.type === 'mathInline' || doc.type === 'mathBlock') return true;
  return Array.isArray(doc.content) && doc.content.some((c) => hasMathNodes(c));
}

/** Converts all `mathInline` and `mathBlock` nodes in a TipTap JSONContent document back into plain text. */
export function unwrapMathInDoc(doc: JSONContent): { doc: JSONContent; changed: boolean } {
  let changed = false;
  const mapNode = (node: JSONContent): JSONContent => {
    if (node.type === 'mathInline') {
      changed = true;
      return { type: 'text', text: String(node.attrs?.latex ?? '') };
    }
    if (node.type === 'mathBlock') {
      changed = true;
      const latex = String(node.attrs?.latex ?? '');
      return latex
        ? { type: 'paragraph', content: [{ type: 'text', text: latex }] }
        : { type: 'paragraph' };
    }
    if (!Array.isArray(node.content)) return node;
    const mapped: JSONContent[] = [];
    for (const child of node.content) {
      const next = mapNode(child);
      if (next.type === 'text' && !next.text) continue;
      const prev = mapped[mapped.length - 1];
      if (next.type === 'text' && prev?.type === 'text' && !next.marks && !prev.marks) {
        prev.text = (prev.text ?? '') + (next.text ?? '');
      } else {
        mapped.push(next);
      }
    }
    return { ...node, content: mapped };
  };
  return { doc: mapNode(doc), changed };
}

function latexFromMathElement(el: Element): string | null {
  const attrLatex = el.getAttribute('data-latex');
  if (attrLatex && attrLatex.trim()) return attrLatex.trim();

  const texAnn = el.querySelector('annotation[encoding="application/x-tex"], annotation[encoding="application/tex"]');
  if (texAnn?.textContent?.trim()) return texAnn.textContent.trim();

  const script = el.querySelector('script[type^="math/tex"]');
  if (script?.textContent?.trim()) return script.textContent.trim();

  const alt = el.getAttribute('alttext');
  if (alt && alt.trim()) return alt.trim();

  return null;
}

/**
 * Returns `rawPlain` when it already contains recognizable LaTeX delimiters.
 * Otherwise, if `html` contains KaTeX/MathJax/GlassNote math elements, extracts their
 * LaTeX annotations into a clean plain-text string with `\(...\)` and `\[...\]` delimiters.
 */
export function extractMathAwarePlainText(rawPlain: string, html: string): string {
  if (rawPlain && hasMathNodes(parseTextWithMath(rawPlain))) {
    return rawPlain;
  }
  if (!html || typeof document === 'undefined') return rawPlain;
  if (!/data-math-|data-latex|katex|mjx-container|application\/x-tex|<math\b/i.test(html)) {
    return rawPlain;
  }

  const host = document.createElement('div');
  host.innerHTML = html;

  let extractedAny = false;
  const replaceMathEl = (el: Element, isBlock: boolean) => {
    if (!el.isConnected && !host.contains(el)) return;
    const latex = latexFromMathElement(el);
    if (!latex) return;
    extractedAny = true;
    const textNode = document.createTextNode(isBlock ? `\n\\[${latex}\\]\n` : `\\(${latex}\\)`);
    el.replaceWith(textNode);
  };

  host.querySelectorAll('[data-math-block], .katex-display, mjx-container[display="true"]').forEach((el) => {
    replaceMathEl(el, true);
  });
  host.querySelectorAll('[data-math-inline], .katex, mjx-container, math').forEach((el) => {
    const isBlock = el.tagName.toLowerCase() === 'math' && el.getAttribute('display') === 'block';
    replaceMathEl(el, isBlock);
  });

  if (!extractedAny) return rawPlain;

  const blockTags = new Set(['p', 'div', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'tr']);
  const parts: string[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.textContent ?? '');
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (tag === 'style' || tag === 'script') return;
    if (tag === 'br') {
      parts.push('\n');
      return;
    }
    const isBlock = blockTags.has(tag);
    if (isBlock && parts.length > 0 && !parts[parts.length - 1].endsWith('\n')) {
      parts.push('\n');
    }
    el.childNodes.forEach(walk);
    if (isBlock && parts.length > 0 && !parts[parts.length - 1].endsWith('\n')) {
      parts.push('\n');
    }
  };
  host.childNodes.forEach(walk);

  const extracted = parts.join('').replace(/\n{3,}/g, '\n\n').trim();
  return extracted || rawPlain;
}
