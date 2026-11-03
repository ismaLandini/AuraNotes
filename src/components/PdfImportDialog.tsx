import { useEffect, useState, type FormEvent } from 'react';
import { create } from 'zustand';
import { AlertTriangle, FileText, Layers, LayoutList, Loader2, Lock, X } from 'lucide-react';
import { Modal } from './Dialogs';
import { toast, useUI } from '../store/ui';
import { useStore } from '../store/useStore';
import { useSettings } from '../store/settings';
import {
  PDF_QUALITY_PRESETS,
  type PdfDocumentMeta,
  type PdfImportProgress,
  type PdfImportTarget,
  type PdfInsertMode,
  type PdfQualityPreset,
} from '../pdf/types';
import {
  inspectPdfDocument,
  PdfCorruptError,
  PdfPasswordIncorrectError,
  PdfPasswordRequiredError,
} from '../pdf/renderer';
import { parsePageRange } from '../pdf/scale';
import {
  checkPdfStorageQuota,
  formatBytes,
  importPdfDocument,
  type StorageQuotaCheck,
} from '../pdf/pdfImporter';

interface PdfImportSession {
  sessionId: number;
  file: File | Blob | null;
  fileName: string;
  target?: PdfImportTarget;
  status: 'idle' | 'inspecting' | 'password' | 'ready' | 'error';
  passwordError: string | null;
  errorMessage: string | null;
  meta: PdfDocumentMeta | null;
  password?: string;
  activeProgress: PdfImportProgress | null;
  abortController: AbortController | null;
}

const initialSession: PdfImportSession = {
  sessionId: 0,
  file: null,
  fileName: '',
  target: undefined,
  status: 'idle',
  passwordError: null,
  errorMessage: null,
  meta: null,
  password: undefined,
  activeProgress: null,
  abortController: null,
};

export const usePdfImportState = create<PdfImportSession>(() => ({ ...initialSession }));

function cleanupPreviewUrl(meta: PdfDocumentMeta | null) {
  if (meta?.firstPagePreviewUrl && meta.firstPagePreviewUrl.startsWith('blob:')) {
    try {
      URL.revokeObjectURL(meta.firstPagePreviewUrl);
    } catch {
      /* ignore */
    }
  }
}

async function runInspect(file: File | Blob, password?: string) {
  usePdfImportState.setState({
    status: 'inspecting',
    passwordError: null,
    errorMessage: null,
  });

  try {
    const meta = await inspectPdfDocument(file, password);
    const prevMeta = usePdfImportState.getState().meta;
    if (prevMeta && prevMeta !== meta) cleanupPreviewUrl(prevMeta);
    usePdfImportState.setState({
      status: 'ready',
      meta,
      password,
      passwordError: null,
      errorMessage: null,
    });
  } catch (err) {
    if (err instanceof PdfPasswordRequiredError) {
      usePdfImportState.setState({
        status: 'password',
        passwordError: null,
      });
      return;
    }
    if (err instanceof PdfPasswordIncorrectError) {
      usePdfImportState.setState({
        status: 'password',
        passwordError: err.message || 'La password inserita per il PDF non è corretta.',
      });
      return;
    }
    const msg =
      err instanceof PdfCorruptError
        ? err.message
        : err instanceof Error
          ? err.message
          : 'Impossibile leggere il documento PDF selezionato.';
    usePdfImportState.setState({
      status: 'error',
      errorMessage: msg,
    });
    toast(msg, 'error', 5000);
  }
}

/** Opens the Liquid Glass PDF Import dialog for a dropped, pasted, or selected PDF file. */
export function openPdfImportDialog(
  file: File | Blob,
  target?: PdfImportTarget,
  explicitFileName?: string,
): void {
  const st = useStore.getState();
  if (!st.pageId) {
    toast('Apri o crea una pagina prima di importare un PDF', 'error');
    return;
  }

  const prevMeta = usePdfImportState.getState().meta;
  cleanupPreviewUrl(prevMeta);

  const fileName =
    explicitFileName || (typeof File !== 'undefined' && file instanceof File && file.name ? file.name : 'Documento.pdf');

  usePdfImportState.setState((s) => ({
    sessionId: s.sessionId + 1,
    file,
    fileName,
    target,
    status: 'inspecting',
    passwordError: null,
    errorMessage: null,
    meta: null,
    password: undefined,
  }));
  useUI.getState().set({ pdfDialogOpen: true });
  void runInspect(file);
}

