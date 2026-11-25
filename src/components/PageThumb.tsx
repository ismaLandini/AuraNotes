import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { ID, PageContent, PdfSourceAttr } from '../types';
import { useSettings } from '../store/settings';
import { StaticPage } from '../canvas/render';
import { itemBounds } from '../lib/geometry';
import { isPdfDocument, PAGE_MARGIN, TITLE_Y, type SheetLayout } from '../lib/page';
import { usePdfPageUrl } from '../pdf/pageCache';

const THUMB_W = 176;

function sheetContentWidth(page: PageContent, layout: SheetLayout): number {
  if (isPdfDocument(page)) return Math.max(1, layout.w);
  let right = layout.x + layout.w;
  const sheetBottomY = layout.y + layout.h;
  for (const id of page.order) {
    const it = page.items[id];
    if (!it || it.parentId) continue;
    const r = itemBounds(it, page.items);
    if (r.y + r.h >= layout.y && r.y <= sheetBottomY) {
      right = Math.max(right, r.x + r.w + PAGE_MARGIN);
    }
  }
  return Math.max(1, right - layout.x);
}

function paperSurfaceColor(paper: string, isPdfSheet: boolean): string {
  if (isPdfSheet || paper === 'white') return '#ffffff';
  if (paper === 'warm') return '#fbf8f1';
  if (paper === 'cool') return '#f4f6f9';
  return '#1e2026';
}

function paperThumbVars(isDarkPaper: boolean, width: number, height: number, backgroundColor: string): CSSProperties {
  return {
    width,
    height,
    backgroundColor,
    '--pattern': isDarkPaper ? 'rgba(200, 210, 235, 0.16)' : 'rgba(67, 81, 85, 0.22)',
    '--pattern-line': isDarkPaper ? 'rgba(160, 190, 255, 0.12)' : 'rgba(67, 81, 85, 0.14)',
  } as CSSProperties;
}

function SheetThumbPdf({ assetId, pdfPage, enabled }: { assetId: ID; pdfPage: number; enabled: boolean }) {
  const source: PdfSourceAttr = useMemo(
    () => ({ type: 'pdf', assetId, page: pdfPage, mode: 'live' }),
    [assetId, pdfPage],
  );
  const { url } = usePdfPageUrl(source, THUMB_W, enabled);
  if (!url) return null;
  return (
    <img
      src={url}
      alt=""
      draggable={false}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        objectFit: 'fill',
        pointerEvents: 'none',
      }}
    />
  );
}

/** Mac Preview-style miniature of a single sheet within the open PageContent. */
export function SheetThumb({
  page,
  layout,
  pageTitle,
}: {
  page: PageContent;
  layout: SheetLayout;
  pageTitle?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const defaultPattern = useSettings((s) => s.background);
  const defaultPaper = useSettings((s) => s.paper);
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined');

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && setVisible(true), { rootMargin: '160px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const isPdfSheet = layout.sheet.type === 'pdf';
  const isPdfDoc = isPdfDocument(page);
  const pattern = page.background?.pattern ?? defaultPattern;
  const paper = page.background?.paper ?? defaultPaper;
  const isDarkPaper = !isPdfSheet && paper === 'dark';
  const effectiveW = useMemo(() => sheetContentWidth(page, layout), [page, layout]);
  const scale = Math.min(THUMB_W / effectiveW, 280 / Math.max(1, layout.h));
  const w = Math.max(48, Math.round(effectiveW * scale));
  const h = Math.max(60, Math.round(layout.h * scale));
  const paperBg = paperSurfaceColor(paper, isPdfSheet);

  return (
    <div
      ref={ref}
      className={`page-thumb sheet-paper${!isPdfSheet ? ` pattern-${pattern}` : ''}`}
      style={paperThumbVars(isDarkPaper, w, h, paperBg)}
    >
      {isPdfSheet && layout.sheet.pdfAssetId && layout.sheet.pdfPage && (
        <SheetThumbPdf assetId={layout.sheet.pdfAssetId} pdfPage={layout.sheet.pdfPage} enabled={visible} />
      )}
      {visible && (
        <div
          className={isDarkPaper ? 'canvas paper-dark' : 'canvas'}
          style={{
            position: 'absolute',
            inset: 'auto',
            left: 0,
            top: 0,
            width: effectiveW,
            height: layout.h,
            overflow: 'visible',
            transformOrigin: '0 0',
            transform: `scale(${scale}) translate(${-layout.x}px, ${-layout.y}px)`,
            pointerEvents: 'none',
            background: 'transparent',
          }}
        >
          {!isPdfDoc && layout.index === 0 && pageTitle && (
            <div
              style={{
                position: 'absolute',
                left: layout.x + PAGE_MARGIN,
                top: TITLE_Y,
                width: Math.max(120, effectiveW - PAGE_MARGIN * 2),
                font: '600 22px/1.3 var(--font-ui)',
                color: isDarkPaper ? '#ececf1' : '#1d1d1f',
                borderBottom: '1px solid rgba(120, 135, 160, 0.35)',
                paddingBottom: 4,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {pageTitle}
            </div>
          )}
          <StaticPage page={page} />
        </div>
      )}
    </div>
  );
}
