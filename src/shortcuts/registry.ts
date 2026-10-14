/**
 * Centralised keyboard-shortcut registry. A single window-level listener dispatches
 * key events to registered handlers, taking the focus context into account.
 */
export type ShortcutCategory =
  | 'Navigazione'
  | 'Pagine e blocchi'
  | 'Formattazione testo'
  | 'Disegno'
  | 'Canvas'
  | 'Appunti'
  | 'Zoom e vista'
  | 'Ricerca e impostazioni';

/**
 * - `global`: works everywhere, including while typing (e.g. save, search).
 * - `canvas`: only when not typing in a text field / rich-text block and no dialog is open.
 * - `text`: documentation only; handled by the rich-text editor itself.
 */
export type ShortcutScope = 'global' | 'canvas' | 'text';

export interface ShortcutDef {
  id: string;
  keys: string[];
  label: string;
  category: ShortcutCategory;
  scope: ShortcutScope;
  /** Return false to let the event continue (no preventDefault). */
  run?: (e: KeyboardEvent) => boolean | void;
  /** Also run while a modal dialog is open (e.g. close overlays). */
  inModal?: boolean;
  note?: string;
  /** Not listed in the shortcut reference (internal handlers of transient UI). */
  hidden?: boolean;
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);

interface ParsedCombo {
  mod: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  key: string;
}

const KEY_ALIASES: Record<string, string[]> = {
  plus: ['+', '='],
  minus: ['-', '_'],
  slash: ['/'],
  question: ['?'],
  space: [' '],
  esc: ['escape'],
  del: ['delete', 'backspace'],
  up: ['arrowup'],
  down: ['arrowdown'],
  left: ['arrowleft'],
  right: ['arrowright'],
};

export function parseCombo(combo: string): ParsedCombo {
  const parts = combo.toLowerCase().split('+').filter(Boolean);
  // handle literal "+" key written as "mod++"
  if (combo.endsWith('++')) parts.push('plus');
  const key = parts[parts.length - 1];
  return {
    mod: parts.includes('mod'),
    ctrl: parts.includes('ctrl'),
    alt: parts.includes('alt'),
    shift: parts.includes('shift'),
    key,
  };
}

function eventKey(e: KeyboardEvent): string {
  // With Option held, macOS produces special characters: fall back to the physical letter/digit.
  if (e.altKey && /^Key[A-Z]$/.test(e.code)) return e.code.slice(3).toLowerCase();
  if (e.altKey && /^Digit\d$/.test(e.code)) return e.code.slice(5);
  return (e.key || '').toLowerCase();
}

export function matches(e: KeyboardEvent, combo: string, mac = isMac): boolean {
  const c = parseCombo(combo);
  if (mac) {
    if (c.mod !== e.metaKey || c.ctrl !== e.ctrlKey) return false;
  } else {
    if ((c.mod || c.ctrl) !== e.ctrlKey || e.metaKey) return false;
  }
  if (c.alt !== e.altKey) return false;
  const k = eventKey(e);
  const candidates = KEY_ALIASES[c.key] ?? [c.key];
  if (!candidates.includes(k)) return false;
  const isLetterOrNamed = /^[a-z0-9]$/.test(c.key) || ['up', 'down', 'left', 'right', 'del', 'esc', 'space', 'enter', 'tab', 'delete', 'backspace', 'escape'].includes(c.key) || c.key.startsWith('arrow') || /^f\d+$/.test(c.key);
  // Symbols often need Shift on non-US layouts (e.g. "/" is ⇧7 on Italian keyboards): ignore Shift unless required.
  if (isLetterOrNamed || c.shift) {
    if (c.shift !== e.shiftKey) return false;
  }
  return true;
}

const SYMBOLS: Record<string, string> = isMac
  ? { mod: '⌘', ctrl: '⌃', alt: '⌥', shift: '⇧' }
  : { mod: 'Ctrl', ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift' };

const KEY_LABELS: Record<string, string> = {
  plus: '+',
  minus: '−',
  slash: '/',
  question: '?',
  del: '⌫',
  delete: 'Canc',
  backspace: '⌫',
  esc: 'Esc',
  escape: 'Esc',
  space: 'Spazio',
  enter: '↩',
  tab: '⇥',
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
};

export function formatCombo(combo: string): string {
  const c = parseCombo(combo);
  const out: string[] = [];
  if (c.ctrl) out.push(SYMBOLS.ctrl);
  if (c.alt) out.push(SYMBOLS.alt);
  if (c.shift) out.push(SYMBOLS.shift);
  if (c.mod) out.push(SYMBOLS.mod);
  out.push(KEY_LABELS[c.key] ?? c.key.toUpperCase());
  return isMac ? out.join('') : out.join('+');
}

export function isEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable) return true;
  const tag = t.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (t as HTMLInputElement).type;
    return !['checkbox', 'radio', 'button', 'range', 'color', 'submit'].includes(type);
  }
  return false;
}

const registry: ShortcutDef[] = [];
const listeners = new Set<() => void>();

/** Registers shortcuts. `prepend` gives them priority (used by transient overlays such as menus). */
export function registerShortcuts(defs: ShortcutDef[], opts: { prepend?: boolean } = {}): () => void {
  if (opts.prepend) registry.unshift(...defs);
  else registry.push(...defs);
  listeners.forEach((l) => l());
  return () => {
    for (const d of defs) {
      const i = registry.indexOf(d);
      if (i >= 0) registry.splice(i, 1);
    }
    listeners.forEach((l) => l());
  };
}

export function listShortcuts(): ShortcutDef[] {
  return registry.filter((d) => !d.hidden);
}

export function onRegistryChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export interface DispatchContext {
  modalOpen: boolean;
}

/** Dispatches a key event; returns true when a shortcut handled it. */
export function dispatchKey(e: KeyboardEvent, ctx: DispatchContext): boolean {
  if (e.isComposing) return false;
  const typing = isEditableTarget(e.target);
  for (const def of registry) {
    if (!def.run || def.scope === 'text') continue;
    if (ctx.modalOpen && !def.inModal) continue;
    if (def.scope === 'canvas' && typing) continue;
    if (!def.keys.some((k) => matches(e, k))) continue;
    const res = def.run(e);
    if (res === false) continue;
    e.preventDefault();
    e.stopPropagation();
    return true;
  }
  return false;
}
