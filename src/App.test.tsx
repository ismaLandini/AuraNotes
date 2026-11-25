import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from './App';
import { useStore } from './store/useStore';
import { useUI } from './store/ui';
import { createTextBlock } from './canvas/actions';
import { useActiveEditor } from './editor/activeEditor';
import * as W from './model/workspaceOps';

describe('App', () => {
  beforeEach(() => {
    useUI.getState().set({
      homeOpen: true,
      homeTab: 'notebooks',
      homeNotebookId: null,
      homeSectionId: null,
      navHistory: [],
      confirm: null,
      prompt: null,
      searchOpen: false,
      settingsOpen: false,
      shortcutsOpen: false,
      exportOpen: false,
      trashOpen: false,
      pdfDialogOpen: false,
      templatePickerOpen: false,
    });
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

    // Now inside the section, pages are shown as Goodnotes-style document cards
    expect(await screen.findByTestId('home-section-pages-grid')).toBeInTheDocument();
    const firstPageCard = await screen.findByTestId('home-page-Scorciatoie essenziali');
    fireEvent.click(firstPageCard);

    // Opens the workspace on that page ("Scorciatoie essenziali")
    expect(await screen.findByLabelText('Navigazione')).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText('Scorciatoie essenziali').length).toBeGreaterThan(0));
    expect(screen.getByTestId('canvas')).toBeInTheDocument();
    expect(screen.getByTestId('tool-palette')).toBeInTheDocument();

    // Clicking the Home icon in the Ribbon returns to the Home screen
    const homeBtn = screen.getByTestId('ribbon-home-btn');
    fireEvent.click(homeBtn);
    expect(await screen.findByTestId('home-view')).toBeInTheDocument();
  });

  it('navigates to Section Pages level in Home when clicking a section, allowing adding pages', async () => {
    render(<App />);
    await screen.findByTestId('home-view');
    const nbId = useStore.getState().workspace.notebookIds[0];
    const newSecId = useStore.getState().createSectionInHome(nbId, 'Sezione Vuota');
    expect(useStore.getState().workspace.sections[newSecId].pageIds).toHaveLength(0);

    // Open notebook folder in Home, then click the section book to view its Pages
    fireEvent.click(screen.getByRole('button', { name: /^Quaderno / }));
    fireEvent.click(await screen.findByTestId('home-section-Sezione Vuota'));

    // Should navigate to section pages level in Home
    expect(useUI.getState().homeSectionId).toBe(newSecId);
    expect(await screen.findByTestId('home-section-pages-grid')).toBeInTheDocument();

    // Clicking "Nuova pagina" in the section creates a page and opens the workspace
    fireEvent.click(screen.getByTestId('home-new-page-card'));
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

  it('scrolls toolbar horizontally only on deltaX and does not scroll canvas sheets when wheeling over the ribbon', async () => {
    useUI.getState().set({ homeOpen: false });
    const { container } = render(<App />);
    const ribbon = container.querySelector('.ribbon') as HTMLElement;
    const ribbonTools = container.querySelector('.ribbon-tools') as HTMLElement;
    expect(ribbon).toBeInTheDocument();
    expect(ribbonTools).toBeInTheDocument();

    Object.defineProperty(ribbonTools, 'scrollWidth', { value: 1200, configurable: true });
    Object.defineProperty(ribbonTools, 'clientWidth', { value: 600, configurable: true });

    const pid = useStore.getState().pageId!;
    const initialVp = { ...useStore.getState().viewports[pid] };

    fireEvent.wheel(ribbon, { deltaX: 0, deltaY: 100 });
    expect(ribbonTools.scrollLeft).toBe(0);

    let currentVp = useStore.getState().viewports[pid];
    expect(currentVp.x).toBe(initialVp.x);
    expect(currentVp.y).toBe(initialVp.y);

    fireEvent.wheel(ribbon, { deltaX: 100, deltaY: 0 });
    expect(ribbonTools.scrollLeft).toBe(100);

    currentVp = useStore.getState().viewports[pid];
    expect(currentVp.x).toBe(initialVp.x);
    expect(currentVp.y).toBe(initialVp.y);
  });

  it('opens the shortcut reference from the toolbar', async () => {
    useUI.getState().set({ homeOpen: false });
    render(<App />);
    fireEvent.click(await screen.findByTestId('ribbon-utilities-btn'));
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
    fireEvent.click(screen.getByTestId('ribbon-utilities-btn'));
    expect(await screen.findByTestId('open-export')).toBeInTheDocument();
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

  it('inserts inline and block equations into an active text block without ending editing on prompt', async () => {
    useUI.getState().set({ homeOpen: false });
    render(<App />);
    await screen.findByTestId('canvas');
    const blockId = createTextBlock({ x: 80, y: 120 });
    expect(blockId).toBeTruthy();

    // Open Equation popover and click "Equazione in linea"
    const eqTrigger = await screen.findByRole('button', { name: 'Equazione' });
    fireEvent.click(eqTrigger);
    const inlineBtn = await screen.findByRole('button', { name: 'Equazione in linea' });
    fireEvent.click(inlineBtn);

    const inputInline = await screen.findByTestId('prompt-input');
    expect(useStore.getState().editingId).toBe(blockId);
    fireEvent.change(inputInline, { target: { value: 'a^2 + b^2 = c^2' } });
    fireEvent.click(screen.getByTestId('prompt-ok'));

    await waitFor(() => expect(screen.queryByTestId('prompt-dialog')).toBeNull());
    await waitFor(() => {
      const page = useStore.getState().currentPage()!;
      const item = page.items[blockId!] as { doc?: unknown };
      expect(JSON.stringify(item.doc)).toContain('mathInline');
      expect(JSON.stringify(item.doc)).toContain('a^2 + b^2 = c^2');
    });

    // Now insert a block equation in the same editing session
    fireEvent.click(screen.getByRole('button', { name: 'Equazione' }));
    const blockBtn = await screen.findByRole('button', { name: 'Equazione a blocco' });
    fireEvent.click(blockBtn);

    const inputBlock = await screen.findByTestId('prompt-input');
    expect(useStore.getState().editingId).toBe(blockId);
    fireEvent.change(inputBlock, { target: { value: '\\int_0^1 x\\,dx' } });
    fireEvent.click(screen.getByTestId('prompt-ok'));

    await waitFor(() => expect(screen.queryByTestId('prompt-dialog')).toBeNull());
    await waitFor(() => {
      const page = useStore.getState().currentPage()!;
      const item = page.items[blockId!] as { doc?: unknown };
      expect(JSON.stringify(item.doc)).toContain('mathBlock');
      expect(JSON.stringify(item.doc)).toContain('\\\\int_0^1 x\\\\,dx');
    });
  });

  it('creates a new text block when inserting an equation without an active text editor', async () => {
    useUI.getState().set({ homeOpen: false });
    render(<App />);
    await screen.findByTestId('canvas');
    useStore.getState().setEditing(null);
    const pid = useStore.getState().pageId!;
    const beforeCount = useStore.getState().pages[pid].order.length;

    fireEvent.click(await screen.findByRole('button', { name: 'Equazione' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Equazione a blocco' }));

    const input = await screen.findByTestId('prompt-input');
    fireEvent.change(input, { target: { value: 'E = mc^2' } });
    fireEvent.click(screen.getByTestId('prompt-ok'));

    await waitFor(() => expect(screen.queryByTestId('prompt-dialog')).toBeNull());
    await waitFor(() => {
      const page = useStore.getState().pages[pid];
      expect(page.order.length).toBe(beforeCount + 1);
      const newId = page.order[page.order.length - 1];
      const item = page.items[newId] as { doc?: unknown };
      expect(JSON.stringify(item.doc)).toContain('mathBlock');
      expect(JSON.stringify(item.doc)).toContain('E = mc^2');
    });
  });

  it('strips \\(...\\) and \\[...\\] delimiters when converting selected text to an inline or block equation', async () => {
    useUI.getState().set({ homeOpen: false });
    render(<App />);
    await screen.findByTestId('canvas');
    const blockId = createTextBlock({ x: 80, y: 120 });
    expect(blockId).toBeTruthy();

    await waitFor(() => expect(useActiveEditor.getState().editor).not.toBeNull());
    const ed = useActiveEditor.getState().editor!;
    ed.commands.setContent('<p>\\({q_1, q_2, \\dots, q_n}\\)</p>');
    ed.commands.selectAll();

    fireEvent.click(await screen.findByRole('button', { name: 'Equazione' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Equazione in linea' }));

    const input = (await screen.findByTestId('prompt-input')) as HTMLInputElement;
    expect(input.value).toBe('{q_1, q_2, \\dots, q_n}');
    fireEvent.click(screen.getByTestId('prompt-ok'));

    await waitFor(() => expect(screen.queryByTestId('prompt-dialog')).toBeNull());
    await waitFor(() => {
      const page = useStore.getState().currentPage()!;
      const item = page.items[blockId!] as { doc?: unknown };
      const serialized = JSON.stringify(item.doc);
      expect(serialized).toContain('mathInline');
      expect(serialized).toContain('{q_1, q_2, \\\\dots, q_n}');
      expect(serialized).not.toContain('\\\\(');
      expect(serialized).not.toContain('\\\\)');
    });
  });

  it('keeps editing continuously after inserting inline/block equations and unwraps math formatting back to plain text', async () => {
    useUI.getState().set({ homeOpen: false });
    render(<App />);
    await screen.findByTestId('canvas');
    const blockId = createTextBlock({ x: 80, y: 120 });
    expect(blockId).toBeTruthy();

    await waitFor(() => expect(useActiveEditor.getState().editor).not.toBeNull());
    const ed = useActiveEditor.getState().editor!;

    // Insert block equation and verify cursor lands in a trailing paragraph so user can keep typing
    fireEvent.click(await screen.findByRole('button', { name: 'Equazione' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Equazione a blocco' }));
    const inputBlock = await screen.findByTestId('prompt-input');
    fireEvent.change(inputBlock, { target: { value: 'a^2 + b^2 = c^2' } });
    fireEvent.click(screen.getByTestId('prompt-ok'));

    await waitFor(() => expect(screen.queryByTestId('prompt-dialog')).toBeNull());
    expect(useStore.getState().editingId).toBe(blockId);

    ed.commands.insertContent('Testo continuo');
    expect(ed.getText()).toContain('Testo continuo');

    // Insert inline equation and unwrap it back to plain text via Equation menu
    fireEvent.click(screen.getByRole('button', { name: 'Equazione' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Equazione in linea' }));
    const inputInline = await screen.findByTestId('prompt-input');
    fireEvent.change(inputInline, { target: { value: '\\alpha + \\beta' } });
    fireEvent.click(screen.getByTestId('prompt-ok'));

    await waitFor(() => expect(screen.queryByTestId('prompt-dialog')).toBeNull());
    expect(JSON.stringify(ed.getJSON())).toContain('mathInline');

    fireEvent.click(screen.getByRole('button', { name: 'Equazione' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Rimuovi formattazione matematica' }));

    await waitFor(() => {
      const json = JSON.stringify(ed.getJSON());
      expect(json).not.toContain('mathInline');
      expect(json).toContain('\\\\alpha + \\\\beta');
    });
    expect(useStore.getState().editingId).toBe(blockId);
  });

  it('returns to the previous screen (Pages screen or initial Page) when clicking the Ribbon Back button', async () => {
    render(<App />);
    await screen.findByTestId('home-view');

    // Navigate to Quaderno -> Sezione Per iniziare (Pages screen)
    fireEvent.click(screen.getByRole('button', { name: /^Quaderno / }));
    fireEvent.click(await screen.findByTestId('home-section-Per iniziare'));
    expect(await screen.findByTestId('home-section-pages-grid')).toBeInTheDocument();
    const secId = useUI.getState().homeSectionId;
    expect(secId).toBeTruthy();

    // Open a page from the Pages screen
    const firstPageCard = await screen.findByTestId('home-page-Scorciatoie essenziali');
    fireEvent.click(firstPageCard);
    await screen.findByTestId('canvas');
    const firstPageId = useStore.getState().pageId!;
    expect(useUI.getState().homeOpen).toBe(false);

    // Back button is enabled and returns to the Pages screen
    const backBtn = screen.getByTestId('ribbon-back-btn');
    expect(backBtn).not.toBeDisabled();
    fireEvent.click(backBtn);

    expect(await screen.findByTestId('home-section-pages-grid')).toBeInTheDocument();
    expect(useUI.getState().homeOpen).toBe(true);
    expect(useUI.getState().homeSectionId).toBe(secId);

    // Open the first page again, then navigate via wikilink to a second page
    fireEvent.click(await screen.findByTestId('home-page-Scorciatoie essenziali'));
    await screen.findByTestId('canvas');
    const secondPageId = await useStore.getState().navigateWikiLink('Pagina collegata');
    expect(secondPageId).toBeTruthy();
    await waitFor(() => expect(useStore.getState().pageId).toBe(secondPageId));

    // Clicking Back returns to the initial page
    fireEvent.click(screen.getByTestId('ribbon-back-btn'));
    await waitFor(() => expect(useStore.getState().pageId).toBe(firstPageId));
    expect(useUI.getState().homeOpen).toBe(false);

    // Clicking Back again returns to the Pages screen, and history is now empty
    fireEvent.click(screen.getByTestId('ribbon-back-btn'));
    expect(await screen.findByTestId('home-section-pages-grid')).toBeInTheDocument();
    expect(useUI.getState().navHistory).toHaveLength(0);
  });

  it('sorts pages inside a Section in HomeView via the sort filter dropdown', async () => {
    render(<App />);
    await screen.findByTestId('home-view');
    const nbId = useStore.getState().workspace.notebookIds[0];
    const secId = useStore.getState().createSectionInHome(nbId, 'Sezione Ordinamento');
    const pZeta = useStore.getState().createPageInHome(secId, 'Zeta')!;
    const pAlfa = useStore.getState().createPageInHome(secId, 'Alfa')!;
    const pBeta = useStore.getState().createPageInHome(secId, 'Beta')!;

    useStore.getState().mutateWorkspace((w) => {
      let next = W.setPageMeta(w, pZeta, { createdAt: 1000, updatedAt: 9000 });
      next = W.setPageMeta(next, pAlfa, { createdAt: 3000, updatedAt: 2000 });
      next = W.setPageMeta(next, pBeta, { createdAt: 2000, updatedAt: 5000 });
      return next;
    });

    fireEvent.click(screen.getByRole('button', { name: /^Quaderno / }));
    fireEvent.click(await screen.findByTestId('home-section-Sezione Ordinamento'));
    const grid = await screen.findByTestId('home-section-pages-grid');

    const cardIds = () =>
      Array.from(grid.querySelectorAll<HTMLElement>('.home-page-card[data-page-id]')).map((el) => el.dataset.pageId);

    expect(cardIds()).toEqual([pZeta, pAlfa, pBeta]);

    const sortSelect = screen.getByTestId('section-page-sort') as HTMLSelectElement;
    fireEvent.change(sortSelect, { target: { value: 'title-asc' } });
    expect(cardIds()).toEqual([pAlfa, pBeta, pZeta]);
    expect(useStore.getState().workspace.sections[secId].pageSort).toBe('title-asc');

    fireEvent.change(sortSelect, { target: { value: 'title-desc' } });
    expect(cardIds()).toEqual([pZeta, pBeta, pAlfa]);

    fireEvent.change(sortSelect, { target: { value: 'created-desc' } });
    expect(cardIds()).toEqual([pAlfa, pBeta, pZeta]);

    fireEvent.change(sortSelect, { target: { value: 'created-asc' } });
    expect(cardIds()).toEqual([pZeta, pBeta, pAlfa]);

    fireEvent.change(sortSelect, { target: { value: 'updated-desc' } });
    expect(cardIds()).toEqual([pZeta, pBeta, pAlfa]);
  });

  it('reorders pages inside a Section in HomeView by press-and-hold dragging a page thumbnail and resets sort to manual', async () => {
    render(<App />);
    await screen.findByTestId('home-view');
    const nbId = useStore.getState().workspace.notebookIds[0];
    const secId = useStore.getState().createSectionInHome(nbId, 'Sezione Drag');
    const p1 = useStore.getState().createPageInHome(secId, 'Prima')!;
    const p2 = useStore.getState().createPageInHome(secId, 'Seconda')!;
    const p3 = useStore.getState().createPageInHome(secId, 'Terza')!;
    useStore.getState().mutateWorkspace((w) => W.sortSectionPages(w, secId, 'title-asc'));

    fireEvent.click(screen.getByRole('button', { name: /^Quaderno / }));
    fireEvent.click(await screen.findByTestId('home-section-Sezione Drag'));
    const grid = await screen.findByTestId('home-section-pages-grid');

    const cards = Array.from(grid.querySelectorAll<HTMLElement>('.home-page-card[data-page-id]'));
    expect(cards).toHaveLength(3);

    cards.forEach((card, idx) => {
      const left = idx * 180;
      Object.defineProperty(card, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({
          left,
          top: 0,
          right: left + 160,
          bottom: 200,
          width: 160,
          height: 200,
          x: left,
          y: 0,
          toJSON: () => ({}),
        }),
      });
    });

    // Press and hold on the first card thumbnail to initiate drag without opening the page
    fireEvent.pointerDown(cards[0], { button: 0, clientX: 80, clientY: 100 });
    await waitFor(() => expect(screen.getByTestId('home-page-drag-ghost')).toBeInTheDocument());

    // Move pointer over the right half of the third card ('Terza')
    fireEvent.pointerMove(window, { clientX: 460, clientY: 100 });
    expect(cards[2]).toHaveClass('drop-after');

    // Drop and simulate trailing synthetic click
    fireEvent.pointerUp(window, { clientX: 460, clientY: 100 });
    fireEvent.click(cards[0]);

    expect(useUI.getState().homeOpen).toBe(true);
    expect(useStore.getState().workspace.sections[secId].pageIds).toEqual([p2, p3, p1]);
    expect(useStore.getState().workspace.sections[secId].pageSort).toBe('manual');

    const reorderedIds = Array.from(grid.querySelectorAll<HTMLElement>('.home-page-card[data-page-id]')).map((el) => el.dataset.pageId);
    expect(reorderedIds).toEqual([p2, p3, p1]);
  });

  it('shows Liquid Glass DockToolOptions above bottom dock only when a color/width tool is selected, removes line tool, and keeps FormatBar in top Ribbon', async () => {
    useUI.getState().set({ homeOpen: false });
    render(<App />);
    const palette = await screen.findByTestId('tool-palette');

    // Line tool is removed
    expect(palette.querySelector('[data-tool="line"]')).toBeNull();

    // Initially ('select'), dock-tool-options is hidden and FormatBar is in the top Ribbon
    expect(screen.queryByTestId('dock-tool-options')).toBeNull();
    expect(screen.getByTestId('format-bar')).toBeInTheDocument();

    // Selecting Pen shows dock-tool-options while FormatBar remains in the top Ribbon
    fireEvent.click(palette.querySelector('[data-tool="pen"]')!);
    expect(useStore.getState().tool).toBe('pen');
    expect(screen.getByTestId('dock-tool-options')).toBeInTheDocument();
    expect(screen.getByTestId('format-bar')).toBeInTheDocument();

    // Selecting Highlighter shows RED (#ff3b30) swatch instead of pink (#ff8fb8)
    fireEvent.click(palette.querySelector('[data-tool="highlighter"]')!);
    const dockOpts = screen.getByTestId('dock-tool-options');
    expect(dockOpts.querySelector('[title="#ff3b30"]')).toBeInTheDocument();
    expect(dockOpts.querySelector('[title="#ff8fb8"]')).toBeNull();

    // Selecting Eraser (no color/width) hides dock-tool-options and keeps FormatBar in top Ribbon
    fireEvent.click(palette.querySelector('[data-tool="eraser"]')!);
    expect(screen.queryByTestId('dock-tool-options')).toBeNull();
    expect(screen.getByTestId('format-bar')).toBeInTheDocument();

    // Selecting Rect shows border, fill, and width; re-clicking Rect deselects it and hides dock-tool-options
    fireEvent.click(palette.querySelector('[data-tool="rect"]')!);
    expect(screen.getByTestId('dock-tool-options')).toHaveTextContent('Riempimento');
    fireEvent.click(palette.querySelector('[data-tool="rect"]')!);
    expect(useStore.getState().tool).toBe('select');
    expect(screen.queryByTestId('dock-tool-options')).toBeNull();
  });

  it('navigates from Breadcrumb segments (Quaderno › Sezione › Pagina) to each corresponding Home dashboard level', async () => {
    useUI.getState().set({ homeOpen: false });
    render(<App />);
    await screen.findByTestId('canvas');
    const nbId = useStore.getState().notebookId!;
    const secId = useStore.getState().sectionId!;

    // 1. Click Pagina segment -> Pages grid of current Section
    fireEvent.click(screen.getByTestId('crumb-page'));
    expect(await screen.findByTestId('home-section-pages-grid')).toBeInTheDocument();
    expect(useUI.getState().homeOpen).toBe(true);
    expect(useUI.getState().homeNotebookId).toBe(nbId);
    expect(useUI.getState().homeSectionId).toBe(secId);

    // Return to workspace and click Sezione segment -> Sections grid of current Notebook
    fireEvent.click(screen.getByTestId('home-resume-workspace'));
    await screen.findByTestId('canvas');
    fireEvent.click(screen.getByTestId('crumb-section'));
    expect(await screen.findByTestId('home-sections-grid')).toBeInTheDocument();
    expect(useUI.getState().homeNotebookId).toBe(nbId);
    expect(useUI.getState().homeSectionId).toBeNull();

    // Return to workspace and click Quaderno segment -> All Notebooks grid
    fireEvent.click(screen.getByTestId('home-resume-workspace'));
    await screen.findByTestId('canvas');
    fireEvent.click(screen.getByTestId('crumb-notebook'));
    expect(await screen.findByTestId('home-notebooks-grid')).toBeInTheDocument();
    expect(useUI.getState().homeNotebookId).toBeNull();
    expect(useUI.getState().homeSectionId).toBeNull();
  });

  it('supports top Ribbon controls across states (heading inside list, red text highlight, formatting without active editor, and rotating freeImage containers)', async () => {
    useUI.getState().set({ homeOpen: false });
    render(<App />);
    await screen.findByTestId('canvas');
    useStore.getState().setEditing(null);
    useStore.getState().setSelection([]);

    // 1. Clicking Bullet List when no editor is active creates & focuses a text container with a bullet list
    fireEvent.click(screen.getByRole('button', { name: /^Elenco puntato/ }));
    await waitFor(() => {
      const active = useActiveEditor.getState().editor;
      expect(active).not.toBeNull();
      expect(active!.isActive('bulletList')).toBe(true);
    });
    const ed = useActiveEditor.getState().editor!;

    // 2. Switching paragraph style to Heading 1 inside a bullet list lifts out cleanly and sets H1
    ed.commands.insertContent('Titolo da lista');
    const styleSelect = screen.getByRole('combobox', { name: 'Stile paragrafo' });
    fireEvent.change(styleSelect, { target: { value: 'h1' } });
    expect(ed.isActive('heading', { level: 1 })).toBe(true);

    // 3. Text highlighter popover exposes RED (#ff6b6b) instead of pink (#ffc9de)
    fireEvent.click(screen.getByRole('button', { name: 'Evidenziazione' }));
    expect(document.querySelector('.popover [title="#ff6b6b"]')).toBeInTheDocument();
    expect(document.querySelector('.popover [title="#ffc9de"]')).toBeNull();

    // 4. Selecting a modern freeImage container exposes Rotate buttons in SelectionActions and updates rotation
    useStore.getState().setEditing(null);
    const pid = useStore.getState().pageId!;
    useStore.getState().updatePage((p) => ({
      ...p,
      items: {
        ...p.items,
        imgFree1: {
          id: 'imgFree1',
          type: 'container',
          x: 100,
          y: 200,
          w: 200,
          h: 150,
          freeImage: true,
          customW: true,
          variant: 'plain',
          doc: {
            type: 'doc',
            content: [{ type: 'imageBlock', attrs: { assetId: 'a1', width: 200, naturalWidth: 400, naturalHeight: 300, rotation: 0 } }],
          },
        },
      },
      order: [...p.order, 'imgFree1'],
    }));
    useStore.getState().setTool('select');
    useStore.getState().setSelection(['imgFree1']);

    const rotRight = await screen.findByRole('button', { name: 'Ruota a destra' });
    fireEvent.click(rotRight);
    const updatedImg = useStore.getState().pages[pid].items.imgFree1;
    expect(updatedImg.type === 'container' && updatedImg.doc.content?.[0]?.attrs?.rotation).toBe(90);
  });

  it('keeps the user on the Home dashboard when deleting the currently active section or notebook from Home', async () => {
    render(<App />);
    await screen.findByTestId('home-view');
    const curSecId = useStore.getState().sectionId!;
    expect(curSecId).toBeTruthy();
    expect(useUI.getState().homeOpen).toBe(true);

    useStore.getState().deleteSection(curSecId);
    expect(useUI.getState().homeOpen).toBe(true);
    expect(useStore.getState().workspace.sections[curSecId]).toBeUndefined();
  });
});
