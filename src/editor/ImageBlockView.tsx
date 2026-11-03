import { memo, useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { useAssetUrl } from '../storage/assets';
import { usePdfPageUrl } from '../pdf/pageCache';
import { shapeElement, strokeElement } from '../canvas/render';
import type { ShapeItem, StrokeItem } from '../types';

export const ImageBlockView = memo(function ImageBlockView({
  node,
  updateAttributes,
  selected,
  editor,
  getPos,
}: NodeViewProps) {
  const { id, assetId, width, naturalWidth, naturalHeight, rotation, indent, alt, annotations, source } = node.attrs;
  const containerRef = useRef<HTMLDivElement>(null);
  const [resizing, setResizing] = useState(false);
  const [nearViewport, setNearViewport] = useState(true);

  const displayWidth = width || Math.min(naturalWidth || 400, 600);
  const aspectRatio = naturalWidth && naturalHeight ? naturalWidth / naturalHeight : 1.333;
  const displayHeight = Math.round(displayWidth / aspectRatio);

  const isLivePdf = Boolean(!assetId && source && source.type === 'pdf' && source.assetId && source.page >= 1);
  const rasterAsset = useAssetUrl(isLivePdf ? '' : assetId || '');
  const pdfPage = usePdfPageUrl(isLivePdf ? source : null, displayWidth, nearViewport && isLivePdf);
  const url = isLivePdf ? pdfPage.url : rasterAsset.url;
  const missing = isLivePdf ? Boolean(pdfPage.error) : rasterAsset.missing;

  // Lazy-unload decoded bitmaps for pages far outside the viewport (>1600px away) in large documents,
  // while preserving exact container dimensions so layout never shifts.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    if (el.closest('#print-root')) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          setNearViewport(entry.isIntersecting);
        }
      },
      { rootMargin: '1600px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const onHandleMouseDown = useCallback(
    (corner: 'nw' | 'ne' | 'sw' | 'se', e: ReactMouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setResizing(true);

      const startX = e.clientX;
      const startWidth = displayWidth;
      const isRight = corner === 'ne' || corner === 'se';

      const onMouseMove = (moveEvent: MouseEvent) => {
        const dx = moveEvent.clientX - startX;
        const delta = isRight ? dx : -dx;
        const newWidth = Math.max(80, Math.min(1850, Math.round(startWidth + delta)));
        updateAttributes({ width: newWidth });
      };

      const onMouseUp = () => {
        setResizing(false);
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    },
    [displayWidth, updateAttributes],
  );

  const onClick = useCallback(
    (e: ReactMouseEvent) => {
      if (typeof getPos === 'function') {
        e.stopPropagation();
        editor.commands.setNodeSelection(getPos());
      }
    },
    [editor, getPos],
  );

  const mapPoint = useCallback(
    (nx: number, ny: number) => ({
      x: nx * displayWidth,
      y: ny * displayHeight,
    }),
    [displayWidth, displayHeight],
  );

  const onDragStart = useCallback(
    (e: React.DragEvent) => {
      if (resizing) {
        e.preventDefault();
        return;
      }
      const containerId = (editor.storage as Record<string, unknown>)?.containerId;
      const payload = {
        containerId,
        attrs: node.attrs,
        fromPos: typeof getPos === 'function' ? getPos() : null,
      };
      e.dataTransfer.setData('application/x-glassnote-image-block', JSON.stringify(payload));
      e.dataTransfer.effectAllowed = 'move';
    },
    [editor, getPos, node.attrs, resizing],
  );

  const indentPx = (indent || 0) * 24;

  return (
    <NodeViewWrapper
      as="div"
      className={`image-block-wrapper${selected ? ' is-selected' : ''}${resizing ? ' is-resizing' : ''}`}
      style={{
        marginLeft: indentPx ? `${indentPx}px` : undefined,
        textAlign: (node.attrs.textAlign as string) || undefined,
      }}
    >
      <div
        ref={containerRef}
        className="image-block-container"
        data-image-block-id={id || undefined}
        data-asset-id={assetId || undefined}
        data-source={source ? JSON.stringify(source) : undefined}
        draggable={!resizing}
        onDragStart={onDragStart}
        style={{
          width: `${displayWidth}px`,
          minHeight: `${displayHeight}px`,
          transform: rotation ? `rotate(${rotation}deg)` : undefined,
        }}
        onClick={onClick}
      >
        {/* Base Image (native Blob resolution, async decoding, lazy offscreen memory release) */}
        {url && nearViewport ? (
          <img
            src={url}
            alt={alt || ''}
            width={naturalWidth || displayWidth}
            height={naturalHeight || displayHeight}
            decoding="async"
            loading="lazy"
            className="image-block-img"
            draggable={false}
            onLoad={(e) => {
              void e.currentTarget.decode?.().catch(() => {});
            }}
            style={{ width: '100%', height: 'auto', display: 'block' }}
          />
        ) : (
          <div className="image-missing" style={{ width: `${displayWidth}px`, height: `${displayHeight}px` }}>
            {missing ? 'Immagine non disponibile' : 'Caricamento…'}
          </div>
        )}

        {/* SVG Drawing Annotations Overlay */}
        {annotations && annotations.length > 0 && (
          <svg
            className="image-block-annotations"
            width={displayWidth}
            height={displayHeight}
            viewBox={`0 0 ${displayWidth} ${displayHeight}`}
            style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 5 }}
          >
            {annotations.map((a: StrokeItem | ShapeItem) =>
              a.type === 'stroke'
                ? strokeElement(a, mapPoint, a.id)
                : a.type === 'shape'
                  ? shapeElement(a, mapPoint, a.id)
                  : null,
            )}
          </svg>
        )}

        {/* Resize Handles */}
        {(selected || resizing) && (
          <div className="image-block-handles">
            <div className="image-handle handle-nw" onMouseDown={(e) => onHandleMouseDown('nw', e)} />
            <div className="image-handle handle-ne" onMouseDown={(e) => onHandleMouseDown('ne', e)} />
            <div className="image-handle handle-sw" onMouseDown={(e) => onHandleMouseDown('sw', e)} />
            <div className="image-handle handle-se" onMouseDown={(e) => onHandleMouseDown('se', e)} />
          </div>
        )}
      </div>
    </NodeViewWrapper>
  );
});
