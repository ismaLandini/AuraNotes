import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const OUT = path.resolve('test-results/e2e');
fs.mkdirSync(OUT, { recursive: true });

type Item = { id: string; type: string; x?: number; y?: number; w?: number; h?: number; parentId?: string; fromId?: string; toId?: string; doc?: unknown; freeImage?: boolean };

async function pageItems(page: Page): Promise<Item[]> {
  return page.evaluate(() => {
    const s = (window as any).__glassnote.useStore.getState();
    const p = s.pages[s.pageId];
    return p ? p.order.map((id: string) => p.items[id]) : [];
  });
}

async function canvasBox(page: Page) {
  const box = await page.getByTestId('canvas').boundingBox();
  if (!box) throw new Error('canvas not visible');
  return box;
}

async function answerPrompt(page: Page, value: string) {
  const input = page.getByTestId('prompt-input');
  await expect(input).toBeVisible();
  await input.fill(value);
  await page.getByTestId('prompt-ok').click();
}

/** Generates a PNG in the browser so no fixture files are needed. */
async function makePng(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 480;
    c.height = 320;
    const g = c.getContext('2d')!;
    const grad = g.createLinearGradient(0, 0, 480, 320);
    grad.addColorStop(0, '#5b8def');
    grad.addColorStop(1, '#7fe0c4');
    g.fillStyle = grad;
    g.fillRect(0, 0, 480, 320);
    g.fillStyle = '#fff';
    g.font = 'bold 40px sans-serif';
    g.fillText('Diagramma', 120, 170);
    return c.toDataURL('image/png').split(',')[1];
  });
  return Buffer.from(b64, 'base64');
}

