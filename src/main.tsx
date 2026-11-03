import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'katex/dist/katex.min.css';
import './styles/index.css';
import './styles/canvas.css';
import './styles/print.css';
import './styles/theme.css';
import App, { ErrorBoundary } from './App';
import { useStore } from './store/useStore';
import { useSettings } from './store/settings';
import { getAsset, getDB, listAssetIds } from './storage/db';
import { flush } from './storage/autosave';
import { openPdfImportDialog, usePdfImportState } from './components/PdfImportDialog';
import { destroyPdfDocument, openPdfDocument, renderPdfPageToBlob } from './pdf/renderer';
import { getPdfPageUrl, getPageCacheStats, clearPageCache } from './pdf/pageCache';
import { clearPrint, preparePrint } from './export/PrintRoot';
import { DEFAULT_PRINT_OPTIONS } from './export/pagination';

// Read-only handle for automated end-to-end checks and debugging from the console.
const debugHandle = {
  useStore,
  useSettings,
  usePdfImportState,
  getAsset,
  listAssetIds,
  getDB,
  flush,
  openPdfImportDialog,
  openPdfDocument,
  renderPdfPage: renderPdfPageToBlob,
  getPdfPageUrl,
  getPageCacheStats,
  clearPageCache,
  destroyPdfDocument,
  preparePrint,
  clearPrint,
  DEFAULT_PRINT_OPTIONS,
};
(window as unknown as { __auranotes: unknown; __glassnote: unknown }).__auranotes = debugHandle;
(window as unknown as { __auranotes: unknown; __glassnote: unknown }).__glassnote = debugHandle;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js')
      .then((reg) => {
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                console.log('AuraNotes: nuova versione disponibile.');
              }
            });
          }
        });
      })
      .catch((err) => {
        console.warn('AuraNotes Service Worker registration failed:', err);
      });
  });
}
