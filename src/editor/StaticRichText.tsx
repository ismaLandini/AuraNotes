import { memo, useLayoutEffect, useMemo, useRef } from 'react';
import { generateHTML, type JSONContent } from '@tiptap/core';
import { lowlight, renderLatex, sharedExtensions } from './extensions';
import { getAssetUrl } from '../storage/assets';
import { computeBucketWidth, getPdfPageUrl } from '../pdf/pageCache';
import { arrowHeadPath, smoothPath } from '../lib/geometry';
import type { PdfSourceAttr, ShapeItem, StrokeItem } from '../types';

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

const SVG_NS = 'http://www.w3.org/2000/svg';

function renderAnnotationsSvg(annotations: Array<StrokeItem | ShapeItem>, dispW: number, dispH: number): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'image-block-annotations');
  svg.setAttribute('width', String(dispW));
  svg.setAttribute('height', String(dispH));
  svg.setAttribute('viewBox', `0 0 ${dispW} ${dispH}`);
  svg.style.position = 'absolute';
  svg.style.inset = '0';
  svg.style.pointerEvents = 'none';
  svg.style.zIndex = '5';

  const map = (nx: number, ny: number) => ({ x: nx * dispW, y: ny * dispH });

  for (const item of annotations) {
    if (item.type === 'stroke') {
      const pts: number[] = [];
      for (let i = 0; i + 1 < item.points.length; i += 2) {
        const p = map(item.points[i], item.points[i + 1]);
        pts.push(p.x, p.y);
      }
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', smoothPath(pts));
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', item.color);
      path.setAttribute('stroke-width', String(item.width));
      path.setAttribute('stroke-opacity', String(item.opacity));
      path.setAttribute('stroke-linecap', item.tool === 'highlighter' ? 'butt' : 'round');
      path.setAttribute('stroke-linejoin', 'round');
      if (item.tool === 'highlighter') {
        path.style.mixBlendMode = 'multiply';
      }
      svg.appendChild(path);
    } else if (item.type === 'shape') {
      const a = map(item.x1, item.y1);
      const b = map(item.x2, item.y2);
      if (item.kind === 'rect') {
        const rect = document.createElementNS(SVG_NS, 'rect');
        rect.setAttribute('x', String(Math.min(a.x, b.x)));
        rect.setAttribute('y', String(Math.min(a.y, b.y)));
        rect.setAttribute('width', String(Math.abs(b.x - a.x)));
        rect.setAttribute('height', String(Math.abs(b.y - a.y)));
        rect.setAttribute('rx', '4');
        rect.setAttribute('fill', item.fill ?? 'none');
        if (item.fill) rect.setAttribute('fill-opacity', '0.35');
        rect.setAttribute('stroke', item.color);
        rect.setAttribute('stroke-width', String(item.width));
        rect.setAttribute('stroke-opacity', String(item.opacity));
        svg.appendChild(rect);
      } else if (item.kind === 'ellipse') {
        const ell = document.createElementNS(SVG_NS, 'ellipse');
        ell.setAttribute('cx', String((a.x + b.x) / 2));
        ell.setAttribute('cy', String((a.y + b.y) / 2));
        ell.setAttribute('rx', String(Math.abs(b.x - a.x) / 2));
        ell.setAttribute('ry', String(Math.abs(b.y - a.y) / 2));
        ell.setAttribute('fill', item.fill ?? 'none');
        if (item.fill) ell.setAttribute('fill-opacity', '0.35');
        ell.setAttribute('stroke', item.color);
        ell.setAttribute('stroke-width', String(item.width));
        ell.setAttribute('stroke-opacity', String(item.opacity));
        svg.appendChild(ell);
      } else {
        const g = document.createElementNS(SVG_NS, 'g');
        g.setAttribute('fill', 'none');
        g.setAttribute('stroke', item.color);
        g.setAttribute('stroke-width', String(item.width));
        g.setAttribute('stroke-opacity', String(item.opacity));
        g.setAttribute('stroke-linecap', 'round');
        g.setAttribute('stroke-linejoin', 'round');
        const line = document.createElementNS(SVG_NS, 'line');
        line.setAttribute('x1', String(a.x));
        line.setAttribute('y1', String(a.y));
        line.setAttribute('x2', String(b.x));
        line.setAttribute('y2', String(b.y));
        g.appendChild(line);
        const head = Math.max(10, item.width * 4);
        if (item.kind === 'arrow' || item.kind === 'double-arrow') {
          const p1 = document.createElementNS(SVG_NS, 'path');
          p1.setAttribute('d', arrowHeadPath(a, b, head));
          g.appendChild(p1);
        }
        if (item.kind === 'double-arrow') {
          const p2 = document.createElementNS(SVG_NS, 'path');
          p2.setAttribute('d', arrowHeadPath(b, a, head));
          g.appendChild(p2);
        }
        svg.appendChild(g);
      }
    }
  }

  return svg;
}

const WIKI_LINK_STATIC_RE = /\[\[([^[\]\n]+?)\]\]/g;

