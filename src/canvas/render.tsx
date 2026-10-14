import { memo, type ReactNode } from 'react';
import type { CanvasItem, ConnectorItem, ID, ImageItem, PageContent, Point, ShapeItem, StrokeItem, TextItem } from '../types';
import { arrowHeadPath, connectorEndpoints, itemBounds, smoothPath } from '../lib/geometry';
import { useAssetUrl } from '../storage/assets';
import { StaticRichText } from '../editor/StaticRichText';

type MapFn = (x: number, y: number) => Point;
const identity: MapFn = (x, y) => ({ x, y });

export function strokeElement(item: StrokeItem, map: MapFn = identity, key?: string): ReactNode {
  const pts: number[] = [];
  for (let i = 0; i + 1 < item.points.length; i += 2) {
    const p = map(item.points[i], item.points[i + 1]);
    pts.push(p.x, p.y);
  }
  return (
    <path
      key={key}
      d={smoothPath(pts)}
      fill="none"
      stroke={item.color}
      strokeWidth={item.width}
      strokeOpacity={item.opacity}
      strokeLinecap={item.tool === 'highlighter' ? 'butt' : 'round'}
      strokeLinejoin="round"
      style={item.tool === 'highlighter' ? { mixBlendMode: 'multiply' } : undefined}
    />
  );
}

