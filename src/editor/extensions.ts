import { Extension, Node, mergeAttributes, type Extensions, type JSONContent } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextStyle from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import TextAlign from '@tiptap/extension-text-align';
import Link from '@tiptap/extension-link';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import FontFamily from '@tiptap/extension-font-family';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { common, createLowlight } from 'lowlight';
import katex from 'katex';
import { askText } from '../store/ui';
import { ImageBlock } from './ImageBlock';
import { ParagraphFormat } from './paragraphFormat';

export const lowlight = createLowlight(common);

export function renderLatex(el: HTMLElement, latex: string, displayMode: boolean): void {
  try {
    katex.render(latex || '\\square', el, { displayMode, throwOnError: false, output: 'htmlAndMathml', strict: 'ignore' });
  } catch {
    el.textContent = latex;
  }
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    fontSize: {
      setFontSize: (size: string) => ReturnType;
      unsetFontSize: () => ReturnType;
    };
    indent: {
      indent: () => ReturnType;
      outdent: () => ReturnType;
    };
    math: {
      insertMath: (latex: string, display: boolean) => ReturnType;
    };
  }
}

export const FontSize = Extension.create({
  name: 'fontSize',
  addGlobalAttributes() {
    return [
      {
        types: ['textStyle'],
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (el) => el.style.fontSize || null,
            renderHTML: (attrs) => (attrs.fontSize ? { style: `font-size: ${attrs.fontSize}` } : {}),
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setFontSize:
        (size) =>
        ({ chain }) =>
          chain().setMark('textStyle', { fontSize: size }).run(),
      unsetFontSize:
        () =>
        ({ chain }) =>
          chain().setMark('textStyle', { fontSize: null }).removeEmptyTextStyle().run(),
    };
  },
});

const INDENT_STEP = 24;
const INDENT_MAX = 8;

export const Indent = Extension.create({
  name: 'indent',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading', 'imageBlock'],
        attributes: {
          indent: {
            default: 0,
            parseHTML: (el) => Math.round((parseInt(el.style.marginLeft || '0', 10) || 0) / INDENT_STEP),
            renderHTML: (attrs) => (attrs.indent ? { style: `margin-left: ${attrs.indent * INDENT_STEP}px` } : {}),
          },
        },
      },
    ];
  },
  addCommands() {
    const change =
      (delta: number) =>
      ({ editor, chain }: { editor: import('@tiptap/core').Editor; chain: () => import('@tiptap/core').ChainedCommands }) => {
        if (editor.isActive('listItem')) return delta > 0 ? chain().sinkListItem('listItem').run() : chain().liftListItem('listItem').run();
        if (editor.isActive('taskItem')) return delta > 0 ? chain().sinkListItem('taskItem').run() : chain().liftListItem('taskItem').run();
        return chain()
          .command(({ tr, state }) => {
            const { from, to } = state.selection;
            let changed = false;
            state.doc.nodesBetween(from, to, (node, pos) => {
              if (node.type.name === 'paragraph' || node.type.name === 'heading' || node.type.name === 'imageBlock') {
                const cur = (node.attrs.indent as number) || 0;
                const next = Math.max(0, Math.min(INDENT_MAX, cur + delta));
                if (next !== cur) {
                  tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: next });
                  changed = true;
                }
                return false;
              }
              return true;
            });
            return changed;
          })
          .run();
      };
    return {
      indent: () => (props) => change(1)(props),
      outdent: () => (props) => change(-1)(props),
    };
  },
  addKeyboardShortcuts() {
    return {
      Tab: () => {
        if (this.editor.isActive('codeBlock')) return this.editor.commands.insertContent('  ');
        if (this.editor.isActive('table')) {
          if (this.editor.commands.goToNextCell()) return true;
          if (this.editor.can().addRowAfter()) {
            return this.editor.chain().addRowAfter().goToNextCell().run();
          }
          return true;
        }
        this.editor.commands.indent();
        return true; // keep focus inside the editor
      },
      'Shift-Tab': () => {
        if (this.editor.isActive('table')) {
          return this.editor.commands.goToPreviousCell();
        }
        this.editor.commands.outdent();
        return true;
      },
    };
  },
});

