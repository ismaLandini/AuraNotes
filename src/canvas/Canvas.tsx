import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Trash2 } from 'lucide-react';
import type { JSONContent } from '@tiptap/core';
import type { Anchor, CanvasItem, ConnectorItem, ID, ImageItem, NoteContainerItem, PageContent, Point, Rect, ShapeItem, ShapeKind, StrokeItem, TextItem, Tool } from '../types';
import { useStore } from '../store/useStore';
import { useSettings } from '../store/settings';
import * as P from '../model/pageOps';
import { newId } from '../model/workspaceOps';
import {
  closestPerimeterAnchor,
  connectorEndpoints,
  constrainAngle,
  constrainOrthogonal,
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
import { requestCaretAt, requestFocusAfterAsset } from '../editor/activeEditor';
import { isFreeImageContainer } from '../model/pageOps';
import {
  createContainerDropCache,
  findTargetContainerAt,
  computeBlockDropPosition,
  getImageBlockAttrsFromContainer,
  type CachedContainer,
  type DropTargetResult,
} from './containerDrop';
import { clampViewport, clampZoom, defaultViewport, getViewport, registerContainer, screenToWorld, setLastPointerWorld, setVp as setViewportClamped } from './viewport';
import {
  consumeShiftPasteIntent,
  createTextBlock,
  editSession,
  finishEditing,
  handleCopy,
  handlePaste,
  insertImageFiles,
  markShiftPasteIntent,
  setCancelActiveGesture,
} from './actions';
import { isEditableTarget, isMac } from '../shortcuts/registry';
import { isModalOpen, useUI } from '../store/ui';
import { BODY_START, SHEET_TOP, computeSheetLayouts, isPdfDocument, sheetBottom, sheetLeft, sheetRight } from '../lib/page';
import { CanvasSheet } from './CanvasSheet';


import { SheetTitle } from './SheetTitle';
import { ScrollBars } from './ScrollBars';

type Handle = 'nw' | 'ne' | 'sw' | 'se' | 'w' | 'e' | 'p1' | 'p2' | 'grip' | 'c1' | 'c2' | 'bend';

interface ImageBlockHit {
  containerId: ID;
  blockIndex: number;
  rectWorld: Rect;
}

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
      freeImageId?: ID;
    }
  | { kind: 'marquee'; origin: Point; current: Point; base: ID[] }
  | {
      kind: 'draw';
      tool: 'pen' | 'highlighter';
      origin: Point;
      points: number[];
      pressures: number[];
      rawPoints: number[];
      rawPressures: number[];
      isStraight?: boolean;
      parentId: ID | null;
      imageBlockHit?: ImageBlockHit | null;
    }
  | { kind: 'shape'; shape: ShapeKind; start: Point; end: Point; parentId: ID | null; startItem: ID | null; imageBlockHit?: ImageBlockHit | null }
  | { kind: 'connector'; fromId: ID | null; fromAnchor: Anchor; start: Point; end: Point; overId: ID | null }
  | { kind: 'reconnect'; before: PageContent; id: ID; end: 'from' | 'to'; point: Point; overId: ID | null }
  | { kind: 'erase'; before: PageContent; erased: Set<ID>; last: Point }
  | { kind: 'resize'; before: PageContent; id: ID; handle: Handle; orig: CanvasItem; alt: boolean };

interface Preview {
  marquee?: Rect;
  stroke?: { d: string; color: string; width: number; opacity: number; highlighter: boolean };
  shape?: ShapeItem;
  connector?: { from: Point; to: Point; fromAnchor?: Point; anchor?: { x: number; y: number }; sourceId?: ID; targetId?: ID };
  connectorHover?: { itemId: ID; anchor: Point };
  guides?: Array<{ x1: number; y1: number; x2: number; y2: number }>;
  eraser?: Point;
  dropIndicator?: DropTargetResult;
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
 * The object a connector end should attach to: prefers the object whose perimeter is
 * closest within `tol`, otherwise an object whose edge is within comfortable reach.
 */
function connectTargetAt(page: PageContent, p: Point, tol: number, exclude: ID | null): CanvasItem | null {
  let bestPerim: CanvasItem | null = null;
  let bestD = Infinity;
  for (const id of page.order) {
    const it = page.items[id];
    if (!it || it.parentId || it.type === 'connector' || it.id === exclude) continue;
    const a = perimeterAnchorAt(it, page.items, p, tol);
    if (!a) continue;
    const q = fixedAnchorPoint(it, page.items, a);
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d <= bestD) {
      bestD = d;
      bestPerim = it;
    }
  }
  if (bestPerim) return bestPerim;

  const ordered = page.order
    .map((id, i) => ({ it: page.items[id], i }))
    .filter((x) => x.it && !x.it.parentId && x.it.type !== 'connector' && x.it.id !== exclude)
    .sort((a, b) => zFor(b.it, b.i) - zFor(a.it, a.i));
  for (const { it } of ordered) {
    const r = itemBounds(it, page.items);
    const isSmall = r.w <= Math.max(48, tol * 3) && r.h <= Math.max(48, tol * 3);
    const closeToEdge = Math.min(Math.abs(p.x - r.x), Math.abs(r.x + r.w - p.x), Math.abs(p.y - r.y), Math.abs(r.y + r.h - p.y)) <= tol * 1.5;
    if ((isSmall || closeToEdge) && hitTest(it, page.items, p, tol)) return it;
  }
  return null;
}

/** Where a connector end sits on `it` for the given anchor, aiming at `towards` when automatic. */
function previewEnd(page: PageContent, it: CanvasItem, anchor: Anchor, towards: Point): Point {
  if (typeof anchor === 'object') return fixedAnchorPoint(it, page.items, anchor);
  const r = itemBounds(it, page.items);
  if (anchor === 'auto') return rectBoundaryPoint(r, towards);
  return anchor === 'top' ? { x: r.x + r.w / 2, y: r.y } : anchor === 'bottom' ? { x: r.x + r.w / 2, y: r.y + r.h } : anchor === 'left' ? { x: r.x, y: r.y + r.h / 2 } : { x: r.x + r.w, y: r.y + r.h / 2 };
}

/** Projects any pointer position onto the closest perimeter point (0..1 along any of the 4 sides) of `it`. */
function anchorFor(page: PageContent, it: CanvasItem, p: Point, _tol?: number): { x: number; y: number } {
  return closestPerimeterAnchor(it, page.items, p);
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

function findImageBlockHitAt(
  canvasRoot: HTMLElement | null,
  clientX: number,
  clientY: number,
  toWorldFn: (cx: number, cy: number) => Point,
): ImageBlockHit | null {
  if (!canvasRoot) return null;
  const containers = Array.from(canvasRoot.querySelectorAll<HTMLElement>('.text-item[data-id]'));
  for (let c = containers.length - 1; c >= 0; c--) {
    const containerEl = containers[c];
    const containerId = containerEl.dataset.id;
    if (!containerId) continue;
    const blocks = Array.from(
      containerEl.querySelectorAll<HTMLElement>('.image-block-container, [data-type="image-block"]'),
    );
    for (let i = 0; i < blocks.length; i++) {
      const r = blocks[i].getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
        const tl = toWorldFn(r.left, r.top);
        const br = toWorldFn(r.right, r.bottom);
        return {
          containerId,
          blockIndex: i,
          rectWorld: {
            x: tl.x,
            y: tl.y,
            w: Math.max(1, br.x - tl.x),
            h: Math.max(1, br.y - tl.y),
          },
        };
      }
    }
  }
  return null;
}

