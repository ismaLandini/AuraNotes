import { memo, useLayoutEffect, useMemo, useRef } from 'react';
import { generateHTML, type JSONContent } from '@tiptap/core';
import { lowlight, renderLatex, sharedExtensions } from './extensions';

const htmlCache = new WeakMap<JSONContent, string>();

export function docToHTML(doc: JSONContent): string {
  const cached = htmlCache.get(doc);
  if (cached !== undefined) return cached;
  let html: string;
  try {
    html = generateHTML(doc, sharedExtensions());
  } catch (e) {
    console.warn('Contenuto non valido nel blocco di testo', e);
    html = '<p><em>Contenuto non leggibile</em></p>';
  }
  htmlCache.set(doc, html);
  return html;
}

interface HastNode {
  type: string;
  value?: string;
  tagName?: string;
  properties?: { className?: string[] };
  children?: HastNode[];
}

function hastToDom(nodes: HastNode[], parent: Node) {
  for (const n of nodes) {
    if (n.type === 'text') parent.appendChild(document.createTextNode(n.value ?? ''));
    else if (n.type === 'element' && n.tagName) {
      const el = document.createElement(n.tagName);
      if (n.properties?.className) el.className = n.properties.className.join(' ');
      hastToDom(n.children ?? [], el);
      parent.appendChild(el);
    }
  }
}

/** Renders equations and syntax highlighting inside static HTML produced by generateHTML. */
export function enhanceStaticHTML(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('[data-math-inline]').forEach((el) => renderLatex(el, el.getAttribute('data-latex') ?? '', false));
  root.querySelectorAll<HTMLElement>('[data-math-block]').forEach((el) => renderLatex(el, el.getAttribute('data-latex') ?? '', true));
  root.querySelectorAll<HTMLElement>('pre > code').forEach((code) => {
    const text = code.textContent ?? '';
    const lang = /language-([\w-]+)/.exec(code.className)?.[1];
    try {
      const tree = lang && lowlight.registered(lang) ? lowlight.highlight(lang, text) : lowlight.highlightAuto(text);
      code.textContent = '';
      hastToDom(tree.children as HastNode[], code);
      code.classList.add('hljs');
    } catch {
      /* keep plain text */
    }
  });
  root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((cb) => {
    cb.disabled = true;
  });
}

export const StaticRichText = memo(function StaticRichText({ doc, className }: { doc: JSONContent; className?: string }) {
  const html = useMemo(() => docToHTML(doc), [doc]);
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (ref.current) enhanceStaticHTML(ref.current);
  }, [html]);
  return <div ref={ref} className={`rich ProseMirror-static ${className ?? ''}`} dangerouslySetInnerHTML={{ __html: html }} />;
});
