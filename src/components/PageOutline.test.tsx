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

  it('defaults to Mac Preview-style thumbnails of the sheets of the current Page (not other section pages) and scrolls viewport on click', () => {
    const now = Date.now();
    const multiSheetPage: PageContent = {
      id: 'p1',
      schemaVersion: 3,
      items: {},
      order: [],
      background: { pattern: 'plain', paper: 'white' },
      sheets: [
        { id: 'sh-1', width: 794, height: 1123, type: 'blank' },
        { id: 'sh-2', width: 794, height: 1123, type: 'blank' },
        { id: 'sh-3', width: 794, height: 1123, type: 'blank' },
      ],
    };
    const otherSectionPage: PageContent = {
      id: 'p2',
      schemaVersion: 3,
      items: {},
      order: [],
      background: { pattern: 'plain', paper: 'white' },
    };
    const prevWs = useStore.getState().workspace;
    useUI.setState({ outlineOpen: true });
    useStore.setState({
      workspace: {
        ...prevWs,
        notebooks: {
          nb1: { id: 'nb1', name: 'Quaderno', color: '#3a6df0', sectionIds: ['sec1'], createdAt: now, updatedAt: now },
        },
        sections: {
          sec1: { id: 'sec1', notebookId: 'nb1', name: 'Sezione 1', color: '#3a6df0', pageIds: ['p1', 'p2'], createdAt: now, updatedAt: now },
        },
        pages: {
          p1: { id: 'p1', sectionId: 'sec1', title: 'Documento Multi-Foglio', createdAt: now, updatedAt: now, searchText: '', sheetCount: 3 },
          p2: { id: 'p2', sectionId: 'sec1', title: 'Altra Pagina Della Sezione', createdAt: now, updatedAt: now, searchText: '' },
        },
        notebookIds: ['nb1'],
      },
      pages: { p1: multiSheetPage, p2: otherSectionPage },
      viewports: { p1: { x: 0, y: -132, zoom: 1 } },
      notebookId: 'nb1',
      sectionId: 'sec1',
      pageId: 'p1',
    });

    render(<PageOutline />);
    expect(screen.getByTestId('outline-thumbs')).toBeInTheDocument();
    expect(screen.getByTestId('outline-sheet-thumb-1')).toHaveClass('current');
    expect(screen.getByTestId('outline-sheet-thumb-2')).toBeInTheDocument();
    expect(screen.getByTestId('outline-sheet-thumb-3')).toBeInTheDocument();
    // Does NOT show other pages of the section
    expect(screen.queryByText(/Altra Pagina Della Sezione/)).not.toBeInTheDocument();

    // Clicking sheet 3 scrolls the current page's viewport down to sheet 3 while keeping pageId === 'p1'
    fireEvent.click(screen.getByTestId('outline-sheet-thumb-3'));
    expect(useStore.getState().pageId).toBe('p1');
    expect(useStore.getState().viewports.p1.y).toBeGreaterThan(2000);
  });
});
