import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import type { ID, PageBackground, PageContent, PdfSourceAttr, SheetDef } from '../types';
import { StaticPage } from '../canvas/render';
import { enhanceStaticHTML } from '../editor/StaticRichText';
import { computeSheetLayouts } from '../lib/page';
import { getCachedPdfPageUrl, getPdfPageUrl, usePdfPageUrl } from '../pdf/pageCache';
import { layoutForPage, PAPERS, type PrintOptions, type SheetLayout } from './pagination';

export { layoutForPage };

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

/** Pre-renders and caches all PDF pages needed for printing before starting print/PDF dialog. */
export async function preloadPrintPdfPages(job: PrintJob): Promise<void> {
  const promises: Promise<string>[] = [];
  for (const page of job.pages) {
    const sheets = computeSheetLayouts(page.content);
    for (const sh of sheets) {
      if (sh.sheet.type === 'pdf' && sh.sheet.pdfAssetId && sh.sheet.pdfPage) {
        const targetW = Math.max(1600, Math.round(sh.w * 2));
        promises.push(
          getPdfPageUrl(sh.sheet.pdfAssetId, sh.sheet.pdfPage, targetW).catch(() => ''),
        );
      }
    }
  }
  if (promises.length > 0) {
    await Promise.all(promises);
  }
}

/** Background layer for a single sheet (original PDF page image or paper background). */
export function PrintSheetBackground({
  sheet,
  w,
  bg,
  includeBackground,
}: {
  sheet: SheetDef;
  w: number;
  h: number;
  bg?: PageBackground;
  includeBackground: boolean;
}) {
  const isPdf = sheet.type === 'pdf';
  const targetW = Math.max(1600, Math.round(w * 2));
  const cachedUrl = isPdf && sheet.pdfAssetId && sheet.pdfPage
    ? getCachedPdfPageUrl(sheet.pdfAssetId, sheet.pdfPage, targetW)
    : undefined;

  const source: PdfSourceAttr | null = useMemo(
    () =>
      isPdf && sheet.pdfAssetId && sheet.pdfPage
        ? { type: 'pdf', assetId: sheet.pdfAssetId, page: sheet.pdfPage, mode: 'live' }
        : null,
    [isPdf, sheet.pdfAssetId, sheet.pdfPage],
  );

  const { url: hookUrl, loading } = usePdfPageUrl(cachedUrl ? null : source, targetW, true);
  const url = cachedUrl ?? hookUrl;

  if (isPdf) {
    if (!url) {
      return (
        <div
          className="sheet-pdf-loading"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#ffffff',
          }}
        >
          <span>{loading ? 'Rendering PDF…' : ''}</span>
        </div>
      );
    }
    return (
      <img
        src={url}
        alt={`PDF Pagina ${sheet.pdfPage ?? ''}`}
        className="sheet-pdf-render-img"
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          pointerEvents: 'none',
        }}
        draggable={false}
      />
    );
  }

  // Blank sheet (foglio bianco o con pattern GoodNotes)
  return (
    <div
      className={`sheet-paper sheet-goodnotes-paper${includeBackground && bg?.pattern ? ` pattern-${bg.pattern}` : ''}`}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: '100%',
        height: '100%',
        backgroundColor: '#ffffff',
        pointerEvents: 'none',
      }}
    />
  );
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
        const isPdfPage = layout.isPdf;
        const curWmm = s.wMm ?? layout.sheetWmm;
        const curHmm = s.hMm ?? layout.sheetHmm;
        const curMarginMm = isPdfPage && o.paper === 'original' ? 0 : o.marginMm;

        return (
          <div
            key={`${page.id}-${idx}`}
            className={`sheet ${isPdfPage ? 'is-pdf-sheet' : ''} ${o.includeBackground ? `with-bg ${job.paperClass} ${page.content.background ? `pattern-${page.content.background.pattern}` : job.patternClass}` : ''}`}
            style={
              {
                width: `${curWmm}mm`,
                height: `${curHmm}mm`,
                padding: `${curMarginMm}mm`,
                '--sheet-w-mm': `${curWmm}mm`,
                '--sheet-h-mm': `${curHmm}mm`,
              } as React.CSSProperties
            }
          >
            {o.showTitle && !isPdfPage && (
              <div className="sheet-header" style={{ height: layout.headerH }}>
                <span>{page.title}</span>
                {idx > 0 && <span className="cont">(segue)</span>}
              </div>
            )}
            <div
              className="sheet-content"
              style={{
                width: s.w * layout.scale,
                height: s.h * layout.scale,
              }}
            >
              {s.sheetDef && (
                <PrintSheetBackground
                  sheet={s.sheetDef}
                  w={s.w}
                  h={s.h}
                  bg={page.content.background}
                  includeBackground={o.includeBackground}
                />
              )}
              <div
                className="world print-world"
                style={{
                  transform: `scale(${layout.scale}) translate(${-s.x}px, ${-s.y}px)`,
                }}
              >
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
  // Attendiamo che eventuali fogli PDF in caricamento abbiano completato il rendering
  let waitCount = 0;
  while (root.querySelector('.sheet-pdf-loading') && waitCount++ < 50) {
    await new Promise((r) => setTimeout(r, 100));
  }
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

    let pageSizeCss = '';
    const firstPage = job.pages[0];
    const layout = firstPage ? layoutForPage(firstPage.content, job.options) : null;
    const firstSlice = layout?.slices[0];

    if (job.options.paper === 'original' && firstSlice?.wMm && firstSlice?.hMm) {
      pageSizeCss = `${firstSlice.wMm}mm ${firstSlice.hMm}mm`;
    } else if (job.options.paper === 'original') {
      pageSizeCss = job.options.orientation === 'landscape' ? 'landscape' : 'portrait';
    } else {
      const p = PAPERS[job.options.paper] ?? PAPERS.a4;
      pageSizeCss = `${p.css} ${job.options.orientation}`;
    }

    style.textContent = `@page { size: ${pageSizeCss}; margin: 0; }`;
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
export async function preparePrint(job: PrintJob): Promise<void> {
  await preloadPrintPdfPages(job);
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
