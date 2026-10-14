import { useRef } from 'react';
import type { Viewport } from '../types';
import { PAGE_WIDTH, SHEET_TOP } from '../lib/page';
import { setVp } from './viewport';

/**
 * Thin, draggable scrollbars showing where the view is on the two-A4 sheet,
 * so it is clear when the page continues beyond the window.
 */
export function ScrollBars({ vp, width, height, bottom }: { vp: Viewport; width: number; height: number; bottom: number }) {
  const drag = useRef<{ axis: 'x' | 'y'; start: number; origin: number; scale: number } | null>(null);
  const left = -72 / vp.zoom;
  const right = PAGE_WIDTH + 24 / vp.zoom;
  const top = SHEET_TOP - 24 / vp.zoom;
  const end = bottom + 24 / vp.zoom;
  const vw = width / vp.zoom;
  const vh = height / vp.zoom;
  const totalW = right - left;
  const totalH = end - top;
  const showX = totalW > vw + 1;
  const showY = totalH > vh + 1;
  const trackW = width - 16;
  const trackH = height - 16;

  const onDown = (axis: 'x' | 'y') => (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = axis === 'x' ? { axis, start: e.clientX, origin: vp.x, scale: totalW / trackW } : { axis, start: e.clientY, origin: vp.y, scale: totalH / trackH };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (d.axis === 'x') setVp({ ...vp, x: d.origin + (e.clientX - d.start) * d.scale });
    else setVp({ ...vp, y: d.origin + (e.clientY - d.start) * d.scale });
  };
  const onUp = () => (drag.current = null);

  return (
    <>
      {showX && (
        <div className="scrollbar x" data-ui>
          <div
            className="thumb"
            style={{ left: 8 + ((vp.x - left) / totalW) * trackW, width: Math.max(30, (vw / totalW) * trackW) }}
            onPointerDown={onDown('x')}
            onPointerMove={onMove}
            onPointerUp={onUp}
          />
        </div>
      )}
      {showY && (
        <div className="scrollbar y" data-ui>
          <div
            className="thumb"
            style={{ top: 8 + ((vp.y - top) / totalH) * trackH, height: Math.max(30, (vh / totalH) * trackH) }}
            onPointerDown={onDown('y')}
            onPointerMove={onMove}
            onPointerUp={onUp}
          />
        </div>
      )}
    </>
  );
}
