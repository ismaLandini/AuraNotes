import { create } from 'zustand';
import type { BackgroundPattern, PaperColor } from '../types';

export type ThemeMode = 'light' | 'dark' | 'system';

export interface PanelLayout {
  sidebarVisible: boolean;
  notebooksVisible: boolean;
  sectionsVisible: boolean;
  pagesVisible: boolean;
  notebooksWidth: number;
  sectionsWidth: number;
  pagesWidth: number;
}

export interface Settings {
  theme: ThemeMode;
  penColor: string;
  penWidth: number;
  highlighterColor: string;
  highlighterWidth: number;
  shapeColor: string;
  shapeWidth: number;
  shapeFill: string | null;
  connectorColor: string;
  connectorWidth: number;
  textColorDefault: string;
  background: BackgroundPattern;
  paper: PaperColor;
  snapToGrid: boolean;
  alignmentGuides: boolean;
  defaultZoom: number;
  autosaveDelay: number;
  layout: PanelLayout;
}

export const DEFAULT_LAYOUT: PanelLayout = {
  sidebarVisible: true,
  // Notebooks start as a slim rail of initials: more room for writing.
  notebooksVisible: false,
  sectionsVisible: true,
  pagesVisible: true,
  notebooksWidth: 168,
  sectionsWidth: 150,
  pagesWidth: 184,
};

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  penColor: '#1d1d1f',
  penWidth: 2.5,
  highlighterColor: '#ffd60a',
  highlighterWidth: 16,
  shapeColor: '#e5484d',
  shapeWidth: 2.5,
  shapeFill: null,
  connectorColor: '#5b8def',
  connectorWidth: 2,
  textColorDefault: '#1d1d1f',
  background: 'plain',
  paper: 'white',
  snapToGrid: false,
  alignmentGuides: true,
  defaultZoom: 1,
  autosaveDelay: 600,
  layout: DEFAULT_LAYOUT,
};

const KEY = 'glassnote.settings.v1';
/** Bumped when default panel sizes change, so older saved layouts adopt the compact one. */
const LAYOUT_VERSION = 2;

function load(): Settings {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings> & { layoutVersion?: number; backgroundVersion?: number };
    // White pages became the default in 1.2: forget the old implicit "dots" default.
    if (parsed.backgroundVersion !== 2) delete parsed.background;
    const layout = parsed.layoutVersion === LAYOUT_VERSION ? { ...DEFAULT_LAYOUT, ...(parsed.layout ?? {}) } : { ...DEFAULT_LAYOUT, sidebarVisible: parsed.layout?.sidebarVisible ?? true };
    return { ...DEFAULT_SETTINGS, ...parsed, layout };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

interface SettingsState extends Settings {
  set: (patch: Partial<Settings>) => void;
  setLayout: (patch: Partial<PanelLayout>) => void;
  reset: () => void;
  resetLayout: () => void;
}

function persist(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...s, layoutVersion: LAYOUT_VERSION, backgroundVersion: 2 }));
  } catch {
    /* preferences are best-effort */
  }
}

function pick(s: SettingsState): Settings {
  const { set: _a, setLayout: _b, reset: _c, resetLayout: _d, ...rest } = s;
  void _a;
  void _b;
  void _c;
  void _d;
  return rest;
}

export const useSettings = create<SettingsState>((set, get) => ({
  ...load(),
  set: (patch) => {
    set(patch);
    persist(pick(get()));
  },
  setLayout: (patch) => {
    set({ layout: { ...get().layout, ...patch } });
    persist(pick(get()));
  },
  reset: () => {
    set({ ...DEFAULT_SETTINGS });
    persist(DEFAULT_SETTINGS);
  },
  resetLayout: () => {
    set({ layout: DEFAULT_LAYOUT });
    persist(pick(get()));
  },
}));
