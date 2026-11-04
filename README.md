# AuraNotes

App web per prendere appunti universitari su macOS, ispirata alla struttura di OneNote (blocchi appunti → sezioni → pagine) e al canvas libero, con un’interfaccia originale in stile *Liquid Glass*. Funziona in locale nel browser, offline, senza account né server: i dati restano in IndexedDB sul tuo Mac.

## Usarla come app del Mac (AuraNotes.app)

Fai doppio clic su **AuraNotes.app**: si apre direttamente, senza terminale, server o porte. Puoi trascinarla in *Applicazioni* e nel Dock.

- **Dove sono i dati**: `~/Library/Application Support/AuraNotes` (IndexedDB dell'app). Restano lì anche se sposti, aggiorni o elimini AuraNotes.app.
- **Salvataggio**: automatico mentre scrivi; alla chiusura (⌘Q o chiudendo la finestra) l'app finisce di salvare prima di uscire.
- **Backup automatici**: ogni 20 minuti, se qualcosa è cambiato, e alla chiusura, in `~/Library/Application Support/AuraNotes/Backups` (si tengono gli ultimi 20). Dal menu File → *Mostra cartella dei backup automatici*.
- **Appunti scritti nella versione browser**: hanno un archivio separato (legato all'indirizzo `localhost`). Esportali dal browser con *Impostazioni → Esporta backup* e importali nell'app con *File → Importa backup…* (scegli *Unisci*).
- **PDF**: *Salva PDF…* e *Stampa…* aprono la finestra di stampa di macOS (scegli “Salva come PDF”).
- Al primo avvio macOS potrebbe dire che l'app è di uno sviluppatore non identificato: clic destro sull'icona → *Apri* → *Apri*. Serve una volta sola.

### Ricreare AuraNotes.app

Requisiti: Node.js 20 o superiore e Rust (`rustup`, toolchain stable per Apple Silicon).

```bash
cd glassnote
npm install
npm run tauri:build    # crea AuraNotes.app (Tauri 2, Apple Silicon)
npm run tauri:dev      # avvia l'app in sviluppo
```

Il risultato è in `src-tauri/target/release/bundle/macos/AuraNotes.app`. Il bundle si firma in modo ad-hoc con `codesign --force --deep --sign - AuraNotes.app`.

**PDF importati**: nel database viene salvato solo il file PDF originale (deduplicato con SHA-256). Le pagine sono disegnate al momento da pdf.js, con cache in memoria (150 MB): nessuna immagine per pagina occupa spazio su disco. In stampa/esportazione le pagine sono rese a 300 DPI.

**Esportazione PDF**: *Salva PDF…* apre la finestra di stampa di macOS, dove scegli “Salva come PDF”.

## Versione browser (sviluppo)

```bash
npm install
npm run dev        # http://localhost:5173
```

## Comandi

| Comando | Cosa fa |
|---|---|
| `npm run dev` | server di sviluppo con ricarica automatica |
| `npm run build` | type-check (TypeScript strict) + build di produzione |
| `npm run preview` | serve la build di produzione |
| `npm run typecheck` | controllo dei tipi di app, test e configurazioni |
| `npm run lint` | analisi statica (oxlint) |
| `npm test` | test unitari e di componente (Vitest + Testing Library) |
| `npm run test:e2e` | test end-to-end nel browser (Playwright) |
| `npm run check` | typecheck + lint + test + build in sequenza |
| `npm run tauri:build` | crea AuraNotes.app |
| `npm run tauri:dev` | avvia l'app desktop in sviluppo |

Per i test end-to-end, la prima volta esegui `npx playwright install chromium`. In ambienti dove il download non è possibile puoi indicare un Chromium esistente con `CHROME_PATH=/percorso/chromium npm run test:e2e`.

## Funzionalità

**Organizzazione**
- Blocchi appunti, sezioni e pagine: crea, rinomina (doppio clic o menu ⋯), elimina con conferma, colore, riordino con trascinamento.
- Pagine: duplica, sposta in un’altra sezione (trascinandole sulla sezione o dal menu “Sposta in…”), data di ultima modifica, cestino con ripristino.
- Tre pannelli di navigazione comprimibili e ridimensionabili; larghezze e visibilità vengono ricordate. Su finestre strette la navigazione diventa un pannello a scomparsa.
- Blocco appunti di esempio al primo avvio (eliminabile).

**Canvas libero**
- Superficie infinita: scorrimento con due dita, zoom con pizzico o ⌘+/⌘−, “adatta contenuto” e “centra contenuto”.
- Sfondo liscio, puntinato, a quadretti o a righe; carta bianca, avorio, grigia o scura.
- Selezione singola e multipla (⇧ o rettangolo di selezione), spostamento, ridimensionamento, duplicazione, ordine di livello, blocco degli oggetti, guide di allineamento e aggancio alla griglia opzionale.
- Annulla/ripeti per pagina (fino a 150 passi).

**Testo**
- Doppio clic su un punto vuoto per scrivere; doppio clic su un blocco per modificarlo.
- Grassetto, corsivo, sottolineato, barrato, colore, evidenziazione multicolore, dimensione e tipo di carattere, titoli, allineamento, elenchi puntati/numerati, liste di controllo, rientri, citazioni, linee divisorie, collegamenti, codice in linea e blocchi di codice con evidenziazione della sintassi, apice/pedice, tabelle, cancella formattazione.
- Equazioni LaTeX in linea e a blocco (KaTeX) con anteprima, più una tavolozza di simboli greci e matematici.
- Incolla da browser e Word mantenendo la formattazione comune; Markdown rapido (`# `, `- `, `1. `, `[ ] `, `> `, ``` ``` ```).
- Note adesive colorate.

**Immagini e disegno**
- Inserimento con ⌘V, trascinamento di file, selettore file o copia da altre app; salvataggio persistente in IndexedDB (non URL temporanei).
- Ridimensionamento con proporzioni bloccate (⌥ per proporzioni libere), rotazione di 90°, blocco, livelli.
- Penna (con pressione se usi uno stilo), evidenziatore semitrasparente, gomma, linee, frecce, doppie frecce, rettangoli, ellissi, testo — sul canvas e **sopra le immagini**: le annotazioni restano agganciate all’immagine quando la sposti, la ridimensioni o la ruoti.
- ⇧ mentre disegni: linee a 45°, quadrati e cerchi.

**Connettori**
- Strumento Connettore (C), oppure una freccia trascinata da un oggetto a un altro: il collegamento è legato agli oggetti e li segue quando si spostano.
- Aggancio automatico al bordo o a un lato scelto, colore, spessore, punte, davanti/dietro agli oggetti.

**Produttività**
- Registro centralizzato delle scorciatoie con pannello consultabile e ricercabile (⌘/).
- Ricerca globale (⌘K o ⌘F) in nomi, titoli e testo delle pagine, con apertura del risultato.
- Salvataggio automatico con indicatore di stato, salvataggio manuale (⌘S), avviso se chiudi con modifiche in sospeso.
- Backup completo in un file JSON (immagini incluse) e importazione con scelta tra *unisci* e *sostituisci*, con validazione del file.
- Stampa ed esportazione PDF (⌘P): pagina, pagine scelte, sezione o blocco intero; A4/Letter/A3/A5, verticale/orizzontale, margini, sfondo, numeri di pagina, titolo, scala (adatta alla larghezza, a un foglio, 100%, personalizzata), anteprima. Nella finestra di stampa di macOS scegli “Salva come PDF”.
- Tema chiaro, scuro o di sistema; rispetto di “Riduci movimento” e “Aumenta contrasto”.

## Scorciatoie principali

| Azione | Scorciatoia |
|---|---|
| Annulla / Ripeti | ⌘Z / ⇧⌘Z |
| Copia / Taglia / Incolla | ⌘C / ⌘X / ⌘V |
| Seleziona tutto | ⌘A |
| Salva ora | ⌘S |
| Cerca | ⌘K o ⌘F |
| Nuova pagina | ⌥⌘N (⌘N dove il browser lo consente) |
| Nuovo blocco di testo | ⌥⌘T |
| Elimina selezione | ⌫ |
| Duplica | ⌘D |
| Zoom + / − / 100% | ⌘+ / ⌘− / ⌘0 |
| Scorciatoie | ⌘/ (o ?) |
| Pannelli di navigazione | ⇧⌘B |
| Stampa / PDF | ⌘P |
| Strumenti | V selezione, H mano, T testo, N nota, P penna, M evidenziatore, E gomma, L linea, A freccia, D doppia freccia, R rettangolo, O ellisse, C connettore |

**Scelte motivate.** Il browser riserva alcune combinazioni: ⌘N (nuova finestra) e ⇧⌘T (riapri scheda) non possono essere intercettate in Chrome, quindi l’app usa anche ⌥⌘N e ⌥⌘T. ⌘K dentro un blocco di testo inserisce un collegamento; fuori apre la ricerca. ⌘/ funziona anche con la tastiera italiana (dove / è ⇧7). Le scorciatoie a tasto singolo non si attivano mai mentre scrivi.

## Architettura

```
src/
  types.ts              modello dati (Workspace, PageContent, CanvasItem…)
  model/                operazioni pure su blocchi/sezioni/pagine e oggetti del canvas
  store/                stato (zustand): workspace, pagine caricate, cronologia, selezione; preferenze; UI
  storage/              IndexedDB (idb), salvataggio automatico, immagini, backup/ripristino
  editor/               TipTap/ProseMirror: estensioni (equazioni, dimensione carattere, rientri), editor e rendering statico
  canvas/               canvas, interazioni puntatore, rendering degli oggetti, viewport, azioni (appunti, immagini…)
  shortcuts/            registro centralizzato e definizioni delle scorciatoie
  export/               impaginazione e rendering per stampa/PDF
  components/           barra superiore, navigazione, barra contestuale, strumenti, finestre di dialogo
  styles/               token di design Liquid Glass, canvas, foglio di stile di stampa
e2e/                    test Playwright dei flussi completi
```

- **Persistenza**: struttura dei blocchi in un unico record, contenuto di ogni pagina in un record separato (si carica solo la pagina aperta), immagini come Blob. Lo stato “Salvato” compare solo dopo il commit della transazione; in caso di errore (anche quota esaurita) i dati restano in coda e il salvataggio viene ritentato. Versione di schema e migrazioni in `storage/db.ts`.
- **Canvas**: gli oggetti HTML/SVG sono posizionati in coordinate mondo dentro un livello trasformato; le interazioni usano hit-testing geometrico (preciso anche su tratti sottili). I blocchi di testo non in modifica sono HTML statico; un solo editor TipTap è montato alla volta, per prestazioni.
- **Annotazioni**: tratti, forme e testi disegnati sopra un’immagine sono salvati nel sistema di coordinate normalizzato dell’immagine (`parentId`), quindi seguono spostamenti, ridimensionamenti e rotazioni.
- **Connettori**: memorizzano gli id degli oggetti collegati e gli ancoraggi; gli estremi vengono ricalcolati a ogni rendering.
- **Stampa**: `export/pagination.ts` calcola scala e fogli evitando, quando possibile, di tagliare blocchi di testo e immagini e saltando i fogli vuoti; un contenitore dedicato `#print-root` è l’unico contenuto visibile in stampa.

## Limitazioni note

- Nella versione browser i dati vivono nell’origine in cui usi l’app: cancellare i dati del sito li elimina. AuraNotes.app ha un archivio proprio sul Mac, con backup automatici.
- AuraNotes.app non è firmata con un certificato Apple Developer: al primo avvio serve clic destro → Apri.
- Il testo nelle immagini e la scrittura a mano non sono ricercabili (nessun OCR).
- La rotazione delle immagini avviene a passi di 90°; i tratti a mano libera si spostano ma non si ridimensionano.
- Gli oggetti di pagine molto grandi sono tutti presenti nel DOM (nessuna virtualizzazione): con centinaia di immagini grandi il canvas può rallentare.
- La pressione dello stilo è usata solo se il browser la fornisce (es. tavolette grafiche); un trackpad Mac non la fornisce.
- La qualità del PDF dipende dal motore di stampa del browser; con lo sfondo incluso attiva “Grafica di sfondo” nella finestra di stampa.
- Nessuna sincronizzazione tra dispositivi.

## Novità della versione 1.1

- **Navigazione compatta**: i blocchi appunti diventano una colonna di iniziali colorate (si espande con l'icona del libro). Sezioni e pagine sono più strette e ridimensionabili, e ⇧⌘B nasconde tutto.
- **Palette blu e azzurro** con superfici piene. Gli effetti vetro sono stati tolti dove rubavano spazio o leggibilità. Il testo degli appunti resta grigio scuro/nero.
- **Foglio largo due A4 (420 mm)** con una piega tratteggiata tenue al centro. Oggetti trascinati, incollati o ridimensionati restano dentro il foglio, e le immagini troppo larghe vengono ridotte. Gli oggetti delle pagine già esistenti non vengono spostati. La vista resta sul foglio e ha barre di scorrimento.
- **Titolo sul foglio**, in alto a sinistra con data e ora come in OneNote. Una pagina nuova mette il cursore nel titolo: premendo Invio si scrive subito sotto.
- **Caselle di testo discrete**: senza bordo né sfondo. In modifica appare solo un contorno tenue, e le maniglie si vedono al passaggio del mouse.
- **Niente bordi residui**: se il focus esce dal testo (menu della barra laterale, altro strumento, altra finestra di dialogo), la modifica si chiude e il testo viene salvato. I controlli di formattazione mantengono invece la modifica attiva.
- **Cancella / ⌫**: mentre scrivi cancella caratteri. Su oggetti selezionati (anche dopo Esc dal testo) li elimina, insieme a gruppi e connettori collegati, e si può annullare.
- **Gruppi**: ⌘G raggruppa, ⇧⌘G separa. Un clic su un elemento seleziona tutto il gruppo.
- **Connettori su qualsiasi punto del bordo** di testo, immagini, forme e disegni. Il punto di aggancio resta lo stesso anche se l'oggetto si sposta, si ridimensiona o ruota. Per ricollegare un estremo basta trascinarlo su un altro oggetto, e non restano mai connettori orfani (vengono anche ripuliti al caricamento).
