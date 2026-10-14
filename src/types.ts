import type { JSONContent } from '@tiptap/core';

export type ID = string;

export const SCHEMA_VERSION = 1;

export interface Notebook {
  id: ID;
  name: string;
  color: string;
  sectionIds: ID[];
  createdAt: number;
  updatedAt: number;
}

export interface Section {
  id: ID;
  notebookId: ID;
  name: string;
  color: string;
  pageIds: ID[];
  createdAt: number;
  updatedAt: number;
}

export interface PageMeta {
  id: ID;
  sectionId: ID;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** Plain text of all text blocks, used for global search. */
  searchText: string;
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

export type CanvasItem = TextItem | ImageItem | StrokeItem | ShapeItem | ConnectorItem;
export type ItemType = CanvasItem['type'];

export interface PageBackground {
  pattern: BackgroundPattern;
  paper: PaperColor;
}

export interface PageContent {
  id: ID;
  schemaVersion: number;
  items: Record<ID, CanvasItem>;
  /** z-order, bottom first */
  order: ID[];
  background?: PageBackground;
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