function makeMathNode(display: boolean) {
  return Node.create({
    name: display ? 'mathBlock' : 'mathInline',
    group: display ? 'block' : 'inline',
    inline: !display,
    atom: true,
    selectable: true,
    draggable: false,
    addAttributes() {
      return { latex: { default: '' } };
    },
    parseHTML() {
      const attr = display ? 'data-math-block' : 'data-math-inline';
      return [{ tag: `${display ? 'div' : 'span'}[${attr}]`, getAttrs: (el) => ({ latex: (el as HTMLElement).getAttribute('data-latex') ?? '' }) }];
    },
    renderHTML({ node, HTMLAttributes }) {
      const attr = display ? 'data-math-block' : 'data-math-inline';
      return [display ? 'div' : 'span', mergeAttributes(HTMLAttributes, { [attr]: '', 'data-latex': node.attrs.latex, class: display ? 'math-block' : 'math-inline' }), node.attrs.latex];
    },
    renderText({ node }) {
      return display ? `$$${node.attrs.latex}$$` : `$${node.attrs.latex}$`;
    },
    addNodeView() {
      return ({ node, getPos, editor }) => {
        const dom = document.createElement(display ? 'div' : 'span');
        dom.className = display ? 'math-block' : 'math-inline';
        dom.setAttribute(display ? 'data-math-block' : 'data-math-inline', '');
        dom.contentEditable = 'false';
        let current = node.attrs.latex as string;
        renderLatex(dom, current, display);
        dom.title = 'Clic per modificare l’equazione';
        dom.addEventListener('mousedown', (e) => {
          if (!editor.isEditable) return;
          e.preventDefault();
          e.stopPropagation();
          void askText({ title: 'Modifica equazione', label: 'LaTeX', initial: current, mathPreview: true, multiline: display, confirmLabel: 'Aggiorna' }).then((v) => {
            if (v === null || typeof getPos !== 'function') return;
            const pos = getPos();
            if (typeof pos !== 'number') return;
            if (v.trim() === '') editor.chain().focus().deleteRange({ from: pos, to: pos + 1 }).run();
            else editor.chain().focus().command(({ tr }) => {
              tr.setNodeMarkup(pos, undefined, { latex: v });
              return true;
            }).run();
          });
        });
        return {
          dom,
          update: (updated) => {
            if (updated.type.name !== node.type.name) return false;
            if (updated.attrs.latex !== current) {
              current = updated.attrs.latex as string;
              renderLatex(dom, current, display);
            }
            return true;
          },
          ignoreMutation: () => true,
        };
      };
    },
  });
}

export const MathInline = makeMathNode(false);
export const MathBlock = makeMathNode(true);

export const MathCommands = Extension.create({
  name: 'mathCommands',
  addCommands() {
    return {
      insertMath:
        (latex, display) =>
        ({ chain }) =>
          chain().insertContent({ type: display ? 'mathBlock' : 'mathInline', attrs: { latex } }).run(),
    };
  },
});

const WIKI_LINK_LIVE_RE = /\[\[([^[\]\n]+?)\]\]/g;

export const WikiLinkExtension = Extension.create({
  name: 'wikiLinkDecorations',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          decorations(state) {
            const decos: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (node.type.name === 'codeBlock') return false;
              if (!node.isText || !node.text || !node.text.includes('[[')) return;
              WIKI_LINK_LIVE_RE.lastIndex = 0;
              for (const m of node.text.matchAll(WIKI_LINK_LIVE_RE)) {
                const start = pos + (m.index ?? 0);
                const end = start + m[0].length;
                const target = m[1].trim();
                if (!target) continue;
                decos.push(
                  Decoration.inline(start, end, {
                    class: 'wiki-link-live',
                    'data-wiki-link': target,
                    title: `⌘+Clic per aprire "${target}"`,
                  }),
                );
              }
            });
            return decos.length ? DecorationSet.create(state.doc, decos) : DecorationSet.empty;
          },
        },
      }),
    ];
  },
});

export const HIGHLIGHT_COLORS = ['#ffe066', '#b2f2bb', '#a5d8ff', '#ffc9de', '#ffd8a8', '#d0bfff'];

export const CustomTableCell = TableCell.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      backgroundColor: {
        default: null,
        parseHTML: (el) => el.style.backgroundColor || el.getAttribute('data-background-color') || null,
        renderHTML: (attrs) => {
          if (!attrs.backgroundColor) return {};
          return {
            'data-background-color': attrs.backgroundColor,
            style: `background-color: ${attrs.backgroundColor}`,
          };
        },
      },
    };
  },
});

export const CustomTableHeader = TableHeader.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      backgroundColor: {
        default: null,
        parseHTML: (el) => el.style.backgroundColor || el.getAttribute('data-background-color') || null,
        renderHTML: (attrs) => {
          if (!attrs.backgroundColor) return {};
          return {
            'data-background-color': attrs.backgroundColor,
            style: `background-color: ${attrs.backgroundColor}`,
          };
        },
      },
    };
  },
});

export function createTableDoc(rows = 3, cols = 3, withHeaderRow = true): JSONContent {
  const content: JSONContent[] = [];
  for (let r = 0; r < rows; r++) {
    const isHeader = withHeaderRow && r === 0;
    const rowContent: JSONContent[] = [];
    for (let c = 0; c < cols; c++) {
      rowContent.push({
        type: isHeader ? 'tableHeader' : 'tableCell',
        content: [{ type: 'paragraph' }],
      });
    }
    content.push({ type: 'tableRow', content: rowContent });
  }
  return {
    type: 'doc',
    content: [
      {
        type: 'table',
        content,
      },
    ],
  };
}

export function getExtensions(): Extensions {
  return [
    StarterKit.configure({ codeBlock: false, history: {} }),
    Underline,
    TextStyle,
    Color,
    FontFamily,
    FontSize,
    Highlight.configure({ multicolor: true }),
    TextAlign.configure({ types: ['heading', 'paragraph', 'imageBlock'] }),
    Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } }),
    Subscript,
    Superscript,
    TaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({
      resizable: true,
      lastColumnResizable: true,
      cellMinWidth: 40,
      handleWidth: 5,
    }),
    TableRow,
    CustomTableHeader,
    CustomTableCell,
    CodeBlockLowlight.configure({ lowlight, defaultLanguage: null }),
    Indent,
    ImageBlock,
    ParagraphFormat,
    MathInline,
    MathBlock,
    MathCommands,
    WikiLinkExtension,
  ];
}

let cachedExtensions: Extensions | null = null;
export function sharedExtensions(): Extensions {
  if (!cachedExtensions) cachedExtensions = getExtensions();
  return cachedExtensions;
}
