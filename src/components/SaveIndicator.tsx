import { useStore } from '../store/useStore';
import { flush } from '../storage/autosave';
import { formatCombo } from '../shortcuts/registry';

function OneNoteCloudSavedIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17.5 19H7a4.5 4.5 0 0 1-.4-8.98A6 6 0 0 1 18.2 8.2a4.5 4.5 0 0 1-.7 10.8Z" />
      <path d="m9.5 13.5 2 2 4-4" />
    </svg>
  );
}

function OneNoteCloudSyncIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6.5 18.5A4.2 4.2 0 0 1 6.2 10a5.8 5.8 0 0 1 11.2-1.6A4.2 4.2 0 0 1 20 15" />
      <g className={spinning ? 'onenote-sync-spin' : undefined}>
        <path d="M10 15.5a3.5 3.5 0 0 1 5.6-1.3" />
        <polyline points="15.8 11.8 15.8 14.3 13.3 14.3" />
        <path d="M16 17.5a3.5 3.5 0 0 1-5.6 1.3" />
        <polyline points="10.2 21.2 10.2 18.7 12.7 18.7" />
      </g>
    </svg>
  );
}

function OneNoteCloudErrorIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17.5 19H7a4.5 4.5 0 0 1-.4-8.98A6 6 0 0 1 18.2 8.2a4.5 4.5 0 0 1-.7 10.8Z" />
      <line x1="12" y1="10.5" x2="12" y2="14" />
      <circle cx="12" cy="16.5" r="0.6" fill="currentColor" />
    </svg>
  );
}

export function SaveIndicator() {
  const status = useStore((s) => s.saveStatus);
  const err = useStore((s) => s.saveError);
  const map = {
    saved: { icon: <OneNoteCloudSavedIcon />, label: 'Salvato', cls: 'ok' },
    saving: { icon: <OneNoteCloudSyncIcon spinning={true} />, label: 'Salvataggio…', cls: 'busy' },
    unsaved: { icon: <OneNoteCloudSyncIcon spinning={false} />, label: 'Salvataggio…', cls: 'pending' },
    error: { icon: <OneNoteCloudErrorIcon />, label: 'Errore di salvataggio', cls: 'error' },
  } as const;
  const m = map[status];
  return (
    <button
      className={`save-indicator ${m.cls}`}
      title={err ?? `${m.label} (${formatCombo('mod+s')} per salvare ora)`}
      aria-label={err ?? m.label}
      onClick={() => void flush()}
      data-testid="save-status"
      aria-live="polite"
    >
      {m.icon}
      <span className="sr-only">{m.label}</span>
    </button>
  );
}
