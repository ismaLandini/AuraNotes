import type { JSONContent } from '@tiptap/core';
import type { CanvasItem, ID, PageContent, Workspace } from '../types';
import * as W from './workspaceOps';
import { addItems, emptyPage, pageSearchText } from './pageOps';

const t = (text: string, marks?: JSONContent['marks']): JSONContent => ({ type: 'text', text, ...(marks ? { marks } : {}) });
const p = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content });
const h = (level: number, text: string): JSONContent => ({ type: 'heading', attrs: { level }, content: [t(text)] });
const li = (...content: JSONContent[]): JSONContent => ({ type: 'listItem', content: [p(...content)] });
const math = (latex: string): JSONContent => ({ type: 'mathInline', attrs: { latex } });
const mathBlock = (latex: string): JSONContent => ({ type: 'mathBlock', attrs: { latex } });
const bold = [{ type: 'bold' }];
const hl = (color: string) => [{ type: 'highlight', attrs: { color } }];

function text(id: ID, x: number, y: number, w: number, content: JSONContent[], variant: 'plain' | 'sticky' = 'plain', bg?: string): CanvasItem {
  return { id, type: 'container', x, y, w, h: 80, doc: { type: 'doc', content }, variant, ...(bg ? { bg } : {}) };
}

export function buildExampleWorkspace(): { workspace: Workspace; pages: Record<ID, PageContent> } {
  let ws = W.emptyWorkspace();
  const nb = W.newId();
  const s1 = W.newId();
  const s2 = W.newId();
  const p1 = W.newId();
  const p2 = W.newId();
  const p3 = W.newId();
  ws = W.createNotebook(ws, 'Benvenuto in AuraNotes', nb);
  ws = W.createSection(ws, nb, 'Per iniziare', s1);
  ws = W.createSection(ws, nb, 'Esempio: Analisi 1', s2);
  ws = W.createPage(ws, s1, 'Come funziona', p1);
  ws = W.createPage(ws, s1, 'Scorciatoie essenziali', p2);
  ws = W.createPage(ws, s2, 'Limiti notevoli', p3);

  const a = W.newId();
  const b = W.newId();
  const c = W.newId();
  const welcome = addItems(emptyPage(p1), [
    text(a, 80, 60, 460, [
      h(1, 'Benvenuto in AuraNotes'),
      p(t('Un quaderno libero per gli appunti universitari: scrivi '), t('ovunque', bold), t(' sulla pagina, incolla immagini, disegna e collega i concetti.')),
      { type: 'bulletList', content: [
        li(t('Doppio clic su un blocco per modificarne il testo.')),
        li(t('Strumento Testo (T) e clic su un punto vuoto per creare un blocco.')),
        li(t('Incolla immagini con ⌘V o trascinale sulla pagina.')),
        li(t('Penna (P), evidenziatore (M), forme e frecce dalla barra a sinistra.')),
      ] },
    ]),
    text(b, 640, 90, 260, [p(t('Nota adesiva', bold)), p(t('Usa lo strumento Connettore (C) per collegare due blocchi: la freccia li segue quando li sposti.'))], 'sticky', '#fff4b8'),
    text(c, 640, 330, 300, [p(t('Le equazioni si scrivono in LaTeX: '), math('e^{i\\pi} + 1 = 0'))]),
    { id: W.newId(), type: 'connector', fromId: b, toId: c, fromAnchor: 'auto', toAnchor: 'auto', arrow: 'end', color: '#5b8def', width: 2, layer: 'back' },
    { id: W.newId(), type: 'shape', kind: 'ellipse', x1: 610, y1: 300, x2: 975, y2: 400, color: '#e5484d', width: 2, opacity: 1, fill: null },
  ]);

  const shortcuts = addItems(emptyPage(p2), [
    text(W.newId(), 80, 60, 520, [
      h(2, 'Scorciatoie essenziali'),
      { type: 'bulletList', content: [
        li(t('⌘/', bold), t(' — elenco completo delle scorciatoie')),
        li(t('⌘K', bold), t(' o '), t('⌘F', bold), t(' — ricerca globale')),
        li(t('⌥⌘N', bold), t(' — nuova pagina')),
        li(t('⌘Z / ⇧⌘Z', bold), t(' — annulla / ripeti')),
        li(t('⌘P', bold), t(' — stampa o esporta in PDF')),
        li(t('⇧⌘B', bold), t(' — mostra/nascondi i pannelli di navigazione')),
        li(t('Spazio + trascina', bold), t(' — sposta la vista')),
      ] },
    ]),
  ]);

  const lim1 = W.newId();
  const lim2 = W.newId();
  const limits = addItems(emptyPage(p3), [
    text(lim1, 80, 60, 420, [
      h(2, 'Limiti notevoli'),
      p(t('Il limite fondamentale '), t('da ricordare', hl('#ffe066')), t(':')),
      mathBlock('\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1'),
      p(t('Da cui segue, per esempio, '), math('\\lim_{x\\to 0} \\frac{1-\\cos x}{x^2} = \\tfrac{1}{2}'), t('.')),
    ]),
    text(lim2, 600, 120, 320, [
      p(t('Numero di Nepero', bold)),
      mathBlock('\\lim_{n \\to \\infty} \\left(1 + \\frac{1}{n}\\right)^n = e'),
    ], 'sticky', '#dff3ff'),
    { id: W.newId(), type: 'connector', fromId: lim1, toId: lim2, fromAnchor: 'auto', toAnchor: 'auto', arrow: 'end', color: '#9b6bf2', width: 2, layer: 'back' },
  ]);

  const pages = { [p1]: welcome, [p2]: shortcuts, [p3]: limits };
  for (const [id, pg] of Object.entries(pages)) ws = W.setPageMeta(ws, id, { searchText: pageSearchText(pg) });
  return { workspace: ws, pages };
}