test('complete academic workflow', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  // 1. Launch
  await page.goto('/');
  await page.getByTestId('home-resume-workspace').click();
  await expect(page.getByTestId('canvas')).toBeVisible();
  await expect(page.locator('.item.text-item', { hasText: 'Benvenuto in AuraNotes' })).toBeVisible();

  // 2. Create a notebook
  await page.getByRole('button', { name: 'Nuovo quaderno' }).click();
  await answerPrompt(page, 'Ricerca Operativa');
  await expect(page.getByRole('button', { name: 'Quaderno Ricerca Operativa' })).toHaveClass(/active/);

  // 3. Create a section
  await page.getByRole('button', { name: 'Nuova sezione' }).click();
  await answerPrompt(page, 'Lezioni');
  await expect(page.locator('.nav-item.section', { hasText: 'Lezioni' })).toHaveClass(/active/);

  // 4. Create a page: the cursor goes to the title on the sheet
  await page.getByRole('button', { name: 'Nuova pagina' }).click();
  const title = page.getByTestId('page-title');
  await expect(title).toBeFocused();
  await title.fill('Simplesso');
  await title.press('Enter'); // continues writing in the body, below the title
  await expect(page.locator('.nav-item.page', { hasText: 'Simplesso' })).toBeVisible();

  // 5. Add and format text
  let box = await canvasBox(page);
  await expect(page.locator('.text-item.editing .ProseMirror')).toBeFocused();
  await page.keyboard.type('Metodo del simplesso');
  await page.keyboard.press('Shift+Home');
  await page.getByTestId('fmt-bold').click();
  await page.keyboard.press('ArrowRight'); // collapse the selection at the end
  await page.waitForTimeout(80); // ProseMirror syncs native selection changes asynchronously
  await page.keyboard.press('Enter');
  await page.getByTestId('fmt-bold').click(); // stop bold for the next paragraph
  await page.keyboard.type('Forma standard: ');
  await page.keyboard.press('Escape');
  await expect(page.locator('.text-item:not(.editing) strong', { hasText: 'Metodo del simplesso' })).toBeVisible();
  await expect(page.locator('.text-item:not(.editing) p')).toHaveCount(2);

  // 6. Insert an image through the file picker
  const png = await makePng(page);
  const chooserP = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Inserisci immagine' }).first().click();
  const chooser = await chooserP;
  await chooser.setFiles({ name: 'diagramma.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('.image-block-container img, .item img, .image-item img')).toBeVisible();
  let items = await pageItems(page);
  const img = items.find((i) => i.type === 'image' || (i.type === 'container' && (i.freeImage || (i.doc as any)?.content?.some((c: any) => c.type === 'imageBlock'))))!;
  expect(img).toBeTruthy();
  // place the image to the right of the text, by dragging it
  const imgEl = page.locator('.image-block-container, .image-item, .item[data-id="' + img.id + '"]').first();
  let ib = (await imgEl.boundingBox())!;
  await page.mouse.move(ib.x + ib.width / 2, ib.y + ib.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 700, box.y + 330, { steps: 8 });
  await page.mouse.up();

  // 7. Draw on the canvas with the pen
  await page.getByTestId('canvas').focus();
  await page.keyboard.press('p');
  await expect(page.locator('[data-tool="pen"]')).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.move(box.x + 160, box.y + 420);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(box.x + 160 + i * 18, box.y + 420 + Math.sin(i) * 20);
  await page.mouse.up();
  items = await pageItems(page);
  expect(items.filter((i) => i.type === 'stroke' && !i.parentId)).toHaveLength(1);

  // 8. Annotate the image (stroke starting on the image is attached to it)
  ib = (await imgEl.boundingBox())!;
  await page.mouse.move(ib.x + 40, ib.y + 40);
  await page.mouse.down();
  await page.mouse.move(ib.x + 120, ib.y + 90, { steps: 6 });
  await page.mouse.move(ib.x + 200, ib.y + 60, { steps: 6 });
  await page.mouse.up();
  items = await pageItems(page);
  const imgItem = items.find((i) => i.type === 'image' || (i.type === 'container' && (i.freeImage || (i.doc as any)?.content?.some((c: any) => c.type === 'imageBlock'))))!;
  const imgId = imgItem.id;
  await expect(page.locator('.image-block-annotations path, .image-item .annotations path')).toHaveCount(1);

  // 9. Connect the text block to the image
  await page.keyboard.press('c');
  const textEl = page.locator('.text-item').first();
  const tb = (await textEl.boundingBox())!;
  ib = (await imgEl.boundingBox())!;
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
  await page.mouse.down();
  await page.mouse.move(ib.x + ib.width / 2, ib.y + ib.height / 2, { steps: 10 });
  await page.mouse.up();
  items = await pageItems(page);
  const conn = items.find((i) => i.type === 'connector')!;
  expect(conn).toBeTruthy();
  expect(conn.toId).toBe(imgId);

  // 10. Move the image: the connector must follow
  const connBefore = (await page.locator(`[data-id="${conn.id}"]`).boundingBox())!;
  await page.keyboard.press('v');
  ib = (await imgEl.boundingBox())!;
  await page.mouse.move(ib.x + 60, ib.y + ib.height - 40);
  await page.mouse.down();
  await page.mouse.move(ib.x + 60, ib.y + ib.height + 80, { steps: 8 });
  await page.mouse.up();
  const connAfter = (await page.locator(`[data-id="${conn.id}"]`).boundingBox())!;
  if (process.env.E2E_DEBUG) {
    await page.screenshot({ path: path.join(OUT, 'debug-move.png') });
    console.log(JSON.stringify({ connBefore, connAfter, ib, items: await pageItems(page) }, null, 1).slice(0, 3000));
  }
  const connDeltaY = Math.max(
    Math.abs(connAfter.height - connBefore.height),
    Math.abs((connAfter.y + connAfter.height) - (connBefore.y + connBefore.height)),
  );
  expect(connDeltaY).toBeGreaterThan(40);
  // annotation moved with the image
  items = await pageItems(page);
  await expect(page.locator('.image-block-annotations path, .image-item .annotations path')).toHaveCount(1);
  await page.screenshot({ path: path.join(OUT, '01-workflow.png') });

  // 11. Save and reload
  await page.keyboard.press(`${MOD}+S`);
  await expect(page.getByTestId('save-status')).toContainText('Salvato');
  const before = await pageItems(page);
  await page.reload();
  const resume = page.getByTestId('home-resume-workspace');
  if (await resume.isVisible({ timeout: 3000 }).catch(() => false)) {
    await resume.click();
  }
  await expect(page.getByTestId('canvas')).toBeVisible();

  // 12. Content is intact
  await expect(page.locator('.nav-item.page.active', { hasText: 'Simplesso' })).toBeVisible();
  await expect(page.locator('.text-item strong', { hasText: 'Metodo del simplesso' })).toBeVisible();
  await expect(page.locator('.image-block-container img, .item img, .image-item img')).toBeVisible();
  const after = await pageItems(page);
  expect(after.map((i) => i.type).sort()).toEqual(before.map((i) => i.type).sort());
  expect(after.find((i) => i.type === 'connector')!.toId).toBe(imgId);

  // 13. Export the page as PDF (print pipeline rendered to a real PDF)
  await page.evaluate(() => {
    (window as any).__printed = 0;
    window.print = () => {
      (window as any).__printed++;
    };
  });
  await page.keyboard.press(`${MOD}+P`);
  await expect(page.getByTestId('export-dialog')).toBeVisible();
  await expect(page.locator('.export-preview .sheet').first()).toBeVisible();
  await page.getByTestId('do-print').click();
  await expect.poll(() => page.evaluate(() => (window as any).__printed)).toBe(1);
  await expect(page.locator('#print-root .sheet').first()).toBeAttached();
  await page.emulateMedia({ media: 'print' });
  await page.screenshot({ path: path.join(OUT, '02-print-media.png'), fullPage: true });
  // In print media the app chrome is hidden and only the sheets are visible.
  await expect(page.locator('#root')).toBeHidden();
  await expect(page.locator('#print-root .sheet-header').first()).toContainText('Simplesso');
  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  fs.writeFileSync(path.join(OUT, 'export.pdf'), pdf);

  // 14. Verify the exported document
  expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  const pageCount = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  expect(pageCount).toBeGreaterThanOrEqual(1);
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await expect(page.locator('#print-root')).toHaveCount(0);

  // 15. Keyboard shortcut panel
  await page.getByTestId('canvas').focus();
  await page.keyboard.press(`${MOD}+/`);
  const overlay = page.getByTestId('shortcuts-overlay');
  await expect(overlay).toBeVisible();
  await overlay.getByLabel('Cerca scorciatoia').fill('zoom');
  await expect(overlay.locator('li', { hasText: 'Ingrandisci' })).toBeVisible();
  await expect(overlay.locator('li', { hasText: 'Grassetto' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(overlay).toBeHidden();

  // 16. Collapse and restore navigation panels
  await page.getByTestId('canvas').focus();
  await page.keyboard.press(`${MOD}+Shift+B`);
  await expect(page.locator('aside.sidebar')).toHaveCount(0);
  await page.keyboard.press(`${MOD}+Shift+B`);
  await expect(page.locator('aside.sidebar')).toBeVisible();
  await page.getByRole('button', { name: 'Comprimi Sezioni' }).click();
  await expect(page.getByRole('button', { name: 'Mostra Sezioni' })).toBeVisible();
  await page.getByRole('button', { name: 'Mostra Sezioni' }).click();
  await expect(page.locator('.panel-title', { hasText: 'Sezioni' })).toBeVisible();

  // 17. Resize the window: navigation becomes a slide-out panel
  await page.setViewportSize({ width: 820, height: 760 });
  await expect(page.locator('aside.sidebar')).toHaveCount(0);
  await page.getByTestId('toggle-sidebar').click();
  await expect(page.locator('aside.sidebar.overlay')).toBeVisible();
  await page.screenshot({ path: path.join(OUT, '03-compact.png') });
  await page.locator('.scrim').click({ position: { x: 790, y: 400 } });
  await expect(page.locator('aside.sidebar.overlay')).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 900 });

  // 18. Dark and light themes
  await page.getByRole('button', { name: 'Impostazioni' }).click();
  await page.getByTestId('theme-dark').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.keyboard.press('Escape');
  await page.screenshot({ path: path.join(OUT, '04-dark.png') });
  await page.getByRole('button', { name: 'Impostazioni' }).click();
  await page.getByTestId('theme-light').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.keyboard.press('Escape');

  expect(errors, errors.join('\n')).toEqual([]);
});

test('undo/redo, copy/paste and delete on the canvas', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('home-resume-workspace').click();
  await expect(page.getByTestId('canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Nuova pagina' }).click();
  const box = await canvasBox(page);
  await page.getByTestId('canvas').focus();
  await page.keyboard.press('r');
  await page.mouse.move(box.x + 200, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 320, box.y + 260, { steps: 5 });
  await page.keyboard.down('Shift'); // square constraint
  await page.mouse.move(box.x + 330, box.y + 270, { steps: 2 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  let items = await pageItems(page);
  expect(items).toHaveLength(1);
  const sq = items[0] as unknown as { x1: number; x2: number; y1: number; y2: number };
  expect(Math.abs(Math.abs(sq.x2 - sq.x1) - Math.abs(sq.y2 - sq.y1))).toBeLessThan(0.01);

  await page.keyboard.press('v');
  await page.mouse.click(box.x + 200, box.y + 230); // on the left edge of the square
  await page.keyboard.press(`${MOD}+D`);
  expect(await pageItems(page)).toHaveLength(2);
  await page.keyboard.press(`${MOD}+Z`);
  expect(await pageItems(page)).toHaveLength(1);
  await page.keyboard.press(`${MOD}+Shift+Z`);
  expect(await pageItems(page)).toHaveLength(2);
  await page.keyboard.press(`${MOD}+A`);
  await page.keyboard.press('Backspace');
  expect(await pageItems(page)).toHaveLength(0);
  await page.keyboard.press(`${MOD}+Z`);
  expect(await pageItems(page)).toHaveLength(2);

  // Copy / paste through the real clipboard events
  await page.keyboard.press(`${MOD}+A`);
  await page.evaluate(() => {
    const dt = new DataTransfer();
    document.dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true }));
    (window as any).__dt = dt;
  });
  await page.evaluate(() => {
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: (window as any).__dt, bubbles: true }));
  });
  await expect.poll(async () => (await pageItems(page)).length).toBe(4);

  // Pasting external text creates a text block
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', 'Testo incollato da un altro programma');
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
  });
  await expect(page.locator('.text-item', { hasText: 'Testo incollato' })).toBeVisible();

  // Pasting an image file inserts it
  const png = await makePng(page);
  await page.evaluate((b64) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'clip.png', { type: 'image/png' }));
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
  }, png.toString('base64'));
  await expect(page.locator('.image-block-container img, .item img, .image-item img')).toBeVisible();
});

