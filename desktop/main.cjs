/**
 * AuraNotes for macOS — Electron main process.
 *
 * The web app (vite build in ../dist) is served from a private `app://glassnotes`
 * origin: no local server, no port, no file:// quirks. IndexedDB for that origin
 * lives in ~/Library/Application Support/AuraNotes, so notes persist across launches.
 * Rolling JSON backups are also written to ~/Library/Application Support/AuraNotes/Backups.
 */
const { app, BrowserWindow, protocol, net, Menu, shell, ipcMain, dialog, screen, nativeTheme } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const APP_NAME = 'AuraNotes';
const SCHEME = 'app';
const HOST = 'glassnotes';
const START_URL = `${SCHEME}://${HOST}/index.html`;

// Automatic migration from GlassNotes to AuraNotes if needed
try {
  const appData = app.getPath('appData');
  const auraUserData = path.join(appData, 'AuraNotes');
  const glassUserData = path.join(appData, 'GlassNotes');
  if (!fs.existsSync(auraUserData) && fs.existsSync(glassUserData)) {
    fs.cpSync(glassUserData, auraUserData, { recursive: true });
  }
} catch (e) {
  console.warn('Migrazione dati da GlassNotes non riuscita:', e);
}

app.setName(APP_NAME);

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

const DIST = path.resolve(__dirname, '..', 'dist');
const userData = () => app.getPath('userData');
const backupsDir = () => path.join(userData(), 'Backups');
const MAX_BACKUPS = 20;

let mainWindow = null;
let quitting = false;

// ------------------------------------------------------------------ single instance
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// ------------------------------------------------------------------ window state
const stateFile = () => path.join(userData(), 'window-state.json');

function loadWindowState() {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    const area = screen.getDisplayMatching(s).workArea;
    const visible = s.x < area.x + area.width && s.y < area.y + area.height && s.x + s.width > area.x && s.y + s.height > area.y;
    return visible ? s : null;
  } catch {
    return null;
  }
}

function saveWindowState(win) {
  try {
    if (win.isDestroyed() || win.isMinimized()) return;
    const b = win.getNormalBounds();
    fs.writeFileSync(stateFile(), JSON.stringify({ ...b, maximized: win.isMaximized() }));
  } catch {
    /* best effort */
  }
}

// ------------------------------------------------------------------ theme state
const themeFile = () => path.join(userData(), 'theme-state.json');

function loadThemeState() {
  try {
    const raw = fs.readFileSync(themeFile(), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed?.theme ?? 'system';
  } catch {
    return 'system';
  }
}

function saveThemeState(theme) {
  try {
    fs.writeFileSync(themeFile(), JSON.stringify({ theme }));
  } catch {
    /* best effort */
  }
}

const initialTheme = loadThemeState();
if (initialTheme === 'dark' || initialTheme === 'light' || initialTheme === 'system') {
  nativeTheme.themeSource = initialTheme;
}

// ------------------------------------------------------------------ static files over app://
function serveFile(request) {
  const url = new URL(request.url);
  if (url.host !== HOST) return new Response('Not found', { status: 404 });
  let rel = decodeURIComponent(url.pathname);
  if (!rel || rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(DIST, rel));
  if (!file.startsWith(DIST + path.sep)) return new Response('Forbidden', { status: 403 });
  // Unknown paths fall back to the app shell instead of a 404 page.
  const target = fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(DIST, 'index.html');
  return net.fetch(pathToFileURL(target).toString());
}

// ------------------------------------------------------------------ window
function createWindow() {
  const saved = loadWindowState();
  const isDark = nativeTheme.shouldUseDarkColors;
  const win = new BrowserWindow({
    width: saved?.width ?? 1440,
    height: saved?.height ?? 900,
    x: saved?.x,
    y: saved?.y,
    minWidth: 720,
    minHeight: 480,
    title: APP_NAME,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 12, y: 9 },
    backgroundColor: isDark ? '#1e1e1e' : '#081e42',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });
  if (saved?.maximized) win.maximize();
  mainWindow = win;

  win.once('ready-to-show', () => win.show());
  win.webContents.on('did-fail-load', (_e, code, desc) => {
    dialog.showErrorBox(APP_NAME, `Impossibile caricare l’interfaccia (${code}: ${desc}).\nVerifica che la cartella dist/ sia inclusa nel pacchetto.`);
  });

  // External links open in the default browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:|^mailto:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(`${SCHEME}://${HOST}/`)) {
      e.preventDefault();
      if (/^https?:|^mailto:/i.test(url)) shell.openExternal(url);
    }
  });

  // Before closing, ask the page to finish writing pending changes to IndexedDB.
  win.on('close', (e) => {
    saveWindowState(win);
    if (win.__flushed) return;
    e.preventDefault();
    const done = () => {
      if (win.isDestroyed()) return;
      win.__flushed = true;
      win.close();
    };
    const timer = setTimeout(done, 5000);
    ipcMain.once('glassnotes:flushed', () => {
      clearTimeout(timer);
      done();
    });
    win.webContents.send('glassnotes:flush-request');
  });
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
  ['resize', 'move'].forEach((ev) => win.on(ev, () => saveWindowState(win)));

  win.loadURL(START_URL);
  return win;
}

