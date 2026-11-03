import { Extension } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

export interface ParagraphFormatAttrs {
  lineHeight: string | null;
  spaceBefore: number | null;
  spaceAfter: number | null;
  leftIndent: number | null;
  firstLineIndent: number | null;
  letterSpacing: number | null;
  textAlign: string | null;
}

export type MixedOr<T> = T | 'mixed';

export interface ParagraphFormatState {
  lineHeight: MixedOr<string | null>;
  spaceBefore: MixedOr<number | null>;
  spaceAfter: MixedOr<number | null>;
  leftIndent: MixedOr<number | null>;
  firstLineIndent: MixedOr<number | null>;
  letterSpacing: MixedOr<number | null>;
  textAlign: MixedOr<string | null>;
  hasSelection: boolean;
  hasTextSelection: boolean;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    paragraphFormat: {
      setParagraphFormat: (attributes: Partial<ParagraphFormatAttrs>) => ReturnType;
      resetParagraphFormat: () => ReturnType;
    };
  }
}

export const ParagraphFormat = Extension.create({
  name: 'paragraphFormat',

  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading'],
        attributes: {
          lineHeight: {
            default: null,
            parseHTML: (el) => el.style.lineHeight || null,
            renderHTML: (attrs) => (attrs.lineHeight ? { style: `line-height: ${attrs.lineHeight}` } : {}),
          },
          spaceBefore: {
            default: null,
            parseHTML: (el) => {
              const data = el.getAttribute('data-space-before');
              if (data !== null) return parseFloat(data);
              if (el.style.marginTop) return parseFloat(el.style.marginTop);
              return null;
            },
            renderHTML: (attrs) =>
              attrs.spaceBefore != null && attrs.spaceBefore > 0
                ? { 'data-space-before': String(attrs.spaceBefore), style: `margin-top: ${attrs.spaceBefore}pt` }
                : {},
          },
          spaceAfter: {
            default: null,
            parseHTML: (el) => {
              const data = el.getAttribute('data-space-after');
              if (data !== null) return parseFloat(data);
              if (el.style.marginBottom) return parseFloat(el.style.marginBottom);
              return null;
            },
            renderHTML: (attrs) =>
              attrs.spaceAfter != null
                ? { 'data-space-after': String(attrs.spaceAfter), style: `margin-bottom: ${attrs.spaceAfter}pt` }
                : {},
          },
          leftIndent: {
            default: null,
            parseHTML: (el) => {
              const data = el.getAttribute('data-left-indent');
              if (data !== null) return parseFloat(data);
              if (el.style.paddingLeft) return parseFloat(el.style.paddingLeft);
              return null;
            },
            renderHTML: (attrs) =>
              attrs.leftIndent != null && attrs.leftIndent > 0
                ? { 'data-left-indent': String(attrs.leftIndent), style: `padding-left: ${attrs.leftIndent}pt` }
                : {},
          },
          firstLineIndent: {
            default: null,
            parseHTML: (el) => {
              const data = el.getAttribute('data-first-line-indent');
              if (data !== null) return parseFloat(data);
              if (el.style.textIndent) return parseFloat(el.style.textIndent);
              return null;
            },
            renderHTML: (attrs) =>
              attrs.firstLineIndent != null && attrs.firstLineIndent !== 0
                ? { 'data-first-line-indent': String(attrs.firstLineIndent), style: `text-indent: ${attrs.firstLineIndent}pt` }
                : {},
          },
          letterSpacing: {
            default: null,
            parseHTML: (el) => {
              const data = el.getAttribute('data-letter-spacing');
              if (data !== null) return parseFloat(data);
              if (el.style.letterSpacing) return parseFloat(el.style.letterSpacing);
              return null;
            },
            renderHTML: (attrs) =>
              attrs.letterSpacing != null && attrs.letterSpacing !== 0
                ? { 'data-letter-spacing': String(attrs.letterSpacing), style: `letter-spacing: ${attrs.letterSpacing}pt` }
                : {},
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setParagraphFormat:
        (attributes) =>
        ({ tr, state }) => {
          const { from, to } = state.selection;
          let changed = false;

          const targets: Array<{ pos: number; node: ProseMirrorNode }> = [];
          state.doc.nodesBetween(from, to, (node, pos) => {
            if (node.type.name === 'paragraph' || node.type.name === 'heading') {
              targets.push({ pos, node });
              return false;
            }
            if (node.type.name === 'imageBlock') {
              targets.push({ pos, node });
              return false;
            }
            return true;
          });

          if (targets.length === 0) {
            const $from = state.selection.$from;
            for (let d = $from.depth; d > 0; d--) {
              const n = $from.node(d);
              if (n.type.name === 'paragraph' || n.type.name === 'heading') {
                targets.push({ pos: $from.before(d), node: n });
                break;
              }
            }
          }

          for (const { pos, node } of targets) {
            if (node.type.name === 'imageBlock') {
              if (attributes.textAlign !== undefined) {
                const align = attributes.textAlign === 'left' ? null : attributes.textAlign;
                if (node.attrs.textAlign !== align) {
                  tr.setNodeMarkup(pos, undefined, {
                    ...node.attrs,
                    textAlign: align,
                  });
                  changed = true;
                }
              }
            } else {
              const nextAttrs = { ...node.attrs };
              if (attributes.lineHeight !== undefined) nextAttrs.lineHeight = attributes.lineHeight;
              if (attributes.spaceBefore !== undefined) nextAttrs.spaceBefore = attributes.spaceBefore;
              if (attributes.spaceAfter !== undefined) nextAttrs.spaceAfter = attributes.spaceAfter;
              if (attributes.leftIndent !== undefined) nextAttrs.leftIndent = attributes.leftIndent;
              if (attributes.firstLineIndent !== undefined) nextAttrs.firstLineIndent = attributes.firstLineIndent;
              if (attributes.letterSpacing !== undefined) nextAttrs.letterSpacing = attributes.letterSpacing;
              if (attributes.textAlign !== undefined) {
                nextAttrs.textAlign = attributes.textAlign === 'left' ? null : attributes.textAlign;
              }
              tr.setNodeMarkup(pos, undefined, nextAttrs);
              changed = true;
            }
          }

          return changed;
        },

      resetParagraphFormat:
        () =>
        ({ tr, state }) => {
          const { from, to } = state.selection;
          let changed = false;

          const targets: Array<{ pos: number; node: ProseMirrorNode }> = [];
          state.doc.nodesBetween(from, to, (node, pos) => {
            if (node.type.name === 'paragraph' || node.type.name === 'heading' || node.type.name === 'imageBlock') {
              targets.push({ pos, node });
              return false;
            }
            return true;
          });

          if (targets.length === 0) {
            const $from = state.selection.$from;
            for (let d = $from.depth; d > 0; d--) {
              const n = $from.node(d);
              if (n.type.name === 'paragraph' || n.type.name === 'heading') {
                targets.push({ pos: $from.before(d), node: n });
                break;
              }
            }
          }

          for (const { pos, node } of targets) {
            if (node.type.name === 'imageBlock') {
              if (node.attrs.textAlign) {
                tr.setNodeMarkup(pos, undefined, {
                  ...node.attrs,
                  textAlign: null,
                });
                changed = true;
              }
            } else {
              tr.setNodeMarkup(pos, undefined, {
                ...node.attrs,
                lineHeight: null,
                spaceBefore: null,
                spaceAfter: null,
                leftIndent: null,
                firstLineIndent: null,
                letterSpacing: null,
                textAlign: null,
                indent: 0,
              });
              changed = true;
            }
          }

          return changed;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const { state } = this.editor;
        const { selection } = state;
        const node = selection.$from.parent;
        if (node.type.name === 'paragraph' || node.type.name === 'heading') {
          const indent = (node.attrs.indent as number) || 0;
          if (node.content.size === 0 && indent > 0) {
            this.editor.commands.outdent();
            return true;
          }

          const inherited = {
            lineHeight: node.attrs.lineHeight ?? null,
            spaceBefore: node.attrs.spaceBefore ?? null,
            spaceAfter: node.attrs.spaceAfter ?? null,
            leftIndent: node.attrs.leftIndent ?? null,
            firstLineIndent: node.attrs.firstLineIndent ?? null,
            letterSpacing: node.attrs.letterSpacing ?? null,
            textAlign: node.attrs.textAlign ?? null,
            indent: indent > 0 ? indent : 0,
          };

          return this.editor
            .chain()
            .splitBlock({ keepMarks: true })
            .command(({ tr, state: newState }) => {
              const newPos = newState.selection.from;
              const targetNode = newState.doc.resolve(newPos).parent;
              if (targetNode.type.name === 'paragraph') {
                const parentPos = newState.doc.resolve(newPos).before();
                tr.setNodeMarkup(parentPos, undefined, {
                  ...targetNode.attrs,
                  ...inherited,
                });
                return true;
              }
              return false;
            })
            .run();
        }
        return false;
      },
    };
  },
});

