import { useEffect, useMemo, useState } from 'react';
import { FileDown, Printer } from 'lucide-react';
import { desktop } from '../desktop';
import { Modal } from './Dialogs';
import { useUI, toast } from '../store/ui';
import { useStore } from '../store/useStore';
import { useSettings } from '../store/settings';
import { DEFAULT_PRINT_OPTIONS, PAPERS, type PaperSize, type PrintOptions, type ScaleMode } from '../export/pagination';
import { Sheets, clearPrint, countSheets, preparePrint, runPrint, type PrintJob, type PrintPage } from '../export/PrintRoot';
import type { ID } from '../types';

type Scope = 'page' | 'selected' | 'section' | 'notebook';

const OPTS_KEY = 'glassnote.printOptions';

function loadOpts(): PrintOptions {
  try {
    return { ...DEFAULT_PRINT_OPTIONS, ...JSON.parse(localStorage.getItem(OPTS_KEY) ?? '{}') };
  } catch {
    return DEFAULT_PRINT_OPTIONS;
  }
}

export function useScopePages(scope: Scope, picked: ID[]): ID[] {
  const ws = useStore((s) => s.workspace);
  const pageId = useStore((s) => s.pageId);
  const sectionId = useStore((s) => s.sectionId);
  const notebookId = useStore((s) => s.notebookId);
  return useMemo(() => {
    if (scope === 'page') return pageId ? [pageId] : [];
    if (scope === 'selected') return (sectionId ? ws.sections[sectionId].pageIds : []).filter((p) => picked.includes(p));
    if (scope === 'section') return sectionId ? ws.sections[sectionId].pageIds : [];
    const nb = notebookId ? ws.notebooks[notebookId] : null;
    return nb ? nb.sectionIds.flatMap((s) => ws.sections[s].pageIds) : [];
  }, [scope, picked, ws, pageId, sectionId, notebookId]);
}

export function ExportDialog() {
  const open = useUI((s) => s.exportOpen);
  if (!open) return null;
  return <ExportDialogInner />;
}

