# Walkthrough — Aggiornamento AuraNotes: Traffic Lights, Doppio Click e Stampa Quaderno

## 1. Ricalibrazione dei Tre Pallini macOS (Traffic Lights)
- **Coordinate native**: in `src-tauri/tauri.conf.json`, `trafficLightPosition` è stato ricalibrato a `{ "x": 16, "y": 12 }` (rispetto a `{ "x": 12, "y": 9 }` precedente).
- **Barra del titolo**: in `src/styles/theme.css`, l'altezza di `.window-titlebar` è stata elevata da 28px a 36px, con `padding-left: 84px` in modalità desktop e il testo `AuraNotes` allineato verticalmente al centro. I pallini ora hanno respiro dai bordi della finestra e sono complanari con il titolo e con il breadcrumb.

## 2. Doppio Click su Foto, PDF e Contenitori
- In `src/canvas/Canvas.tsx`, `onDoubleClick` rileva se il doppio click avviene sopra un'immagine o pagina PDF (inclusi blocchi `.image-block-container`, `.image-item`, `img` o container liberi `freeImage`).
- Viene creata immediatamente una nuova casella di testo classica (`NoteContainerItem` via `createTextBlock`) posizionata esattamente nel punto del click, aggiunta in cima alla sequenza visiva (z-index) ed entrando subito in modalità editing, permettendo di annotare o prendere appunti sopra il PDF/foto come su carta.
- Se il doppio click avviene sul testo di un blocco esistente, si apre la consueta modifica del testo di quel blocco.

## 3. Stampa ed Esportazione Intero Quaderno in Singolo PDF
- **Stato UI**: `src/store/ui.ts` supporta `exportInitialScope: 'notebook'` ed `exportNotebookId`.
- **Menu contestuale Quaderno**: aggiunta l'azione *"Esporta quaderno in PDF…"* nel menu con il tasto destro / ⋯ sia nella barra laterale (`src/components/Sidebar.tsx`) che nella schermata Home (`src/components/HomeView.tsx`).
- **Organizzazione pagine**: all'apertura del dialogo con lo scope quaderno, tutte le pagine di tutte le sezioni del quaderno vengono caricate in sequenza. Ciascuna pagina del quaderno inizia tassativamente su una nuova pagina del PDF grazie a `page-break-after: always` e al layout indipendente generato per ciascuna pagina in `layoutForPage` / `Sheets`. Se una singola pagina del quaderno è molto estesa verticalmente, prosegue con le sue fette (`segue`), mentre la pagina successiva del quaderno riprende da un foglio pulito.
- **Titolo documento**: in `src/components/ExportDialog.tsx`, quando lo scope è `notebook`, il nome predefinito del PDF assume automaticamente il nome del quaderno.

## Risultati dei Test e Build
| Controllo | Esito |
|---|---|
| `npm run typecheck` | 0 errori |
| `npm run lint` (oxlint) | 0 avvisi, 0 errori |
| Vitest (27 suite) | 260 su 260 passati |
| Vite production build | OK |
| Playwright E2E (20 test) | 20 su 20 passati |
| Build release Tauri | `AuraNotes.app` (6.03 MiB) compilato e firmato ad-hoc |
| Applicazione installata | Aggiornata in `/Applications/AuraNotes.app` |