// ------------------------------------------------------------------ IPC
ipcMain.handle('glassnotes:write-backup', async (_e, json) => {
  if (typeof json !== 'string' || json.length < 2) throw new Error('Backup vuoto');
  await fs.promises.mkdir(backupsDir(), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
  const file = path.join(backupsDir(), `auranotes-${stamp}.json`);
  await fs.promises.writeFile(file + '.tmp', json, 'utf8');
  await fs.promises.rename(file + '.tmp', file);
  const all = (await fs.promises.readdir(backupsDir())).filter((f) => /^(glassnotes|auranotes)-.*\.json$/.test(f)).sort();
  for (const old of all.slice(0, Math.max(0, all.length - MAX_BACKUPS))) await fs.promises.rm(path.join(backupsDir(), old), { force: true });
  return file;
});

ipcMain.handle('glassnotes:open-backups', async () => {
  await fs.promises.mkdir(backupsDir(), { recursive: true });
  await shell.openPath(backupsDir());
});

ipcMain.handle('glassnotes:save-pdf', async (e, { title }) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const safe = String(title || APP_NAME).replace(/[\\/:*?"<>|]/g, '-').slice(0, 120);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Esporta PDF',
    defaultPath: path.join(app.getPath('documents'), `${safe}.pdf`),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (canceled || !filePath) return null;
  const data = await e.sender.printToPDF({ preferCSSPageSize: true, printBackground: true });
  await fs.promises.writeFile(filePath, data);
  shell.showItemInFolder(filePath);
  return filePath;
});

ipcMain.handle('glassnotes:info', () => ({ version: app.getVersion(), userData: userData(), backups: backupsDir() }));

ipcMain.handle('glassnotes:set-theme', (_e, { theme, dark }) => {
  if (theme === 'dark' || theme === 'light' || theme === 'system') {
    nativeTheme.themeSource = theme;
    saveThemeState(theme);
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    const isDark = typeof dark === 'boolean' ? dark : nativeTheme.shouldUseDarkColors;
    mainWindow.setBackgroundColor(isDark ? '#1e1e1e' : '#081e42');
  }
});

nativeTheme.on('updated', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#081e42');
  }
});

// ------------------------------------------------------------------ menu
function send(cmd) {
  const win = BrowserWindow.getFocusedWindow() || mainWindow;
  if (win) win.webContents.send('glassnotes:menu', cmd);
}

function buildMenu() {
  // Items whose shortcut the page already handles show it without registering it twice.
  const item = (label, cmd, accelerator) => ({ label, accelerator, registerAccelerator: false, click: () => send(cmd) });
  const template = [
    {
      label: APP_NAME,
      submenu: [
        { role: 'about', label: `Informazioni su ${APP_NAME}` },
        { type: 'separator' },
        item('Impostazioni…', 'settings', 'CmdOrCtrl+,'),
        { type: 'separator' },
        { role: 'hide', label: `Nascondi ${APP_NAME}` },
        { role: 'hideOthers', label: 'Nascondi altre' },
        { role: 'unhide', label: 'Mostra tutte' },
        { type: 'separator' },
        { role: 'quit', label: `Esci da ${APP_NAME}` },
      ],
    },
    {
      label: 'File',
      submenu: [
        item('Nuova pagina', 'new-page', 'CmdOrCtrl+Alt+N'),
        item('Importa PDF…', 'import-pdf', 'CmdOrCtrl+Shift+P'),
        { type: 'separator' },
        item('Esporta PDF…', 'export-pdf', 'CmdOrCtrl+P'),
        { type: 'separator' },
        item('Esporta backup…', 'export-backup'),
        item('Importa backup…', 'import-backup'),
        { label: 'Mostra cartella dei backup automatici', click: () => shell.openPath(backupsDir()) },
        { type: 'separator' },
        { role: 'close', label: 'Chiudi finestra' },
      ],
    },
    {
      label: 'Modifica',
      submenu: [
        { role: 'undo', label: 'Annulla' },
        { role: 'redo', label: 'Ripeti' },
        { type: 'separator' },
        { role: 'cut', label: 'Taglia' },
        { role: 'copy', label: 'Copia' },
        { role: 'paste', label: 'Incolla' },
        { role: 'pasteAndMatchStyle', label: 'Incolla senza formattazione' },
        { role: 'selectAll', label: 'Seleziona tutto' },
        { type: 'separator' },
        item('Cerca…', 'search', 'CmdOrCtrl+K'),
      ],
    },
    {
      label: 'Vista',
      submenu: [
        item('Pannelli di navigazione', 'toggle-sidebar', 'CmdOrCtrl+Shift+B'),
        item('Scorciatoie da tastiera', 'shortcuts', 'CmdOrCtrl+/'),
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Schermo intero' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' }, { role: 'reload' }]),
      ],
    },
    { role: 'windowMenu', label: 'Finestra' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ------------------------------------------------------------------ lifecycle
app.whenReady().then(() => {
  protocol.handle(SCHEME, serveFile);
  buildMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  quitting = true;
});

app.on('window-all-closed', () => {
  // macOS convention: the app stays in the Dock; elsewhere quit.
  if (process.platform !== 'darwin' || quitting) app.quit();
});