export function shapeElement(item: ShapeItem, map: MapFn = identity, key?: string): ReactNode {
  const a = map(item.x1, item.y1);
  const b = map(item.x2, item.y2);
  const common = {
    stroke: item.color,
    strokeWidth: item.width,
    strokeOpacity: item.opacity,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  if (item.kind === 'rect') {
    return (
      <rect key={key} x={Math.min(a.x, b.x)} y={Math.min(a.y, b.y)} width={Math.abs(b.x - a.x)} height={Math.abs(b.y - a.y)} rx={4} fill={item.fill ?? 'none'} fillOpacity={item.fill ? 0.35 : undefined} {...common} />
    );
  }
  if (item.kind === 'ellipse') {
    return (
      <ellipse key={key} cx={(a.x + b.x) / 2} cy={(a.y + b.y) / 2} rx={Math.abs(b.x - a.x) / 2} ry={Math.abs(b.y - a.y) / 2} fill={item.fill ?? 'none'} fillOpacity={item.fill ? 0.35 : undefined} {...common} />
    );
  }
  const head = Math.max(10, item.width * 4);
  return (
    <g key={key} fill="none" {...common}>
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
      {(item.kind === 'arrow' || item.kind === 'double-arrow') && <path d={arrowHeadPath(a, b, head)} />}
      {item.kind === 'double-arrow' && <path d={arrowHeadPath(b, a, head)} />}
    </g>
  );
}

export function connectorElement(c: ConnectorItem, from: Point, to: Point, key?: string): ReactNode {
  const head = Math.max(10, c.width * 4.5);
  return (
    <g key={key} fill="none" stroke={c.color} strokeWidth={c.width} strokeLinecap="round" strokeLinejoin="round">
      <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
      {(c.arrow === 'end' || c.arrow === 'both') && <path d={arrowHeadPath(from, to, head)} />}
      {c.arrow === 'both' && <path d={arrowHeadPath(to, from, head)} />}
    </g>
  );
}

export const TextView = memo(function TextView({ item, z, editingSlot }: { item: TextItem; z: number; editingSlot?: ReactNode }) {
  const sticky = item.variant === 'sticky';
  return (
    <div
      className={`item text-item${sticky ? ' sticky' : ''}${editingSlot ? ' editing' : ''}`}
      data-id={item.id}
      style={{ left: item.x, top: item.y, width: item.w, zIndex: z, background: sticky ? item.bg ?? '#fff4b8' : item.bg }}
    >
      {editingSlot ?? <StaticRichText doc={item.doc} />}
    </div>
  );
});

export const VectorView = memo(function VectorView({ item, z, items }: { item: StrokeItem | ShapeItem; z: number; items: Record<ID, CanvasItem> }) {
  const b = itemBounds(item, items);
  const map: MapFn = (x, y) => ({ x: x - b.x, y: y - b.y });
  return (
    <svg className="item vector-item" data-id={item.id} style={{ left: b.x, top: b.y, width: Math.max(1, b.w), height: Math.max(1, b.h), zIndex: z }} overflow="visible">
      {item.type === 'stroke' ? strokeElement(item, map) : shapeElement(item, map)}
    </svg>
  );
});

export const ConnectorView = memo(function ConnectorView({ item, z, fx, fy, tx, ty }: { item: ConnectorItem; z: number; fx: number; fy: number; tx: number; ty: number }) {
  const minX = Math.min(fx, tx) - 12;
  const minY = Math.min(fy, ty) - 12;
  return (
    <svg className="item vector-item" data-id={item.id} style={{ left: minX, top: minY, width: Math.abs(tx - fx) + 24, height: Math.abs(ty - fy) + 24, zIndex: z }} overflow="visible">
      {connectorElement(item, { x: fx - minX, y: fy - minY }, { x: tx - minX, y: ty - minY })}
    </svg>
  );
});

export const ImageView = memo(function ImageView({
  item,
  z,
  annotations,
  renderChildText,
}: {
  item: ImageItem;
  z: number;
  annotations: CanvasItem[];
  renderChildText: (t: TextItem) => ReactNode;
}) {
  const { url, missing } = useAssetUrl(item.assetId);
  const map: MapFn = (x, y) => ({ x: x * item.w, y: y * item.h });
  return (
    <div
      className={`item image-item${item.locked ? ' locked' : ''}`}
      data-id={item.id}
      style={{ left: item.x, top: item.y, width: item.w, height: item.h, zIndex: z, transform: item.rotation ? `rotate(${item.rotation}deg)` : undefined }}
    >
      {url ? (
        <img src={url} alt="" draggable={false} />
      ) : (
        <div className="image-missing">{missing ? 'Immagine non disponibile' : 'Caricamento…'}</div>
      )}
      {annotations.some((a) => a.type !== 'text') && (
        <svg className="annotations" width={item.w} height={item.h} viewBox={`0 0 ${item.w} ${item.h}`} overflow="visible">
          {annotations.map((a) => (a.type === 'stroke' ? strokeElement(a, map, a.id) : a.type === 'shape' ? shapeElement(a, map, a.id) : null))}
        </svg>
      )}
      {annotations.filter((a): a is TextItem => a.type === 'text').map((t) => renderChildText(t))}
    </div>
  );
});

export function childText(t: TextItem, slot?: ReactNode): ReactNode {
  const sticky = t.variant === 'sticky';
  return (
    <div
      key={t.id}
      className={`item text-item child-text${sticky ? ' sticky' : ''}${slot ? ' editing' : ''}`}
      data-id={t.id}
      style={{ left: `${t.x * 100}%`, top: `${t.y * 100}%`, width: t.w, background: sticky ? t.bg ?? '#fff4b8' : t.bg }}
    >
      {slot ?? <StaticRichText doc={t.doc} />}
    </div>
  );
}

export function childrenMap(page: PageContent): Map<ID, CanvasItem[]> {
  const m = new Map<ID, CanvasItem[]>();
  for (const id of page.order) {
    const it = page.items[id];
    if (it?.parentId) {
      const arr = m.get(it.parentId) ?? [];
      arr.push(it);
      m.set(it.parentId, arr);
    }
  }
  return m;
}

export const EMPTY_ARR: CanvasItem[] = [];
/** Top-level vectors do not need the item map; a stable object keeps memoisation effective. */
export const EMPTY_ITEMS: Record<ID, CanvasItem> = {};

/** z-index assignment: back connectors below everything, front connectors above. */
export function zFor(item: CanvasItem, index: number): number {
  if (item.type === 'connector') return item.layer === 'front' ? 100000 + index : index;
  return 1000 + index;
}

/** Static rendering of a whole page (print/export, previews). */
export function StaticPage({ page }: { page: PageContent }) {
  const children = childrenMap(page);
  return (
    <>
      {page.order.map((id, i) => {
        const it = page.items[id];
        if (!it || it.parentId) return null;
        const z = zFor(it, i);
        switch (it.type) {
          case 'text':
            return <TextView key={id} item={it} z={z} />;
          case 'image':
            return <ImageView key={id} item={it} z={z} annotations={children.get(id) ?? EMPTY_ARR} renderChildText={(t) => childText(t)} />;
          case 'stroke':
          case 'shape':
            return <VectorView key={id} item={it} z={z} items={EMPTY_ITEMS} />;
          case 'connector': {
            const ep = connectorEndpoints(it, page.items);
            if (!ep) return null;
            return <ConnectorView key={id} item={it} z={z} fx={ep.from.x} fy={ep.from.y} tx={ep.to.x} ty={ep.to.y} />;
          }
        }
      })}
    </>
  );
}
