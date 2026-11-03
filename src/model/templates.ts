import type { JSONContent } from '@tiptap/core';
import type { CanvasItem, ID, PageBackground, PageContent } from '../types';
import { newId } from './workspaceOps';
import { addItems, emptyPage } from './pageOps';

export type AcademicTemplateId = 'cornell' | 'exercise' | 'cheatsheet';

export interface AcademicTemplate {
  id: AcademicTemplateId;
  title: string;
  badge: string;
  description: string;
  defaultTitle: string;
  background: PageBackground;
  createItems: () => CanvasItem[];
}

const t = (text: string, marks?: JSONContent['marks']): JSONContent => ({
  type: 'text',
  text,
  ...(marks ? { marks } : {}),
});

const p = (...content: JSONContent[]): JSONContent => ({
  type: 'paragraph',
  content,
});

const h = (level: number, text: string): JSONContent => ({
  type: 'heading',
  attrs: { level },
  content: [t(text)],
});

const li = (...content: JSONContent[]): JSONContent => ({
  type: 'listItem',
  content: [p(...content)],
});

const bulletList = (...items: JSONContent[]): JSONContent => ({
  type: 'bulletList',
  content: items,
});

const math = (latex: string): JSONContent => ({
  type: 'mathInline',
  attrs: { latex },
});

const mathBlock = (latex: string): JSONContent => ({
  type: 'mathBlock',
  attrs: { latex },
});

const bold = [{ type: 'bold' }];

function container(
  x: number,
  y: number,
  w: number,
  content: JSONContent[],
  variant: 'plain' | 'sticky' = 'plain',
  bg?: string,
): CanvasItem {
  return {
    id: newId(),
    type: 'container',
    x,
    y,
    w,
    h: 80,
    customW: true,
    doc: { type: 'doc', content },
    variant,
    ...(bg ? { bg } : {}),
  };
}

