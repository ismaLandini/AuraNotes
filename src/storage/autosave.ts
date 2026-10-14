import { dirty, useStore } from '../store/useStore';
import { useSettings } from '../store/settings';
import { isQuotaError, saveAll } from './db';
import { pageSearchText } from '../model/pageOps';
import { setPageMeta } from '../model/workspaceOps';
import type { PageContent } from '../types';
import { toast } from '../store/ui';

let timer: ReturnType<typeof setTimeout> | null = null;

/** Hooks run synchronously before saving (e.g. the open text editor pushes its latest keystrokes). */
const preFlush = new Set<() => void>();
export function registerPreFlush(fn: () => void): () => void {
  preFlush.add(fn);
  return () => preFlush.delete(fn);
}
let inFlight: Promise<void> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Writes all dirty data to IndexedDB. The status only becomes "saved" after the
 * transaction has committed successfully.
 */
export async function flush(): Promise<void> {
  preFlush.forEach((fn) => {
    try {
      fn();
    } catch (e) {
      console.warn(e);
    }
  });
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (inFlight) {
    await inFlight;
    if (!dirty.ws && dirty.pages.size === 0) return;
  }
  if (!dirty.ws && dirty.pages.size === 0) {
    if (useStore.getState().saveStatus !== 'error') useStore.getState().setSaveStatus('saved');
    return;
  }
  const state = useStore.getState();
  const pageIds = [...dirty.pages];
  const wasWs = dirty.ws;
  dirty.pages.clear();
  dirty.ws = false;

  // Refresh search text & timestamps of modified pages (without re-marking dirty).
  let ws = state.workspace;
  const pages: PageContent[] = [];
  const now = Date.now();
  for (const id of pageIds) {
    const p = state.pages[id];
    if (!p) continue;
    pages.push(p);
    if (ws.pages[id]) ws = setPageMeta(ws, id, { searchText: pageSearchText(p), updatedAt: now });
  }
  const wsChanged = ws !== state.workspace;
  if (wsChanged) useStore.setState({ workspace: ws });

  state.setSaveStatus('saving');
  inFlight = (async () => {
    try {
      await saveAll(wasWs || wsChanged ? ws : null, pages);
      const stillDirty = dirty.ws || dirty.pages.size > 0;
      useStore.getState().setSaveStatus(stillDirty ? 'unsaved' : 'saved');
      if (stillDirty) schedule();
    } catch (e) {
      // Put the work back so nothing is lost and retry later.
      for (const id of pageIds) dirty.pages.add(id);
      dirty.ws = dirty.ws || wasWs || wsChanged;
      const msg = isQuotaError(e)
        ? 'Spazio di archiviazione esaurito: libera spazio o esporta un backup.'
        : `Salvataggio non riuscito: ${e instanceof Error ? e.message : String(e)}`;
      useStore.getState().setSaveStatus('error', msg);
      toast(msg, 'error', 6000);
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(() => void flush(), 8000);
    } finally {
      inFlight = null;
    }
  })();
  await inFlight;
}

function schedule() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void flush(), useSettings.getState().autosaveDelay);
}

export function hasUnsavedChanges(): boolean {
  return dirty.ws || dirty.pages.size > 0 || inFlight !== null;
}

/** Subscribes to store changes and starts debounced autosaving. */
export function startAutosave(): () => void {
  let lastTick = useStore.getState().dirtyTick;
  const unsub = useStore.subscribe((s) => {
    if (s.dirtyTick !== lastTick) {
      lastTick = s.dirtyTick;
      schedule();
    }
  });
  if (dirty.ws || dirty.pages.size) schedule();

  const onHide = () => {
    if (document.visibilityState === 'hidden') void flush();
  };
  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    // In GlassNotes.app the window waits for the save itself; blocking here would freeze closing.
    const desktop = !!(window as unknown as { glassnotesDesktop?: unknown }).glassnotesDesktop;
    if (hasUnsavedChanges() && !desktop) {
      void flush();
      e.preventDefault();
      e.returnValue = '';
    }
  };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('beforeunload', onBeforeUnload);
  window.addEventListener('pagehide', () => void flush());
  return () => {
    unsub();
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('beforeunload', onBeforeUnload);
  };
}
