import { useEffect, useState } from 'react';
import { Download, HardDrive, RotateCcw, Upload } from 'lucide-react';
import { Modal } from './Dialogs';
import { useSettings, type ThemeMode } from '../store/settings';
import { askConfirm, confirmDanger, toast, useUI } from '../store/ui';
import { dirty, useStore } from '../store/useStore';
import { HL_INK, INK_COLORS } from './Ribbon';
import { BackupValidationError, backupToAssets, buildBackup, downloadBlob, mergeWorkspaces, remapBackup, validateBackup } from '../storage/backup';
import { putAsset, replaceAll, requestPersistence, saveAll, storageEstimate } from '../storage/db';
import { flush } from '../storage/autosave';
import type { BackgroundPattern, PaperColor } from '../types';
import { formatCombo } from '../shortcuts/registry';
import { desktop } from '../desktop';

function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export async function exportBackup() {
  await flush();
  const st = useStore.getState();
  const b = await buildBackup(st.workspace, st.pages);
  const blob = new Blob([JSON.stringify(b)], { type: 'application/json' });
  const date = new Date().toISOString().slice(0, 10);
  downloadBlob(blob, `auranotes-backup-${date}.json`);
  toast(`Backup esportato (${fmtBytes(blob.size)})`, 'success');
}

export async function importBackupFile(file: File) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    toast('Il file non è un JSON valido.', 'error');
    return;
  }
  let backup;
  try {
    backup = validateBackup(parsed);
  } catch (e) {
    toast(e instanceof BackupValidationError ? e.message : 'Backup non valido', 'error', 6000);
    return;
  }
  const nbCount = backup.workspace.notebookIds.length;
  const choice = await askConfirm({
    title: 'Importa backup',
    message: `Il backup contiene ${nbCount} quaderni e ${backup.pages.length} pagine. Puoi aggiungerli ai tuoi quaderni attuali (unisci) oppure sostituire tutti i dati attuali.`,
    confirmLabel: 'Unisci',
    altLabel: 'Sostituisci tutto…',
  });
  if (choice === 'cancel') return;
  try {
    if (choice === 'confirm') {
      const remapped = remapBackup(backup);
      for (const a of backupToAssets(remapped)) await putAsset(a);
      await saveAll(null, remapped.pages);
      useStore.getState().mutateWorkspace((ws) => mergeWorkspaces(ws, remapped.workspace));
      await flush();
      toast(`Importati ${remapped.workspace.notebookIds.length} quaderni`, 'success');
    } else {
      const sure = await confirmDanger('Sostituire tutti i dati?', 'Tutti i quaderni, le pagine e le immagini attuali verranno eliminati e sostituiti dal backup. Ti consigliamo di esportare prima un backup dei dati attuali.', 'Sostituisci');
      if (!sure) return;
      await replaceAll({ ...backup.workspace, trash: backup.workspace.trash ?? [] }, backup.pages, backupToAssets(backup));
      dirty.ws = false;
      dirty.pages.clear();
      localStorage.removeItem('glassnote.lastPage');
      toast('Backup ripristinato. Ricarico…', 'success');
      setTimeout(() => window.location.reload(), 600);
    }
  } catch (e) {
    toast(`Importazione non riuscita: ${e instanceof Error ? e.message : String(e)}`, 'error', 6000);
  }
}

export function pickBackupFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.style.position = 'fixed';
  input.style.top = '-10000px';
  input.style.opacity = '0';
  document.body.appendChild(input);
  const cleanup = () => {
    input.remove();
  };
  input.onchange = () => {
    const f = input.files?.[0];
    cleanup();
    if (f) void importBackupFile(f);
  };
  input.oncancel = cleanup;
  input.click();
}

