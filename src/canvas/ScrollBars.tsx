import { useRef } from 'react';
import type { Viewport } from '../types';
import { PAGE_WIDTH, SHEET_TOP, TWO_A4_HEIGHT } from '../lib/page';
import { getViewport, setVp } from './viewport';

/**
 * Draggable scrollbars with smooth tracking, non-sticking incremental drag,
 * and zero corner-overlap glitching.
 */
export function ScrollBars({
  vp,
  width,
  height,
  left = 0,
  right = PAGE_WIDTH,
  bottom,
}: {
  vp: Viewport;
  width: number;
  height: number;
  left?: number;
  right?: number;
  bottom: number;
}) {
  const drag = useRef<{ axis: 'x' | 'y'; lastPos: number; scale: number } | null>(null);
  const vw = width / vp.zoom;
  const vh = height / vp.zoom;

  // Viewport bounds aligned strictly with clampViewport
  const minX = left - 8 / vp.zoom;
  const totalW = right - left;
  const maxX = totalW <= vw ? minX : Math.max(minX, right - vw + 24 / vp.zoom);
  const availTravelX = Math.max(0, maxX - minX);

  const minY = SHEET_TOP - 16 / vp.zoom;
  const pageBottom = Math.max(bottom, SHEET_TOP + TWO_A4_HEIGHT);
  const maxY = Math.max(minY, pageBottom - vh + 160 / vp.zoom);
  const availTravelY = Math.max(0, maxY - minY);

  // Tracks leave 28px corner space to prevent intersecting or glitching
  const trackW = Math.max(60, width - 28);
  const trackH = Math.max(60, height - 28);

  // Proportional thumb sizes with sensible min/max
  const ratioX = vw / (vw + availTravelX);
  const thumbW = Math.max(36, Math.min(trackW * 0.75, trackW * ratioX));
  const trackTravelX = Math.max(1, trackW - thumbW);
  const thumbLeft = availTravelX > 0 ? Math.max(0, Math.min(trackTravelX, ((vp.x - minX) / availTravelX) * trackTravelX)) : 0;
  const scaleX = trackTravelX > 0 ? availTravelX / trackTravelX : 1;

  const ratioY = vh / (vh + availTravelY);
  const thumbH = Math.max(36, Math.min(trackH * 0.75, trackH * ratioY));
  const trackTravelY = Math.max(1, trackH - thumbH);
  const thumbTop = availTravelY > 0 ? Math.max(0, Math.min(trackTravelY, ((vp.y - minY) / availTravelY) * trackTravelY)) : 0;
  const scaleY = trackTravelY > 0 ? availTravelY / trackTravelY : 1;

  const showX = availTravelX > 10;
  const showY = availTravelY > 10;

  const onDown = (axis: 'x' | 'y') => (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = {
      axis,
      lastPos: axis === 'x' ? e.clientX : e.clientY,
      scale: axis === 'x' ? scaleX : scaleY,
    };
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const curPos = d.axis === 'x' ? e.clientX : e.clientY;
    const delta = curPos - d.lastPos;
    if (delta === 0) return;
    d.lastPos = curPos;

    const curVp = getViewport();
    if (d.axis === 'x') {
      setVp({ ...curVp, x: curVp.x + delta * d.scale });
    } else {
      setVp({ ...curVp, y: curVp.y + delta * d.scale });
    }
  };

  const onUp = (e: React.PointerEvent) => {
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    drag.current = null;
  };

  const onTrackClick = (axis: 'x' | 'y') => (e: React.PointerEvent) => {
    if (e.target !== e.currentTarget) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const curVp = getViewport();
    if (axis === 'x') {
      if (availTravelX <= 0) return;
      const clickPos = e.clientX - rect.left;
      const targetRatio = Math.max(0, Math.min(1, (clickPos - thumbW / 2) / trackTravelX));
      setVp({ ...curVp, x: minX + targetRatio * availTravelX });
    } else {
      if (availTravelY <= 0) return;
      const clickPos = e.clientY - rect.top;
      const targetRatio = Math.max(0, Math.min(1, (clickPos - thumbH / 2) / trackTravelY));
      setVp({ ...curVp, y: minY + targetRatio * availTravelY });
    }
  };

  return (
    <>
      {showX && (
        <div className="scrollbar x" data-ui onPointerDown={onTrackClick('x')}>
          <div
            className="thumb"
            style={{ left: thumbLeft, width: thumbW }}
            onPointerDown={onDown('x')}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
          />
        </div>
      )}
      {showY && (
        <div className="scrollbar y" data-ui onPointerDown={onTrackClick('y')}>
          <div
            className="thumb"
            style={{ top: thumbTop, height: thumbH }}
            onPointerDown={onDown('y')}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
          />
        </div>
      )}
    </>
  );
}