function enhanceWikiLinks(root: HTMLElement) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const parent = node.parentElement;
    if (!parent) continue;
    if (parent.closest('code, pre, [data-math-inline], [data-math-block], .wiki-link')) continue;
    if (node.nodeValue && node.nodeValue.includes('[[')) {
      textNodes.push(node as Text);
    }
  }
  for (const tNode of textNodes) {
    const raw = tNode.nodeValue ?? '';
    WIKI_LINK_STATIC_RE.lastIndex = 0;
    if (!WIKI_LINK_STATIC_RE.test(raw)) continue;
    WIKI_LINK_STATIC_RE.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let lastIdx = 0;
    for (const m of raw.matchAll(WIKI_LINK_STATIC_RE)) {
      const idx = m.index ?? 0;
      const target = m[1].trim();
      if (!target) continue;
      if (idx > lastIdx) {
        frag.appendChild(document.createTextNode(raw.slice(lastIdx, idx)));
      }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'wiki-link';
      btn.setAttribute('data-wiki-link', target);
      btn.setAttribute('data-testid', `wiki-link-${target}`);
      btn.title = `Apri pagina: ${target}`;
      btn.textContent = target;
      frag.appendChild(btn);
      lastIdx = idx + m[0].length;
    }
    if (lastIdx === 0) continue;
    if (lastIdx < raw.length) {
      frag.appendChild(document.createTextNode(raw.slice(lastIdx)));
    }
    tNode.parentNode?.replaceChild(frag, tNode);
  }
}

/** Renders equations, code highlighting, wiki-links, and imageBlocks inside static HTML produced by generateHTML. */
export async function enhanceStaticHTML(root: HTMLElement): Promise<void> {
  root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((cb) => {
    cb.disabled = true;
  });
  root.querySelectorAll<HTMLElement>('[data-math-inline]').forEach((el) => renderLatex(el, el.getAttribute('data-latex') ?? '', false));
  root.querySelectorAll<HTMLElement>('[data-math-block]').forEach((el) => renderLatex(el, el.getAttribute('data-latex') ?? '', true));
  enhanceWikiLinks(root);
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

  const inPrint = !!root.closest('#print-root');
  const imageBlocks = Array.from(root.querySelectorAll<HTMLElement>('[data-type="image-block"]'));
  await Promise.all(
    imageBlocks.map(async (el) => {
      const assetId = el.getAttribute('data-asset-id');
      const widthAttr = el.getAttribute('data-width');
      const naturalWidth = Number(el.getAttribute('data-natural-width') || 0);
      const naturalHeight = Number(el.getAttribute('data-natural-height') || 0);
      const indent = Number(el.getAttribute('data-indent') || 0);
      const rotation = Number(el.getAttribute('data-rotation') || 0);
      const altText = el.getAttribute('alt') || '';
      const rawAnnotations = el.getAttribute('data-annotations');

      const dispW = widthAttr ? Number(widthAttr) : naturalWidth || 400;
      const ratio = naturalWidth && naturalHeight ? naturalWidth / naturalHeight : 1.333;
      const dispH = Math.max(24, Math.round(dispW / ratio));

      el.setAttribute('data-testid', 'image-block');
      el.style.position = 'relative';
      el.style.width = `${dispW}px`;
      el.style.minHeight = `${dispH}px`;
      if (naturalWidth && naturalHeight) {
        el.style.aspectRatio = `${naturalWidth} / ${naturalHeight}`;
      }
      if (indent > 0) {
        el.style.marginLeft = `${indent * 24}px`;
      }
      const align = (el.style.textAlign as string) || el.getAttribute('data-text-align') || null;
      if (align === 'center') {
        el.style.marginLeft = 'auto';
        el.style.marginRight = 'auto';
      } else if (align === 'right') {
        el.style.marginLeft = 'auto';
        el.style.marginRight = '0';
      }
      if (rotation) {
        el.style.transform = `rotate(${rotation}deg)`;
      }

      if (!el.querySelector('img')) {
        let url: string | null = null;
        if (assetId) {
          url = await getAssetUrl(assetId);
        } else {
          const rawSource = el.getAttribute('data-source');
          if (rawSource) {
            try {
              const parsedSource = JSON.parse(rawSource) as PdfSourceAttr;
              if (
                parsedSource &&
                parsedSource.type === 'pdf' &&
                typeof parsedSource.assetId === 'string' &&
                parsedSource.assetId &&
                typeof parsedSource.page === 'number' &&
                parsedSource.page >= 1
              ) {
                const targetWidth = inPrint
                  ? Math.max(1200, Math.round(((naturalWidth || 595.28) * 300) / 72))
                  : computeBucketWidth(dispW);
                url = await getPdfPageUrl(parsedSource.assetId, parsedSource.page, targetWidth, undefined, {
                  priority: inPrint ? 10 : 1,
                });
              }
            } catch {
              /* ignore invalid source */
            }
          }
        }
        if (url && !el.querySelector('img')) {
          const img = document.createElement('img');
          img.src = url;
          img.alt = altText;
          img.width = naturalWidth || dispW;
          img.height = naturalHeight || dispH;
          img.decoding = inPrint ? 'sync' : 'async';
          img.loading = inPrint ? 'eager' : 'lazy';
          img.className = 'image-block-img';
          img.style.width = '100%';
          img.style.height = 'auto';
          img.style.display = 'block';
          img.style.borderRadius = '6px';
          el.appendChild(img);
          if (!inPrint) {
            void img.decode?.().catch(() => {});
          }
        }
      }

      if (rawAnnotations && !el.querySelector('svg.image-block-annotations')) {
        try {
          const parsed = JSON.parse(rawAnnotations) as Array<StrokeItem | ShapeItem>;
          if (Array.isArray(parsed) && parsed.length > 0) {
            el.appendChild(renderAnnotationsSvg(parsed, dispW, dispH));
          }
        } catch {
          /* ignore malformed annotations */
        }
      }
    }),
  );
}

export const StaticRichText = memo(function StaticRichText({ doc, className }: { doc: JSONContent; className?: string }) {
  const html = useMemo(() => docToHTML(doc), [doc]);
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (ref.current) void enhanceStaticHTML(ref.current);
  }, [html]);
  return <div ref={ref} className={`rich ProseMirror-static ${className ?? ''}`} dangerouslySetInnerHTML={{ __html: html }} />;
});
