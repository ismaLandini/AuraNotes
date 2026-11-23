/**
 * Integration with the macOS Tauri 2 shell (AuraNotes.app).
 * In a normal browser neither `__TAURI_INTERNALS__` nor `window.auranotesDesktop`
 * is present and `desktop()` returns `null`.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { flush, hasUnsavedChanges } from './storage/autosave';
import { useStore } from './store/useStore';
import { useUI, toast } from './store/ui';
import { useSettings } from './store/settings';
import { buildBackup } from './storage/backup';
import { exportBackup, pickBackupFile } from './components/SettingsDialog';
import { importPdfAsDocument } from './pdf/importPdfDocument';
import { pickPdfFile } from './components/PdfImportDialog';
import { consumeShiftPasteIntent, pastePlainText } from './canvas/actions';

export interface DesktopBridge {
  platform: string;
  onFlushRequest(handler: () => Promise<void>): void;
  onMenu(handler: (cmd: string) => void): void;
  writeBackup(json: string): Promise<string>;
  openBackups(): Promise<void>;
  savePdf(title: string): Promise<string | null>;
  info(): Promise<{ version: string; userData: string; backups: string }>;
  setTheme(theme: string, dark: boolean): Promise<void>;
  readClipboardText?(): Promise<string>;
  snapWindow?(direction: 'left' | 'right' | 'top' | 'bottom' | 'fill'): Promise<void>;
}

function hasTauriInternals(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    '__TAURI_INTERNALS__' in window ||
    '__TAURI__' in window ||
    window.location.protocol === 'tauri:' ||
    window.location.protocol === 'app:' ||
    window.location.protocol === 'asset:' ||
    document.documentElement.classList.contains('is-desktop')
  );
}

const tauriBridge: DesktopBridge = {
  platform: 'darwin',
  onFlushRequest(handler) {
    void listen('glassnotes:flush-request', async () => {
      try {
        await handler();
      } finally {
        await invoke('flush_done').catch(() => undefined);
      }
    });
  },
  onMenu(handler) {
    void listen<string>('glassnotes:menu', (event) => {
      if (typeof event.payload === 'string') {
        handler(event.payload);
      }
    });
  },
  writeBackup(json: string) {
    return invoke<string>('write_backup', { json });
  },
  async openBackups() {
    await invoke('open_backups');
  },
  async savePdf(title: string): Promise<string | null> {
    await new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        window.removeEventListener('afterprint', done);
        resolve();
      };
      window.addEventListener('afterprint', done);
      setTimeout(done, 60_000);
      void invoke<string | null>('save_pdf', { title }).catch(() => done());
    });
    return null;
  },
  info() {
    return invoke<{ version: string; userData: string; backups: string }>('get_app_info');
  },
  async setTheme(theme: string, dark: boolean) {
    await invoke('set_theme', { theme, dark });
  },
  readClipboardText() {
    return invoke<string>('read_clipboard_text');
  },
  async snapWindow(direction: 'left' | 'right' | 'top' | 'bottom' | 'fill') {
    await invoke('snap_window', { direction });
  },
};

export function desktop(): DesktopBridge | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { auranotesDesktop?: DesktopBridge; glassnotesDesktop?: DesktopBridge };
  if (w.auranotesDesktop) return w.auranotesDesktop;
  if (w.glassnotesDesktop) return w.glassnotesDesktop;
  if (hasTauriInternals()) return tauriBridge;
  return null;
}

export const isDesktop = () => desktop() !== null;

const BACKUP_EVERY_MS = 20 * 60 * 1000;
let lastBackupTick = -1;

/** Writes an automatic JSON backup when something changed since the previous one. */
export async function autoBackup(force = false): Promise<void> {
  const d = desktop();
  const st = useStore.getState();
  if (!d || !st.loaded || st.loadError) return;
  if (!force && st.dirtyTick === lastBackupTick) return;
  try {
    await flush();
    const tick = useStore.getState().dirtyTick;
    const b = await buildBackup(useStore.getState().workspace, useStore.getState().pages);
    await d.writeBackup(JSON.stringify(b));
    lastBackupTick = tick;
  } catch (e) {
    console.warn('Backup automatico non riuscito', e);
  }
}