export function getParagraphFormatState(editor: Editor | null | undefined): ParagraphFormatState {
  if (!editor || editor.isDestroyed) {
    return {
      lineHeight: null,
      spaceBefore: null,
      spaceAfter: null,
      leftIndent: null,
      firstLineIndent: null,
      letterSpacing: null,
      textAlign: 'left',
      hasSelection: false,
      hasTextSelection: false,
    };
  }

  const { state } = editor;
  const { from, to } = state.selection;
  const nodes: Array<{ attrs: Record<string, unknown>; isImage: boolean }> = [];

  state.doc.nodesBetween(from, to, (node) => {
    if (node.type.name === 'paragraph' || node.type.name === 'heading') {
      nodes.push({ attrs: node.attrs, isImage: false });
      return false;
    }
    if (node.type.name === 'imageBlock') {
      nodes.push({ attrs: node.attrs, isImage: true });
      return false;
    }
    return true;
  });

  if (nodes.length === 0) {
    const $from = state.selection.$from;
    for (let d = $from.depth; d > 0; d--) {
      const n = $from.node(d);
      if (n.type.name === 'paragraph' || n.type.name === 'heading') {
        nodes.push({ attrs: n.attrs, isImage: false });
        break;
      }
    }
  }

  const textNodes = nodes.filter((n) => !n.isImage);

  const getCommon = <T>(
    items: Array<{ attrs: Record<string, unknown> }>,
    getter: (attrs: Record<string, unknown>) => T,
    fallback: T,
  ): MixedOr<T> => {
    if (items.length === 0) return fallback;
    const first = getter(items[0].attrs);
    for (let i = 1; i < items.length; i++) {
      if (getter(items[i].attrs) !== first) {
        return 'mixed';
      }
    }
    return first;
  };

  return {
    lineHeight: getCommon(textNodes, (a) => (a.lineHeight as string) || null, null),
    spaceBefore: getCommon(textNodes, (a) => (a.spaceBefore != null ? Number(a.spaceBefore) : null), null),
    spaceAfter: getCommon(textNodes, (a) => (a.spaceAfter != null ? Number(a.spaceAfter) : null), null),
    leftIndent: getCommon(textNodes, (a) => (a.leftIndent != null ? Number(a.leftIndent) : null), null),
    firstLineIndent: getCommon(textNodes, (a) => (a.firstLineIndent != null ? Number(a.firstLineIndent) : null), null),
    letterSpacing: getCommon(textNodes, (a) => (a.letterSpacing != null ? Number(a.letterSpacing) : null), null),
    textAlign: getCommon(nodes, (a) => (a.textAlign as string) || 'left', 'left'),
    hasSelection: nodes.length > 0,
    hasTextSelection: textNodes.length > 0,
  };
}
