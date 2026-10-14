import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { JSONContent } from '@tiptap/core';
import type { Anchor, CanvasItem, ConnectorItem, ID, ImageItem, PageContent, Point, Rect, ShapeItem, ShapeKind, StrokeItem, TextItem, Tool } from '../types';
import { useStore } from '../store/useStore';
import { useSettings } from '../store/settings';
import * as P from '../model/pageOps';
import { newId } from '../model/workspaceOps';
import {
  connectorEndpoints,
  constrainAngle,
  constrainSquare,
  fromImageLocal,
  hitTest,
  itemBounds,
  fixedAnchorPoint,
  perimeterAnchorAt,
  rectBoundaryPoint,
  rectFromPoints,
  rectsIntersect,
  rotatePoint,
  simplify,
  smoothPath,
  toImageLocal,
  unionRects,
} from '../lib/geometry';
import { ConnectorView, EMPTY_ARR, EMPTY_ITEMS, ImageView, TextView, VectorView, childText, childrenMap, connectorElement, shapeElement, zFor } from './render';
import { EditableRichText } from '../editor/EditableRichText';
import { requestCaretAt } from '../editor/activeEditor';
import { clampViewport, clampZoom, defaultViewport, getViewport, registerContainer, screenToWorld, setLastPointerWorld, setVp as setViewportClamped } from './viewport';
import { createTextBlock, editSession, finishEditing, handleCopy, handlePaste, insertImageFiles } from './actions';
import { isEditableTarget } from '../shortcuts/registry';
import { isModalOpen } from '../store/ui';
import { A4_WIDTH, BODY_START, PAGE_WIDTH, SHEET_TOP, sheetBottom } from '../lib/page';
import { SheetTitle } from './SheetTitle';
import { ScrollBars } from './ScrollBars';

type Handle = 'nw' | 'ne' | 'sw' | 'se' | 'w' | 'e' | 'p1' | 'p2' | 'grip' | 'c1' | 'c2';

type Gesture =
  | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number }
  | {
      kind: 'move';
      before: PageContent;
      origin: Point;
      ids: ID[];
      moved: boolean;
      clickedId: ID | null;
      wasSelected: boolean;
      shift: boolean;
      clientX: number;
      clientY: number;
    }
  | { kind: 'marquee'; origin: Point; current: Point; base: ID[] }
  | { kind: 'draw'; tool: 'pen' | 'highlighter'; points: number[]; pressures: number[]; parentId: ID | null }
  | { kind: 'shape'; shape: ShapeKind; start: Point; end: Point; parentId: ID | null; startItem: ID | null }
  | { kind: 'connector'; fromId: ID; fromAnchor: Anchor; end: Point; overId: ID | null }
  | { kind: 'reconnect'; before: PageContent; id: ID; end: 'from' | 'to'; point: Point; overId: ID | null }
  | { kind: 'erase'; before: PageContent; erased: Set<ID>; last: Point }
  | { kind: 'resize'; before: PageContent; id: ID; handle: Handle; orig: CanvasItem; alt: boolean };

interface Preview {
  marquee?: Rect;
  stroke?: { d: string; color: string; width: number; opacity: number; highlighter: boolean };
  shape?: ShapeItem;
  connector?: { from: Point; to: Point; anchor?: { x: number; y: number } };
  guides?: Array<{ x1: number; y1: number; x2: number; y2: number }>;
  eraser?: Point;
}

const DRAG_THRESHOLD = 3;
const GRID = 20;
const DRAW_TOOLS: Tool[] = ['pen', 'highlighter', 'eraser', 'line', 'arrow', 'double-arrow', 'rect', 'ellipse', 'connector'];

function worldDeltaToLocal(parent: ImageItem, dx: number, dy: number): Point {
  const r = rotatePoint({ x: dx, y: dy }, { x: 0, y: 0 }, -parent.rotation);
  return { x: r.x / parent.w, y: r.y / parent.h };
}

/** Topmost item under a world point (annotations of an image take precedence over the image). */
function hitAt(page: PageContent, p: Point, tol: number, opts: { topLevelOnly?: boolean; types?: CanvasItem['type'][] } = {}): CanvasItem | null {
  const children = childrenMap(page);
  const ordered = page.order
    .map((id, i) => ({ it: page.items[id], i }))
    .filter((x) => x.it && !x.it.parentId)
    .sort((a, b) => zFor(b.it, b.i) - zFor(a.it, a.i));
  for (const { it } of ordered) {
    if (!opts.topLevelOnly && it.type === 'image') {
      const kids = children.get(it.id) ?? [];
      for (let k = kids.length - 1; k >= 0; k--) {
        if ((!opts.types || opts.types.includes(kids[k].type)) && hitTest(kids[k], page.items, p, tol)) return kids[k];
      }
    }
    if (opts.types && !opts.types.includes(it.type)) continue;
    if (hitTest(it, page.items, p, tol)) return it;
  }
  return null;
}

/**
 * The object a connector end should attach to: the topmost object under the pointer, or
 * else the object whose perimeter is closest (within `tol`), so nearby/overlapping
 * objects are resolved predictably.
 */
function connectTargetAt(page: PageContent, p: Point, tol: number, exclude: ID | null): CanvasItem | null {
  const direct = hitAt(page, p, tol, { topLevelOnly: true });
  if (direct && direct.type !== 'connector' && direct.id !== exclude) return direct;
  let best: CanvasItem | null = null;
  let bestD = Infinity;
  for (const id of page.order) {
    const it = page.items[id];
    if (!it || it.parentId || it.type === 'connector' || it.id === exclude) continue;
    const a = perimeterAnchorAt(it, page.items, p, tol);
    if (!a) continue;
    const q = fixedAnchorPoint(it, page.items, a);
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < bestD) {
      bestD = d;
      best = it;
    }
  }
  return best;
}

/** Where a connector end sits on `it` for the given anchor, aiming at `towards` when automatic. */
function previewEnd(page: PageContent, it: CanvasItem, anchor: Anchor, towards: Point): Point {
  if (typeof anchor === 'object') return fixedAnchorPoint(it, page.items, anchor);
  const r = itemBounds(it, page.items);
  if (anchor === 'auto') return rectBoundaryPoint(r, towards);
  return anchor === 'top' ? { x: r.x + r.w / 2, y: r.y } : anchor === 'bottom' ? { x: r.x + r.w / 2, y: r.y + r.h } : anchor === 'left' ? { x: r.x, y: r.y + r.h / 2 } : { x: r.x + r.w, y: r.y + r.h / 2 };
}

