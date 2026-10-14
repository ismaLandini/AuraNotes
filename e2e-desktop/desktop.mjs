/**
 * Desktop smoke test: launches the real Electron app twice with the same profile and
 * checks that notes written in the first session are there in the second.
 *   xvfb-run node e2e-desktop/desktop.mjs   (Linux CI)   |   node e2e-desktop/desktop.mjs (macOS)
 */
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'glassnotes-profile-'));
const exe = process.env.GLASSNOTES_EXE; // optional: packaged app binary
const launch = () =>
  electron.launch({
    ...(exe ? { executablePath: exe, args: [`--user-data-dir=${profile}`] } : { args: [path.join(root, 'desktop', 'main.cjs'), `--user-data-dir=${profile}`, '--no-sandbox'] }),
    cwd: root,
  });

// Session 1: write a note, then close the window (the app must save before closing)
let app = await launch();
let win = await app.firstWindow();
await win.waitForSelector('[data-testid="canvas"]');
assert.equal(new URL(win.url()).protocol, 'app:', 'served from app://');
assert.ok(await win.evaluate(() => !!window.glassnotesDesktop), 'desktop bridge available');
await win.getByRole('button', { name: 'Nuova pagina' }).click();
await win.getByTestId('page-title').fill('Persistenza');
await win.getByTestId('page-title').press('Enter');
await win.keyboard.type('Scritto nella prima sessione');
// close immediately: no explicit save, the close handler must flush the pending text
const closed = app.waitForEvent('close');
// the same path as ⌘W / ⌘Q: BrowserWindow 'close' → page saves → window closes → app quits
await app.evaluate(({ BrowserWindow, app: a }) => {
  if (process.platform === 'darwin') a.quit();
  else BrowserWindow.getAllWindows()[0].close();
});
await closed;

// Session 2: same profile, the note must be there
app = await launch();
win = await app.firstWindow();
await win.waitForSelector('[data-testid="canvas"]');
await win.locator('.nav-item.page', { hasText: 'Persistenza' }).waitFor();
await win.locator('.nav-item.page', { hasText: 'Persistenza' }).click();
await win.locator('.text-item', { hasText: 'Scritto nella prima sessione' }).waitFor({ timeout: 10000 });
const info = await win.evaluate(() => window.glassnotesDesktop.info());
assert.ok(info.userData.startsWith(profile) || info.userData === profile, `userData in profile: ${info.userData}`);
// automatic backup can be written
await win.evaluate(async () => {
  const s = window.__glassnote.useStore.getState();
  await window.glassnotesDesktop.writeBackup(JSON.stringify({ format: 'glassnote-backup', test: true, pages: Object.keys(s.pages).length }));
});
const backups = fs.readdirSync(path.join(info.userData, 'Backups'));
assert.ok(backups.length >= 1, 'backup file written');
await win.screenshot({ path: path.join(root, 'test-results', 'desktop.png') });
await app.close();
console.log('✓ app:// shell, save-on-close, reopen with data, automatic backups');
console.log('  profile:', profile);
