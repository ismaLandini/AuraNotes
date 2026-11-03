/**
 * Integration with the macOS shell (AuraNotes.app). In a normal browser
 * `window.auranotesDesktop` is absent and nothing here runs.
 */
import { flush, hasUnsavedChanges } from './storage/autosave';
import { useStore } from './store/useStore';
import { useUI } from './store/ui';
import { useSettings } from './store/settings';
import { buildBackup } from './storage/backup';
import { exportBackup, pickBackupFile } from './components/SettingsDialog';
import { pickPdfFile } from './canvas/actions';

export interface DesktopBridge {
  platform: string;
  onFlushRequest(handler: () => Promise<void>): void;
  onMenu(handler: (cmd: string) => void): void;
  writeBackup(json: string): Promise<string>;
  openBackups(): Promise<void>;
  savePdf(title: string): Promise<string | null>;
  info(): Promise<{ version: string; userData: string; backups: string }>;
  setTheme(theme: string, dark: boolean): Promise<void>;
}

export function desktop(): DesktopBridge | null {
  const w = window as unknown as { auranotesDesktop?: DesktopBridge; glassnotesDesktop?: DesktopBridge };
  return w.auranotesDesktop ?? w.glassnotesDesktop ?? null;
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
    case 'import-pdf':
      pickPdfFile();
      break;
    case 'export-pdf':
      if (st.pageId) ui.set({ exportOpen: true });
      break;
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
  // First backup shortly after start (once the notes are loaded), then periodically.
  setTimeout(() => void autoBackup(true), 15_000);
  setInterval(() => void autoBackup(), BACKUP_EVERY_MS);
  void d.info().then((i) => console.info(`AuraNotes ${i.version} — dati in ${i.userData}`));
}