test('math, search and trash', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('home-resume-workspace').click();
  await expect(page.getByTestId('canvas')).toBeVisible();
  // Example notebook renders KaTeX
  await page.locator('.nav-item.section', { hasText: 'Esempio' }).click();
  await expect(page.locator('.katex').first()).toBeVisible();

  // Global search finds page content
  await page.keyboard.press(`${MOD}+K`);
  await page.getByTestId('search-input').fill('nepero');
  await expect(page.locator('.search-results li').first()).toContainText('Limiti notevoli');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('page-title')).toHaveValue('Limiti notevoli');

  // Trash and restore a page
  page.on('dialog', (d) => d.accept());
  await page.locator('.nav-item.page.active').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Sposta nel cestino' }).click();
  await page.getByTestId('confirm-ok').click();
  await expect(page.locator('.nav-item.page', { hasText: 'Limiti notevoli' })).toHaveCount(0);
  await page.locator('.trash-link').click();
  await page.getByTestId('trash-dialog').getByRole('button', { name: 'Ripristina' }).click();
  await expect(page.locator('.nav-item.page', { hasText: 'Limiti notevoli' })).toBeVisible();
  await expect(page.locator('.katex').first()).toBeVisible();
});

test('drawing tools, image handling and backup', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByTestId('home-resume-workspace').click();
  await expect(page.getByTestId('canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Nuova pagina' }).click();
  const box = await canvasBox(page);

  // Image via drag & drop
  const png = await makePng(page);
  const dt = await page.evaluateHandle((b64) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const d = new DataTransfer();
    d.items.add(new File([bytes], 'drop.png', { type: 'image/png' }));
    return d;
  }, png.toString('base64'));
  await page.getByTestId('canvas').dispatchEvent('dragover', { dataTransfer: dt, clientX: box.x + 150, clientY: box.y + 80 });
  await page.getByTestId('canvas').dispatchEvent('drop', { dataTransfer: dt, clientX: box.x + 150, clientY: box.y + 80 });
  await expect(page.locator('.image-block-container img, .item img, .image-item img')).toBeVisible();
  let items = await pageItems(page);
  const img0 = items.find((i) => i.type === 'image' || (i.type === 'container' && (i.freeImage || (i.doc as any)?.content?.some((c: any) => c.type === 'imageBlock'))))!;

  // Resize from the bottom-right corner keeps the aspect ratio
  await page.locator('.handle.h-se, .image-handle.handle-se, .handle.h-e').first().hover();
  const hb = (await page.locator('.handle.h-se, .image-handle.handle-se, .handle.h-e').first().boundingBox())!;
  await page.mouse.down();
  await page.mouse.move(hb.x + 120, hb.y + 10, { steps: 6 });
  await page.mouse.up();
  items = await pageItems(page);
  const img1 = items.find((i) => i.type === 'image' || (i.type === 'container' && (i.freeImage || (i.doc as any)?.content?.some((c: any) => c.type === 'imageBlock'))))!;
  expect(img1.w!).toBeGreaterThan(img0.w! + 50);
  expect(img1.w! / img1.h!).toBeCloseTo(img0.w! / img0.h!, 1);

  // Lock prevents moving
  await page.keyboard.press(`${MOD}+Shift+L`);
  const ib = (await page.locator('.image-block-container, .image-item, .item[data-id="' + img1.id + '"]').first().boundingBox())!;
  await page.mouse.move(ib.x + 50, ib.y + 50);
  await page.mouse.down();
  await page.mouse.move(ib.x + 250, ib.y + 150, { steps: 5 });
  await page.mouse.up();
  items = await pageItems(page);
  expect(items.find((i) => i.id === img1.id)!.x).toBe(img1.x);
  await page.keyboard.press(`${MOD}+Shift+L`);

  // Text annotation on the image (text tool click on top of it)
  await page.getByTestId('canvas').focus();
  await page.keyboard.press('t');
  await page.mouse.click(ib.x + 60, ib.y + ib.height - 60);
  await page.keyboard.type('Nota sul grafico');
  await page.keyboard.press('Escape');
  items = await pageItems(page);
  await expect(page.getByText('Nota sul grafico')).toBeVisible();

  // Highlighter + eraser on the general canvas
  await page.getByTestId('canvas').focus();
  await page.keyboard.press('m');
  await page.mouse.move(box.x + 120, box.y + 600);
  await page.mouse.down();
  await page.mouse.move(box.x + 400, box.y + 600, { steps: 10 });
  await page.mouse.up();
  items = await pageItems(page);
  const hl = items.find((i) => i.type === 'stroke') as unknown as { tool: string; opacity: number };
  expect(hl.tool).toBe('highlighter');
  expect(hl.opacity).toBeLessThan(1);
  await page.keyboard.press('e');
  await page.mouse.move(box.x + 260, box.y + 560);
  await page.mouse.down();
  await page.mouse.move(box.x + 260, box.y + 640, { steps: 8 });
  await page.mouse.up();
  items = await pageItems(page);
  expect(items.filter((i) => i.type === 'stroke')).toHaveLength(0);
  await page.keyboard.press(`${MOD}+Z`);
  items = await pageItems(page);
  expect(items.filter((i) => i.type === 'stroke')).toHaveLength(1);

  // Straight line constrained with Shift
  await page.keyboard.press('l');
  await page.keyboard.down('Shift');
  await page.mouse.move(box.x + 500, box.y + 500);
  await page.mouse.down();
  await page.mouse.move(box.x + 700, box.y + 512, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  items = await pageItems(page);
  const line = items.find((i) => i.type === 'shape') as unknown as { y1: number; y2: number };
  expect(line.y1).toBeCloseTo(line.y2, 3);

  // Context menu closes with Escape
  await page.locator('.nav-item.page.active').click({ button: 'right' });
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);

  // Backup export downloads a JSON with the image embedded
  await page.getByRole('button', { name: 'Impostazioni' }).click();
  const dl = page.waitForEvent('download');
  await page.getByTestId('export-backup').click();
  const file = await dl;
  const json = JSON.parse(fs.readFileSync((await file.path())!, 'utf8'));
  expect(json.format).toBe('auranotes-backup');
  expect(json.assets.length).toBeGreaterThanOrEqual(1);
  expect(errors).toEqual([]);
});
