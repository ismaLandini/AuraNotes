import type { ShortcutDef } from './registry';
import { useStore } from '../store/useStore';
import { useSettings } from '../store/settings';
import { useUI, isModalOpen } from '../store/ui';
import { flush } from '../storage/autosave';
import { toast } from '../store/ui';
import { createTextBlock, deleteSelection, duplicateSelection, groupSelection, ungroupSelection, nudgeSelection, reorderSelection, selectAll, toggleLockSelection, finishEditing, cancelActiveGesture } from '../canvas/actions';
import { centerContent, fitContent, insertionPoint, resetZoom, zoomAt } from '../canvas/viewport';
import { TOOL_DEFS } from '../components/ToolPalette';
import { isEditableTarget } from './registry';
import { desktop } from '../desktop';

const hasPage = () => !!useStore.getState().pageId;

function newPage() {
  if (!useStore.getState().sectionId) {
    toast('Crea prima una sezione', 'error');
    return;
  }
  useStore.getState().addPage();
}

function toggleSidebar() {
  if (window.matchMedia('(max-width: 900px)').matches) {
    const ui = useUI.getState();
    ui.set({ mobileNavOpen: !ui.mobileNavOpen });
    return;
  }
  const s = useSettings.getState();
  s.setLayout({ sidebarVisible: !s.layout.sidebarVisible });
}

function closeTopOverlay(): boolean {
  const ui = useUI.getState();
  if (ui.shortcutsOpen) {
    ui.set({ shortcutsOpen: false });
    return true;
  }
  if (ui.mobileNavOpen) {
    ui.set({ mobileNavOpen: false });
    return true;
  }
  return false;
}

