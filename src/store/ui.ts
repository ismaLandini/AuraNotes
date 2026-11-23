import { create } from 'zustand';

export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  /** Optional third choice (e.g. "Unisci" vs "Sostituisci"). */
  altLabel?: string;
  resolve: (choice: 'confirm' | 'alt' | 'cancel') => void;
}

export interface PromptRequest {
  title: string;
  label?: string;
  initial: string;
  placeholder?: string;
  multiline?: boolean;
  /** Renders a KaTeX preview below the input. */
  mathPreview?: boolean;
  /** Keeps an active canvas text editor alive while this prompt is open. */
  keepEditing?: boolean;
  confirmLabel?: string;
  resolve: (value: string | null) => void;
}

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'error';
  message: string;
}

export type HomeTab = 'notebooks' | 'recent' | 'favorites' | 'trash';

export type NavHistoryEntry =
  | { kind: 'home'; homeTab: HomeTab; homeNotebookId: string | null; homeSectionId: string | null }
  | { kind: 'page'; pageId: string };

const MAX_NAV_HISTORY = 50;

interface UIState {
  confirm: ConfirmRequest | null;
  prompt: PromptRequest | null;
  toasts: Toast[];
  homeOpen: boolean;
  homeTab: HomeTab;
  homeNotebookId: string | null;
  homeSectionId: string | null;
  navHistory: NavHistoryEntry[];
  searchOpen: boolean;
  settingsOpen: boolean;
  shortcutsOpen: boolean;
  exportOpen: boolean;
  exportInitialScope?: 'page' | 'selected' | 'section' | 'notebook';
  exportNotebookId?: string | null;
  exportSectionId?: string | null;
  trashOpen: boolean;
  pdfDialogOpen: boolean;
  templatePickerOpen: boolean;
  outlineOpen: boolean;
  mobileNavOpen: boolean;
  set: (patch: Partial<Omit<UIState, 'set'>>) => void;
}

export const useUI = create<UIState>((set) => ({
  confirm: null,
  prompt: null,
  toasts: [],
  homeOpen: true,
  homeTab: 'notebooks',
  homeNotebookId: null,
  homeSectionId: null,
  navHistory: [],
  searchOpen: false,
  settingsOpen: false,
  shortcutsOpen: false,
  exportOpen: false,
  exportInitialScope: undefined,
  exportNotebookId: null,
  exportSectionId: null,
  trashOpen: false,
  pdfDialogOpen: false,
  templatePickerOpen: false,
  outlineOpen: false,
  mobileNavOpen: false,
  set: (patch) => set(patch),
}));

export function pushNavHistory(entry: NavHistoryEntry): void {
  useUI.setState((s) => {
    const last = s.navHistory[s.navHistory.length - 1];
    if (
      last &&
      last.kind === entry.kind &&
      (entry.kind === 'page'
        ? last.kind === 'page' && last.pageId === entry.pageId
        : last.kind === 'home' &&
          last.homeTab === entry.homeTab &&
          last.homeNotebookId === entry.homeNotebookId &&
          last.homeSectionId === entry.homeSectionId)
    ) {
      return s;
    }
    const next = [...s.navHistory, entry];
    return { navHistory: next.length > MAX_NAV_HISTORY ? next.slice(-MAX_NAV_HISTORY) : next };
  });
}

let toastSeq = 1;

export function toast(message: string, kind: Toast['kind'] = 'info', ms = 3200): void {
  const id = toastSeq++;
  useUI.setState((s) => ({ toasts: [...s.toasts, { id, kind, message }] }));
  setTimeout(() => useUI.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), ms);
}

export function askConfirm(opts: Omit<ConfirmRequest, 'resolve'>): Promise<'confirm' | 'alt' | 'cancel'> {
  return new Promise((resolve) => {
    useUI.setState({
      confirm: {
        ...opts,
        resolve: (c) => {
          useUI.setState({ confirm: null });
          resolve(c);
        },
      },
    });
  });
}

export async function confirmDanger(title: string, message: string, confirmLabel = 'Elimina'): Promise<boolean> {
  return (await askConfirm({ title, message, confirmLabel, danger: true })) === 'confirm';
}

export function askText(opts: Omit<PromptRequest, 'resolve'>): Promise<string | null> {
  return new Promise((resolve) => {
    useUI.setState({
      prompt: {
        ...opts,
        resolve: (v) => {
          useUI.setState({ prompt: null });
          resolve(v);
        },
      },
    });
  });
}

/** True when any modal dialog is open (global shortcuts should then be suspended). */
export function isModalOpen(): boolean {
  const s = useUI.getState();
  return !!(s.confirm || s.prompt || s.searchOpen || s.settingsOpen || s.exportOpen || s.trashOpen || s.pdfDialogOpen || s.templatePickerOpen);
}
