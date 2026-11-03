#!/usr/bin/env node
/**
 * Builds AuraNotes.app for macOS.
 *
 *   npm run app:mac                  → release/AuraNotes-darwin-arm64/AuraNotes.app (Apple Silicon)
 *   npm run app:mac -- --arch=x64    → Intel Macs
 *   npm run app:mac -- --out=/percorso/cartella   → also copies AuraNotes.app there
 *
 * Works on macOS and on Linux (cross-packaging, unsigned). On a Mac, the app is then
 * ad-hoc signed with `codesign` so macOS accepts it after the bundle is modified.
 */
import { packager } from '@electron/packager';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const arch = args.arch || 'arm64';
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

if (!fs.existsSync(path.join(root, 'dist', 'index.html'))) {
  console.error('dist/ non trovata: esegui prima "npm run build".');
  process.exit(1);
}

// Only the built web app, the Electron entry points and package.json go into the bundle.
const keep = [/^\/package\.json$/, /^\/desktop(\/|$)/, /^\/dist(\/|$)/];

const [appDir] = await packager({
  dir: root,
  name: 'AuraNotes',
  executableName: 'AuraNotes',
  platform: 'darwin',
  arch,
  electronVersion: pkg.devDependencies.electron.replace(/^[^\d]*/, ''),
  appBundleId: 'it.auranotes.app',
  appCategoryType: 'public.app-category.education',
  appVersion: pkg.version,
  icon: path.join(root, 'build', 'icon.icns'),
  // Optional: folder that already contains electron-vX-darwin-<arch>.zip (offline / proxied builds).
  ...(process.env.ELECTRON_ZIP_DIR ? { electronZipDir: process.env.ELECTRON_ZIP_DIR } : {}),
  out: path.join(root, 'release'),
  overwrite: true,
  prune: false,
  asar: true,
  ignore: (file) => file !== '' && !keep.some((re) => re.test(file)),
  extendInfo: {
    CFBundleDisplayName: 'AuraNotes',
    LSApplicationCategoryType: 'public.app-category.education',
    NSHumanReadableCopyright: 'AuraNotes',
  },
});

const appPath = path.join(appDir, 'AuraNotes.app');
if (process.platform === 'darwin') {
  try {
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
    execFileSync('xattr', ['-cr', appPath]);
  } catch (e) {
    console.warn('Firma ad-hoc non riuscita (l’app potrebbe comunque avviarsi):', e.message);
  }
}
console.log(`\n✓ Creato ${appPath}`);

if (args.out) {
  const outDir = path.resolve(args.out);
  const oldDest = path.join(outDir, 'GlassNotes.app');
  if (fs.existsSync(oldDest)) {
    try {
      fs.rmSync(oldDest, { recursive: true, force: true });
      console.log(`✓ Rimosso vecchio pacchetto ${oldDest}`);
    } catch (e) {
      console.warn(`Impossibile rimuovere ${oldDest}:`, e.message);
    }
  }
  const dest = path.join(outDir, 'AuraNotes.app');
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(appPath, dest, { recursive: true, verbatimSymlinks: true });
  fs.rmSync(path.join(root, 'release'), { recursive: true, force: true });
  const userAppsDuplicate = path.join(process.env.HOME || '', 'Applications', 'AuraNotes.app');
  if (outDir === '/Applications' && fs.existsSync(userAppsDuplicate)) {
    fs.rmSync(userAppsDuplicate, { recursive: true, force: true });
    console.log(`✓ Rimosso duplicato ${userAppsDuplicate}`);
  }
  console.log(`✓ Copiato in ${dest} (cartella temporanea release/ rimossa per evitare duplicati)`);
}