export function closePdfImportDialog(): void {
  const prevMeta = usePdfImportState.getState().meta;
  cleanupPreviewUrl(prevMeta);
  usePdfImportState.setState((s) => ({
    ...initialSession,
    sessionId: s.sessionId,
    activeProgress: s.activeProgress,
    abortController: s.abortController,
  }));
  useUI.getState().set({ pdfDialogOpen: false });
}

export function pickPdfFile(target?: PdfImportTarget): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/pdf,.pdf';
  input.setAttribute('data-testid', 'pdf-file-input');
  input.onchange = () => {
    const f = input.files?.[0];
    if (f) openPdfImportDialog(f, target);
  };
  input.click();
}

export function PdfImportDialog() {
  const open = useUI((s) => s.pdfDialogOpen);
  const sessionId = usePdfImportState((s) => s.sessionId);
  if (!open) return null;
  return <PdfImportDialogInner key={sessionId} />;
}

function PdfImportDialogInner() {
  const session = usePdfImportState();
  const defaultQuality = useSettings((s) => s.pdfQuality);
  const format = useSettings((s) => s.pdfFormat);

  const [quality, setQuality] = useState<PdfQualityPreset>(defaultQuality);
  const [mode, setMode] = useState<PdfInsertMode>('single-container');
  const [rangeMode, setRangeMode] = useState<'all' | 'custom'>('all');
  const [rangeInput, setRangeInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [quotaCheck, setQuotaCheck] = useState<StorageQuotaCheck | null>(null);

  const numPages = session.meta?.numPages ?? 0;
  const parsedRange =
    numPages > 0
      ? parsePageRange(rangeMode === 'all' ? '' : rangeInput, numPages)
      : { pages: [] as number[], error: undefined };

  useEffect(() => {
    let alive = true;
    if (session.status !== 'ready' || !session.file || parsedRange.pages.length === 0) {
      void Promise.resolve().then(() => {
        if (alive) setQuotaCheck(null);
      });
      return () => {
        alive = false;
      };
    }
    void checkPdfStorageQuota(parsedRange.pages.length, session.file.size, quality, format).then((res) => {
      if (alive) setQuotaCheck(res);
    });
    return () => {
      alive = false;
    };
  }, [session.status, session.file, parsedRange.pages.length, quality, format]);

  const onPasswordSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!session.file || !passwordInput.trim()) return;
    void runInspect(session.file, passwordInput);
  };

  const onStartImport = () => {
    if (!session.file || session.status !== 'ready' || parsedRange.error || parsedRange.pages.length === 0) {
      return;
    }
    if (quotaCheck && !quotaCheck.ok) {
      toast(quotaCheck.warningMessage ?? 'Spazio insufficiente per importare il PDF', 'error', 6000);
      return;
    }

    const file = session.file;
    const fileName = session.fileName;
    const target = session.target;
    const password = session.password;
    const pagesToImport = [...parsedRange.pages];
    const abortController = new AbortController();

    // Close the modal and start progressive import
    closePdfImportDialog();

    usePdfImportState.setState({
      activeProgress: {
        currentPage: pagesToImport[0],
        completedPages: 0,
        totalPages: pagesToImport.length,
        clampedPages: [],
        peakMemoryBytes: 0,
      },
      abortController,
    });

    void importPdfDocument({
      file,
      fileName,
      pages: pagesToImport,
      quality,
      format,
      mode,
      password,
      target,
      signal: abortController.signal,
      onProgress: (prog) => {
        usePdfImportState.setState({ activeProgress: prog });
      },
    })
      .then((result) => {
        usePdfImportState.setState({ activeProgress: null, abortController: null });
        if (result.clampedPages.length > 0) {
          toast(
            `Scala adattata automaticamente ai limiti canvas del browser per ${
              result.clampedPages.length === 1
                ? `la pagina ${result.clampedPages[0]} di grandi dimensioni`
                : `${result.clampedPages.length} pagine di grandi dimensioni`
            }.`,
            'info',
            5500,
          );
        }
        if (result.cancelled) {
          toast(
            `Importazione interrotta (${result.importedPages} ${
              result.importedPages === 1 ? 'pagina importata' : 'pagine importate'
            } — Cmd+Z per annullare tutto)`,
            'info',
            4200,
          );
        } else {
          toast(
            `PDF importato (${result.importedPages} ${result.importedPages === 1 ? 'pagina' : 'pagine'})`,
            'success',
            3000,
          );
        }
      })
      .catch((err) => {
        usePdfImportState.setState({ activeProgress: null, abortController: null });
        toast(err instanceof Error ? err.message : 'Errore durante l’importazione del PDF', 'error', 5000);
      });
  };

  const canConfirm =
    session.status === 'ready' &&
    !parsedRange.error &&
    parsedRange.pages.length > 0 &&
    (!quotaCheck || quotaCheck.ok);

  return (
    <Modal
      title="Importa PDF nella pagina"
      onClose={closePdfImportDialog}
      wide={session.status === 'ready'}
      testid="pdf-import-dialog"
      footer={
        session.status === 'ready' ? (
          <>
            <button className="btn" onClick={closePdfImportDialog} data-testid="pdf-import-cancel">
              Annulla
            </button>
            <button
              className="btn primary"
              onClick={onStartImport}
              disabled={!canConfirm}
              data-testid="pdf-import-confirm"
            >
              Importa {parsedRange.pages.length}{' '}
              {parsedRange.pages.length === 1 ? 'pagina' : 'pagine'}
            </button>
          </>
        ) : session.status === 'error' ? (
          <button className="btn primary" onClick={closePdfImportDialog} data-testid="pdf-error-close">
            Chiudi
          </button>
        ) : undefined
      }
    >
      {session.status === 'inspecting' && (
        <div className="pdf-dialog-loading" data-testid="pdf-inspecting">
          <Loader2 size={24} className="spin" />
          <p>Analisi di &ldquo;{session.fileName}&rdquo; in corso…</p>
        </div>
      )}

      {session.status === 'password' && (
        <form onSubmit={onPasswordSubmit} className="pdf-password-form" data-testid="pdf-password-form">
          <div className="pdf-password-header">
            <Lock size={20} />
            <div>
              <strong>Documento PDF protetto da password</strong>
              <p className="hint">Inserisci la password per sbloccare &ldquo;{session.fileName}&rdquo;.</p>
            </div>
          </div>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              placeholder="Password del documento…"
              autoFocus
              data-testid="pdf-password-input"
            />
          </label>
          {session.passwordError && (
            <p className="pdf-inline-error" role="alert" data-testid="pdf-password-error">
              <AlertTriangle size={14} /> {session.passwordError}
            </p>
          )}
          <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" className="btn" onClick={closePdfImportDialog}>
              Annulla
            </button>
            <button
              type="submit"
              className="btn primary"
              disabled={!passwordInput.trim()}
              data-testid="pdf-password-submit"
            >
              Sblocca PDF
            </button>
          </div>
        </form>
      )}

      {session.status === 'error' && (
        <div className="pdf-error-box" role="alert" data-testid="pdf-error-message">
          <AlertTriangle size={22} />
          <div>
            <strong>Impossibile importare il PDF</strong>
            <p>{session.errorMessage}</p>
          </div>
        </div>
      )}

      {session.status === 'ready' && session.meta && (
        <div className="pdf-import-grid">
          <div className="pdf-preview-col">
            <div className="pdf-preview-frame" data-testid="pdf-preview-frame">
              {session.meta.firstPagePreviewUrl ? (
                <img
                  src={session.meta.firstPagePreviewUrl}
                  alt={`Anteprima pagina 1 di ${session.fileName}`}
                  data-testid="pdf-first-page-preview"
                />
              ) : (
                <div className="pdf-preview-fallback">
                  <FileText size={36} />
                  <span>Anteprima pagina 1</span>
                </div>
              )}
            </div>
            <div className="pdf-meta-summary">
              <strong className="pdf-filename" title={session.fileName}>
                {session.fileName}
              </strong>
              <span className="pdf-page-badge" data-testid="pdf-page-count">
                {session.meta.numPages} {session.meta.numPages === 1 ? 'pagina' : 'pagine'}
              </span>
            </div>
          </div>

          <div className="pdf-options-col">
            <div className="pdf-field-group">
              <label className="pdf-group-label">Pagine da importare</label>
              <div className="segmented">
                <button
                  type="button"
                  className={rangeMode === 'all' ? 'active' : ''}
                  onClick={() => setRangeMode('all')}
                  data-testid="pdf-range-all"
                >
                  Tutte ({session.meta.numPages})
                </button>
                <button
                  type="button"
                  className={rangeMode === 'custom' ? 'active' : ''}
                  onClick={() => {
                    setRangeMode('custom');
                    if (!rangeInput) setRangeInput(`1-${session.meta!.numPages}`);
                  }}
                  data-testid="pdf-range-custom"
                >
                  Intervallo
                </button>
              </div>
              {rangeMode === 'custom' && (
                <div className="pdf-range-input-wrap">
                  <input
                    type="text"
                    value={rangeInput}
                    onChange={(e) => setRangeInput(e.target.value)}
                    placeholder={`es. 1-${session.meta.numPages} oppure 1-3, 5`}
                    aria-label="Intervallo di pagine"
                    data-testid="pdf-range-input"
                  />
                  {parsedRange.error && (
                    <span className="pdf-inline-error" role="alert" data-testid="pdf-range-error">
                      {parsedRange.error}
                    </span>
                  )}
                </div>
              )}
            </div>

            <div className="pdf-field-group">
              <label className="pdf-group-label" htmlFor="pdf-quality-select">
                Qualità di rendering (lossless {format === 'webp' ? 'WebP' : 'PNG'})
              </label>
              <div className="segmented" role="group" aria-label="Qualità di rendering">
                {(['standard', 'high', 'maximum'] as PdfQualityPreset[]).map((q) => (
                  <button
                    key={q}
                    type="button"
                    className={quality === q ? 'active' : ''}
                    aria-pressed={quality === q}
                    onClick={() => setQuality(q)}
                    data-testid={`pdf-quality-${q}`}
                  >
                    {q === 'standard' ? 'Standard (150 DPI)' : q === 'high' ? 'Alta (220 DPI)' : 'Massima (300 DPI)'}
                  </button>
                ))}
              </div>
              <p className="hint">{PDF_QUALITY_PRESETS[quality].description}</p>
            </div>

            <div className="pdf-field-group">
              <label className="pdf-group-label">Modalità di inserimento</label>
              <div className="pdf-mode-cards">
                <button
                  type="button"
                  className={`pdf-mode-card${mode === 'single-container' ? ' active' : ''}`}
                  aria-pressed={mode === 'single-container'}
                  onClick={() => setMode('single-container')}
                  data-testid="pdf-mode-single"
                >
                  <LayoutList size={18} />
                  <div>
                    <strong>In un unico contenitore</strong>
                    <span>
                      Tutte le pagine in flusso nello stesso contenitore, con spazio per scrivere appunti tra una pagina e l’altra.
                    </span>
                  </div>
                </button>
                <button
                  type="button"
                  className={`pdf-mode-card${mode === 'one-per-container' ? ' active' : ''}`}
                  aria-pressed={mode === 'one-per-container'}
                  onClick={() => setMode('one-per-container')}
                  data-testid="pdf-mode-multiple"
                >
                  <Layers size={18} />
                  <div>
                    <strong>Una pagina per contenitore</strong>
                    <span>
                      Ogni pagina come oggetto immagine libero disposto in colonna sulla tela con margine regolare.
                    </span>
                  </div>
                </button>
              </div>
            </div>

            {quotaCheck && (
              <div className="pdf-storage-info">
                <span className="hint">
                  Spazio stimato: ~{formatBytes(quotaCheck.estimatedBytes)}
                  {Number.isFinite(quotaCheck.availableBytes)
                    ? ` (disponibili ${formatBytes(quotaCheck.availableBytes)})`
                    : ''}
                </span>
                {!quotaCheck.ok && (
                  <div className="pdf-quota-warning" role="alert" data-testid="pdf-quota-warning">
                    <AlertTriangle size={15} />
                    <span>{quotaCheck.warningMessage}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

/** Discrete floating progress pill with aria-live and Cancel button shown during progressive PDF import. */
export function PdfImportProgressBanner() {
  const progress = usePdfImportState((s) => s.activeProgress);
  const abortController = usePdfImportState((s) => s.abortController);

  if (!progress) return null;

  const pct =
    progress.totalPages > 0 ? Math.round((progress.completedPages / progress.totalPages) * 100) : 0;

  return (
    <div
      className="pdf-progress-banner glass-strong"
      role="status"
      aria-live="polite"
      data-testid="pdf-import-progress"
      data-ui
    >
      <Loader2 size={15} className="spin" />
      <div className="pdf-progress-text">
        <span>
          Importazione PDF: pagina {Math.min(progress.completedPages + 1, progress.totalPages)} di{' '}
          {progress.totalPages} ({pct}%)
        </span>
        <div className="pdf-progress-bar">
          <div className="pdf-progress-fill" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <button
        type="button"
        className="btn sm"
        onClick={() => abortController?.abort()}
        data-testid="pdf-import-abort"
      >
        <X size={13} /> Annulla
      </button>
    </div>
  );
}
