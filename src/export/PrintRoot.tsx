import { useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import type { ID, PageContent } from '../types';
import { StaticPage } from '../canvas/render';
import { enhanceStaticHTML } from '../editor/StaticRichText';
import { contentBounds, itemBounds } from '../lib/geometry';
import { computeLayout, PAPERS, type PrintOptions, type SheetLayout } from './pagination';

export interface PrintPage {
  id: ID;
  title: string;
  content: PageContent;
}

export interface PrintJob {
  pages: PrintPage[];
  options: PrintOptions;
  docTitle: string;
  paperClass: string;
  patternClass: string;
}

interface PrintState {
  job: PrintJob | null;
  onReady: (() => void) | null;
}

export const usePrint = create<PrintState>(() => ({ job: null, onReady: null }));

export function layoutForPage(p: PageContent, o: PrintOptions): SheetLayout {
  const rects = p.order.map((id) => p.items[id]).filter((it) => it && it.type !== 'connector').map((it) => itemBounds(it, p.items));
  return computeLayout(contentBounds(p), rects, o);
}

export function Sheets({ job, limit }: { job: PrintJob; limit?: number }) {
  const o = job.options;
  const all: Array<{ page: PrintPage; layout: SheetLayout; idx: number }> = [];
  for (const page of job.pages) {
    const layout = layoutForPage(page.content, o);
    layout.slices.forEach((_, idx) => all.push({ page, layout, idx }));
  }
  const total = all.length;
  const shown = limit ? all.slice(0, limit) : all;
  return (
    <>
      {shown.map(({ page, layout, idx }, n) => {
        const s = layout.slices[idx];
        return (
          <div
            key={`${page.id}-${idx}`}
            className={`sheet ${o.includeBackground ? `with-bg ${job.paperClass} ${page.content.background ? `pattern-${page.content.background.pattern}` : job.patternClass}` : ''}`}
            style={{ width: `${layout.sheetWmm}mm`, height: `${layout.sheetHmm}mm`, padding: `${o.marginMm}mm` }}
          >
            {o.showTitle && (
              <div className="sheet-header" style={{ height: layout.headerH }}>
                <span>{page.title}</span>
                {idx > 0 && <span className="cont">(segue)</span>}
              </div>
            )}
            <div className="sheet-content" style={{ width: layout.contentW, height: s.h * layout.scale }}>
              <div className="world print-world" style={{ transform: `scale(${layout.scale}) translate(${-s.x}px, ${-s.y}px)` }}>
                <StaticPage page={page.content} />
              </div>
            </div>
            {o.pageNumbers && (
              <div className="sheet-footer" style={{ height: layout.footerH }}>
                {n + 1} / {total}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

export function countSheets(job: PrintJob): number {
  return job.pages.reduce((a, p) => a + layoutForPage(p.content, job.options).slices.length, 0);
}

async function waitForAssets(root: HTMLElement) {
  await enhanceStaticHTML(root);
  const imgs = Array.from(root.querySelectorAll('img'));
  await Promise.all(
    imgs.map(async (img) => {
      if (!img.complete) {
        await new Promise<void>((res) => {
          img.onload = () => res();
          img.onerror = () => res();
        });
      }
      await img.decode?.().catch(() => {});
    }),
  );
  if (document.fonts?.ready) await document.fonts.ready;
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}

/** Off-screen render target used for printing; becomes the only visible content in print media. */
export function PrintRoot() {
  const job = usePrint((s) => s.job);
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!job) return;
    const style = document.createElement('style');
    style.id = 'print-page-style';
    style.textContent = `@page { size: ${PAPERS[job.options.paper].css} ${job.options.orientation}; margin: 0; }`;
    document.head.appendChild(style);
    const prevTitle = document.title;
    document.title = job.docTitle;
    return () => {
      style.remove();
      document.title = prevTitle;
    };
  }, [job]);
  useEffect(() => {
    if (!job || !ref.current) return;
    let alive = true;
    void waitForAssets(ref.current).then(() => {
      if (alive) usePrint.getState().onReady?.();
    });
    return () => {
      alive = false;
    };
  }, [job]);
  if (!job) return null;
  return createPortal(
    <div id="print-root" ref={ref} data-testid="print-root">
      <Sheets job={job} />
    </div>,
    document.body,
  );
}

/** Renders the job and resolves once images and fonts are ready. */
export function preparePrint(job: PrintJob): Promise<void> {
  return new Promise((resolve) => {
    usePrint.setState({ job, onReady: resolve });
  });
}

export function clearPrint() {
  usePrint.setState({ job: null, onReady: null });
}

/** Opens the native print dialog (which offers "Save as PDF" on macOS). */
export async function runPrint(job: PrintJob): Promise<void> {
  await preparePrint(job);
  const done = () => {
    window.removeEventListener('afterprint', done);
    clearPrint();
  };
  window.addEventListener('afterprint', done);
  window.print();
  // Some browsers do not fire afterprint reliably; clean up eventually.
  setTimeout(() => {
    if (usePrint.getState().job === job) done();
  }, 60_000);
}
