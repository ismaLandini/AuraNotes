import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PageOutline } from './PageOutline';
import { useUI } from '../store/ui';
import { useStore } from '../store/useStore';
import type { PageContent } from '../types';

describe('PageOutline', () => {
  it('renders nothing when outlineOpen is false', () => {
    useUI.setState({ outlineOpen: false });
    const { container } = render(<PageOutline />);
    expect(container.firstChild).toBeNull();
  });

  it('renders empty state when page has no headings', () => {
    useUI.setState({ outlineOpen: true });
    const mockPage: PageContent = {
      id: 'p1',
      schemaVersion: 3,
      items: {
        t1: {
          id: 't1',
          type: 'container',
          x: 50,
          y: 50,
          w: 300,
          h: 100,
          doc: {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Solo testo normale' }] }],
          },
        },
      },
      order: ['t1'],
      background: { pattern: 'dots', paper: 'white' },
    };
    useStore.setState({ pages: { p1: mockPage }, pageId: 'p1' });

    render(<PageOutline />);
    fireEvent.click(screen.getByTestId('outline-tab-titles'));
    expect(screen.getByText('Nessun titolo nella pagina')).toBeInTheDocument();
  });

  it('extracts, sorts and navigates headings from NoteContainers', () => {
    useUI.setState({ outlineOpen: true });
    const mockPage: PageContent = {
      id: 'p1',
      schemaVersion: 3,
      items: {
        c2: {
          id: 'c2',
          type: 'container',
          x: 50,
          y: 400,
          w: 400,
          h: 150,
          doc: {
            type: 'doc',
            content: [
              { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Seconda Sezione' }] },
            ],
          },
        },
        c1: {
          id: 'c1',
          type: 'container',
          x: 50,
          y: 100,
          w: 600,
          h: 200,
          doc: {
            type: 'doc',
            content: [
              { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Introduzione al Corso' }] },
              { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Dettaglio Teorema 1' }] },
            ],
          },
        },
      },
      order: ['c2', 'c1'],
      background: { pattern: 'dots', paper: 'white' },
    };
    useStore.setState({ pages: { p1: mockPage }, pageId: 'p1', selection: [] });

    render(<PageOutline />);
    fireEvent.click(screen.getByTestId('outline-tab-titles'));

    // Count pill shows 3 headings
    expect(document.querySelector('.outline-count-pill')?.textContent).toBe('3');

    // Verify all 3 headings are rendered
    const h1 = screen.getByText('Introduzione al Corso');
    const h2 = screen.getByText('Seconda Sezione');
    const h3 = screen.getByText('Dettaglio Teorema 1');
    expect(h1).toBeInTheDocument();
    expect(h2).toBeInTheDocument();
    expect(h3).toBeInTheDocument();

    // Clicking a heading selects its container
    fireEvent.click(h2);
    expect(useStore.getState().selection).toEqual(['c2']);
  });

  it('defaults to thumbnails of only the current section and switches page on click', () => {
    const now = Date.now();
    const blank = (id: string): PageContent => ({
      id,
      schemaVersion: 3,
      items: {},
      order: [],
      background: { pattern: 'plain', paper: 'white' },
    });
    const prevWs = useStore.getState().workspace;
    useUI.setState({ outlineOpen: true });
    useStore.setState({
      workspace: {
        ...prevWs,
        notebooks: {
          nb1: { id: 'nb1', name: 'Quaderno', color: '#3a6df0', sectionIds: ['sec1', 'sec2'], createdAt: now, updatedAt: now },
        },
        sections: {
          sec1: { id: 'sec1', notebookId: 'nb1', name: 'Sezione 1', color: '#3a6df0', pageIds: ['p1', 'p2'], createdAt: now, updatedAt: now },
          sec2: { id: 'sec2', notebookId: 'nb1', name: 'Sezione 2', color: '#3a6df0', pageIds: ['p3'], createdAt: now, updatedAt: now },
        },
        pages: {
          p1: { id: 'p1', sectionId: 'sec1', title: 'Pagina Uno', createdAt: now, updatedAt: now, searchText: '' },
          p2: { id: 'p2', sectionId: 'sec1', title: 'Pagina Due', createdAt: now, updatedAt: now, searchText: '' },
          p3: { id: 'p3', sectionId: 'sec2', title: 'Altra Sezione', createdAt: now, updatedAt: now, searchText: '' },
        },
        notebookIds: ['nb1'],
      },
      pages: { p1: blank('p1'), p2: blank('p2'), p3: blank('p3') },
      notebookId: 'nb1',
      sectionId: 'sec1',
      pageId: 'p1',
    });

    render(<PageOutline />);
    expect(screen.getByTestId('outline-thumbs')).toBeInTheDocument();
    expect(screen.getByText('1 · Pagina Uno')).toBeInTheDocument();
    expect(screen.getByText('2 · Pagina Due')).toBeInTheDocument();
    expect(screen.queryByText(/Altra Sezione/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('2 · Pagina Due'));
    expect(useStore.getState().pageId).toBe('p2');
  });
});
