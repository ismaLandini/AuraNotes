# Walkthrough — Motore PDF leggero e migrazione a Tauri 2

## Parte A — PDF vettoriali on-demand
- Nel database si salva solo il PDF originale (deduplicato SHA-256); nessun PNG/WebP per pagina.
- Le pagine sono rese da pdf.js in `OffscreenCanvas`, con cache LRU in memoria da 150 MB (`src/pdf/pageCache.ts`), risoluzione `larghezza × DPR × 1.5` a scaglioni di 256 px. Stampa/esportazione a 300 DPI.
- Corretto `detectCanvasLimits` per WKWebView.
- Rimossi i selettori qualità/formato dall'import (dialogo di importazione).
- I vecchi PDF raster vengono eliminati all'avvio (`src/storage/legacyCleanup.ts`, con backup preventivo in IndexedDB) e gli asset orfani ripuliti.
- Verifica: `many-105-pages.pdf` occupa 1 solo asset, < 1.3× la dimensione del file.

## Parte B — Electron → Tauri 2 (macOS Apple Silicon)
- Nuovo crate `src-tauri/`: backup automatici (20 file a rotazione), apertura cartella backup, chiusura con flush (timeout 5 s), menu italiano nativo, stato finestra e tema, titlebar overlay, link esterni nel browser, migrazione dati GlassNotes → AuraNotes.
- `src/desktop.ts` usa `@tauri-apps/api` mantenendo la compatibilità con `DesktopBridge`; service worker disattivato nell'app; font KaTeX `.ttf`/`.woff` esclusi dalla build.
- Esportazione PDF: apre la finestra di stampa nativa di macOS ("Salva come PDF"), come concordato.
- Rimossi `desktop/`, `e2e-desktop/`, `scripts/`, `electron`, `@electron/packager`.

## Risultati
| Controllo | Esito |
|---|---|
| `npm run check` (typecheck, lint, Vitest, build) | OK |
| Playwright E2E | 20/20 |
| `cargo test` | 9/9 |
| `cargo clippy -D warnings` | 0 avvisi |
| `AuraNotes.app` (release, firmata ad-hoc) | **6,03 MiB** (Electron: ~200 MB) |

Nota: l'identifier `it.auranotes.app` termina in `.app`; Tauri lo segnala come sconsigliato (solo un warning).
