import { create } from 'zustand';
import type { Editor } from '@tiptap/core';

interface ActiveEditorState {
  editor: Editor | null;
  /** Bumped on every editor transaction so toolbars re-render with the right active states. */
  tick: number;
  set: (editor: Editor | null) => void;
}

export const useActiveEditor = create<ActiveEditorState>((set) => ({
  editor: null,
  tick: 0,
  set: (editor) => set({ editor }),
}));

/** Caret position requested by the click that started editing. */
export const pendingCaret: { x: number; y: number } | { x: null; y: null } = { x: null, y: null };

export function requestCaretAt(x: number | null, y: number | null) {
  (pendingCaret as { x: number | null; y: number | null }).x = x;
  (pendingCaret as { x: number | null; y: number | null }).y = y;
}

/** Target node after which caret should be placed on next focus. */
export const pendingFocusTarget: { afterAssetId: string | null } = { afterAssetId: null };

export function requestFocusAfterAsset(assetId: string | null) {
  pendingFocusTarget.afterAssetId = assetId;
}

