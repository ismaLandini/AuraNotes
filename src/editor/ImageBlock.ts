import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { ImageBlockView } from './ImageBlockView';
import type { ImageBlockAttrs } from '../types';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    imageBlock: {
      setImageBlock: (attributes: ImageBlockAttrs) => ReturnType;
      updateImageBlock: (attributes: Partial<ImageBlockAttrs>) => ReturnType;
    };
  }
}

export const ImageBlock = Node.create({
  name: 'imageBlock',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  defining: true,

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-id'),
        renderHTML: (attrs) => (attrs.id ? { 'data-id': attrs.id } : {}),
      },
      assetId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-asset-id'),
        renderHTML: (attrs) => (attrs.assetId ? { 'data-asset-id': attrs.assetId } : {}),
      },
      width: {
        default: null,
        parseHTML: (el) => (el.getAttribute('data-width') ? Number(el.getAttribute('data-width')) : null),
        renderHTML: (attrs) => (attrs.width ? { 'data-width': attrs.width } : {}),
      },
      naturalWidth: {
        default: null,
        parseHTML: (el) => (el.getAttribute('data-natural-width') ? Number(el.getAttribute('data-natural-width')) : null),
        renderHTML: (attrs) => (attrs.naturalWidth ? { 'data-natural-width': attrs.naturalWidth } : {}),
      },
      naturalHeight: {
        default: null,
        parseHTML: (el) => (el.getAttribute('data-natural-height') ? Number(el.getAttribute('data-natural-height')) : null),
        renderHTML: (attrs) => (attrs.naturalHeight ? { 'data-natural-height': attrs.naturalHeight } : {}),
      },
      mime: {
        default: 'image/png',
        parseHTML: (el) => el.getAttribute('data-mime') || 'image/png',
        renderHTML: (attrs) => (attrs.mime ? { 'data-mime': attrs.mime } : {}),
      },
      rotation: {
        default: 0,
        parseHTML: (el) => Number(el.getAttribute('data-rotation') || 0),
        renderHTML: (attrs) => (attrs.rotation ? { 'data-rotation': attrs.rotation } : {}),
      },
      indent: {
        default: 0,
        parseHTML: (el) => Number(el.getAttribute('data-indent') || 0),
        renderHTML: (attrs) => (attrs.indent ? { 'data-indent': attrs.indent } : {}),
      },
      alt: {
        default: '',
        parseHTML: (el) => el.getAttribute('alt') || '',
        renderHTML: (attrs) => (attrs.alt ? { alt: attrs.alt } : {}),
      },
      annotations: {
        default: [],
        parseHTML: (el) => {
          const raw = el.getAttribute('data-annotations');
          if (!raw) return [];
          try {
            const parsed = JSON.parse(raw) as unknown;
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return [];
          }
        },
        renderHTML: (attrs) =>
          Array.isArray(attrs.annotations) && attrs.annotations.length > 0
            ? { 'data-annotations': JSON.stringify(attrs.annotations) }
            : {},
      },
      source: {
        default: null,
        parseHTML: (el) => {
          const raw = el.getAttribute('data-source');
          if (!raw) return null;
          try {
            const parsed = JSON.parse(raw) as unknown;
            if (
              parsed &&
              typeof parsed === 'object' &&
              (parsed as Record<string, unknown>).type === 'pdf' &&
              typeof (parsed as Record<string, unknown>).assetId === 'string' &&
              typeof (parsed as Record<string, unknown>).page === 'number'
            ) {
              return parsed;
            }
          } catch {
            /* ignore invalid data-source */
          }
          return null;
        },
        renderHTML: (attrs) => (attrs.source ? { 'data-source': JSON.stringify(attrs.source) } : {}),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="image-block"]',
      },
      {
        tag: 'figure[data-type="image-block"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'image-block', class: 'image-block-static' })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageBlockView);
  },

  addCommands() {
    return {
      setImageBlock:
        (attributes) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: attributes,
          });
        },
      updateImageBlock:
        (attributes) =>
        ({ commands }) => {
          return commands.updateAttributes(this.name, attributes);
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { state } = editor;
        const { selection } = state;
        const node = (selection as { node?: { type: { name: string }; attrs?: { indent?: number } } }).node;
        if (node?.type.name === this.name) {
          const indent = node.attrs?.indent || 0;
          return editor.commands.insertContentAt(selection.to, {
            type: 'paragraph',
            attrs: indent ? { indent } : {},
          });
        }
        return false;
      },
      Backspace: ({ editor }) => {
        const { state } = editor;
        const { selection } = state;
        const node = (selection as { node?: { type: { name: string } } }).node;
        if (node?.type.name === this.name) {
          return editor.commands.deleteSelection();
        }
        return false;
      },
      Delete: ({ editor }) => {
        const { state } = editor;
        const { selection } = state;
        const node = (selection as { node?: { type: { name: string } } }).node;
        if (node?.type.name === this.name) {
          return editor.commands.deleteSelection();
        }
        return false;
      },
    };
  },
});
