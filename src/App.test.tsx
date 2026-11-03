import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from './App';
import { useStore } from './store/useStore';
import { useUI } from './store/ui';

describe('App', () => {
  beforeEach(() => {
    useUI.getState().set({ homeOpen: true, homeTab: 'notebooks', homeNotebookId: null });
  });

  it('starts on the Goodnotes-style Home screen showing Quaderni as folders, opens Sezioni as books, and navigates to the workspace', async () => {
    render(<App />);
    expect(await screen.findByTestId('home-view')).toBeInTheDocument();
    expect(screen.getByTestId('home-nav-notebooks')).toBeInTheDocument();
    expect(screen.getByTestId('home-nav-recent')).toBeInTheDocument();
    expect(screen.getByTestId('home-nav-favorites')).toBeInTheDocument();
    expect(screen.getByTestId('home-nav-trash')).toBeInTheDocument();

    // Click the example Quaderno folder
    const folder = screen.getByRole('button', { name: /^Quaderno / });
    fireEvent.click(folder);

    // Now inside the notebook, sections are shown as books
    expect(await screen.findByTestId('home-sections-grid')).toBeInTheDocument();
    const firstSectionBook = screen.getByRole('button', { name: 'Sezione Per iniziare' });
    fireEvent.click(firstSectionBook);

    // Opens the workspace on the last page of that section ("Scorciatoie essenziali")
    expect(await screen.findByLabelText('Navigazione')).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText('Scorciatoie essenziali').length).toBeGreaterThan(0));
    expect(screen.getByTestId('canvas')).toBeInTheDocument();
    expect(screen.getByTestId('tool-palette')).toBeInTheDocument();

    // Clicking the Home icon in the Ribbon returns to the Home screen
    const homeBtn = screen.getByTestId('ribbon-home-btn');
    fireEvent.click(homeBtn);
    expect(await screen.findByTestId('home-view')).toBeInTheDocument();
  });

  it('creates a new page automatically when clicking a newly created empty section in Home', async () => {
    render(<App />);
    await screen.findByTestId('home-view');
    const nbId = useStore.getState().workspace.notebookIds[0];
    const newSecId = useStore.getState().createSectionInHome(nbId, 'Sezione Vuota');
    expect(useStore.getState().workspace.sections[newSecId].pageIds).toHaveLength(0);

    // Open notebook folder in Home, then click the empty section book
    fireEvent.click(screen.getByRole('button', { name: /^Quaderno / }));
    fireEvent.click(await screen.findByTestId('home-section-Sezione Vuota'));

    // Should create a page in the empty section and open the workspace
    await waitFor(() => expect(useUI.getState().homeOpen).toBe(false));
    expect(useStore.getState().sectionId).toBe(newSecId);
    expect(useStore.getState().workspace.sections[newSecId].pageIds.length).toBe(1);
    expect(useStore.getState().pageId).toBe(useStore.getState().workspace.sections[newSecId].pageIds[0]);
  });

  it('switches tools from the palette and toggles back to select when clicked again', async () => {
    useUI.getState().set({ homeOpen: false });
    render(<App />);
    const pen = await screen.findAllByRole('button', { name: 'Penna' });
    fireEvent.click(pen[0]);
    expect(useStore.getState().tool).toBe('pen');
    // Clicking active tool again returns to text/writing functions ('select')
    fireEvent.click(pen[0]);
    expect(useStore.getState().tool).toBe('select');
  });

  it('scrolls the viewport on wheel event', async () => {
    useUI.getState().set({ homeOpen: false });
    render(<App />);
    const canvas = await screen.findByTestId('canvas');
    const pid = useStore.getState().pageId!;
    const initialVp = useStore.getState().viewports[pid];
    fireEvent.wheel(canvas, { deltaX: 0, deltaY: 100 });
    const nextVp = useStore.getState().viewports[pid];
    expect(nextVp).toBeDefined();
    expect(nextVp.y).toBeGreaterThan(initialVp ? initialVp.y : -200);
  });

  it('opens the shortcut reference from the toolbar', async () => {
    useUI.getState().set({ homeOpen: false });
    render(<App />);
    const btn = await screen.findAllByRole('button', { name: 'Scorciatoie da tastiera' });
    fireEvent.click(btn[0]);
    expect(await screen.findByTestId('shortcuts-overlay')).toBeInTheDocument();
    expect(screen.getAllByText('Nuova pagina').length).toBeGreaterThan(0);
  });

  it('renders the horizontal editing toolbar (Ribbon) with Home button and dedicated vertical tool palette', async () => {
    useUI.getState().set({ homeOpen: false });
    render(<App />);
    expect(await screen.findByRole('toolbar', { name: 'Opzioni contestuali' })).toBeInTheDocument();
    expect(screen.getByTestId('ribbon-home-btn')).toBeInTheDocument();
    expect(screen.getByTestId('tool-palette')).toBeInTheDocument();
    expect(screen.getByTestId('canvas')).toBeInTheDocument();
    expect(screen.getByTestId('toggle-sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('save-status')).toBeInTheDocument();
    expect(screen.getByTestId('open-export')).toBeInTheDocument();
  });

  it('toggles navigation sidebar from the dedicated minimenu above the tool palette', async () => {
    useUI.getState().set({ homeOpen: false });
    render(<App />);
    const toggle = await screen.findByTestId('toggle-sidebar');
    expect(toggle).toBeInTheDocument();
    fireEvent.click(toggle);
    // After click, sidebarVisible is toggled
    fireEvent.click(toggle);
  });
});
