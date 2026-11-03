import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from 'react';
import { useStore } from './store/useStore';
import { useSettings } from './store/settings';
import { isModalOpen, useUI } from './store/ui';
import { Sidebar } from './components/Sidebar';
import { HomeView } from './components/HomeView';
import { Ribbon } from './components/Ribbon';
import { SaveIndicator } from './components/SaveIndicator';
import { Breadcrumb } from './components/Breadcrumb';
import { FloatingFormatBar } from './components/FloatingFormatBar';
import { NavMiniMenu, ToolPalette, ZoomControls } from './components/ToolPalette';
import { Canvas } from './canvas/Canvas';
import { ConfirmDialog, PromptDialog, SearchDialog, ShortcutsOverlay, Toasts, TrashDialog } from './components/Dialogs';
import { SettingsDialog, exportBackup } from './components/SettingsDialog';
import { ExportDialog } from './components/ExportDialog';
import { PdfImportDialog, PdfImportProgressBanner } from './components/PdfImportDialog';
import { TemplatePickerModal } from './components/TemplatePickerModal';
import { PageOutline } from './components/PageOutline';
import { PrintRoot } from './export/PrintRoot';
import { dispatchKey, registerShortcuts } from './shortcuts/registry';
import { buildShortcuts } from './shortcuts/definitions';
import { startAutosave } from './storage/autosave';
import { requestPersistence, storageEstimate } from './storage/db';
import { toast } from './store/ui';
import { desktop, initDesktop, isDesktop } from './desktop';

export class ErrorBoundary extends Component<{ children: ReactNode; label?: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('AuraNotes error', error, info.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="error-panel" role="alert">
          <h2>{this.props.label ?? 'Qualcosa è andato storto'}</h2>
          <p>{this.state.error.message}</p>
          <p className="hint">I dati già salvati sono al sicuro. Puoi riprovare o esportare un backup.</p>
          <div className="btn-row">
            <button className="btn primary" onClick={() => this.setState({ error: null })}>
              Riprova
            </button>
            <button className="btn" onClick={() => void exportBackup()}>
              Esporta backup
            </button>
            <button className="btn" onClick={() => window.location.reload()}>
              Ricarica l’app
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function useTheme() {
  const theme = useSettings((s) => s.theme);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && mq.matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', dark ? '#1e1e1e' : '#081e42');
      void desktop()?.setTheme(theme, dark);
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
}

function useCompact() {
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 900px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)');
    const fn = () => setCompact(mq.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  return compact;
}

export default function App() {
  const loaded = useStore((s) => s.loaded);
  const loadError = useStore((s) => s.loadError);
  const sidebarVisible = useSettings((s) => s.layout.sidebarVisible);
  const mobileNavOpen = useUI((s) => s.mobileNavOpen);
  const homeOpen = useUI((s) => s.homeOpen);
  const compact = useCompact();
  useTheme();

  useEffect(() => {
    void useStore.getState().init();
    initDesktop();
    const stop = startAutosave();
    const unregister = registerShortcuts(buildShortcuts());
    const onKey = (e: KeyboardEvent) => dispatchKey(e, { modalOpen: isModalOpen() });
    window.addEventListener('keydown', onKey, true);
    void requestPersistence();
    void storageEstimate().then((e) => {
      if (e && e.quota && e.usage / e.quota > 0.85) toast('Spazio di archiviazione quasi esaurito: esporta un backup e libera spazio.', 'error', 8000);
    });
    return () => {
      stop();
      unregister();
      window.removeEventListener('keydown', onKey, true);
    };
  }, []);

  // Close the slide-out navigation when a page is chosen on small screens.
  const pageId = useStore((s) => s.pageId);
  useEffect(() => {
    if (compact) useUI.getState().set({ mobileNavOpen: false });
  }, [pageId, compact]);

  if (!loaded) {
    return (
      <div className="splash">
        <span className="brand-mark big" />
        <p>Apertura dei quaderni…</p>
      </div>
    );
  }
  if (loadError) {
    return (
      <div className="error-panel" role="alert">
        <h2>Impossibile aprire l’archivio locale</h2>
        <p>{loadError}</p>
        <p className="hint">Il browser potrebbe bloccare IndexedDB (ad esempio in navigazione privata). Prova in una finestra normale.</p>
        <button className="btn primary" onClick={() => window.location.reload()}>
          Riprova
        </button>
      </div>
    );
  }

  return (
    <div className={`app${compact ? ' compact' : ''}${homeOpen ? ' is-home' : ''}`}>
      <div className={`window-titlebar${isDesktop() ? ' is-desktop' : ''}`} data-ui>
        <span className="window-titlebar-title" aria-hidden="true">AuraNotes</span>
        {!homeOpen ? <Breadcrumb /> : <div className="titlebar-crumbs" />}
        <SaveIndicator />
      </div>
      {homeOpen ? (
        <div className="main home-main-wrap">
          <ErrorBoundary label="Errore nella schermata Home">
            <HomeView />
          </ErrorBoundary>
        </div>
      ) : (
        <>
          <Ribbon />
          <div className="main">
            {!compact && sidebarVisible && (
              <ErrorBoundary label="Errore nella navigazione">
                <Sidebar />
              </ErrorBoundary>
            )}
            {compact && mobileNavOpen && (
              <>
                <div className="scrim" onClick={() => useUI.getState().set({ mobileNavOpen: false })} />
                <Sidebar overlay />
              </>
            )}
            <main className="workspace">
              <div className="canvas-container">
                <div className="vertical-tool-rail">
                  <NavMiniMenu compact={compact} />
                  <ToolPalette />
                </div>
                <div className="canvas-wrap">
                  <ErrorBoundary label="Errore nel canvas">
                    <Canvas />
                  </ErrorBoundary>
                  <PageOutline />
                  <ZoomControls />
                </div>
              </div>
            </main>
          </div>
          <FloatingFormatBar />
        </>
      )}
      <SearchDialog />
      <SettingsDialog />
      <ShortcutsOverlay />
      <ExportDialog />
      <PdfImportDialog />
      <PdfImportProgressBanner />
      <TemplatePickerModal />
      <TrashDialog />
      <ConfirmDialog />
      <PromptDialog />
      <Toasts />
      <PrintRoot />
    </div>
  );
}