function appendAnnotationToImageBlock(
  page: PageContent,
  hit: ImageBlockHit,
  annotation: StrokeItem | ShapeItem,
): PageContent {
  const item = page.items[hit.containerId];
  if (!item || (item.type !== 'container' && item.type !== 'text') || !item.doc?.content) {
    return page;
  }
  let currentBlockIdx = 0;
  let updated = false;
  const walk = (nodes: JSONContent[]): JSONContent[] =>
    nodes.map((n) => {
      if (n.type === 'imageBlock') {
        const isTarget = currentBlockIdx === hit.blockIndex;
        currentBlockIdx++;
        if (isTarget) {
          updated = true;
          const prevAnns = Array.isArray(n.attrs?.annotations) ? (n.attrs!.annotations as Array<StrokeItem | ShapeItem>) : [];
          return {
            ...n,
            attrs: {
              ...n.attrs,
              annotations: [...prevAnns, annotation],
            },
          };
        }
      }
      if (Array.isArray(n.content)) {
        return { ...n, content: walk(n.content) };
      }
      return n;
    });
  const nextContent = walk(item.doc.content);
  if (!updated) return page;
  return P.updateItems(page, {
    [hit.containerId]: {
      doc: {
        ...item.doc,
        content: nextContent,
      },
    },
  });
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
  const vpRef = useRef(vp);
  vpRef.current = vp;

  const containerRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const lastPointerRef = useRef<Point>({ x: 0, y: 0 });
  const [preview, setPreview] = useState<Preview>({});
  const [spaceDown, setSpaceDown] = useState(false);
  const [hoverCursor, setHoverCursor] = useState<string>('default');
  const editBefore = useRef<{ id: ID; before: PageContent } | null>(null);

  const hasPage = Boolean(page && pageId);
  useLayoutEffect(() => {
    registerContainer(containerRef.current);
    const el = containerRef.current;
    const ro = el ? new ResizeObserver(() => setResizeTick((t) => t + 1)) : null;
    if (el) ro!.observe(el);
    return () => {
      ro?.disconnect();
    };
  }, [pageId, hasPage]);

  useEffect(() => {
    return () => {
      registerContainer(null);
    };
  }, []);

  const setVp = useCallback((v: { x: number; y: number; zoom: number }) => setViewportClamped(v), []);
  const getVp = () => getViewport();

  const toWorld = (clientX: number, clientY: number): Point => {
    const el = containerRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return screenToWorld(clientX - r.left, clientY - r.top, vpRef.current);
  };

  const containerDropCache = useRef<CachedContainer[]>([]);
  const activeDropTarget = useRef<DropTargetResult | null>(null);
  const autoScrollRaf = useRef<number | null>(null);
  const autoScrollVelocity = useRef<{ vx: number; vy: number }>({ vx: 0, vy: 0 });
  const [isDraggingImage, setIsDraggingImage] = useState(false);
  const html5DragCache = useRef<CachedContainer[] | null>(null);

  const cancelAutoScroll = useCallback(() => {
    if (autoScrollRaf.current !== null) {
      cancelAnimationFrame(autoScrollRaf.current);
      autoScrollRaf.current = null;
    }
    autoScrollVelocity.current = { vx: 0, vy: 0 };
  }, []);

  const checkAutoScroll = useCallback((clientX: number, clientY: number) => {
    const el = containerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const EDGE_ZONE = 40;
    const MAX_SPEED = 16;
    let vx = 0;
    let vy = 0;

    if (clientX < r.left + EDGE_ZONE) {
      const ratio = 1 - Math.max(0, clientX - r.left) / EDGE_ZONE;
      vx = -MAX_SPEED * ratio;
    } else if (clientX > r.right - EDGE_ZONE) {
      const ratio = 1 - Math.max(0, r.right - clientX) / EDGE_ZONE;
      vx = MAX_SPEED * ratio;
    }

    if (clientY < r.top + EDGE_ZONE) {
      const ratio = 1 - Math.max(0, clientY - r.top) / EDGE_ZONE;
      vy = -MAX_SPEED * ratio;
    } else if (clientY > r.bottom - EDGE_ZONE) {
      const ratio = 1 - Math.max(0, r.bottom - clientY) / EDGE_ZONE;
      vy = MAX_SPEED * ratio;
    }

    autoScrollVelocity.current = { vx, vy };

    if ((vx !== 0 || vy !== 0) && autoScrollRaf.current === null) {
      const step = () => {
        const { vx: curVx, vy: curVy } = autoScrollVelocity.current;
        if (curVx !== 0 || curVy !== 0) {
          const curVp = getViewport();
          setViewportClamped({
            ...curVp,
            x: curVp.x + curVx / curVp.zoom,
            y: curVp.y + curVy / curVp.zoom,
          });
          autoScrollRaf.current = requestAnimationFrame(step);
        } else {
          autoScrollRaf.current = null;
        }
      };
      autoScrollRaf.current = requestAnimationFrame(step);
    }
  }, []);

  useEffect(() => {
    return () => {
      cancelAutoScroll();
    };
  }, [cancelAutoScroll]);

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
      if (changed && st.pageId === eb.before.id && !st.history[st.pageId]?.future?.length) {
        st.commitFrom(eb.before);
      }
    };
  }, [editingId]);

  const startCreateText = (at: Point, variant: 'plain' | 'sticky') => {
    createTextBlock({ x: at.x, y: at.y - 12 }, { variant });
  };

  const enterEdit = (id: ID, clientX: number | null, clientY: number | null) => {
    const prev = useStore.getState().editingId;
    if (prev && prev !== id) finishEditing(prev);
    requestCaretAt(clientX, clientY);
    useStore.getState().setSelection([id]);
    useStore.getState().setEditing(id);
  };

  const exitEdit = () => {
    const id = useStore.getState().editingId;
    if (id) finishEditing(id);
  };

  const updateDrawPreview = () => {
    const g = gesture.current;
    if (!g || g.kind !== 'draw') return;
    const s = useSettings.getState();
    const hl = g.tool === 'highlighter';
    setPreview({ stroke: { d: smoothPath(g.points), color: hl ? s.highlighterColor : s.penColor, width: hl ? s.highlighterWidth : s.penWidth, opacity: hl ? 0.38 : 1, highlighter: hl } });
  };

  const syncStraightDraw = (isStraight: boolean) => {
    const g = gesture.current;
    if (!g || g.kind !== 'draw') return;
    if (isStraight) {
      const world = lastPointerRef.current;
      const target = constrainOrthogonal(g.origin.x, g.origin.y, world.x, world.y);
      g.isStraight = true;
      g.points = [g.origin.x, g.origin.y, target.x, target.y];
    } else {
      g.isStraight = false;
      g.points = g.rawPoints.slice();
      g.pressures = g.rawPressures.slice();
    }
    updateDrawPreview();
  };

  // ---------------------------------------------------------------- wheel / pinch
  useEffect(() => {
    const isInsideUI = (target: EventTarget | null) => {
      const el = target instanceof Element ? target : (target as Node | null)?.parentElement ?? null;
      return Boolean(
        el?.closest(
          '.ribbon, .vertical-tool-rail, .tool-palette, .modal, .popover, .menu, .submenu, .sidebar, .nav-list, .shortcuts-overlay, .dialog, .floating-format-bar, .page-outline-panel, .window-titlebar, .zoom-controls, .nav-minimenu'
        )
      );
    };

    const onWheel = (e: WheelEvent) => {
      // Don't intercept wheel events if already handled or inside UI overlays/toolbars
      if (e.defaultPrevented || isInsideUI(e.target)) {
        return;
      }
      const target = e.target as HTMLElement | null;
      // Allow internal horizontal scrolling for preformatted code blocks or math blocks if present
      const childScrollable = target?.closest('pre, .math-block') as HTMLElement | null;
      if (childScrollable && Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        const canScrollX = childScrollable.scrollWidth > childScrollable.clientWidth;
        if (canScrollX) {
          const atLeft = childScrollable.scrollLeft <= 0 && e.deltaX < 0;
          const atRight = childScrollable.scrollLeft + childScrollable.clientWidth >= childScrollable.scrollWidth - 1 && e.deltaX > 0;
          if (!atLeft && !atRight) return;
        }
      }

      e.preventDefault();
      const v = getViewport();
      const el = containerRef.current;
      const r = el ? el.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.01));
        const nz = clampZoom(v.zoom * factor);
        const sx = e.clientX - r.left;
        const sy = e.clientY - r.top;
        const w = screenToWorld(sx, sy, v);
        setViewportClamped({ zoom: nz, x: w.x - sx / nz, y: w.y - sy / nz });
      } else {
        const mult = e.deltaMode === 1 ? 28 : (e.deltaMode === 2 ? r.height : 1);
        let dx = e.deltaX * mult;
        let dy = e.deltaY * mult;
        if (e.shiftKey && dx === 0) {
          dx = dy;
          dy = 0;
        }
        setViewportClamped({ ...v, x: v.x + dx / v.zoom, y: v.y + dy / v.zoom });
      }
    };
    // Safari pinch gestures
    let gestureStartZoom = 1;
    const onGestureStart = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (isInsideUI(target)) return;
      e.preventDefault();
      gestureStartZoom = getViewport().zoom;
    };
    const onGestureChange = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (isInsideUI(target)) return;
      e.preventDefault();
      const ge = e as Event & { scale: number; clientX: number; clientY: number };
      const v = getViewport();
      const el = containerRef.current;
      const r = el ? el.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
      const nz = clampZoom(gestureStartZoom * ge.scale);
      const sx = (ge.clientX ?? r.width / 2 + r.left) - r.left;
      const sy = (ge.clientY ?? r.height / 2 + r.top) - r.top;
      const w = screenToWorld(sx, sy, v);
      setViewportClamped({ zoom: nz, x: w.x - sx / nz, y: w.y - sy / nz });
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('gesturestart', onGestureStart as EventListener);
    window.addEventListener('gesturechange', onGestureChange as EventListener);
    return () => {
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('gesturestart', onGestureStart as EventListener);
      window.removeEventListener('gesturechange', onGestureChange as EventListener);
    };
  }, []);

  // ---------------------------------------------------------------- space-to-pan, clipboard
  useEffect(() => {
    setCancelActiveGesture(() => {
      cancelAutoScroll();
      setIsDraggingImage(false);
      const g = gesture.current;
      if (g) {
        gesture.current = null;
        activeDropTarget.current = null;
        setPreview({});
        if ('before' in g && g.before) {
          useStore.getState().updatePage(() => g.before, false);
        }
        return true;
      }
      return false;
    });

    const down = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        cancelAutoScroll();
        setIsDraggingImage(false);
        const g = gesture.current;
        if (g) {
          gesture.current = null;
          activeDropTarget.current = null;
          setPreview({});
          if ('before' in g && g.before) {
            useStore.getState().updatePage(() => g.before, false);
          }
          e.preventDefault();
          return;
        }
      }
      if (e.key === 'Meta' || e.key === 'Control' || e.key === 'Shift') {
        syncStraightDraw(true);
      }
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (mod && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'v') {
        markShiftPasteIntent();
      }
      if (e.code === 'Space' && !isEditableTarget(e.target) && !isModalOpen()) {
        if (!e.repeat) setSpaceDown(true);
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceDown(false);
      if (e.key === 'Meta' || e.key === 'Control' || e.key === 'Shift') {
        syncStraightDraw(e.metaKey || e.ctrlKey || e.shiftKey);
      }
    };
    const blur = () => setSpaceDown(false);
    const visibilityChange = () => {
      if (document.hidden) setSpaceDown(false);
    };
    const textSelected = () => {
      const sel = window.getSelection();
      return !!sel && !sel.isCollapsed && sel.toString().length > 0 && !!sel.anchorNode && document.contains(sel.anchorNode);
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
      const plain = consumeShiftPasteIntent();
      void handlePaste(e, { plain });
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    document.addEventListener('visibilitychange', visibilityChange);
    document.addEventListener('copy', onCopy);
    document.addEventListener('cut', onCut);
    document.addEventListener('paste', onPaste);
    return () => {
      setCancelActiveGesture(null);
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      document.removeEventListener('visibilitychange', visibilityChange);
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('cut', onCut);
      document.removeEventListener('paste', onPaste);
    };
  }, [cancelAutoScroll]);

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
    if (e.button === 2 && tool !== 'hand') return;
    const target = e.target as HTMLElement;
    if (target.closest('[data-ui]')) return;
    const st = useStore.getState();
    const cur = st.currentPage();
    if (!cur) return;
    const inEditing = target.closest('.text-item.editing');
    if (inEditing && !target.dataset.handle) return; // typing / selecting text inside the editor

    const wikiEl = !inEditing ? target.closest<HTMLElement>('.wiki-link[data-wiki-link]') : null;
    if (wikiEl && e.button === 0 && tool === 'select') {
      const targetTitle = wikiEl.getAttribute('data-wiki-link') ?? '';
      if (targetTitle) {
        e.preventDefault();
        e.stopPropagation();
        if (st.editingId) exitEdit();
        void st.navigateWikiLink(targetTitle);
        return;
      }
    }

    const world = toWorld(e.clientX, e.clientY);
    const v = getVp();
    const tol = 6 / v.zoom;
    const el = containerRef.current!;

    if (e.button === 1 || (e.button === 2 && tool === 'hand') || spaceDown || tool === 'hand') {
      gesture.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: v.x, vy: v.y };
      el.setPointerCapture(e.pointerId);
      return;
    }

    // Leaving an active text block.
    if (st.editingId && !(target.dataset.handle === 'grip')) exitEdit();
    if (document.activeElement instanceof HTMLElement && document.activeElement !== el) document.activeElement.blur();
    el.focus({ preventScroll: true });

    const curAfterExit = useStore.getState().currentPage();
    if (!curAfterExit) return;
    const activeCur = curAfterExit;
    const latestSel = useStore.getState().selection;

    const handle = target.dataset.handle as Handle | undefined;
    if (handle && latestSel.length === 1) {
      const id = latestSel[0];
      const it = activeCur.items[id];
      if (handle === 'grip') e.preventDefault(); // keep the editor focused while dragging the block
      if (it && it.type === 'connector' && (handle === 'c1' || handle === 'c2')) {
        gesture.current = { kind: 'reconnect', before: activeCur, id, end: handle === 'c1' ? 'from' : 'to', point: world, overId: null };
      } else if (it && handle === 'grip') {
        const isFree = isFreeImageContainer(it);
        if (isFree) {
          containerDropCache.current = createContainerDropCache(activeCur, id);
        }
        gesture.current = { kind: 'move', before: activeCur, origin: world, ids: [id], moved: false, clickedId: null, wasSelected: true, shift: false, clientX: e.clientX, clientY: e.clientY, freeImageId: isFree ? id : undefined };
      } else if (it && !it.locked) {
        gesture.current = { kind: 'resize', before: activeCur, id, handle, orig: it, alt: e.altKey };
      }
      el.setPointerCapture(e.pointerId);
      return;
    }

    switch (tool) {
      case 'select': {
        const hit = hitAt(activeCur, world, tol);
        if (hit) {
          const members = groupOf(activeCur, hit);
          const wasSelected = latestSel.includes(hit.id);
          let sel = latestSel;
          if (e.shiftKey || e.metaKey) sel = wasSelected ? sel.filter((s) => !members.includes(s)) : [...new Set([...sel, ...members])];
          else if (!wasSelected) sel = members;
          st.setSelection(sel);
          const movable = sel.filter((id) => activeCur.items[id] && !activeCur.items[id].locked && activeCur.items[id].type !== 'connector');
          const singleFreeId = movable.length === 1 && isFreeImageContainer(activeCur.items[movable[0]]) ? movable[0] : undefined;
          if (singleFreeId) {
            containerDropCache.current = createContainerDropCache(activeCur, singleFreeId);
          }
          gesture.current = { kind: 'move', before: activeCur, origin: world, ids: movable, moved: false, clickedId: hit.id, wasSelected, shift: e.shiftKey, clientX: e.clientX, clientY: e.clientY, freeImageId: singleFreeId };
        } else {
          const base = e.shiftKey ? latestSel : [];
          if (!e.shiftKey) st.setSelection([]);
          gesture.current = { kind: 'marquee', origin: world, current: world, base };
        }
        break;
      }
      case 'text':
      case 'sticky': {
        const textItemEl = target.closest<HTMLElement>('.text-item[data-id]');
        const clickedId = textItemEl?.dataset.id;
        const clickedItem = clickedId ? activeCur.items[clickedId] : null;
        if (clickedItem && (clickedItem.type === 'text' || clickedItem.type === 'container') && !isFreeImageContainer(clickedItem)) {
          enterEdit(clickedItem.id, e.clientX, e.clientY);
        } else {
          startCreateText(world, tool === 'sticky' ? 'sticky' : 'plain');
        }
        return;
      }
      case 'pen':
      case 'highlighter': {
        const parent = topImageAt(activeCur, world);
        const imageBlockHit = !parent ? findImageBlockHitAt(containerRef.current, e.clientX, e.clientY, toWorld) : null;
        lastPointerRef.current = world;
        const initialPressure = e.pressure || 0.5;
        const isStraight = e.metaKey || e.ctrlKey || e.shiftKey;
        gesture.current = {
          kind: 'draw',
          tool,
          origin: world,
          points: [world.x, world.y],
          pressures: [initialPressure],
          rawPoints: [world.x, world.y],
          rawPressures: [initialPressure],
          isStraight,
          parentId: parent?.id ?? null,
          imageBlockHit,
        };
        updateDrawPreview();
        break;
      }
      case 'eraser': {
        gesture.current = { kind: 'erase', before: activeCur, erased: new Set(), last: world };
        eraseAt(world);
        break;
      }
      case 'line':
      case 'arrow':
      case 'double-arrow':
      case 'rect':
      case 'ellipse': {
        if (latestSel.length) st.setSelection([]);
        const parent = topImageAt(activeCur, world);
        const imageBlockHit = !parent ? findImageBlockHitAt(containerRef.current, e.clientX, e.clientY, toWorld) : null;
        const startHit = tool === 'arrow' || tool === 'line' || tool === 'double-arrow' ? connectTargetAt(activeCur, world, 12 / v.zoom, null) : null;
        gesture.current = {
          kind: 'shape',
          shape: tool,
          start: world,
          end: world,
          parentId: parent?.id ?? null,
          startItem: startHit ? startHit.id : null,
          imageBlockHit,
        };
        break;
      }
      case 'connector': {
        const hit = connectTargetAt(activeCur, world, 12 / v.zoom, null);
        const fromAnchor = hit ? anchorFor(activeCur, hit, world, 12 / v.zoom) : 'auto';
        gesture.current = { kind: 'connector', fromId: hit ? hit.id : null, fromAnchor, start: world, end: world, overId: null };
        break;
      }
      default:
        break;
    }
    if (gesture.current) el.setPointerCapture(e.pointerId);
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
    lastPointerRef.current = world;
    const targetEl = e.target as HTMLElement | null;
    if (!targetEl?.closest?.('[data-ui]')) {
      setLastPointerWorld(world);
    }
    const g = gesture.current;
    const st = useStore.getState();
    const cur = st.currentPage();
    if (!g) {
      if (tool === 'eraser') setPreview({ eraser: world });
      else if (tool === 'connector' && cur) {
        const tol = 12 / getVp().zoom;
        const over = connectTargetAt(cur, world, tol, null);
        if (over) {
          const a = anchorFor(cur, over, world, tol);
          setPreview({ connectorHover: { itemId: over.id, anchor: fixedAnchorPoint(over, cur.items, a) } });
        } else if (preview.connectorHover) {
          setPreview({});
        }
      }
      if (tool === 'select' && cur && !spaceDown) {
        const target = e.target as HTMLElement;
        if (target.dataset.handle) return;
        const hit = hitAt(cur, world, 6 / getVp().zoom);
        const c = !hit ? 'default' : hit.locked ? 'not-allowed' : (hit.type === 'text' || hit.type === 'container') && st.selection.includes(hit.id) && st.selection.length === 1 ? 'text' : 'move';
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

        if (g.freeImageId) {
          setIsDraggingImage(true);
          checkAutoScroll(e.clientX, e.clientY);
          const target = findTargetContainerAt(containerDropCache.current, world);
          if (target) {
            const targetEl = containerRef.current?.querySelector(`.text-item[data-id="${target.id}"]`) as HTMLElement | null;
            const dropPos = computeBlockDropPosition(target.item, world, targetEl);
            activeDropTarget.current = dropPos;
            setPreview({ dropIndicator: dropPos, guides: snap.guides });
          } else {
            activeDropTarget.current = null;
            setPreview({ guides: snap.guides });
          }
        } else {
          setPreview({ guides: snap.guides });
        }
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
        const isStraight = e.metaKey || e.ctrlKey || e.shiftKey;
        g.isStraight = isStraight;

        const n = g.rawPoints.length;
        const lx = g.rawPoints[n - 2];
        const ly = g.rawPoints[n - 1];
        const events = typeof e.nativeEvent.getCoalescedEvents === 'function' ? e.nativeEvent.getCoalescedEvents() : [];
        const samples = events.length ? events.map((ce) => toWorld(ce.clientX, ce.clientY)) : [world];
        let px = lx;
        let py = ly;
        for (const s of samples) {
          if (Math.hypot(s.x - px, s.y - py) > 0.6 / getVp().zoom) {
            g.rawPoints.push(s.x, s.y);
            g.rawPressures.push(e.pressure || 0.5);
            px = s.x;
            py = s.y;
          }
        }

        if (isStraight) {
          const target = constrainOrthogonal(g.origin.x, g.origin.y, world.x, world.y);
          g.points = [g.origin.x, g.origin.y, target.x, target.y];
          g.pressures = [g.rawPressures[0] || 0.5, e.pressure || 0.5];
        } else {
          g.points = g.rawPoints.slice();
          g.pressures = g.rawPressures.slice();
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
        const over = connectTargetAt(cur, world, tol, g.fromId ?? null);
        g.overId = over ? over.id : null;
        const source = g.fromId ? cur.items[g.fromId] : null;
        let anchor: Point | undefined;
        let toAnchor: Anchor = 'auto';
        if (over) {
          toAnchor = anchorFor(cur, over, world, tol);
          if (typeof toAnchor === 'object') anchor = fixedAnchorPoint(over, cur.items, toAnchor);
        }
        const from = source ? previewEnd(cur, source, g.fromAnchor, anchor ?? world) : g.start;
        const to = anchor ?? (over ? previewEnd(cur, over, 'auto', from) : world);
        setPreview({
          connector: {
            from,
            to,
            fromAnchor: from,
            anchor,
            sourceId: g.fromId ?? undefined,
            targetId: over?.id,
          },
        });
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
        setPreview({
          connector: g.end === 'from'
            ? { from: moving, to: fixedEnd, fromAnchor: fixedEnd, anchor, sourceId: fixedId, targetId: over?.id }
            : { from: fixedEnd, to: moving, fromAnchor: fixedEnd, anchor, sourceId: fixedId, targetId: over?.id },
        });
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
    if (o.type === 'text' || o.type === 'container') {
      let nextW: number | undefined;
      let nextX: number | undefined;
      if (g.handle === 'e' || g.handle === 'se' || g.handle === 'ne') nextW = Math.max(80, Math.round(world.x - o.x));
      if (g.handle === 'w' || g.handle === 'sw' || g.handle === 'nw') {
        const right = o.x + o.w;
        const nx = Math.min(world.x, right - 80);
        nextX = Math.round(nx);
        nextW = Math.round(right - nx);
      }
      if (nextW !== undefined) {
        if (o.type === 'container' && isFreeImageContainer(o) && o.doc?.content?.[0]?.type === 'imageBlock') {
          const block = o.doc.content[0];
          const nw = Number(block.attrs?.naturalWidth || nextW);
          const nh = Number(block.attrs?.naturalHeight || nextW);
          const ratio = nw && nh ? nw / nh : 1.333;
          patch = {
            ...(nextX !== undefined ? { x: nextX } : {}),
            w: nextW,
            h: Math.round(nextW / ratio),
            customW: true,
            doc: {
              ...o.doc,
              content: [{ ...block, attrs: { ...block.attrs, width: nextW } }, ...o.doc.content.slice(1)],
            },
          };
        } else {
          patch = { ...(nextX !== undefined ? { x: nextX } : {}), w: nextW, customW: true };
        }
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
      const curPage = st.currentPage() ?? g.before;
      const parent = o.parentId ? curPage.items[o.parentId] : undefined;
      const isImgParent = parent?.type === 'image';
      const toItemSpace = (pt: Point): Point => (isImgParent ? toImageLocal(parent, pt.x, pt.y) : pt);
      if (g.handle === 'bend') {
        const localWorld = toItemSpace(world);
        const mid = { x: (o.x1 + o.x2) / 2, y: (o.y1 + o.y2) / 2 };
        const snapDist = isImgParent ? 6 / Math.max(parent.w, parent.h, 1) : 6;
        patch = { bend: Math.hypot(localWorld.x - mid.x, localWorld.y - mid.y) < snapDist ? undefined : localWorld };
      } else if (g.handle === 'p1' || g.handle === 'p2') {
        const otherLocal = g.handle === 'p1' ? { x: o.x2, y: o.y2 } : { x: o.x1, y: o.y1 };
        const other = isImgParent ? fromImageLocal(parent, otherLocal.x, otherLocal.y) : otherLocal;
        const p = toItemSpace(shift ? constrainAngle(other.x, other.y, world.x, world.y) : world);
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
    try {
      if (el?.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore stale pointer capture */
    }
    const st = useStore.getState();
    const cur = st.currentPage();
    if (!g || !cur) {
      setPreview(tool === 'eraser' && g ? { eraser: preview.eraser } : {});
      return;
    }
    const s = useSettings.getState();
    switch (g.kind) {
      case 'move': {
        cancelAutoScroll();
        setIsDraggingImage(false);
        if (g.freeImageId && activeDropTarget.current) {
          const dropTarget = activeDropTarget.current;
          activeDropTarget.current = null;
          setPreview({});
          const freeContainer = g.before.items[g.freeImageId] as NoteContainerItem | undefined;
          const attrs = freeContainer ? getImageBlockAttrsFromContainer(freeContainer) : null;
          if (attrs) {
            st.updatePage((p) => P.moveImageIntoContainer(p, g.freeImageId!, dropTarget.container.id, attrs, dropTarget.insertIndex), false);
            st.commitFrom(g.before);
            requestFocusAfterAsset(attrs.assetId);
            enterEdit(dropTarget.container.id, null, null);
            break;
          }
        }
        activeDropTarget.current = null;
        if (g.moved) st.commitFrom(g.before);
        else if (g.clickedId && g.wasSelected && !g.shift && st.selection.length === 1) {
          const it = cur.items[g.clickedId];
          if (it?.type === 'text' || it?.type === 'container') enterEdit(it.id, e.clientX, e.clientY);
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
        let pts: number[];
        if (g.isStraight && g.points.length >= 4) {
          // Linea dritta vincolata ortogonalmente: mantiene esattamente i due punti estremi
          pts = [g.points[0], g.points[1], g.points[g.points.length - 2], g.points[g.points.length - 1]];
        } else {
          pts = g.points.length > 4 ? simplify(g.points, 0.35 / zoom) : g.points.slice();
        }
        if (pts.length === 2) pts = [pts[0], pts[1], pts[0] + 0.01, pts[1] + 0.01];
        const avgP = g.pressures.reduce((a, b) => a + b, 0) / g.pressures.length;
        const isPen = e.pointerType === 'pen';
        const baseW = hl ? s.highlighterWidth : s.penWidth;
        const width = isPen && !hl ? baseW * (0.5 + avgP) : baseW;
        if (g.imageBlockHit) {
          const rw = g.imageBlockHit.rectWorld;
          const normPts: number[] = [];
          for (let i = 0; i < pts.length; i += 2) {
            normPts.push((pts[i] - rw.x) / rw.w, (pts[i + 1] - rw.y) / rw.h);
          }
          const stroke: StrokeItem = {
            id: newId(),
            type: 'stroke',
            points: normPts,
            color: hl ? s.highlighterColor : s.penColor,
            width,
            opacity: hl ? 0.38 : 1,
            tool: g.tool,
          };
          st.updatePage((pg) => appendAnnotationToImageBlock(pg, g.imageBlockHit!, stroke));
          break;
        }
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
        // An arrow/line/double-arrow dragged from one object to another becomes an attached connector.
        if ((g.shape === 'arrow' || g.shape === 'line' || g.shape === 'double-arrow') && g.startItem) {
          const tolA = 12 / getVp().zoom;
          const endHit = connectTargetAt(cur, g.end, tolA, g.startItem);
          if (endHit && endHit.type !== 'connector' && endHit.id !== g.startItem && cur.items[g.startItem]) {
            const conn: ConnectorItem = {
              id: newId(),
              type: 'connector',
              fromId: g.startItem,
              toId: endHit.id,
              fromAnchor: anchorFor(cur, cur.items[g.startItem], g.start, tolA),
              toAnchor: anchorFor(cur, endHit, g.end, tolA),
              arrow: g.shape === 'arrow' ? 'end' : g.shape === 'double-arrow' ? 'both' : 'none',
              color: s.shapeColor,
              width: s.shapeWidth,
              layer: 'back',
            };
            st.updatePage((pg) => P.addItems(pg, [conn]));
            st.setSelection([conn.id]);
            break;
          }
        }
        const boxy = g.shape === 'rect' || g.shape === 'ellipse';
        if (g.imageBlockHit) {
          const rw = g.imageBlockHit.rectWorld;
          const shape: ShapeItem = {
            id: newId(),
            type: 'shape',
            kind: g.shape,
            x1: (g.start.x - rw.x) / rw.w,
            y1: (g.start.y - rw.y) / rw.h,
            x2: (g.end.x - rw.x) / rw.w,
            y2: (g.end.y - rw.y) / rw.h,
            color: s.shapeColor,
            width: s.shapeWidth,
            opacity: 1,
            fill: boxy ? s.shapeFill : null,
          };
          st.updatePage((pg) => appendAnnotationToImageBlock(pg, g.imageBlockHit!, shape));
          break;
        }
        const parent = g.parentId ? (cur.items[g.parentId] as ImageItem | undefined) : undefined;
        let a = g.start;
        let b = g.end;
        if (parent) {
          a = toImageLocal(parent, a.x, a.y);
          b = toImageLocal(parent, b.x, b.y);
        }
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
        if (!boxy) st.setSelection([shape.id]);
        break;
      }
      case 'connector': {
        const source = g.fromId ? cur.items[g.fromId] : null;
        const target = g.overId ? cur.items[g.overId] : null;
        if (source && target && source.id !== target.id) {
          const conn: ConnectorItem = {
            id: newId(),
            type: 'connector',
            fromId: source.id,
            toId: target.id,
            fromAnchor: g.fromAnchor,
            toAnchor: anchorFor(cur, target, g.end, 12 / getVp().zoom),
            arrow: 'end',
            color: s.connectorColor,
            width: s.connectorWidth,
            layer: 'back',
          };
          st.updatePage((pg) => P.addItems(pg, [conn]));
        } else if (Math.hypot(g.end.x - g.start.x, g.end.y - g.start.y) > 4) {
          const startPt = source ? previewEnd(cur, source, g.fromAnchor, g.end) : g.start;
          const endPt = target ? previewEnd(cur, target, 'auto', startPt) : g.end;
          const shape: ShapeItem = {
            id: newId(),
            type: 'shape',
            kind: 'arrow',
            x1: startPt.x,
            y1: startPt.y,
            x2: endPt.x,
            y2: endPt.y,
            color: s.connectorColor,
            width: s.connectorWidth,
            opacity: 1,
            fill: null,
          };
          st.updatePage((pg) => P.addItems(pg, [shape]));
        }
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
        // A plain click on an empty space starts writing right there (OneNote style).
        const moved = Math.hypot(g.current.x - g.origin.x, g.current.y - g.origin.y) * getVp().zoom > 3;
        if (!moved && !e.shiftKey && g.origin.y >= SHEET_TOP) {
          startCreateText({ x: g.origin.x, y: g.origin.y }, 'plain');
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

    // Se l'utente fa doppio click su un blocco di solo testo per modificarne il contenuto:
    const isPureTextContent = Boolean(
      target.closest('p, h1, h2, h3, li, blockquote, code, table') &&
      !target.closest('[data-type="image-block"], [data-testid="image-block"], .image-block-container, .image-block-wrapper, img, svg, .image-item')
    );

    if (hit && isPureTextContent && (hit.type === 'text' || (hit.type === 'container' && !(hit as NoteContainerItem).freeImage))) {
      enterEdit(hit.id, e.clientX, e.clientY);
    } else {
      // Qualsiasi doppio click su foto, PDF, canvas o sopra un contenitore crea un nuovo blocco di testo classico nel punto cliccato
      createTextBlock({ x: world.x, y: world.y - 12 }, { variant: 'plain' });
    }
  };

  // ---------------------------------------------------------------- drag & drop of files & blocks
  const onDragOver = (e: React.DragEvent) => {
    const types = Array.from(e.dataTransfer.types);
    if (types.includes('Files') || types.includes('application/x-glassnote-image-block')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = types.includes('application/x-glassnote-image-block') ? 'move' : 'copy';
      setIsDraggingImage(true);
      checkAutoScroll(e.clientX, e.clientY);
      const world = toWorld(e.clientX, e.clientY);
      if (!html5DragCache.current) {
        const cur = useStore.getState().currentPage();
        if (cur) html5DragCache.current = createContainerDropCache(cur);
      }
      if (html5DragCache.current) {
        const target = findTargetContainerAt(html5DragCache.current, world);
        if (target) {
          const targetEl = containerRef.current?.querySelector(`.text-item[data-id="${target.id}"]`) as HTMLElement | null;
          const dropPos = computeBlockDropPosition(target.item, world, targetEl);
          activeDropTarget.current = dropPos;
          setPreview({ dropIndicator: dropPos });
        } else {
          activeDropTarget.current = null;
          setPreview({});
        }
      }
    }
  };

  const onDragLeave = () => {
    cancelAutoScroll();
    setIsDraggingImage(false);
    activeDropTarget.current = null;
    html5DragCache.current = null;
    setPreview({});
  };

  const onDrop = (e: React.DragEvent) => {
    cancelAutoScroll();
    setIsDraggingImage(false);
    html5DragCache.current = null;
    const customData = e.dataTransfer.getData('application/x-glassnote-image-block');
    if (customData) {
      e.preventDefault();
      setPreview({});
      try {
        const payload = JSON.parse(customData);
        if (payload?.attrs) {
          const world = toWorld(e.clientX, e.clientY);
          const st = useStore.getState();
          const cur = st.currentPage();
          if (!cur) return;
          const dropTarget = activeDropTarget.current;
          activeDropTarget.current = null;
          if (dropTarget && dropTarget.container.id !== payload.containerId) {
            st.updatePage((p) => P.moveImageIntoContainer(p, payload.containerId, dropTarget.container.id, payload.attrs, dropTarget.insertIndex));
            requestFocusAfterAsset(payload.attrs.assetId);
            enterEdit(dropTarget.container.id, null, null);
          } else {
            const hit = hitAt(cur, world, 0);
            if (hit && (hit.type === 'container' || hit.type === 'text') && hit.id !== payload.containerId) {
              st.updatePage((p) => P.moveImageIntoContainer(p, payload.containerId, hit.id, payload.attrs));
              requestFocusAfterAsset(payload.attrs.assetId);
              enterEdit(hit.id, null, null);
            } else {
              const { page: nextPg, newId } = P.moveImageToCanvas(cur, payload.containerId, payload.attrs, world);
              st.updatePage(() => nextPg);
              st.setSelection([newId]);
            }
          }
        }
      } catch (err) {
        console.error('Failed to parse dropped image block', err);
      }
      return;
    }
    const dropTarget = activeDropTarget.current;
    activeDropTarget.current = null;
    setPreview({});
    const files = Array.from(e.dataTransfer.files);
    if (!files.length) return;
    e.preventDefault();
    const world = toWorld(e.clientX, e.clientY);
    if (dropTarget) {
      void insertImageFiles(files, world, {
        containerId: dropTarget.container.id,
        insertIndex: dropTarget.insertIndex,
      });
    } else {
      const cur = useStore.getState().currentPage();
      const hit = cur ? hitAt(cur, world, 0, { types: ['container', 'text'] }) : null;
      if (hit && (hit.type === 'container' || hit.type === 'text') && !isFreeImageContainer(hit)) {
        const targetEl = containerRef.current?.querySelector(`.text-item[data-id="${hit.id}"]`) as HTMLElement | null;
        const computed = computeBlockDropPosition(hit as NoteContainerItem, world, targetEl);
        void insertImageFiles(files, world, {
          containerId: hit.id,
          insertIndex: computed.insertIndex,
        });
      } else {
        void insertImageFiles(files, world);
      }
    }
  };

  // ---------------------------------------------------------------- text block callbacks
  const updateTextDoc = useCallback((pid: ID, id: ID, doc: JSONContent) => {
    useStore.getState().updatePage(
      (p) => {
        const next = P.updateItems(p, { [id]: { doc } });
        const activeEdit = useStore.getState().editingId;
        return activeEdit === id ? next : P.pruneEmptyTextItems(next, activeEdit);
      },
      false,
      pid,
    );
  }, []);

  const onExitEditing = useCallback((reason: 'escape' | 'blur' | 'undo') => {
    if (reason === 'undo') {
      editBefore.current = null;
    }
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
    if (st.editingId) {
      finishEditing(st.editingId);
      if (tool !== 'select') st.setSelection([]);
    }
    setPreview({});
  }, [tool]);

  // Opening an external modal dialog (PDF, Shortcuts, Settings, Search, Templates, Confirm...)
  // ends text editing cleanly. Prompts with `keepEditing` (equations, links, wiki-links)
  // operate on the active text block and must keep the editor mounted.
  const externalModalOpen = useUI((s) =>
    !!(
      s.confirm ||
      (s.prompt && !s.prompt.keepEditing) ||
      s.searchOpen ||
      s.settingsOpen ||
      s.exportOpen ||
      s.trashOpen ||
      s.pdfDialogOpen ||
      s.templatePickerOpen ||
      s.shortcutsOpen
    ),
  );
  useEffect(() => {
    if (externalModalOpen) {
      setSpaceDown(false);
      const st = useStore.getState();
      if (st.editingId) {
        finishEditing(st.editingId);
        st.setSelection([]);
      }
    }
  }, [externalModalOpen]);

  const editingSlot = useCallback(
    (t: TextItem) => <EditableRichText key={t.id} id={t.id} initial={t.doc} onChange={(doc) => pageId && updateTextDoc(pageId, t.id, doc)} onExit={onExitEditing} />,
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
        if (!it || (it.type !== 'text' && it.type !== 'container')) continue;
        const elTarget = en.target as HTMLElement;
        const h = Math.round(elTarget.offsetHeight);
        const w = Math.round(elTarget.offsetWidth);
        const patch: Partial<TextItem> = {};
        if (Math.abs(h - it.h) > 1) patch.h = h;
        if (!it.customW && Math.abs(w - it.w) > 2) patch.w = w;
        if (Object.keys(patch).length) patches[it.id] = patch;
      }
      if (Object.keys(patches).length) {
        // Measured dimensions are layout data, not user edits: update without history/dirty noise.
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

  const layouts = useMemo(() => (page ? computeSheetLayouts(page) : []), [page]);
  const [sheetMenu, setSheetMenu] = useState<{ index: number; x: number; y: number } | null>(null);

  useEffect(() => {
    if (!sheetMenu) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!(e.target as HTMLElement | null)?.closest('[data-testid="sheet-context-menu"]')) {
        setSheetMenu(null);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSheetMenu(null);
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [sheetMenu]);

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
      case 'container':
        return <TextView key={id} item={it as unknown as TextItem} z={z} editingSlot={editingId === id ? editingSlot(it as unknown as TextItem) : undefined} />;
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

  const firstLayout = layouts[0];
  const isPdfPage = isPdfDocument(page);
  const sLeft = sheetLeft(page);
  const sRight = sheetRight(page);

  return (
    <div
      ref={containerRef}
      className={`canvas paper-${bg.paper}${isDraggingImage ? ' is-dragging-image' : ''}`}
      data-canvas-root
      data-testid="canvas"
      tabIndex={0}
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onScroll={(e) => {
        if (e.currentTarget.scrollTop !== 0) e.currentTarget.scrollTop = 0;
        if (e.currentTarget.scrollLeft !== 0) e.currentTarget.scrollLeft = 0;
      }}
      onPointerLeave={() => (tool === 'eraser' || tool === 'connector') && !gesture.current && setPreview({})}
      onDoubleClick={onDoubleClick}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onContextMenu={(e) => {
        e.preventDefault();
        const target = e.target as HTMLElement | null;
        if (target?.closest('[data-ui], .menu')) return;
        const el = containerRef.current;
        if (!el || !page) return;
        const worldPt = toWorld(e.clientX, e.clientY);
        const sheetAttr = target?.closest<HTMLElement>('[data-sheet-index]')?.dataset.sheetIndex;
        const attrIdx = sheetAttr !== undefined ? Number(sheetAttr) : NaN;
        const hit = Number.isInteger(attrIdx) && layouts[attrIdx]
          ? layouts[attrIdx]
          : layouts.find(
              (l) => worldPt.x >= l.x && worldPt.x <= l.x + l.w && worldPt.y >= l.y && worldPt.y <= l.y + l.h,
            );
        if (!hit) {
          setSheetMenu(null);
          return;
        }
        setSheetMenu({ index: hit.index, x: e.clientX, y: e.clientY });
      }}
    >
      <div className="world" style={{ transform: `translate(${-vp.x * vp.zoom}px, ${-vp.y * vp.zoom}px) scale(${vp.zoom})` }}>
        {layouts.map((l) => (
          <CanvasSheet
            key={l.sheet.id}
            sheet={l.sheet}
            index={l.index}
            totalSheets={layouts.length}
            x={l.x}
            y={l.y}
            w={l.w}
            h={l.h}
            bg={bg}
          />
        ))}

        {!isPdfPage && <SheetTitle pageId={pageId} leftOffset={firstLayout?.x ?? 0} />}
        {!isPdfPage && page.order.length === 0 && !editingId && (
          <div className="sheet-hint" style={{ left: (firstLayout?.x ?? 0) + BODY_START.x + 8, top: BODY_START.y + 6 }} aria-hidden>
            Fai clic qui per scrivere · ⌘V incolla un’immagine · P penna
          </div>
        )}
        {items}
        {preview.dropIndicator && (
          <>
            <div
              className="container-drop-target-glow"
              style={{
                left: preview.dropIndicator.containerBounds.x - 4,
                top: preview.dropIndicator.containerBounds.y - 4,
                width: preview.dropIndicator.containerBounds.w + 8,
                height: preview.dropIndicator.containerBounds.h + 8,
              }}
            />
            <div
              className="container-drop-insertion-line"
              style={{
                left: preview.dropIndicator.line.x1,
                top: preview.dropIndicator.line.y1 - 1.5,
                width: Math.max(20, preview.dropIndicator.line.x2 - preview.dropIndicator.line.x1),
              }}
            />
          </>
        )}
        <svg className="preview-layer" overflow="visible" width="1" height="1">
          {(tool === 'connector' || preview.connector) &&
            page.order.map((id) => {
              const it = page.items[id];
              if (!it || it.parentId || it.type === 'connector') return null;
              const isHighlighted =
                preview.connectorHover?.itemId === id ||
                preview.connector?.sourceId === id ||
                preview.connector?.targetId === id;
              const strokeOpacity = isHighlighted ? 0.85 : 0.35;
              const sw = (isHighlighted ? 1.75 : 1.25) / vp.zoom;
              const dash = `${5 / vp.zoom} ${3 / vp.zoom}`;
              if (it.type === 'image' && it.rotation) {
                const pts = [fromImageLocal(it, 0, 0), fromImageLocal(it, 1, 0), fromImageLocal(it, 1, 1), fromImageLocal(it, 0, 1)];
                return (
                  <polygon
                    key={`perim-${id}`}
                    points={pts.map((p) => `${p.x},${p.y}`).join(' ')}
                    fill="none"
                    stroke={settings.connectorColor}
                    strokeWidth={sw}
                    strokeDasharray={dash}
                    strokeOpacity={strokeOpacity}
                  />
                );
              }
              const r = itemBounds(it, page.items);
              return (
                <rect
                  key={`perim-${id}`}
                  x={r.x}
                  y={r.y}
                  width={r.w}
                  height={r.h}
                  rx={4 / vp.zoom}
                  fill="none"
                  stroke={settings.connectorColor}
                  strokeWidth={sw}
                  strokeDasharray={dash}
                  strokeOpacity={strokeOpacity}
                />
              );
            })}
          {preview.connectorHover && !preview.connector && (
            <circle
              cx={preview.connectorHover.anchor.x}
              cy={preview.connectorHover.anchor.y}
              r={5.5 / vp.zoom}
              fill={settings.connectorColor}
              stroke="#fff"
              strokeWidth={1.5 / vp.zoom}
            />
          )}
          {preview.stroke && (
            <path d={preview.stroke.d} fill="none" stroke={preview.stroke.color} strokeWidth={preview.stroke.width} strokeOpacity={preview.stroke.opacity} strokeLinecap={preview.stroke.highlighter ? 'butt' : 'round'} strokeLinejoin="round" style={preview.stroke.highlighter ? { mixBlendMode: 'multiply' } : undefined} />
          )}
          {preview.shape && shapeElement(preview.shape)}
          {preview.connector && (
            <>
              {connectorElement({ id: 'p', type: 'connector', fromId: '', toId: '', fromAnchor: 'auto', toAnchor: 'auto', arrow: 'end', color: settings.connectorColor, width: settings.connectorWidth, layer: 'front' }, preview.connector.from, preview.connector.to)}
              {preview.connector.fromAnchor && (
                <circle
                  cx={preview.connector.fromAnchor.x}
                  cy={preview.connector.fromAnchor.y}
                  r={5 / vp.zoom}
                  fill="#fff"
                  stroke={settings.connectorColor}
                  strokeWidth={2 / vp.zoom}
                />
              )}
              {preview.connector.anchor && (
                <circle
                  cx={preview.connector.anchor.x}
                  cy={preview.connector.anchor.y}
                  r={6 / vp.zoom}
                  fill={settings.connectorColor}
                  stroke="#fff"
                  strokeWidth={1.5 / vp.zoom}
                />
              )}
            </>
          )}
          {preview.guides?.map((g, i) => <line key={i} x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2} className="guide" strokeWidth={1 / vp.zoom} />)}
          {preview.marquee && <rect className="marquee" x={preview.marquee.x} y={preview.marquee.y} width={preview.marquee.w} height={preview.marquee.h} strokeWidth={1 / vp.zoom} />}
          {preview.eraser && tool === 'eraser' && <circle className="eraser-cursor" cx={preview.eraser.x} cy={preview.eraser.y} r={8 / vp.zoom} strokeWidth={1.5 / vp.zoom} />}
        </svg>
      </div>
      <SelectionOverlay page={page} selection={selection} editingId={editingId} vp={vp} tool={tool} />
      <ScrollBars vp={vp} width={containerRef.current?.clientWidth ?? 1000} height={containerRef.current?.clientHeight ?? 700} left={sLeft} right={sRight} bottom={sheetBottom(page)} />
      {sheetMenu &&
        createPortal(
          <div
            className="menu"
            data-ui="true"
            data-testid="sheet-context-menu"
            style={{
              position: 'fixed',
              left: Math.min(sheetMenu.x, window.innerWidth - 220),
              top: Math.min(sheetMenu.y, window.innerHeight - 110),
              zIndex: 200,
            }}
            role="menu"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="menu-item"
              data-testid="sheet-ctx-add-below"
              onClick={() => {
                const idx = sheetMenu.index;
                const target = layouts[idx];
                setSheetMenu(null);
                const st = useStore.getState();
                if (st.editingId) finishEditing(st.editingId);
                if (st.selection.length) st.setSelection([]);
                if (target) {
                  st.insertSheetAfterCurrent(idx, { width: target.sheet.width, height: target.sheet.height, type: 'blank' });
                }
              }}
            >
              <Plus size={14} />
              <span>Aggiungi foglio sotto</span>
            </button>
            <button
              type="button"
              className="menu-item danger"
              data-testid="sheet-ctx-remove"
              disabled={layouts.length <= 1}
              title={layouts.length <= 1 ? 'Non puoi rimuovere l’unico foglio della pagina' : 'Rimuovi questo foglio'}
              onClick={() => {
                const idx = sheetMenu.index;
                setSheetMenu(null);
                useStore.getState().removeSheetFromCurrent(idx);
              }}
            >
              <Trash2 size={14} />
              <span>Rimuovi foglio</span>
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}

function SelectionOverlay({ page, selection, editingId, vp, tool }: { page: PageContent; selection: ID[]; editingId: ID | null; vp: { x: number; y: number; zoom: number }; tool: Tool }) {
  const modalOpen = useUI(isModalOpen);
  const singleLinearShape =
    selection.length === 1 &&
    page.items[selection[0]]?.type === 'shape' &&
    (page.items[selection[0]] as ShapeItem).kind !== 'rect' &&
    (page.items[selection[0]] as ShapeItem).kind !== 'ellipse';
  if (modalOpen || (tool !== 'select' && !editingId && !singleLinearShape)) return null;
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
      const isEditingThis = (it.type === 'text' || it.type === 'container') && editingId === id;
      if (!isEditingThis) {
        const r = itemBounds(it, page.items);
        const s = toScreen(r);
        nodes.push(<div key={id} className={`sel-box${it.locked ? ' locked' : ''}`} style={{ left: s.x - 3, top: s.y - 3, width: r.w * vp.zoom + 6, height: r.h * vp.zoom + 6 }} />);
      }
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
    } else if (it.type === 'shape' && it.kind !== 'rect' && it.kind !== 'ellipse') {
      const parent = it.parentId ? page.items[it.parentId] : undefined;
      const mapPt = (pt: Point): Point => (parent && parent.type === 'image' ? fromImageLocal(parent, pt.x, pt.y) : pt);
      nodes.push(handle('p1', toScreen(mapPt({ x: it.x1, y: it.y1 })), 'round'));
      nodes.push(handle('p2', toScreen(mapPt({ x: it.x2, y: it.y2 })), 'round'));
      const bm = it.bend ?? { x: (it.x1 + it.x2) / 2, y: (it.y1 + it.y2) / 2 };
      nodes.push(<div key="bend" data-handle="bend" data-ui-handle className="handle round bend" style={{ left: toScreen(mapPt(bm)).x, top: toScreen(mapPt(bm)).y }} title="Trascina per curvare la freccia" />);
    } else if (!it.parentId) {
      if (it.type === 'container' && isFreeImageContainer(it)) {
        const r = itemBounds(it, page.items);
        nodes.push(handle('nw', toScreen({ x: r.x, y: r.y })));
        nodes.push(handle('ne', toScreen({ x: r.x + r.w, y: r.y })));
        nodes.push(handle('sw', toScreen({ x: r.x, y: r.y + r.h })));
        nodes.push(handle('se', toScreen({ x: r.x + r.w, y: r.y + r.h })));
      } else if (it.type === 'text' || it.type === 'container') {
        const r = itemBounds(it, page.items);
        const editing = editingId === it.id;
        nodes.push(handle('w', toScreen({ x: r.x, y: r.y + r.h / 2 }), editing ? 'side subtle' : 'side'));
        nodes.push(handle('e', toScreen({ x: r.x + r.w, y: r.y + r.h / 2 }), editing ? 'side subtle' : 'side'));
        if (editing) nodes.push(handle('grip', toScreen({ x: r.x + r.w / 2, y: r.y }), 'grip subtle'));
      } else if (it.type === 'image') {
        nodes.push(handle('nw', toScreen(fromImageLocal(it, 0, 0))));
        nodes.push(handle('ne', toScreen(fromImageLocal(it, 1, 0))));
        nodes.push(handle('sw', toScreen(fromImageLocal(it, 0, 1))));
        nodes.push(handle('se', toScreen(fromImageLocal(it, 1, 1))));
      } else if (it.type === 'shape') {
        const minX = Math.min(it.x1, it.x2);
        const maxX = Math.max(it.x1, it.x2);
        const minY = Math.min(it.y1, it.y2);
        const maxY = Math.max(it.y1, it.y2);
        nodes.push(handle('nw', toScreen({ x: minX, y: minY })));
        nodes.push(handle('ne', toScreen({ x: maxX, y: minY })));
        nodes.push(handle('sw', toScreen({ x: minX, y: maxY })));
        nodes.push(handle('se', toScreen({ x: maxX, y: maxY })));
      }
    }
  }
  return <div className="selection-overlay">{nodes}</div>;
}