/** Fixed perimeter anchor when the pointer is near the outline, automatic otherwise. */
function anchorFor(page: PageContent, it: CanvasItem, p: Point, tol: number): Anchor {
  return perimeterAnchorAt(it, page.items, p, tol) ?? 'auto';
}

/** Selecting one member of a group selects the whole group. */
export function groupOf(page: PageContent, it: CanvasItem): ID[] {
  if (!it.groupId || it.parentId) return [it.id];
  return page.order.filter((id) => page.items[id]?.groupId === it.groupId && !page.items[id].parentId);
}

function topImageAt(page: PageContent, p: Point): ImageItem | null {
  const hit = hitAt(page, p, 0, { topLevelOnly: true, types: ['image', 'text', 'shape', 'stroke'] });
  return hit && hit.type === 'image' ? hit : null;
}

export function Canvas() {
  const pageId = useStore((s) => s.pageId);
  const page = useStore((s) => (s.pageId ? s.pages[s.pageId] : undefined));
  const selection = useStore((s) => s.selection);
  const editingId = useStore((s) => s.editingId);
  const tool = useStore((s) => s.tool);
  const vpStored = useStore((s) => (s.pageId ? s.viewports[s.pageId] : undefined));
  const settings = useSettings();
  // Re-render on container resizes so the sheet clamp/centring follows the window.
  const [, setResizeTick] = useState(0);
  const vp = clampViewport(vpStored ?? defaultViewport());

  const containerRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [preview, setPreview] = useState<Preview>({});
  const [spaceDown, setSpaceDown] = useState(false);
  const [hoverCursor, setHoverCursor] = useState<string>('default');
  const editBefore = useRef<{ id: ID; before: PageContent } | null>(null);

  useLayoutEffect(() => {
    registerContainer(containerRef.current);
    const el = containerRef.current;
    const ro = el ? new ResizeObserver(() => setResizeTick((t) => t + 1)) : null;
    if (el) ro!.observe(el);
    return () => {
      ro?.disconnect();
      registerContainer(null);
    };
  }, [pageId]);

  const setVp = useCallback((v: { x: number; y: number; zoom: number }) => setViewportClamped(v), []);
  const getVp = () => getViewport();

  const toWorld = (clientX: number, clientY: number): Point => {
    const r = containerRef.current!.getBoundingClientRect();
    return screenToWorld(clientX - r.left, clientY - r.top, getVp());
  };

  // ---------------------------------------------------------------- edit session history
  useEffect(() => {
    const s = useStore.getState();
    if (editingId && s.pageId) {
      // A block created for this session is absent from the snapshot, so its creation is undoable as one step.
      editBefore.current = { id: editingId, before: editSession.pendingBefore ?? s.pages[s.pageId] };
      editSession.pendingBefore = null;
    }
    return () => {
      const eb = editBefore.current;
      if (!eb || eb.id !== editingId) return;
      editBefore.current = null;
      const st = useStore.getState();
      const cur = st.pages[eb.before.id];
      if (!cur) return;
      const a = eb.before.items[eb.id];
      const b = cur.items[eb.id];
      const changed = !a ? !!b : !b || JSON.stringify((a as TextItem).doc) !== JSON.stringify((b as TextItem).doc);
      if (changed && st.pageId === eb.before.id) st.commitFrom(eb.before);
    };
  }, [editingId]);

  const startCreateText = (at: Point, variant: 'plain' | 'sticky', parent: ImageItem | null) => {
    const s = useStore.getState();
    const cur = s.currentPage();
    if (!cur) return;
    editSession.pendingBefore = cur;
    if (parent) {
      const local = toImageLocal(parent, at.x, at.y);
      const item: TextItem = {
        id: newId(),
        type: 'text',
        x: local.x,
        y: local.y,
        w: 200,
        h: 32,
        doc: P.EMPTY_DOC,
        variant,
        parentId: parent.id,
        ...(variant === 'sticky' ? { bg: '#fff4b8' } : {}),
      };
      s.updatePage((p) => P.addItems(p, [item]), false);
      s.setSelection([item.id]);
      s.setEditing(item.id);
    } else {
      createTextBlock({ x: at.x, y: at.y - 12 }, { variant });
    }
  };

  const enterEdit = (id: ID, clientX: number | null, clientY: number | null) => {
    requestCaretAt(clientX, clientY);
    useStore.getState().setSelection([id]);
    useStore.getState().setEditing(id);
  };

  const exitEdit = () => {
    const id = useStore.getState().editingId;
    if (id) finishEditing(id);
  };

  // ---------------------------------------------------------------- wheel / pinch
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      // Let scrollable widgets inside editing blocks (e.g. tables) scroll normally.
      const v = getVp();
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.01));
        const nz = clampZoom(v.zoom * factor);
        const sx = e.clientX - r.left;
        const sy = e.clientY - r.top;
        const w = screenToWorld(sx, sy, v);
        setVp({ zoom: nz, x: w.x - sx / nz, y: w.y - sy / nz });
      } else {
        const mult = e.deltaMode === 1 ? 16 : 1;
        let dx = e.deltaX * mult;
        let dy = e.deltaY * mult;
        if (e.shiftKey && dx === 0) {
          dx = dy;
          dy = 0;
        }
        setVp({ ...v, x: v.x + dx / v.zoom, y: v.y + dy / v.zoom });
      }
    };
    // Safari pinch gestures
    let gestureStartZoom = 1;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      gestureStartZoom = getVp().zoom;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const ge = e as Event & { scale: number; clientX: number; clientY: number };
      const v = getVp();
      const r = el.getBoundingClientRect();
      const nz = clampZoom(gestureStartZoom * ge.scale);
      const sx = (ge.clientX ?? r.width / 2 + r.left) - r.left;
      const sy = (ge.clientY ?? r.height / 2 + r.top) - r.top;
      const w = screenToWorld(sx, sy, v);
      setVp({ zoom: nz, x: w.x - sx / nz, y: w.y - sy / nz });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('gesturestart', onGestureStart as EventListener);
    el.addEventListener('gesturechange', onGestureChange as EventListener);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', onGestureStart as EventListener);
      el.removeEventListener('gesturechange', onGestureChange as EventListener);
    };
  }, [setVp]);

  // ---------------------------------------------------------------- space-to-pan, clipboard
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isEditableTarget(e.target) && !isModalOpen()) {
        if (!e.repeat) setSpaceDown(true);
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceDown(false);
    };
    const blur = () => setSpaceDown(false);
    const textSelected = () => {
      const sel = window.getSelection();
      return !!sel && !sel.isCollapsed && sel.toString().length > 0;
    };
    const onCopy = (e: ClipboardEvent) => {
      if (isEditableTarget(e.target) || isModalOpen() || textSelected()) return;
      handleCopy(e, false);
    };
    const onCut = (e: ClipboardEvent) => {
      if (isEditableTarget(e.target) || isModalOpen() || textSelected()) return;
      handleCopy(e, true);
    };
    const onPaste = (e: ClipboardEvent) => {
      if (isEditableTarget(e.target) || isModalOpen()) return;
      void handlePaste(e);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    document.addEventListener('copy', onCopy);
    document.addEventListener('cut', onCut);
    document.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('cut', onCut);
      document.removeEventListener('paste', onPaste);
    };
  }, []);

  // ---------------------------------------------------------------- snapping
  const computeSnap = (cur: PageContent, ids: ID[], dx: number, dy: number, before: PageContent): { dx: number; dy: number; guides: Preview['guides'] } => {
    const tops = ids.filter((id) => !before.items[id]?.parentId);
    if (!tops.length) return { dx, dy, guides: [] };
    const rects = tops.map((id) => itemBounds(before.items[id], before.items));
    const b = unionRects(rects)!;
    let nx = b.x + dx;
    let ny = b.y + dy;
    const guides: NonNullable<Preview['guides']> = [];
    const zoom = getVp().zoom;
    if (settings.alignmentGuides) {
      const th = 6 / zoom;
      const sel = new Set(P.withChildren(before, ids));
      const others = cur.order.filter((id) => !sel.has(id) && cur.items[id] && !cur.items[id].parentId && cur.items[id].type !== 'connector').map((id) => itemBounds(cur.items[id], cur.items));
      const xs = [nx, nx + b.w / 2, nx + b.w];
      const ys = [ny, ny + b.h / 2, ny + b.h];
      let bestX: { d: number; adj: number; line: number } | null = null;
      let bestY: { d: number; adj: number; line: number } | null = null;
      for (const o of others) {
        for (const ox of [o.x, o.x + o.w / 2, o.x + o.w]) {
          xs.forEach((x) => {
            const d = Math.abs(x - ox);
            if (d < th && (!bestX || d < bestX.d)) bestX = { d, adj: ox - x, line: ox };
          });
        }
        for (const oy of [o.y, o.y + o.h / 2, o.y + o.h]) {
          ys.forEach((y) => {
            const d = Math.abs(y - oy);
            if (d < th && (!bestY || d < bestY.d)) bestY = { d, adj: oy - y, line: oy };
          });
        }
      }
      const bx = bestX as { d: number; adj: number; line: number } | null;
      const by = bestY as { d: number; adj: number; line: number } | null;
      if (bx) {
        nx += bx.adj;
        guides.push({ x1: bx.line, y1: ny - 4000, x2: bx.line, y2: ny + 4000 });
      }
      if (by) {
        ny += by.adj;
        guides.push({ x1: nx - 4000, y1: by.line, x2: nx + 4000, y2: by.line });
      }
      if (bx || by) return { dx: nx - b.x, dy: ny - b.y, guides };
    }
    if (settings.snapToGrid) {
      nx = Math.round(nx / GRID) * GRID;
      ny = Math.round(ny / GRID) * GRID;
    }
    return { dx: nx - b.x, dy: ny - b.y, guides };
  };

  // ---------------------------------------------------------------- pointer handling
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button === 2) return;
    const target = e.target as HTMLElement;
    if (target.closest('[data-ui]')) return;
    const st = useStore.getState();
    const cur = st.currentPage();
    if (!cur) return;
    const inEditing = target.closest('.text-item.editing');
    if (inEditing && !target.dataset.handle) return; // typing / selecting text inside the editor

    const world = toWorld(e.clientX, e.clientY);
    const v = getVp();
    const tol = 6 / v.zoom;
    const el = containerRef.current!;

    if (e.button === 1 || spaceDown || tool === 'hand') {
      gesture.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: v.x, vy: v.y };
      el.setPointerCapture(e.pointerId);
      return;
    }

    // Leaving an active text block.
    if (st.editingId && !(target.dataset.handle === 'grip')) exitEdit();
    if (document.activeElement instanceof HTMLElement && document.activeElement !== el) document.activeElement.blur();
    el.focus({ preventScroll: true });

    const handle = target.dataset.handle as Handle | undefined;
    if (handle && st.selection.length === 1) {
      const id = st.selection[0];
      const it = cur.items[id];
      if (handle === 'grip') e.preventDefault(); // keep the editor focused while dragging the block
      if (it && it.type === 'connector' && (handle === 'c1' || handle === 'c2')) {
        gesture.current = { kind: 'reconnect', before: cur, id, end: handle === 'c1' ? 'from' : 'to', point: world, overId: null };
      } else if (it && handle === 'grip') {
        gesture.current = { kind: 'move', before: cur, origin: world, ids: [id], moved: false, clickedId: null, wasSelected: true, shift: false, clientX: e.clientX, clientY: e.clientY };
      } else if (it && !it.locked) {
        gesture.current = { kind: 'resize', before: cur, id, handle, orig: it, alt: e.altKey };
      }
      el.setPointerCapture(e.pointerId);
      return;
    }

    switch (tool) {
      case 'select': {
        const hit = hitAt(cur, world, tol);
        if (hit) {
          const members = groupOf(cur, hit);
          const wasSelected = st.selection.includes(hit.id);
          let sel = st.selection;
          if (e.shiftKey || e.metaKey) sel = wasSelected ? sel.filter((s) => !members.includes(s)) : [...new Set([...sel, ...members])];
          else if (!wasSelected) sel = members;
          st.setSelection(sel);
          const movable = sel.filter((id) => cur.items[id] && !cur.items[id].locked && cur.items[id].type !== 'connector');
          gesture.current = { kind: 'move', before: cur, origin: world, ids: movable, moved: false, clickedId: hit.id, wasSelected, shift: e.shiftKey, clientX: e.clientX, clientY: e.clientY };
        } else {
          const base = e.shiftKey ? st.selection : [];
          if (!e.shiftKey) st.setSelection([]);
          gesture.current = { kind: 'marquee', origin: world, current: world, base };
        }
        break;
      }
      case 'text':
      case 'sticky': {
        const hit = hitAt(cur, world, 0, { types: ['text'] });
        if (hit && hit.type === 'text') enterEdit(hit.id, e.clientX, e.clientY);
        else startCreateText(world, tool === 'sticky' ? 'sticky' : 'plain', topImageAt(cur, world));
        return;
      }
      case 'pen':
      case 'highlighter': {
        const parent = topImageAt(cur, world);
        gesture.current = { kind: 'draw', tool, points: [world.x, world.y], pressures: [e.pressure || 0.5], parentId: parent?.id ?? null };
        updateDrawPreview();
        break;
      }
      case 'eraser': {
        gesture.current = { kind: 'erase', before: cur, erased: new Set(), last: world };
        eraseAt(world);
        break;
      }
      case 'line':
      case 'arrow':
      case 'double-arrow':
      case 'rect':
      case 'ellipse': {
        const parent = topImageAt(cur, world);
        const startHit = tool === 'arrow' || tool === 'line' ? hitAt(cur, world, tol, { topLevelOnly: true }) : null;
        gesture.current = {
          kind: 'shape',
          shape: tool,
          start: world,
          end: world,
          parentId: parent?.id ?? null,
          startItem: startHit && startHit.type !== 'connector' && startHit.type !== 'image' ? startHit.id : null,
        };
        break;
      }
      case 'connector': {
        const hit = connectTargetAt(cur, world, 12 / v.zoom, null);
        if (hit) gesture.current = { kind: 'connector', fromId: hit.id, fromAnchor: anchorFor(cur, hit, world, 12 / v.zoom), end: world, overId: null };
        break;
      }
      default:
        break;
    }
    el.setPointerCapture(e.pointerId);
  };

  const updateDrawPreview = () => {
    const g = gesture.current;
    if (!g || g.kind !== 'draw') return;
    const s = useSettings.getState();
    const hl = g.tool === 'highlighter';
    setPreview({ stroke: { d: smoothPath(g.points), color: hl ? s.highlighterColor : s.penColor, width: hl ? s.highlighterWidth : s.penWidth, opacity: hl ? 0.38 : 1, highlighter: hl } });
  };

  const eraseAt = (p: Point) => {
    const g = gesture.current;
    if (!g || g.kind !== 'erase') return;
    const st = useStore.getState();
    const cur = st.currentPage();
    if (!cur) return;
    const tol = 8 / getVp().zoom;
    const hits: ID[] = [];
    for (const id of cur.order) {
      const it = cur.items[id];
      if (!it || (it.type !== 'stroke' && it.type !== 'shape') || g.erased.has(id)) continue;
      if (hitTest(it, cur.items, p, tol)) hits.push(id);
    }
    if (hits.length) {
      hits.forEach((h) => g.erased.add(h));
      st.updatePage((pg) => P.deleteItems(pg, hits), false);
    }
    setPreview({ eraser: p });
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const world = toWorld(e.clientX, e.clientY);
    setLastPointerWorld(world);
    const g = gesture.current;
    const st = useStore.getState();
    const cur = st.currentPage();
    if (!g) {
      if (tool === 'eraser') setPreview({ eraser: world });
      if (tool === 'select' && cur && !spaceDown) {
        const target = e.target as HTMLElement;
        if (target.dataset.handle) return;
        const hit = hitAt(cur, world, 6 / getVp().zoom);
        const c = !hit ? 'default' : hit.locked ? 'not-allowed' : hit.type === 'text' && st.selection.includes(hit.id) && st.selection.length === 1 ? 'text' : 'move';
        if (c !== hoverCursor) setHoverCursor(c);
      }
      return;
    }
    if (!cur) return;
    switch (g.kind) {
      case 'pan':
        setVp({ ...getVp(), x: g.vx - (e.clientX - g.sx) / getVp().zoom, y: g.vy - (e.clientY - g.sy) / getVp().zoom });
        break;
      case 'move': {
        if (!g.moved && Math.hypot(e.clientX - g.clientX, e.clientY - g.clientY) < DRAG_THRESHOLD) return;
        g.moved = true;
        let dx = world.x - g.origin.x;
        let dy = world.y - g.origin.y;
        const snap = computeSnap(cur, g.ids, dx, dy, g.before);
        dx = snap.dx;
        dy = snap.dy;
        const patches: Record<ID, Partial<CanvasItem>> = {};
        const idSet = new Set(g.ids);
        for (const id of g.ids) {
          const orig = g.before.items[id];
          if (!orig) continue;
          if (orig.parentId) {
            if (idSet.has(orig.parentId)) continue;
            const parent = g.before.items[orig.parentId];
            if (parent?.type !== 'image') continue;
            const l = worldDeltaToLocal(parent, world.x - g.origin.x, world.y - g.origin.y);
            patches[id] = { ...orig, ...P.translateLocal(orig, l.x, l.y) };
          } else patches[id] = { ...orig, ...P.translateItem(orig, dx, dy) };
        }
        st.updatePage((pg) => P.updateItems(pg, patches), false);
        setPreview({ guides: snap.guides });
        break;
      }
      case 'marquee': {
        g.current = world;
        const r = rectFromPoints(g.origin.x, g.origin.y, world.x, world.y);
        const inside = cur.order.filter((id) => {
          const it = cur.items[id];
          return it && !it.parentId && rectsIntersect(itemBounds(it, cur.items), r);
        });
        st.setSelection([...new Set([...g.base, ...inside.flatMap((id) => groupOf(cur, cur.items[id]))])]);
        setPreview({ marquee: r });
        break;
      }
      case 'draw': {
        const n = g.points.length;
        const lx = g.points[n - 2];
        const ly = g.points[n - 1];
        const events = typeof e.nativeEvent.getCoalescedEvents === 'function' ? e.nativeEvent.getCoalescedEvents() : [];
        const samples = events.length ? events.map((ce) => toWorld(ce.clientX, ce.clientY)) : [world];
        let px = lx;
        let py = ly;
        for (const s of samples) {
          if (Math.hypot(s.x - px, s.y - py) > 0.6 / getVp().zoom) {
            g.points.push(s.x, s.y);
            g.pressures.push(e.pressure || 0.5);
            px = s.x;
            py = s.y;
          }
        }
        updateDrawPreview();
        break;
      }
      case 'erase':
        eraseAt(world);
        g.last = world;
        break;
      case 'shape': {
        let end = world;
        if (e.shiftKey) end = g.shape === 'rect' || g.shape === 'ellipse' ? constrainSquare(g.start.x, g.start.y, world.x, world.y) : constrainAngle(g.start.x, g.start.y, world.x, world.y);
        g.end = end;
        const s = useSettings.getState();
        setPreview({ shape: { id: 'preview', type: 'shape', kind: g.shape, x1: g.start.x, y1: g.start.y, x2: end.x, y2: end.y, color: s.shapeColor, width: s.shapeWidth, opacity: 1, fill: g.shape === 'rect' || g.shape === 'ellipse' ? s.shapeFill : null } });
        break;
      }
      case 'connector': {
        g.end = world;
        const tol = 12 / getVp().zoom;
        const over = connectTargetAt(cur, world, tol, g.fromId);
        g.overId = over ? over.id : null;
        const source = cur.items[g.fromId];
        let anchor: Point | undefined;
        let toAnchor: Anchor = 'auto';
        if (over) {
          toAnchor = anchorFor(cur, over, world, tol);
          if (typeof toAnchor === 'object') anchor = fixedAnchorPoint(over, cur.items, toAnchor);
        }
        const from = previewEnd(cur, source, g.fromAnchor, anchor ?? world);
        setPreview({ connector: { from, to: anchor ?? (over ? previewEnd(cur, over, 'auto', from) : world), anchor } });
        break;
      }
      case 'reconnect': {
        g.point = world;
        const c = g.before.items[g.id];
        if (c?.type !== 'connector') break;
        const fixedId = g.end === 'from' ? c.toId : c.fromId;
        const tol = 12 / getVp().zoom;
        const over = connectTargetAt(cur, world, tol, fixedId);
        g.overId = over ? over.id : null;
        let anchor: Point | undefined;
        if (over) {
          const a = anchorFor(cur, over, world, tol);
          if (typeof a === 'object') anchor = fixedAnchorPoint(over, cur.items, a);
        }
        const fixedItem = cur.items[fixedId];
        const fixedEnd = fixedItem ? previewEnd(cur, fixedItem, g.end === 'from' ? c.toAnchor : c.fromAnchor, anchor ?? world) : world;
        const moving = anchor ?? (over ? previewEnd(cur, over, 'auto', fixedEnd) : world);
        setPreview({ connector: g.end === 'from' ? { from: moving, to: fixedEnd, anchor } : { from: fixedEnd, to: moving, anchor } });
        break;
      }
      case 'resize':
        applyResize(g, world, e.shiftKey, e.altKey || g.alt);
        break;
    }
  };

  const applyResize = (g: Extract<Gesture, { kind: 'resize' }>, world: Point, shift: boolean, alt: boolean) => {
    const st = useStore.getState();
    const o = g.orig;
    let patch: Partial<CanvasItem> | null = null;
    if (o.type === 'text') {
      if (g.handle === 'e') patch = { w: Math.max(80, world.x - o.x) };
      if (g.handle === 'w') {
        const right = o.x + o.w;
        const nx = Math.min(world.x, right - 80);
        patch = { x: nx, w: right - nx };
      }
    } else if (o.type === 'image') {
      const hx = g.handle === 'nw' || g.handle === 'sw' ? 0 : 1;
      const hy = g.handle === 'nw' || g.handle === 'ne' ? 0 : 1;
      const l = toImageLocal(o, world.x, world.y);
      const lx = l.x * o.w;
      const ly = l.y * o.h;
      const fx = (1 - hx) * o.w;
      const fy = (1 - hy) * o.h;
      let nw = Math.max(24, Math.abs(lx - fx));
      let nh = Math.max(24, Math.abs(ly - fy));
      if (!alt) {
        const s = Math.max(nw / o.w, nh / o.h);
        nw = Math.max(24, o.w * s);
        nh = Math.max(24, o.h * s);
      }
      const fixedWorld = fromImageLocal(o, 1 - hx, 1 - hy);
      const d = rotatePoint({ x: (0.5 - hx) * nw, y: (0.5 - hy) * nh }, { x: 0, y: 0 }, o.rotation);
      const cx = fixedWorld.x - d.x;
      const cy = fixedWorld.y - d.y;
      patch = { x: cx - nw / 2, y: cy - nh / 2, w: nw, h: nh };
    } else if (o.type === 'shape') {
      if (g.handle === 'p1' || g.handle === 'p2') {
        const other = g.handle === 'p1' ? { x: o.x2, y: o.y2 } : { x: o.x1, y: o.y1 };
        const p = shift ? constrainAngle(other.x, other.y, world.x, world.y) : world;
        patch = g.handle === 'p1' ? { x1: p.x, y1: p.y } : { x2: p.x, y2: p.y };
      } else {
        const minX = Math.min(o.x1, o.x2);
        const maxX = Math.max(o.x1, o.x2);
        const minY = Math.min(o.y1, o.y2);
        const maxY = Math.max(o.y1, o.y2);
        const fixed = { x: g.handle === 'nw' || g.handle === 'sw' ? maxX : minX, y: g.handle === 'nw' || g.handle === 'ne' ? maxY : minY };
        const p = shift ? constrainSquare(fixed.x, fixed.y, world.x, world.y) : world;
        patch = { x1: fixed.x, y1: fixed.y, x2: p.x, y2: p.y };
      }
    }
    if (patch) st.updatePage((pg) => P.updateItems(pg, { [g.id]: patch! }), false);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    gesture.current = null;
    const el = containerRef.current;
    if (el?.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    const st = useStore.getState();
    const cur = st.currentPage();
    if (!g || !cur) {
      setPreview(tool === 'eraser' && g ? { eraser: preview.eraser } : {});
      return;
    }
    const s = useSettings.getState();
    switch (g.kind) {
      case 'move': {
        if (g.moved) st.commitFrom(g.before);
        else if (g.clickedId && g.wasSelected && !g.shift && st.selection.length === 1) {
          const it = cur.items[g.clickedId];
          if (it?.type === 'text') enterEdit(it.id, e.clientX, e.clientY);
        }
        break;
      }
      case 'resize':
        st.commitFrom(g.before);
        break;
      case 'erase':
        if (g.erased.size) st.commitFrom(g.before);
        break;
      case 'draw': {
        if (g.points.length < 2) break;
        const hl = g.tool === 'highlighter';
        const zoom = getVp().zoom;
        let pts = g.points.length > 4 ? simplify(g.points, 0.35 / zoom) : g.points.slice();
        if (pts.length === 2) pts = [pts[0], pts[1], pts[0] + 0.01, pts[1] + 0.01];
        const avgP = g.pressures.reduce((a, b) => a + b, 0) / g.pressures.length;
        const isPen = e.pointerType === 'pen';
        const baseW = hl ? s.highlighterWidth : s.penWidth;
        const width = isPen && !hl ? baseW * (0.5 + avgP) : baseW;
        const parent = g.parentId ? (cur.items[g.parentId] as ImageItem | undefined) : undefined;
        if (parent) {
          const local: number[] = [];
          for (let i = 0; i < pts.length; i += 2) {
            const l = toImageLocal(parent, pts[i], pts[i + 1]);
            local.push(l.x, l.y);
          }
          pts = local;
        }
        const stroke: StrokeItem = {
          id: newId(),
          type: 'stroke',
          points: pts,
          color: hl ? s.highlighterColor : s.penColor,
          width,
          opacity: hl ? 0.38 : 1,
          tool: g.tool,
          ...(parent ? { parentId: parent.id } : {}),
        };
        st.updatePage((pg) => P.addItems(pg, [stroke]));
        break;
      }
      case 'shape': {
        const len = Math.hypot(g.end.x - g.start.x, g.end.y - g.start.y);
        if (len < 4 / getVp().zoom) break;
        // An arrow/line dragged from one object to another becomes an attached connector.
        if ((g.shape === 'arrow' || g.shape === 'line') && g.startItem) {
          const endHit = hitAt(cur, g.end, 6 / getVp().zoom, { topLevelOnly: true });
          if (endHit && endHit.type !== 'connector' && endHit.id !== g.startItem) {
            const tolA = 12 / getVp().zoom;
            const conn: ConnectorItem = { id: newId(), type: 'connector', fromId: g.startItem, toId: endHit.id, fromAnchor: anchorFor(cur, cur.items[g.startItem], g.start, tolA), toAnchor: anchorFor(cur, endHit, g.end, tolA), arrow: g.shape === 'arrow' ? 'end' : 'none', color: s.shapeColor, width: s.shapeWidth, layer: 'back' };
            st.updatePage((pg) => P.addItems(pg, [conn]));
            st.setSelection([conn.id]);
            break;
          }
        }
        const parent = g.parentId ? (cur.items[g.parentId] as ImageItem | undefined) : undefined;
        let a = g.start;
        let b = g.end;
        if (parent) {
          a = toImageLocal(parent, a.x, a.y);
          b = toImageLocal(parent, b.x, b.y);
        }
        const boxy = g.shape === 'rect' || g.shape === 'ellipse';
        const shape: ShapeItem = {
          id: newId(),
          type: 'shape',
          kind: g.shape,
          x1: a.x,
          y1: a.y,
          x2: b.x,
          y2: b.y,
          color: s.shapeColor,
          width: s.shapeWidth,
          opacity: 1,
          fill: boxy ? s.shapeFill : null,
          ...(parent ? { parentId: parent.id } : {}),
        };
        st.updatePage((pg) => P.addItems(pg, [shape]));
        break;
      }
      case 'connector': {
        if (!g.overId || !cur.items[g.overId] || !cur.items[g.fromId]) break;
        const conn: ConnectorItem = {
          id: newId(),
          type: 'connector',
          fromId: g.fromId,
          toId: g.overId,
          fromAnchor: g.fromAnchor,
          toAnchor: anchorFor(cur, cur.items[g.overId], g.end, 12 / getVp().zoom),
          arrow: 'end',
          color: s.connectorColor,
          width: s.connectorWidth,
          layer: 'back',
        };
        st.updatePage((pg) => P.addItems(pg, [conn]));
        break;
      }
      case 'reconnect': {
        // Released over an object: re-attach that end there; elsewhere the connector is unchanged.
        if (!g.overId || !cur.items[g.overId]) break;
        const anchor = anchorFor(cur, cur.items[g.overId], g.point, 12 / getVp().zoom);
        const patch: Partial<ConnectorItem> = g.end === 'from' ? { fromId: g.overId, fromAnchor: anchor } : { toId: g.overId, toAnchor: anchor };
        st.updatePage((pg) => P.updateItems(pg, { [g.id]: patch }));
        break;
      }
      case 'marquee': {
        // A plain click on an empty page starts writing right there.
        const moved = Math.hypot(g.current.x - g.origin.x, g.current.y - g.origin.y) * getVp().zoom > 3;
        if (!moved && !e.shiftKey && cur.order.length === 0 && g.origin.x >= 0 && g.origin.x <= PAGE_WIDTH && g.origin.y >= SHEET_TOP + 40) {
          startCreateText({ x: g.origin.x, y: g.origin.y + 12 }, 'plain', null);
        }
        break;
      }
      default:
        break;
    }
    setPreview(tool === 'eraser' ? { eraser: preview.eraser } : {});
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (tool !== 'select') return;
    const target = e.target as HTMLElement;
    if (target.closest('.text-item.editing') || target.closest('[data-ui]')) return;
    const cur = useStore.getState().currentPage();
    if (!cur) return;
    const world = toWorld(e.clientX, e.clientY);
    const hit = hitAt(cur, world, 6 / getVp().zoom);
    if (hit?.type === 'text') enterEdit(hit.id, e.clientX, e.clientY);
    else if (!hit) startCreateText(world, 'plain', null);
    else if (hit.type === 'image') startCreateText(world, 'plain', hit);
  };

  // ---------------------------------------------------------------- drag & drop of files
  const onDragOver = (e: React.DragEvent) => {
    if (Array.from(e.dataTransfer.types).includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  };
  const onDrop = (e: React.DragEvent) => {
    const files = Array.from(e.dataTransfer.files);
    if (!files.length) return;
    e.preventDefault();
    void insertImageFiles(files, toWorld(e.clientX, e.clientY));
  };

  // ---------------------------------------------------------------- text block callbacks
  const updateTextDoc = useCallback((pid: ID, id: ID, doc: JSONContent) => {
    useStore.getState().updatePage((p) => P.updateItems(p, { [id]: { doc } }), false, pid);
  }, []);

  const onExitEditing = useCallback((reason: 'escape' | 'blur') => {
    exitEdit();
    if (reason === 'escape') {
      // Escape keeps the block selected as an object (Delete then removes it).
      containerRef.current?.focus({ preventScroll: true });
    } else {
      useStore.getState().setSelection([]);
    }
  }, []);

  // Switching to another tool ends text editing properly (saves, drops empty blocks, clears outlines).
  useEffect(() => {
    const st = useStore.getState();
    if (tool !== 'select' && st.editingId) {
      finishEditing(st.editingId);
      st.setSelection([]);
    }
  }, [tool]);

  const editingSlot = useCallback(
    (t: TextItem) => <EditableRichText key={t.id} initial={t.doc} onChange={(doc) => pageId && updateTextDoc(pageId, t.id, doc)} onExit={onExitEditing} />,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pageId, updateTextDoc, onExitEditing],
  );

  // ---------------------------------------------------------------- text height measurement
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el || !page || !pageId) return;
    const ro = new ResizeObserver((entries) => {
      const st = useStore.getState();
      const cur = st.pages[pageId];
      if (!cur) return;
      const patches: Record<ID, Partial<CanvasItem>> = {};
      for (const en of entries) {
        const id = (en.target as HTMLElement).dataset.id;
        const it = id ? cur.items[id] : undefined;
        if (!it || it.type !== 'text') continue;
        const h = Math.round((en.target as HTMLElement).offsetHeight);
        if (Math.abs(h - it.h) > 1) patches[it.id] = { h };
      }
      if (Object.keys(patches).length) {
        // Measured heights are layout data, not user edits: update without history/dirty noise.
        useStore.setState((s) => ({ pages: { ...s.pages, [pageId]: P.updateItems(s.pages[pageId], patches) } }));
      }
    });
    el.querySelectorAll('.text-item').forEach((n) => ro.observe(n));
    return () => ro.disconnect();
    // Re-observe only when the set of blocks or the edited block changes; elements keep their identity otherwise.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId, page?.order, editingId, !!page]);

  const children = useMemo(() => (page ? childrenMap(page) : new Map<ID, CanvasItem[]>()), [page?.items, page?.order]); // eslint-disable-line react-hooks/exhaustive-deps

  const renderChildText = useCallback(
    (t: TextItem) => childText(t, editingId === t.id ? editingSlot(t) : undefined),
    [editingId, editingSlot],
  );

  if (!page || !pageId) {
    return (
      <div className="canvas-empty">
        <p>Nessuna pagina aperta.</p>
        <button className="btn primary" onClick={() => useStore.getState().addPage()} disabled={!useStore.getState().sectionId}>
          Crea una pagina
        </button>
      </div>
    );
  }

  const bg = page.background ?? { pattern: settings.background, paper: settings.paper };
  const cursor = spaceDown || tool === 'hand' ? (gesture.current?.kind === 'pan' ? 'grabbing' : 'grab') : tool === 'select' ? hoverCursor : tool === 'text' || tool === 'sticky' ? 'text' : DRAW_TOOLS.includes(tool) ? (tool === 'eraser' ? 'none' : 'crosshair') : 'default';

  const items: ReactNode[] = page.order.map((id, i) => {
    const it = page.items[id];
    if (!it || it.parentId) return null;
    const z = zFor(it, i);
    switch (it.type) {
      case 'text':
        return <TextView key={id} item={it} z={z} editingSlot={editingId === id ? editingSlot(it) : undefined} />;
      case 'image':
        return <ImageView key={id} item={it} z={z} annotations={children.get(id) ?? EMPTY_ARR} renderChildText={renderChildText} />;
      case 'stroke':
      case 'shape':
        return <VectorView key={id} item={it} z={z} items={EMPTY_ITEMS} />;
      case 'connector': {
        const ep = connectorEndpoints(it, page.items);
        if (!ep) return null;
        return <ConnectorView key={id} item={it} z={z} fx={ep.from.x} fy={ep.from.y} tx={ep.to.x} ty={ep.to.y} />;
      }
    }
  });

  return (
    <div
      ref={containerRef}
      className={`canvas paper-${bg.paper}`}
      data-canvas-root
      data-testid="canvas"
      tabIndex={0}
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => tool === 'eraser' && !gesture.current && setPreview({})}
      onDoubleClick={onDoubleClick}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="world" style={{ transform: `translate(${-vp.x * vp.zoom}px, ${-vp.y * vp.zoom}px) scale(${vp.zoom})` }}>
        <div className={`sheet-paper pattern-${bg.pattern}`} style={{ left: 0, top: SHEET_TOP, width: PAGE_WIDTH, height: sheetBottom(page) - SHEET_TOP }} aria-hidden>
          <span className="a4-guide" style={{ left: A4_WIDTH }} />
        </div>
        <SheetTitle pageId={pageId} />
        {page.order.length === 0 && !editingId && (
          <div className="sheet-hint" style={{ left: BODY_START.x + 8, top: BODY_START.y + 6 }} aria-hidden>
            Fai clic qui per scrivere · ⌘V incolla un’immagine · P penna
          </div>
        )}
        {items}
        <svg className="preview-layer" overflow="visible" width="1" height="1">
          {preview.stroke && (
            <path d={preview.stroke.d} fill="none" stroke={preview.stroke.color} strokeWidth={preview.stroke.width} strokeOpacity={preview.stroke.opacity} strokeLinecap={preview.stroke.highlighter ? 'butt' : 'round'} strokeLinejoin="round" style={preview.stroke.highlighter ? { mixBlendMode: 'multiply' } : undefined} />
          )}
          {preview.shape && shapeElement(preview.shape)}
          {preview.connector && (
            <>
              {connectorElement({ id: 'p', type: 'connector', fromId: '', toId: '', fromAnchor: 'auto', toAnchor: 'auto', arrow: 'end', color: settings.connectorColor, width: settings.connectorWidth, layer: 'front' }, preview.connector.from, preview.connector.to)}
              {preview.connector.anchor && <circle cx={preview.connector.anchor.x} cy={preview.connector.anchor.y} r={6 / vp.zoom} fill={settings.connectorColor} />}
            </>
          )}
          {preview.guides?.map((g, i) => <line key={i} x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2} className="guide" strokeWidth={1 / vp.zoom} />)}
          {preview.marquee && <rect className="marquee" x={preview.marquee.x} y={preview.marquee.y} width={preview.marquee.w} height={preview.marquee.h} strokeWidth={1 / vp.zoom} />}
          {preview.eraser && tool === 'eraser' && <circle className="eraser-cursor" cx={preview.eraser.x} cy={preview.eraser.y} r={8 / vp.zoom} strokeWidth={1.5 / vp.zoom} />}
        </svg>
      </div>
      <SelectionOverlay page={page} selection={selection} editingId={editingId} vp={vp} tool={tool} />
      <ScrollBars vp={vp} width={containerRef.current?.clientWidth ?? 1000} height={containerRef.current?.clientHeight ?? 700} bottom={sheetBottom(page)} />
    </div>
  );
}

