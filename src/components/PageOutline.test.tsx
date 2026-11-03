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
});
