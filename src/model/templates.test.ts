import { describe, expect, it } from 'vitest';
import { ACADEMIC_TEMPLATES, createTemplatePage } from './templates';
import { useStore } from '../store/useStore';
import * as W from './workspaceOps';

describe('Academic Templates', () => {
  it('defines all 3 academic templates with required metadata', () => {
    expect(ACADEMIC_TEMPLATES).toHaveLength(3);
    const ids = ACADEMIC_TEMPLATES.map((t) => t.id);
    expect(ids).toContain('cornell');
    expect(ids).toContain('exercise');
    expect(ids).toContain('cheatsheet');

    for (const tmpl of ACADEMIC_TEMPLATES) {
      expect(tmpl.title).toBeTruthy();
      expect(tmpl.badge).toBeTruthy();
      expect(tmpl.description).toBeTruthy();
      expect(tmpl.defaultTitle).toBeTruthy();
      expect(tmpl.background).toBeDefined();
    }
  });

  it('generates a valid Cornell template page with 4 containers', () => {
    const page = createTemplatePage('test-p1', 'cornell');
    expect(page.id).toBe('test-p1');
    expect(page.background?.pattern).toBe('dots');
    expect(page.order.length).toBe(4);

    const items = Object.values(page.items);
    expect(items.every((it) => it.type === 'container')).toBe(true);

    const serialized = JSON.stringify(items);
    expect(serialized).toContain('Argomento della Lezione');
    expect(serialized).toContain('Parole chiave & Domande');
    expect(serialized).toContain('Note della Lezione');
    expect(serialized).toContain('Sintesi & Conclusioni');
  });

  it('generates a valid Exercise template page with formula and result box', () => {
    const page = createTemplatePage('test-p2', 'exercise');
    expect(page.id).toBe('test-p2');
    expect(page.background?.pattern).toBe('grid');
    expect(page.order.length).toBe(5);

    const items = Object.values(page.items);
    const serialized = JSON.stringify(items);
    expect(serialized).toContain('Testo del Problema');
    expect(serialized).toContain('Dati & Formule Note');
    expect(serialized).toContain('Risoluzione & Svolgimento');
    expect(serialized).toContain('Risultato Finale & Verifica');
  });

  it('generates a valid Cheatsheet template page with 2 dense formula columns', () => {
    const page = createTemplatePage('test-p3', 'cheatsheet');
    expect(page.id).toBe('test-p3');
    expect(page.background?.pattern).toBe('grid');
    expect(page.order.length).toBe(3);

    const items = Object.values(page.items);
    const serialized = JSON.stringify(items);
    expect(serialized).toContain('Formulario: [Nome Insegnamento]');
    expect(serialized).toContain('Definizioni & Derivate Notevoli');
    expect(serialized).toContain('Integrali & Teoremi');
  });

  it('creates templated pages via useStore.addPage', () => {
    let ws = W.emptyWorkspace();
    const nb = W.newId();
    const sec = W.newId();
    ws = W.createNotebook(ws, 'Test Notebook', nb);
    ws = W.createSection(ws, nb, 'Test Section', sec);
    useStore.setState({ workspace: ws, notebookId: nb, sectionId: sec, pages: {} });

    const pid = useStore.getState().addPage(sec, undefined, 'cornell');
    expect(pid).toBeTruthy();

    const createdMeta = useStore.getState().workspace.pages[pid!];
    expect(createdMeta.title).toBe('Lezione — Metodo Cornell');
    expect(createdMeta.searchText.toLowerCase()).toContain('argomento della lezione');

    const createdPage = useStore.getState().pages[pid!];
    expect(createdPage).toBeDefined();
    expect(createdPage.order.length).toBe(4);
  });
});