function SelectionOverlay({ page, selection, editingId, vp, tool }: { page: PageContent; selection: ID[]; editingId: ID | null; vp: { x: number; y: number; zoom: number }; tool: Tool }) {
  if (tool !== 'select' && !editingId) return null;
  const sel = selection.filter((id) => page.items[id]);
  if (!sel.length) return null;
  const toScreen = (p: Point) => ({ x: (p.x - vp.x) * vp.zoom, y: (p.y - vp.y) * vp.zoom });
  const nodes: ReactNode[] = [];
  for (const id of sel) {
    const it = page.items[id];
    if (it.type === 'connector') {
      const ep = connectorEndpoints(it, page.items);
      if (!ep) continue;
      const a = toScreen(ep.from);
      const b = toScreen(ep.to);
      nodes.push(
        <svg key={id} className="sel-svg" style={{ left: 0, top: 0 }} overflow="visible" width="1" height="1">
          <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="sel-line" />
        </svg>,
      );
      if (sel.length === 1) {
        nodes.push(<div key="c1" data-handle="c1" className="handle round conn-end" style={{ left: a.x, top: a.y }} title="Trascina su un altro oggetto per ricollegare" />);
        nodes.push(<div key="c2" data-handle="c2" className="handle round conn-end" style={{ left: b.x, top: b.y }} title="Trascina su un altro oggetto per ricollegare" />);
      }
      continue;
    }
    if (it.type === 'image' && it.rotation) {
      const pts = [fromImageLocal(it, 0, 0), fromImageLocal(it, 1, 0), fromImageLocal(it, 1, 1), fromImageLocal(it, 0, 1)].map(toScreen);
      nodes.push(
        <svg key={id} className="sel-svg" style={{ left: 0, top: 0 }} overflow="visible" width="1" height="1">
          <polygon points={pts.map((p) => `${p.x},${p.y}`).join(' ')} className="sel-line" fill="none" />
        </svg>,
      );
    } else {
      const r = itemBounds(it, page.items);
      const s = toScreen(r);
      nodes.push(<div key={id} className={`sel-box${it.locked ? ' locked' : ''}${editingId === id ? ' editing' : ''}`} style={{ left: s.x - 3, top: s.y - 3, width: r.w * vp.zoom + 6, height: r.h * vp.zoom + 6 }} />);
    }
  }
  // Dashed outline around each selected group.
  const groups = new Set(sel.map((id) => page.items[id].groupId).filter(Boolean) as string[]);
  for (const gid of groups) {
    const rects = page.order.filter((id) => page.items[id]?.groupId === gid).map((id) => itemBounds(page.items[id], page.items));
    const g = unionRects(rects);
    if (!g) continue;
    const s0 = toScreen(g);
    nodes.push(<div key={`g-${gid}`} className="group-box" style={{ left: s0.x - 8, top: s0.y - 8, width: g.w * vp.zoom + 16, height: g.h * vp.zoom + 16 }} />);
  }
  if (sel.length === 1) {
    const it = page.items[sel[0]];
    const handle = (h: Handle, p: Point, cls = '') => <div key={h} data-handle={h} data-ui-handle className={`handle ${cls} h-${h}`} style={{ left: p.x, top: p.y }} title={h === 'grip' ? 'Trascina per spostare' : 'Ridimensiona'} />;
    if (it.locked) {
      const r = itemBounds(it, page.items);
      const s = toScreen({ x: r.x + r.w, y: r.y });
      nodes.push(
        <div key="lock" className="lock-badge" style={{ left: s.x - 10, top: s.y - 10 }} title="Bloccato">
          🔒
        </div>,
      );
    } else if (!it.parentId) {
      if (it.type === 'text') {
        const r = itemBounds(it, page.items);
        const editing = editingId === it.id;
        nodes.push(handle('w', toScreen({ x: r.x, y: r.y + r.h / 2 }), editing ? 'side subtle' : 'side'));
        nodes.push(handle('e', toScreen({ x: r.x + r.w, y: r.y + r.h / 2 }), editing ? 'side subtle' : 'side'));
        if (editing) nodes.push(handle('grip', toScreen({ x: r.x + r.w / 2, y: r.y }), 'grip'));
      } else if (it.type === 'image') {
        nodes.push(handle('nw', toScreen(fromImageLocal(it, 0, 0))));
        nodes.push(handle('ne', toScreen(fromImageLocal(it, 1, 0))));
        nodes.push(handle('sw', toScreen(fromImageLocal(it, 0, 1))));
        nodes.push(handle('se', toScreen(fromImageLocal(it, 1, 1))));
      } else if (it.type === 'shape') {
        if (it.kind === 'rect' || it.kind === 'ellipse') {
          const minX = Math.min(it.x1, it.x2);
          const maxX = Math.max(it.x1, it.x2);
          const minY = Math.min(it.y1, it.y2);
          const maxY = Math.max(it.y1, it.y2);
          nodes.push(handle('nw', toScreen({ x: minX, y: minY })));
          nodes.push(handle('ne', toScreen({ x: maxX, y: minY })));
          nodes.push(handle('sw', toScreen({ x: minX, y: maxY })));
          nodes.push(handle('se', toScreen({ x: maxX, y: maxY })));
        } else {
          nodes.push(handle('p1', toScreen({ x: it.x1, y: it.y1 }), 'round'));
          nodes.push(handle('p2', toScreen({ x: it.x2, y: it.y2 }), 'round'));
        }
      }
    }
  }
  return <div className="selection-overlay">{nodes}</div>;
}
