import { useEffect, useRef, useState } from 'react';
import type { ID, PageContent } from '../types';
import { loadPage } from '../storage/db';
import { useStore } from '../store/useStore';
import { StaticPage } from '../canvas/render';
import { computeSheetLayouts } from '../lib/page';

const THUMB_W = 190;
const cache = new Map<string, PageContent>();

/** Lazy miniature of the first sheet of a page; loads content only when scrolled into view. */
export function PageThumb({ pageId, updatedAt }: { pageId: ID; updatedAt: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const live = useStore((s) => s.pages[pageId]);
  const key = `${pageId}:${updatedAt}`;
  const cached = cache.get(key);
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined');
  const [loaded, setLoaded] = useState<PageContent | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && setVisible(true), { rootMargin: '120px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || live || cached) return;
    let alive = true;
    void loadPage(pageId).then((p) => {
      if (!alive || !p) return;
      cache.set(key, p);
      setLoaded(p);
    });
    return () => {
      alive = false;
    };
  }, [visible, live, cached, key, pageId]);

  const page = live ?? cached ?? (loaded?.id === pageId ? loaded : null);
  const layout = page ? computeSheetLayouts(page)[0] : null;
  const scale = layout ? THUMB_W / layout.w : 1;
  const h = layout ? Math.min(layout.h * scale, 260) : 120;

  return (
    <div ref={ref} className="page-thumb" style={{ width: THUMB_W, height: h }}>
      {page && layout && (
        <div style={{ position: 'absolute', left: 0, top: 0, width: layout.w, height: layout.h, transformOrigin: '0 0', transform: `scale(${scale}) translate(${-layout.x}px, ${-layout.y}px)`, pointerEvents: 'none' }}>
          <StaticPage page={page} />
        </div>
      )}
    </div>
  );
}
