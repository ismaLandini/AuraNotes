import type { JSONContent } from '@tiptap/core';

export type ID = string;

export const SCHEMA_VERSION = 3;

export interface Notebook {
  id: ID;
  name: string;
  color: string;
  sectionIds: ID[];
  createdAt: number;
  updatedAt: number;
  starred?: boolean;
}

export type PageSortOrder =
  | 'manual'
  | 'title-asc'
  | 'title-desc'
  | 'created-desc'
  | 'created-asc'
  | 'updated-desc'
  | 'updated-asc';

export interface Section {
  id: ID;
  notebookId: ID;
  name: string;
  color: string;
  pageIds: ID[];
  pageSort?: PageSortOrder;
  createdAt: number;
  updatedAt: number;
  starred?: boolean;
}

export interface PageMeta {
  id: ID;
  sectionId: ID;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** Plain text of all text blocks, used for global search. */
  searchText: string;
  /** Optional normalised tags (e.g. ['esame', 'importante']). */
  tags?: string[];
  starred?: boolean;
  sheetCount?: number;
  firstSheetType?: 'blank' | 'pdf';
  pdfAssetId?: ID;
}

export interface TrashEntry {
  page: PageMeta;
  deletedAt: number;
  fromSectionId: ID;
  fromNotebookId: ID;
  fromSectionName: string;
}

export interface Workspace {
  schemaVersion: number;
  notebookIds: ID[];
  notebooks: Record<ID, Notebook>;
  sections: Record<ID, Section>;
  pages: Record<ID, PageMeta>;
  trash: TrashEntry[];
}

export type SideAnchor = 'top' | 'right' | 'bottom' | 'left';
/**
 * Where a connector attaches to an item:
 * - 'auto': nearest point of the boundary facing the other end
 * - a side: midpoint of that side (older data)
 * - { x, y }: a fixed point on the perimeter, normalised to the item's box (0..1),
 *   so it follows moves and resizes.
 */
export type Anchor = 'auto' | SideAnchor | { x: number; y: number };
export type ShapeKind = 'line' | 'arrow' | 'double-arrow' | 'rect' | 'ellipse';
export type BackgroundPattern = 'plain' | 'dots' | 'grid' | 'lines';
export type PaperColor = 'white' | 'warm' | 'cool' | 'dark';

interface BaseItem {
  id: ID;
  locked?: boolean;
  /**
   * When set, the item is an annotation attached to an image. Geometry is then
   * expressed in the image's local, normalised frame (0..1 on both axes, before rotation).
   */
  parentId?: ID;
  /** Items sharing a groupId are selected, moved and deleted together. */
  groupId?: ID;
}

export interface PdfSourceAttr {
  type: 'pdf';
  assetId: ID;
  page: number;
  /** 'live' indicates on-demand vector rendering; absent for legacy rasterized imports */
  mode?: 'live';
}

export interface ImageBlockAttrs {
  id?: ID;
  /**
   * Reference to stored raster image asset in IndexedDB.
   * For live on-demand vector PDF blocks, this is set to empty string `''`
   * and the page is rendered dynamically using `source.assetId`.
   */
  assetId: ID;
  width: number;
  naturalWidth: number;
  naturalHeight: number;
  mime?: string;
  rotation?: number;
  indent?: number; // 0..8
  alt?: string;
  annotations?: CanvasItem[];
  source?: PdfSourceAttr | null;
}

/**
 * Top-level Note Container (OneNote-style container).
 * Holds a unified TipTap document where paragraphs, headings, tables,
 * math, and image blocks live in a single continuous flow.
 */
export interface NoteContainerItem extends BaseItem {
  type: 'container';
  x: number;
  y: number;
  w: number;
  /** Last measured rendered height (kept in sync, not part of undo history semantics). */
  h: number;
  doc: JSONContent;
  variant?: 'plain' | 'sticky';
  bg?: string;
  /** Whether the width was manually chosen by the user via resizing (so auto-width does not override it). */
  customW?: boolean;
  /** When true, this container is a free-standing image on the canvas. */
  freeImage?: boolean;
  createdAt?: number;
  updatedAt?: number;
}

export interface TextItem extends BaseItem {
  type: 'text';
  x: number;
  y: number;
  w: number;
  /** Last measured rendered height (kept in sync, not part of undo history semantics). */
  h: number;
  doc: JSONContent;
  variant: 'plain' | 'sticky';
  bg?: string;
  /** Whether the width was manually chosen by the user via resizing (so auto-width does not override it). */
  customW?: boolean;
}

export interface ImageItem extends BaseItem {
  type: 'image';
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  assetId: ID;
  naturalWidth: number;
  naturalHeight: number;
  mime: string;
}

export interface StrokeItem extends BaseItem {
  type: 'stroke';
  /** Flat list x0,y0,x1,y1,... */
  points: number[];
  color: string;
  width: number;
  opacity: number;
  tool: 'pen' | 'highlighter';
}

export interface ShapeItem extends BaseItem {
  type: 'shape';
  kind: ShapeKind;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  width: number;
  opacity: number;
  fill: string | null;
  /** Point the (line/arrow) curve passes through at its middle; absent = straight. */
  bend?: { x: number; y: number };
}

export interface ConnectorItem extends BaseItem {
  type: 'connector';
  fromId: ID;
  toId: ID;
  fromAnchor: Anchor;
  toAnchor: Anchor;
  arrow: 'none' | 'end' | 'both';
  color: string;
  width: number;
  /** Render behind (default) or in front of other objects. */
  layer: 'back' | 'front';
}

export type CanvasItem = NoteContainerItem | TextItem | ImageItem | StrokeItem | ShapeItem | ConnectorItem;
export type ItemType = CanvasItem['type'];

export interface PageBackground {
  pattern: BackgroundPattern;
  paper: PaperColor;
}

export interface SheetDef {
  id: ID;
  width: number;
  height: number;
  type: 'blank' | 'pdf';
  /** 1-based page number if type === 'pdf' */
  pdfPage?: number;
  /** Binary PDF asset ID in IndexedDB if type === 'pdf' */
  pdfAssetId?: ID;
}

export interface PageContent {
  id: ID;
  schemaVersion: number;
  items: Record<ID, CanvasItem>;
  /** z-order, bottom first */
  order: ID[];
  background?: PageBackground;
  /** Ordered sheets contained in this document/page. */
  sheets?: SheetDef[];
  /** Optional reference to an imported PDF document asset */
  pdfAssetId?: ID;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

export type Tool =
  | 'select'
  | 'hand'
  | 'text'
  | 'sticky'
  | 'pen'
  | 'highlighter'
  | 'eraser'
  | 'line'
  | 'arrow'
  | 'double-arrow'
  | 'rect'
  | 'ellipse'
  | 'connector';

export interface Viewport {
  x: number; // world coordinate at the left edge of the screen
  y: number;
  zoom: number;
}