export function SettingsDialog() {
  const open = useUI((s) => s.settingsOpen);
  const s = useSettings();
  const [est, setEst] = useState<{ usage: number; quota: number } | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  useEffect(() => {
    if (!open) return;
    void storageEstimate().then(setEst);
    void (navigator.storage?.persisted?.() ?? Promise.resolve(false)).then(setPersisted).catch(() => setPersisted(null));
  }, [open]);
  if (!open) return null;
  const close = () => useUI.getState().set({ settingsOpen: false });
  const pct = est && est.quota ? (est.usage / est.quota) * 100 : 0;

  return (
    <Modal title="Impostazioni" onClose={close} wide testid="settings-dialog">
      <div className="settings-grid">
        <section>
          <h3>Aspetto</h3>
          <label className="row">
            <span>Tema</span>
            <div className="segmented">
              {(['light', 'dark', 'system'] as ThemeMode[]).map((t) => (
                <button key={t} className={s.theme === t ? 'active' : ''} onClick={() => s.set({ theme: t })} data-testid={`theme-${t}`}>
                  {t === 'light' ? 'Chiaro' : t === 'dark' ? 'Scuro' : 'Sistema'}
                </button>
              ))}
            </div>
          </label>
          <label className="row">
            <span>Sfondo delle nuove pagine</span>
            <select value={s.background} onChange={(e) => s.set({ background: e.target.value as BackgroundPattern })}>
              <option value="plain">Liscio</option>
              <option value="dots">Puntinato</option>
              <option value="grid">Quadretti</option>
              <option value="lines">Righe</option>
            </select>
          </label>
          <label className="row">
            <span>Colore carta</span>
            <select value={s.paper} onChange={(e) => s.set({ paper: e.target.value as PaperColor })}>
              <option value="white">Bianco</option>
              <option value="warm">Avorio</option>
              <option value="cool">Grigio chiaro</option>
              <option value="dark">Scuro</option>
            </select>
          </label>
          <label className="row">
            <span>Zoom predefinito</span>
            <select value={s.defaultZoom} onChange={(e) => s.set({ defaultZoom: Number(e.target.value) })}>
              {[0.75, 1, 1.25, 1.5].map((z) => (
                <option key={z} value={z}>
                  {Math.round(z * 100)}%
                </option>
              ))}
            </select>
          </label>
        </section>

        <section>
          <h3>Strumenti</h3>
          <div className="row">
            <span>Colore penna</span>
            <div className="mini-swatches">
              {INK_COLORS.slice(0, 7).map((c) => (
                <button key={c} className={`swatch${s.penColor === c ? ' active' : ''}`} style={{ background: c }} onClick={() => s.set({ penColor: c })} aria-label={`Penna ${c}`} />
              ))}
            </div>
          </div>
          <div className="row">
            <span>Colore evidenziatore</span>
            <div className="mini-swatches">
              {HL_INK.map((c) => (
                <button key={c} className={`swatch${s.highlighterColor === c ? ' active' : ''}`} style={{ background: c }} onClick={() => s.set({ highlighterColor: c })} aria-label={`Evidenziatore ${c}`} />
              ))}
            </div>
          </div>
          <label className="row">
            <span>Spessore penna</span>
            <input type="range" min={0.5} max={12} step={0.5} value={s.penWidth} onChange={(e) => s.set({ penWidth: Number(e.target.value) })} />
            <span className="val">{s.penWidth}</span>
          </label>
          <label className="row check">
            <input type="checkbox" checked={s.alignmentGuides} onChange={(e) => s.set({ alignmentGuides: e.target.checked })} />
            <span>Guide di allineamento durante lo spostamento</span>
          </label>
          <label className="row check">
            <input type="checkbox" checked={s.snapToGrid} onChange={(e) => s.set({ snapToGrid: e.target.checked })} />
            <span>Aggancia alla griglia (20 px)</span>
          </label>
        </section>

        <section>
          <h3>Area di lavoro</h3>
          <label className="row check">
            <input type="checkbox" checked={s.layout.sidebarVisible} onChange={(e) => s.setLayout({ sidebarVisible: e.target.checked })} />
            <span>Mostra pannelli di navigazione ({formatCombo('mod+shift+b')})</span>
          </label>
          <label className="row check">
            <input type="checkbox" checked={s.layout.notebooksVisible} onChange={(e) => s.setLayout({ notebooksVisible: e.target.checked })} />
            <span>Pannello quaderni</span>
          </label>
          <label className="row check">
            <input type="checkbox" checked={s.layout.sectionsVisible} onChange={(e) => s.setLayout({ sectionsVisible: e.target.checked })} />
            <span>Pannello sezioni</span>
          </label>
          <label className="row check">
            <input type="checkbox" checked={s.layout.pagesVisible} onChange={(e) => s.setLayout({ pagesVisible: e.target.checked })} />
            <span>Pannello pagine</span>
          </label>
          <button className="btn sm" onClick={() => (s.resetLayout(), toast('Layout ripristinato'))}>
            <RotateCcw size={13} /> Ripristina layout predefinito
          </button>
          <label className="row">
            <span>Salvataggio automatico dopo</span>
            <select value={s.autosaveDelay} onChange={(e) => s.set({ autosaveDelay: Number(e.target.value) })}>
              <option value={300}>0,3 s</option>
              <option value={600}>0,6 s</option>
              <option value={1500}>1,5 s</option>
              <option value={4000}>4 s</option>
            </select>
          </label>
          <button className="btn sm" onClick={() => (close(), useUI.getState().set({ shortcutsOpen: true }))}>
            Scorciatoie da tastiera…
          </button>
        </section>

        <section>
          <h3>Dati e backup</h3>
          <p className="hint">
            {desktop()
              ? 'Le note sono salvate sul Mac in ~/Library/Application Support/AuraNotes; l’app crea anche backup automatici (ultimi 20). Per portare appunti dalla versione browser usa “Importa backup”.'
              : 'Le note sono salvate solo in questo browser (IndexedDB). Svuotare i dati del sito le elimina: esporta regolarmente un backup.'}
          </p>
          <div className="btn-row">
            <button className="btn" onClick={() => void exportBackup()} data-testid="export-backup">
              <Download size={14} /> Esporta backup
            </button>
            <button className="btn" onClick={pickBackupFile}>
              <Upload size={14} /> Importa backup…
            </button>
          </div>
          {desktop() && (
            <div className="btn-row" style={{ marginTop: 8 }}>
              <button className="btn sm" onClick={() => void desktop()!.openBackups()}>
                Apri backup automatici
              </button>
            </div>
          )}
          {est && (
            <div className="storage-meter">
              <HardDrive size={14} />
              <div className="meter">
                <div style={{ width: `${Math.min(100, pct)}%` }} className={pct > 80 ? 'warn' : ''} />
              </div>
              <span>
                {fmtBytes(est.usage)} di {fmtBytes(est.quota)}
              </span>
            </div>
          )}
          {pct > 80 && <p className="hint warn">Lo spazio disponibile si sta esaurendo: elimina immagini inutili o svuota il cestino.</p>}
          <p className="hint">
            Archiviazione persistente: {persisted === null ? 'non disponibile' : persisted ? 'attiva' : 'non concessa'}
            {persisted === false && (
              <button className="link-btn" onClick={async () => setPersisted(await requestPersistence())}>
                Richiedi
              </button>
            )}
          </p>
          <button
            className="btn sm danger-outline"
            onClick={async () => {
              if (await confirmDanger('Ripristinare le preferenze?', 'Tema, strumenti e layout torneranno ai valori predefiniti. Le note non verranno toccate.', 'Ripristina')) {
                s.reset();
                toast('Preferenze ripristinate');
              }
            }}
          >
            Ripristina preferenze
          </button>
        </section>
      </div>
    </Modal>
  );
}