function runMenu(cmd: string) {
  const ui = useUI.getState();
  const st = useStore.getState();
  switch (cmd) {
    case 'new-page':
      if (st.sectionId) st.addPage();
      break;
    case 'import-pdf': {
      const activeSecId = ui.homeOpen ? (ui.homeSectionId ?? st.sectionId) : (st.sectionId ?? ui.homeSectionId);
      if (!ui.homeOpen && st.pageId) {
        pickPdfFile();
        break;
      }
      if (!activeSecId) {
        toast('Per importare un PDF, apri o seleziona prima una sezione', 'info');
        break;
      }
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/pdf,.pdf';
      input.style.position = 'fixed';
      input.style.top = '-10000px';
      input.style.opacity = '0';
      document.body.appendChild(input);
      const cleanup = () => {
        input.remove();
      };
      input.onchange = async () => {
        const file = input.files?.[0];
        cleanup();
        if (file) {
          try {
            toast('Importazione del PDF in corso...', 'info', 2500);
            const res = await importPdfAsDocument(file, file.name, activeSecId);
            toast(`"${res.title}" importato con successo (${res.sheetCount} pagine)`, 'success');
            await useStore.getState().openPage(res.pageId);
          } catch (err) {
            console.error('Errore importazione PDF:', err);
            toast('Impossibile importare il PDF. Verifica che il file sia valido.', 'error');
          }
        }
      };
      input.oncancel = cleanup;
      input.click();
      break;
    }
    case 'export-pdf':
      if (st.pageId) ui.set({ exportOpen: true });
      break;
    case 'export-section-pdf': {
      const secId = st.sectionId;
      if (secId) {
        ui.set({ exportOpen: true, exportInitialScope: 'section', exportSectionId: secId });
      }
      break;
    }
    case 'export-notebook-pdf': {
      const nbId = st.notebookId;
      if (nbId) {
        ui.set({ exportOpen: true, exportInitialScope: 'notebook', exportNotebookId: nbId });
      }
      break;
    }
    case 'settings':
      ui.set({ settingsOpen: true });
      break;
    case 'search':
      ui.set({ searchOpen: true });
      break;
    case 'shortcuts':
      ui.set({ shortcutsOpen: !ui.shortcutsOpen });
      break;
    case 'toggle-sidebar': {
      const s = useSettings.getState();
      s.setLayout({ sidebarVisible: !s.layout.sidebarVisible });
      break;
    }
    case 'export-backup':
      void exportBackup();
      break;
    case 'import-backup':
      pickBackupFile();
      break;
    case 'open-backups':
      void desktop()?.openBackups();
      break;
    case 'paste-match-style':
      consumeShiftPasteIntent();
      void desktop()
        ?.readClipboardText?.()
        .then((text) => {
          if (text) pastePlainText(text);
        })
        .catch((err) => console.warn('Incolla e adatta stile non riuscito', err));
      break;
  }
}

let initialised = false;

export function initDesktop(): void {
  const d = desktop();
  if (!d || initialised) return;
  initialised = true;
  document.documentElement.classList.add('is-desktop');
  d.onFlushRequest(async () => {
    if (hasUnsavedChanges()) await flush();
    await autoBackup();
  });
  d.onMenu(runMenu);

  if (hasTauriInternals()) {
    document.addEventListener(
      'click',
      (e) => {
        const target = e.target as HTMLElement | null;
        const anchor = target?.closest?.('a[href]') as HTMLAnchorElement | null;
        if (!anchor) return;
        const href = anchor.getAttribute('href') ?? '';
        if (/^(https?:|mailto:)/i.test(href)) {
          e.preventDefault();
          void invoke('open_external', { url: href }).catch(() => undefined);
        }
      },
      true,
    );
  }

  // First backup shortly after start (once the notes are loaded), then periodically.
  setTimeout(() => void autoBackup(true), 15_000);
  setInterval(() => void autoBackup(), BACKUP_EVERY_MS);
  void d.info().then((i) => console.info(`AuraNotes ${i.version} — dati in ${i.userData}`));
}