function ExportDialogInner() {
  const close = () => useUI.getState().set({ exportOpen: false });
  const ws = useStore((s) => s.workspace);
  const sectionId = useStore((s) => s.sectionId);
  const pageId = useStore((s) => s.pageId);
  const settings = useSettings();
  const [opts, setOpts] = useState<PrintOptions>(loadOpts);
  const [scope, setScope] = useState<Scope>('page');
  const [picked, setPicked] = useState<ID[]>(pageId ? [pageId] : []);
  const ids = useScopePages(scope, picked);
  const [pages, setPages] = useState<PrintPage[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setPages(null);
    void Promise.all(ids.map((id) => useStore.getState().ensurePageLoaded(id))).then((contents) => {
      if (!alive) return;
      setPages(contents.map((c, i) => ({ id: ids[i], title: useStore.getState().workspace.pages[ids[i]]?.title ?? '', content: c })));
    });
    return () => {
      alive = false;
    };
  }, [ids]);

  const set = (patch: Partial<PrintOptions>) => {
    const next = { ...opts, ...patch };
    setOpts(next);
    try {
      localStorage.setItem(OPTS_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  const docTitle = useMemo(() => {
    if (scope === 'page' && pageId) return ws.pages[pageId]?.title ?? 'GlassNotes';
    if (sectionId) return ws.sections[sectionId]?.name ?? 'GlassNotes';
    return 'GlassNotes';
  }, [scope, pageId, sectionId, ws]);

  const job: PrintJob | null = pages
    ? {
        pages,
        options: opts,
        docTitle,
        paperClass: `paper-${settings.paper}`,
        patternClass: `pattern-${settings.background}`,
      }
    : null;
  const sheetCount = job ? countSheets(job) : 0;

  const desktopBridge = desktop();
  const doSavePdf = async () => {
    if (!job || !job.pages.length || !desktopBridge) return;
    setBusy(true);
    close();
    try {
      await preparePrint(job);
      const saved = await desktopBridge.savePdf(docTitle);
      if (saved) toast(`PDF salvato: ${saved.split('/').pop()}`, 'success');
    } catch (e) {
      toast(`Esportazione PDF non riuscita: ${e instanceof Error ? e.message : String(e)}`, 'error');
    } finally {
      clearPrint();
      setBusy(false);
    }
  };

  const doPrint = async () => {
    if (!job || !job.pages.length) return;
    setBusy(true);
    close();
    try {
      await runPrint(job);
    } catch (e) {
      toast(`Stampa non riuscita: ${e instanceof Error ? e.message : String(e)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const section = sectionId ? ws.sections[sectionId] : null;

  return (
    <Modal
      title="Stampa ed esporta PDF"
      onClose={close}
      wide
      testid="export-dialog"
      footer={
        <>
          <span className="foot-info">{job ? `${sheetCount} ${sheetCount === 1 ? 'foglio' : 'fogli'} · ${ids.length} ${ids.length === 1 ? 'pagina' : 'pagine'}` : 'Preparazione…'}</span>
          <button className="btn" onClick={close}>
            Annulla
          </button>
          {desktopBridge ? (
            <>
              <button className="btn" onClick={() => void doPrint()} disabled={!job || !ids.length || busy} data-testid="do-print">
                <Printer size={14} /> Stampa…
              </button>
              <button className="btn primary" onClick={() => void doSavePdf()} disabled={!job || !ids.length || busy} data-testid="do-save-pdf">
                <FileDown size={14} /> Salva PDF…
              </button>
            </>
          ) : (
            <button className="btn primary" onClick={() => void doPrint()} disabled={!job || !ids.length || busy} data-testid="do-print">
              <Printer size={14} /> Stampa / Salva PDF…
            </button>
          )}
        </>
      }
    >
      <div className="export-layout">
        <div className="export-options">
          <label className="row">
            <span>Contenuto</span>
            <select value={scope} onChange={(e) => setScope(e.target.value as Scope)} data-testid="export-scope">
              <option value="page">Pagina corrente</option>
              <option value="selected">Pagine scelte della sezione</option>
              <option value="section">Intera sezione</option>
              <option value="notebook">Intero blocco appunti</option>
            </select>
          </label>
          {scope === 'selected' && section && (
            <div className="page-picks">
              {section.pageIds.map((pid) => (
                <label key={pid} className="row check">
                  <input type="checkbox" checked={picked.includes(pid)} onChange={(e) => setPicked(e.target.checked ? [...picked, pid] : picked.filter((p) => p !== pid))} />
                  <span>{ws.pages[pid]?.title}</span>
                </label>
              ))}
            </div>
          )}
          <label className="row">
            <span>Formato carta</span>
            <select value={opts.paper} onChange={(e) => set({ paper: e.target.value as PaperSize })}>
              {Object.entries(PAPERS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>
          </label>
          <label className="row">
            <span>Orientamento</span>
            <div className="segmented">
              <button className={opts.orientation === 'portrait' ? 'active' : ''} onClick={() => set({ orientation: 'portrait' })}>
                Verticale
              </button>
              <button className={opts.orientation === 'landscape' ? 'active' : ''} onClick={() => set({ orientation: 'landscape' })}>
                Orizzontale
              </button>
            </div>
          </label>
          <label className="row">
            <span>Margini (mm)</span>
            <input type="number" min={0} max={40} value={opts.marginMm} onChange={(e) => set({ marginMm: Math.max(0, Math.min(40, Number(e.target.value) || 0)) })} />
          </label>
          <label className="row">
            <span>Scala</span>
            <select value={opts.scaleMode} onChange={(e) => set({ scaleMode: e.target.value as ScaleMode })}>
              <option value="fit-width">Adatta alla larghezza</option>
              <option value="fit-page">Adatta a un foglio</option>
              <option value="actual">Dimensione reale (100%)</option>
              <option value="custom">Personalizzata</option>
            </select>
          </label>
          {opts.scaleMode === 'custom' && (
            <label className="row">
              <span>Percentuale</span>
              <input type="number" min={10} max={300} step={5} value={Math.round(opts.customScale * 100)} onChange={(e) => set({ customScale: Math.max(0.1, Math.min(3, (Number(e.target.value) || 100) / 100)) })} />
            </label>
          )}
          <label className="row check">
            <input type="checkbox" checked={opts.showTitle} onChange={(e) => set({ showTitle: e.target.checked })} />
            <span>Titolo della pagina</span>
          </label>
          <label className="row check">
            <input type="checkbox" checked={opts.pageNumbers} onChange={(e) => set({ pageNumbers: e.target.checked })} />
            <span>Numeri di pagina</span>
          </label>
          <label className="row check">
            <input type="checkbox" checked={opts.includeBackground} onChange={(e) => set({ includeBackground: e.target.checked })} />
            <span>Includi sfondo (carta e motivo)</span>
          </label>
          <p className="hint">{desktopBridge ? 'Salva PDF crea il file direttamente; Stampa apre la finestra di stampa di macOS.' : 'Nella finestra di stampa di macOS scegli “Salva come PDF”.'} Per un PDF fedele, lascia attiva l’opzione “Grafica di sfondo” se hai incluso lo sfondo.</p>
        </div>
        <div className="export-preview" aria-label="Anteprima">
          {job ? (
            <div className="preview-scaler">
              <Sheets job={job} limit={6} />
              {sheetCount > 6 && <p className="hint">… e altri {sheetCount - 6} fogli</p>}
            </div>
          ) : (
            <p className="hint">Caricamento anteprima…</p>
          )}
        </div>
      </div>
    </Modal>
  );
}