export const ACADEMIC_TEMPLATES: AcademicTemplate[] = [
  {
    id: 'cornell',
    title: 'Metodo Cornell',
    badge: 'Appunti Lezione',
    description: 'Struttura a 3 sezioni: colonna spunti a sinistra, note della lezione a destra e riassunto finale in basso.',
    defaultTitle: 'Lezione — Metodo Cornell',
    background: { pattern: 'dots', paper: 'white' },
    createItems: () => [
      // 1. Header (Argomento, data, docente)
      container(60, 40, 1100, [
        h(1, 'Argomento della Lezione'),
        p(
          t('Insegnamento: '),
          t('[Nome Corso]', bold),
          t('  •  Data: '),
          t('GG/MM/AAAA', bold),
          t('  •  Docente: '),
          t('[Nome Docente]', bold),
        ),
      ]),
      // 2. Colonna Cue / Parole chiave (sinistra)
      container(60, 150, 340, [
        h(3, 'Parole chiave & Domande'),
        p(t('Usa questa colonna per appuntare domande guida, concetti chiave o dubbi da chiarire.')),
        bulletList(
          li(t('Definizione del principio fondamentale')),
          li(t('Quali sono le ipotesi di validità?')),
          li(t('Casi limite e interpretazione geometrica')),
        ),
      ]),
      // 3. Colonna Note (destra)
      container(430, 150, 730, [
        h(2, 'Note della Lezione'),
        p(t('Scrivi qui le spiegazioni dettagliate, i passaggi matematici e gli schemi concettuali:')),
        mathBlock('\\int_a^b f(x)\\,dx = F(b) - F(a)'),
        p(t('Osservazioni importanti:')),
        bulletList(
          li(t('Condizione necessaria: la funzione dev\'essere continua nell\'intervallo chiuso e limitato.')),
          li(t('Se esistono discontinuità eliminabili, l\'integrale coincide comunque con quello della funzione regolarizzata.')),
        ),
      ]),
      // 4. Sintesi / Riassunto in basso
      container(
        60,
        520,
        1100,
        [
          h(3, 'Sintesi & Conclusioni'),
          p(t('Riassumi in 2-3 frasi l\'essenza della lezione per il ripasso rapido a distanza di settimane.')),
        ],
        'sticky',
        '#fff4b8',
      ),
    ],
  },
  {
    id: 'exercise',
    title: 'Scheda Esercizio',
    badge: 'STEM & Esercitazioni',
    description: 'Risoluzione guidata per problemi d\'esame: testo, dati noti, passaggi matematici e box del risultato.',
    defaultTitle: 'Esercizio — [Tema d\'Esame]',
    background: { pattern: 'grid', paper: 'white' },
    createItems: () => [
      // 1. Header
      container(60, 40, 1100, [
        h(1, 'Esercizio: [Titolo Argomento]'),
        p(
          t('Fonte: '),
          t('Appello / Eserciziario', bold),
          t('  •  Difficoltà: '),
          t('★★★☆☆', bold),
          t('  •  Tempo stimato: '),
          t('25 min', bold),
        ),
      ]),
      // 2. Testo problema
      container(60, 140, 1100, [
        h(3, 'Testo del Problema'),
        p(t('Incolla qui il testo dell\'esercizio, l\'immagine del circuito o lo schema fornito dal docente.')),
      ]),
      // 3. Dati e formule note (colonna sinistra)
      container(60, 290, 420, [
        h(3, 'Dati & Formule Note'),
        bulletList(
          li(t('m = 2.5 \\text{ kg}')),
          li(t('v_0 = 12.0 \\text{ m/s}')),
          li(t('\\theta = 30^\\circ')),
        ),
        p(t('Relazioni fondamentali:')),
        mathBlock('F = m \\cdot a = m \\frac{dv}{dt}'),
      ]),
      // 4. Risoluzione (colonna destra)
      container(510, 290, 650, [
        h(3, 'Risoluzione & Svolgimento'),
        p(t('1. Equazione del moto proiettata lungo la direzione del piano inclinato:')),
        mathBlock('m \\frac{dv}{dt} = -m g \\sin(\\theta) - \\mu_d m g \\cos(\\theta)'),
        p(t('2. Separazione delle variabili ed integrazione temporale:')),
        mathBlock('v(t) = v_0 - g (\\sin\\theta + \\mu_d \\cos\\theta)\\,t'),
      ]),
      // 5. Box Risultato finale
      container(
        60,
        630,
        1100,
        [
          h(3, 'Risultato Finale & Verifica'),
          p(
            t('Soluzione: '),
            math('t_{\\text{arresto}} = 2.38 \\text{ s}'),
            t('  —  Verifica dimensionale corretta [s].'),
          ),
        ],
        'sticky',
        '#e2f8e5',
      ),
    ],
  },
  {
    id: 'cheatsheet',
    title: 'Formulario d\'Esame',
    badge: 'Ripasso Rapido',
    description: 'Layout denso a 2 colonne affiancate con carta millimetrata per raccogliere tutte le formule chiave.',
    defaultTitle: 'Formulario — [Nome Insegnamento]',
    background: { pattern: 'grid', paper: 'white' },
    createItems: () => [
      // 1. Header
      container(60, 40, 1100, [
        h(1, 'Formulario: [Nome Insegnamento]'),
        p(t('Raccolta sintetica di relazioni fondamentali, proprietà e costanti per la prova d\'esame.')),
      ]),
      // 2. Colonna 1 (Sinistra)
      container(60, 130, 530, [
        h(2, '1. Definizioni & Derivate Notevoli'),
        p(t('Derivate di funzioni elementari:')),
        mathBlock('\\frac{d}{dx} \\ln|x| = \\frac{1}{x}, \\quad \\frac{d}{dx} e^{ax} = a e^{ax}'),
        h(3, 'Sviluppi notevoli (Maclaurin per x → 0)'),
        mathBlock('\\sin(x) = x - \\frac{x^3}{6} + \\frac{x^5}{120} + o(x^6)'),
        mathBlock('\\cos(x) = 1 - \\frac{x^2}{2} + \\frac{x^4}{24} + o(x^5)'),
        mathBlock('e^x = 1 + x + \\frac{x^2}{2} + \\frac{x^3}{6} + o(x^3)'),
      ]),
      // 3. Colonna 2 (Destra)
      container(620, 130, 540, [
        h(2, '2. Integrali & Teoremi'),
        p(t('Regola di integrazione per parti:')),
        mathBlock('\\int u(x) v\'(x)\\,dx = u(x)v(x) - \\int u\'(x)v(x)\\,dx'),
        h(3, 'Identità Trigonometriche & Esponenziali'),
        mathBlock('e^{i\\theta} = \\cos(\\theta) + i\\sin(\\theta)'),
        mathBlock('\\cosh^2(x) - \\sinh^2(x) = 1'),
        p(t('Suggerimenti per la prova:')),
        bulletList(
          li(t('Verificare sempre la parità delle funzioni per dimezzare l\'intervallo di integrazione.')),
          li(t('Controllare il comportamento asintotico nei limiti agli estremi del dominio.')),
        ),
      ]),
    ],
  },
];

export function getTemplate(id: AcademicTemplateId): AcademicTemplate | undefined {
  return ACADEMIC_TEMPLATES.find((t) => t.id === id);
}

export function createTemplatePage(pageId: ID, templateId: AcademicTemplateId): PageContent {
  const template = getTemplate(templateId);
  const base = emptyPage(pageId);
  if (!template) return base;
  const items = template.createItems();
  return {
    ...addItems(base, items),
    background: template.background,
  };
}