export function buildShortcuts(): ShortcutDef[] {
  const defs: ShortcutDef[] = [
    // ------------------------------------------------------------- global
    { id: 'save', keys: ['mod+s'], label: 'Salva ora', category: 'Pagine e blocchi', scope: 'global', run: () => void flush().then(() => toast('Salvato', 'success', 1200)) },
    {
      id: 'search',
      keys: ['mod+k', 'mod+f'],
      label: 'Ricerca globale',
      category: 'Ricerca e impostazioni',
      scope: 'global',
      note: 'Nel testo in modifica ⌘K inserisce un collegamento',
      run: (e) => {
        // ⌘K inside the rich-text editor is "insert link" (handled by the editor).
        if (e.key.toLowerCase() === 'k' && useStore.getState().editingId) return false;
        useUI.getState().set({ searchOpen: true, shortcutsOpen: false });
      },
    },
    {
      id: 'shortcuts',
      keys: ['mod+/', 'shift+?'],
      label: 'Mostra scorciatoie',
      category: 'Ricerca e impostazioni',
      scope: 'global',
      inModal: true,
      run: (e) => {
        if (!e.metaKey && !e.ctrlKey && (useStore.getState().editingId || (e.target as HTMLElement)?.closest?.('input,textarea,[contenteditable="true"]'))) return false;
        const ui = useUI.getState();
        if (isModalOpen() && !ui.shortcutsOpen) return false;
        ui.set({ shortcutsOpen: !ui.shortcutsOpen });
      },
    },
    { id: 'new-page', keys: ['mod+alt+n', 'mod+n'], label: 'Nuova pagina', category: 'Pagine e blocchi', scope: 'global', note: '⌘N è riservato da alcuni browser: usa ⌥⌘N', run: newPage },
    {
      id: 'template-picker',
      keys: ['mod+shift+n'],
      label: 'Nuova pagina da template',
      category: 'Pagine e blocchi',
      scope: 'global',
      run: () => {
        useUI.getState().set({ templatePickerOpen: true });
      },
    },
    {
      id: 'page-outline',
      keys: ['mod+shift+o', 'mod+alt+o'],
      label: 'Indice dinamico della pagina',
      category: 'Navigazione',
      scope: 'global',
      run: () => {
        if (!hasPage()) return false;
        const ui = useUI.getState();
        ui.set({ outlineOpen: !ui.outlineOpen });
      },
    },
    { id: 'sidebar', keys: ['mod+shift+b'], label: 'Mostra/nascondi pannelli di navigazione', category: 'Navigazione', scope: 'global', run: toggleSidebar },
    { id: 'focus-mode', keys: ['mod+alt+f'], label: 'Modalità concentrazione (solo pagina)', category: 'Navigazione', scope: 'global', run: toggleSidebar },
    {
      id: 'print',
      keys: ['mod+p'],
      label: 'Stampa / esporta PDF',
      category: 'Pagine e blocchi',
      scope: 'global',
      run: () => {
        if (!hasPage()) return false;
        useUI.getState().set({ exportOpen: true });
      },
    },
    {
      id: 'print-section',
      keys: ['mod+shift+alt+p'],
      label: 'Esporta intera sezione in PDF',
      category: 'Pagine e blocchi',
      scope: 'global',
      run: () => {
        const secId = useStore.getState().sectionId;
        if (!secId) return false;
        useUI.getState().set({ exportOpen: true, exportInitialScope: 'section', exportSectionId: secId });
      },
    },
    {
      id: 'print-notebook',
      keys: ['mod+alt+p'],
      label: 'Esporta intero quaderno in PDF',
      category: 'Pagine e blocchi',
      scope: 'global',
      run: () => {
        const nbId = useStore.getState().notebookId;
        if (!nbId) return false;
        useUI.getState().set({ exportOpen: true, exportInitialScope: 'notebook', exportNotebookId: nbId });
      },
    },
    { id: 'zoom-in', keys: ['mod+plus'], label: 'Ingrandisci', category: 'Zoom e vista', scope: 'global', run: () => (hasPage() ? zoomAt(1.2) : false) },
    { id: 'zoom-out', keys: ['mod+minus'], label: 'Riduci', category: 'Zoom e vista', scope: 'global', run: () => (hasPage() ? zoomAt(1 / 1.2) : false) },
    { id: 'zoom-reset', keys: ['mod+0'], label: 'Zoom 100%', category: 'Zoom e vista', scope: 'global', run: () => (hasPage() ? resetZoom() : false) },
    { id: 'fit', keys: ['shift+1'], label: 'Adatta tutto il contenuto alla vista', category: 'Zoom e vista', scope: 'canvas', run: () => fitContent() },
    { id: 'center', keys: ['shift+2'], label: 'Centra il contenuto', category: 'Zoom e vista', scope: 'canvas', run: () => centerContent() },
    { id: 'pan', keys: ['space'], label: 'Spazio + trascina: sposta la vista', category: 'Zoom e vista', scope: 'text', note: 'Anche due dita sul trackpad; pizzica per lo zoom' },
    {
      id: 'escape',
      keys: ['escape'],
      label: 'Chiudi pannello / deseleziona / esci dal testo',
      category: 'Navigazione',
      scope: 'canvas',
      inModal: true,
      run: () => {
        if (cancelActiveGesture && cancelActiveGesture()) return;
        if (closeTopOverlay()) return;
        if (isModalOpen()) return false;
        const s = useStore.getState();
        if (s.editingId) {
          finishEditing(s.editingId);
          return;
        }
        if (s.selection.length) s.setSelection([]);
        else if (s.tool !== 'select') s.setTool('select');
        else return false;
      },
    },
    { id: 'prev-page', keys: ['mod+alt+up'], label: 'Pagina precedente', category: 'Navigazione', scope: 'canvas', run: () => stepPage(-1) },
    { id: 'next-page', keys: ['mod+alt+down'], label: 'Pagina successiva', category: 'Navigazione', scope: 'canvas', run: () => stepPage(1) },

    // ------------------------------------------------------------- canvas
    { id: 'undo', keys: ['mod+z'], label: 'Annulla', category: 'Canvas', scope: 'canvas', note: 'Nel testo annulla la digitazione', run: () => void useStore.getState().undo() },
    { id: 'redo', keys: ['mod+shift+z', 'mod+y'], label: 'Ripeti', category: 'Canvas', scope: 'canvas', run: () => void useStore.getState().redo() },
    { id: 'select-all', keys: ['mod+a'], label: 'Seleziona tutti gli oggetti', category: 'Canvas', scope: 'canvas', run: () => (hasPage() ? selectAll() : false) },
    { id: 'delete', keys: ['delete', 'backspace'], label: 'Elimina gli oggetti selezionati (anche gruppi e connettori)', category: 'Canvas', scope: 'canvas', note: 'Mentre scrivi cancella i caratteri', run: () => deleteSelection() || false },
    { id: 'duplicate', keys: ['mod+d'], label: 'Duplica selezione', category: 'Canvas', scope: 'canvas', run: () => duplicateSelection() },
    {
      id: 'new-text',
      keys: ['mod+alt+t', 'mod+shift+t'],
      label: 'Nuovo blocco di testo',
      category: 'Pagine e blocchi',
      scope: 'canvas',
      note: '⇧⌘T è riservato da Chrome: usa ⌥⌘T',
      run: () => {
        if (!hasPage()) return false;
        const p = insertionPoint();
        createTextBlock({ x: p.x - 40, y: p.y - 16 });
      },
    },
    {
      id: 'edit-text',
      keys: ['enter'],
      label: 'Modifica il blocco di testo selezionato',
      category: 'Pagine e blocchi',
      scope: 'canvas',
      run: () => {
        const s = useStore.getState();
        const it = s.selection.length === 1 ? s.currentPage()?.items[s.selection[0]] : undefined;
        if (it?.type !== 'text') return false;
        s.setEditing(it.id);
      },
    },
    { id: 'group', keys: ['mod+g'], label: 'Raggruppa selezione', category: 'Canvas', scope: 'canvas', run: () => groupSelection() },
    { id: 'ungroup', keys: ['mod+shift+g'], label: 'Separa gruppo', category: 'Canvas', scope: 'canvas', run: () => ungroupSelection() },
    { id: 'lock', keys: ['mod+shift+l'], label: 'Blocca/sblocca selezione', category: 'Canvas', scope: 'canvas', run: () => toggleLockSelection() },
    { id: 'front', keys: ['mod+shift+up'], label: 'Porta in primo piano', category: 'Canvas', scope: 'canvas', run: () => reorderSelection('front') },
    { id: 'forward', keys: ['mod+up'], label: 'Porta avanti', category: 'Canvas', scope: 'canvas', run: () => reorderSelection('forward') },
    { id: 'backward', keys: ['mod+down'], label: 'Porta indietro', category: 'Canvas', scope: 'canvas', run: () => reorderSelection('backward') },
    { id: 'back', keys: ['mod+shift+down'], label: 'Porta in fondo', category: 'Canvas', scope: 'canvas', run: () => reorderSelection('back') },
    { id: 'nudge-l', keys: ['left', 'shift+left'], label: 'Sposta selezione (⇧ = 10 px)', category: 'Canvas', scope: 'canvas', run: (e) => nudge(e, -1, 0) },
    { id: 'nudge-r', keys: ['right', 'shift+right'], label: 'Sposta a destra', category: 'Canvas', scope: 'canvas', run: (e) => nudge(e, 1, 0) },
    { id: 'nudge-u', keys: ['up', 'shift+up'], label: 'Sposta in alto', category: 'Canvas', scope: 'canvas', run: (e) => nudge(e, 0, -1) },
    { id: 'nudge-d', keys: ['down', 'shift+down'], label: 'Sposta in basso', category: 'Canvas', scope: 'canvas', run: (e) => nudge(e, 0, 1) },

    // ------------------------------------------------------------- clipboard (native events)
    { id: 'copy', keys: ['mod+c'], label: 'Copia', category: 'Appunti', scope: 'text' },
    { id: 'cut', keys: ['mod+x'], label: 'Taglia', category: 'Appunti', scope: 'text' },
    { id: 'paste', keys: ['mod+v'], label: 'Incolla (testo, immagini o oggetti)', category: 'Appunti', scope: 'text' },
    { id: 'paste-plain', keys: ['mod+shift+v'], label: 'Incolla con formato e colori di sistema', category: 'Appunti', scope: 'text' },

    // ------------------------------------------------------------- text formatting (editor)
    { id: 'f-bold', keys: ['mod+b'], label: 'Grassetto', category: 'Formattazione testo', scope: 'text' },
    { id: 'f-italic', keys: ['mod+i'], label: 'Corsivo', category: 'Formattazione testo', scope: 'text' },
    { id: 'f-underline', keys: ['mod+u'], label: 'Sottolineato', category: 'Formattazione testo', scope: 'text' },
    { id: 'f-strike', keys: ['mod+shift+x'], label: 'Barrato', category: 'Formattazione testo', scope: 'text' },
    { id: 'f-code', keys: ['mod+e'], label: 'Codice in linea', category: 'Formattazione testo', scope: 'text' },
    { id: 'f-codeblock', keys: ['mod+alt+c'], label: 'Blocco di codice', category: 'Formattazione testo', scope: 'text' },
    { id: 'f-h1', keys: ['mod+alt+1'], label: 'Titolo 1', category: 'Formattazione testo', scope: 'text' },
    { id: 'f-h2', keys: ['mod+alt+2'], label: 'Titolo 2', category: 'Formattazione testo', scope: 'text' },
    { id: 'f-h3', keys: ['mod+alt+3'], label: 'Titolo 3', category: 'Formattazione testo', scope: 'text' },
    { id: 'f-p', keys: ['mod+alt+0'], label: 'Testo normale', category: 'Formattazione testo', scope: 'text' },
    { id: 'f-bullet', keys: ['mod+shift+8'], label: 'Elenco puntato', category: 'Formattazione testo', scope: 'text' },
    { id: 'f-ordered', keys: ['mod+shift+7'], label: 'Elenco numerato', category: 'Formattazione testo', scope: 'text' },
    { id: 'f-task', keys: ['mod+shift+9'], label: 'Lista di controllo', category: 'Formattazione testo', scope: 'text' },
    { id: 'f-hl', keys: ['mod+shift+h'], label: 'Evidenzia', category: 'Formattazione testo', scope: 'text' },
    { id: 'f-sup', keys: ['mod+.'], label: 'Apice', category: 'Formattazione testo', scope: 'text' },
    { id: 'f-sub', keys: ['mod+,'], label: 'Pedice', category: 'Formattazione testo', scope: 'text' },
    { id: 'f-link', keys: ['mod+k'], label: 'Inserisci collegamento', category: 'Formattazione testo', scope: 'text' },
    { id: 'f-indent', keys: ['tab', 'shift+tab'], label: 'Aumenta / riduci rientro', category: 'Formattazione testo', scope: 'text' },
    { id: 'f-undo', keys: ['mod+z'], label: 'Annulla digitazione', category: 'Formattazione testo', scope: 'text' },
    { id: 'f-exit', keys: ['escape'], label: 'Esci dalla modifica del testo', category: 'Formattazione testo', scope: 'text' },
    { id: 'f-md', keys: ['#'], label: 'Markdown rapido: “# ”, “- ”, “1. ”, “[ ] ”, “> ”, “```”', category: 'Formattazione testo', scope: 'text' },
  ];

  // Single-key tool shortcuts (only outside text fields)
  for (const t of TOOL_DEFS) {
    defs.push({
      id: `tool-${t.tool}`,
      keys: [t.key],
      label: t.label,
      category: 'Disegno',
      scope: 'canvas',
      run: () => {
        if (!hasPage()) return false;
        const st = useStore.getState();
        if (st.editingId) {
          const active = document.activeElement as HTMLElement | null;
          if (isEditableTarget(active) || active?.closest?.('[data-keep-editing]') || useUI.getState().prompt) {
            return false;
          }
          finishEditing(st.editingId);
        }
        const cur = useStore.getState().tool;
        if (cur === t.tool) {
          useStore.getState().setTool('select');
        } else {
          useStore.getState().setTool(t.tool);
        }
      },
    });
  }
  defs.push({ id: 'draw-shift', keys: ['⇧'], label: 'Tieni ⇧ mentre disegni: linee a 45°, quadrati e cerchi', category: 'Disegno', scope: 'text' });
  defs.push({ id: 'draw-alt', keys: ['⌥'], label: 'Tieni ⌥ ridimensionando un’immagine: proporzioni libere', category: 'Disegno', scope: 'text' });
  const snap = (dir: 'left' | 'right' | 'top' | 'bottom') => () => {
    const fn = desktop()?.snapWindow;
    if (!fn) return false;
    void fn(dir);
  };
  defs.push(
    { id: 'snap-left', keys: ['ctrl+home', 'ctrl+left'], label: 'Finestra metà sinistra', category: 'Zoom e vista', scope: 'global', run: snap('left') },
    { id: 'snap-right', keys: ['ctrl+end', 'ctrl+right'], label: 'Finestra metà destra', category: 'Zoom e vista', scope: 'global', run: snap('right') },
    { id: 'snap-top', keys: ['ctrl+pageup', 'ctrl+up'], label: 'Finestra metà superiore', category: 'Zoom e vista', scope: 'global', run: snap('top') },
    { id: 'snap-bottom', keys: ['ctrl+pagedown', 'ctrl+down'], label: 'Finestra metà inferiore', category: 'Zoom e vista', scope: 'global', run: snap('bottom') },
  );
  return defs;
}

function nudge(e: KeyboardEvent, dx: number, dy: number) {
  const s = useStore.getState();
  if (!s.selection.length) return false;
  const step = e.shiftKey ? 10 : 1;
  nudgeSelection(dx * step, dy * step);
}

function stepPage(dir: number) {
  const s = useStore.getState();
  if (!s.sectionId || !s.pageId) return false;
  const ids = s.workspace.sections[s.sectionId].pageIds;
  const i = ids.indexOf(s.pageId);
  const next = ids[i + dir];
  if (next) void s.openPage(next);
}
