import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const OUT = path.resolve('test-results/e2e');
fs.mkdirSync(OUT, { recursive: true });

type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function state(page: Page): Promise<{ items: Any[]; selection: string[]; editingId: string | null; tool: string }> {
  return page.evaluate(() => {
    const s = (window as any).__glassnote.useStore.getState();
    const p = s.pages[s.pageId];
    return { items: p ? p.order.map((id: string) => p.items[id]) : [], selection: s.selection, editingId: s.editingId, tool: s.tool };
  });
}

/** Adds items directly through the store (fast, deterministic setup). */
async function addItems(page: Page, items: Any[]) {
  await page.evaluate((list) => {
    const s = (window as any).__glassnote.useStore.getState();
    s.updatePage((p: any) => ({ ...p, items: { ...p.items, ...Object.fromEntries(list.map((i: any) => [i.id, i])) }, order: [...p.order, ...list.map((i: any) => i.id)] }));
  }, items);
}

const textItem = (id: string, x: number, y: number, txt: string) => ({ id, type: 'text', x, y, w: 220, h: 40, variant: 'plain', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: txt }] }] } });
const rect = (id: string, x: number, y: number) => ({ id, type: 'shape', kind: 'rect', x1: x, y1: y, x2: x + 120, y2: y + 80, color: '#1663d6', width: 2, opacity: 1, fill: null });

/** Double-clicks the middle of a canvas object (objects are hit-tested by the canvas itself). */
async function dbl(page: Page, selector: string) {
  const b = (await page.locator(selector).boundingBox())!;
  await page.mouse.dblclick(b.x + Math.min(40, b.width / 2), b.y + b.height / 2);
}

async function newPage(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Nuova pagina' }).click();
  await expect(page.getByTestId('page-title')).toBeFocused();
  await page.getByTestId('page-title').press('Escape');
}

/** Screen position of a world point. */
async function toScreen(page: Page, x: number, y: number) {
  return page.evaluate(
    ([wx, wy]) => {
      const s = (window as any).__glassnote.useStore.getState();
      const c = document.querySelector('[data-testid="canvas"]')!.getBoundingClientRect();
      const world = document.querySelector('.world') as HTMLElement;
      const m = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)\)/.exec(world.style.transform)!;
      void s;
      return { x: c.left + Number(m[1]) + wx * Number(m[3]), y: c.top + Number(m[2]) + wy * Number(m[3]) };
    },
    [x, y],
  );
}

test('compact navigation, bounded page and title on the sheet', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
  const sb = (await page.locator('aside.sidebar').boundingBox())!;
  expect(sb.width).toBeLessThan(400);
  // collapse everything for maximum writing space
  await page.getByTestId('toggle-sidebar').click();
  await expect(page.locator('aside.sidebar')).toHaveCount(0);
  await page.getByTestId('toggle-sidebar').click();

  await page.getByRole('button', { name: 'Nuova pagina' }).click();
  const title = page.getByTestId('page-title');
  await expect(title).toBeFocused();
  const tb = (await title.boundingBox())!;
  const cb = (await page.getByTestId('canvas').boundingBox())!;
  expect(tb.x - cb.x).toBeLessThan(200); // top-left of the sheet
  expect(tb.y - cb.y).toBeLessThan(120);
  await title.fill('Programmazione lineare');
  await title.press('Enter');
  await expect(page.locator('.text-item.editing .ProseMirror')).toBeFocused();
  await page.keyboard.type('Primo appunto');
  await page.keyboard.press('Escape');
  let s = await state(page);
  expect(s.items[0].x).toBe(48);
  expect(s.items[0].y).toBeGreaterThanOrEqual(0);

  // The sheet is two A4 wide (420 mm ≈ 1587 px) and nothing can leave it horizontally.
  const sheetW = await page.locator('.sheet-paper').evaluate((el) => parseFloat((el as HTMLElement).style.width));
  expect(sheetW).toBe(1587);
  await page.keyboard.press(`${MOD}+A`);
  for (let i = 0; i < 30; i++) await page.keyboard.press('Shift+ArrowRight');
  for (let i = 0; i < 300; i++) await page.keyboard.press('Shift+ArrowRight');
  s = await state(page);
  expect(s.items[0].x + s.items[0].w).toBeLessThanOrEqual(1587);

  // A very wide image is scaled to fit the page
  await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 3000;
    c.height = 600;
    c.getContext('2d')!.fillRect(0, 0, 3000, 600);
    const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/png'));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'wide.png', { type: 'image/png' }));
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
  });
  await expect(page.locator('.image-item img')).toBeVisible();
  await page.getByRole('button', { name: 'Adatta il contenuto alla vista' }).click();
  s = await state(page);
  const img = s.items.find((i) => i.type === 'image')!;
  // dragging the image far to the right keeps it inside
  await page.evaluate(() => (window as any).__glassnote.useStore.getState().setTool('select'));
  const ib = (await page.locator('.image-item').boundingBox())!;
  await page.mouse.move(ib.x + 20, ib.y + 20);
  await page.mouse.down();
  await page.mouse.move(ib.x + 900, ib.y + 40, { steps: 6 });
  await page.mouse.up();
  s = await state(page);
  const img2 = s.items.find((i) => i.type === 'image')!;
  expect(img.x).toBeGreaterThanOrEqual(0);
  expect(img2.x + img2.w).toBeLessThanOrEqual(1587.5);
  await page.screenshot({ path: path.join(OUT, '10-sheet.png') });
});

test('text boxes are discreet and never leave a stale outline', async ({ page }) => {
  await newPage(page);
  await addItems(page, [textItem('t1', 60, 40, 'Definizione di base')]);
  const block = page.locator('[data-id="t1"]');
  await expect(block).toBeVisible();
  const style = await block.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { border: cs.borderTopWidth, shadow: cs.boxShadow, bg: cs.backgroundColor };
  });
  expect(style.border).toBe('0px');
  expect(style.shadow).toBe('none');
  expect(style.bg).toBe('rgba(0, 0, 0, 0)');

  // Edit, then open a menu in the sidebar: editing ends, text is kept, no outline remains.
  await dbl(page, '[data-id="t1"]');
  await expect(page.locator('.text-item.editing')).toHaveCount(1);
  await page.keyboard.press('End');
  await page.keyboard.type(' e proprietà');
  await page.locator('.nav-item.page.active').click({ button: 'right' });
  await expect(page.getByRole('menu')).toBeVisible();
  await expect(page.locator('.text-item.editing')).toHaveCount(0);
  await expect(page.locator('.sel-box')).toHaveCount(0);
  await page.keyboard.press('Escape');
  let s = await state(page);
  expect(s.editingId).toBeNull();
  expect(JSON.stringify(s.items[0].doc)).toContain('e proprietà');

  // Using the format toolbar keeps the editing session (and the text).
  await dbl(page, '[data-id="t1"]');
  await page.keyboard.press('Shift+Home');
  await page.getByRole('button', { name: 'Evidenziazione' }).click();
  await page.locator('.popover .swatch').nth(1).click();
  await expect(page.locator('.text-item.editing')).toHaveCount(1);
  // Switching tool from the palette ends editing too.
  await page.locator('[data-tool="pen"]').click();
  await expect(page.locator('.text-item.editing')).toHaveCount(0);
  s = await state(page);
  expect(s.editingId).toBeNull();
  expect(JSON.stringify(s.items[0].doc)).toContain('highlight');
});

test('Delete/Backspace: characters while typing, objects when selected, groups as a whole', async ({ page }) => {
  await newPage(page);
  await addItems(page, [textItem('t1', 60, 40, 'abcdef'), rect('r1', 60, 200), rect('r2', 260, 200), rect('r3', 460, 200)]);

  // Typing: Backspace removes characters, not the block
  await dbl(page, '[data-id="t1"]');
  await page.keyboard.press('End');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Delete');
  let s = await state(page);
  expect(s.items.find((i) => i.id === 't1')).toBeTruthy();
  // Escape selects the block as an object: now Backspace deletes it
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  s = await state(page);
  expect(JSON.stringify(s.items.find((i) => i.id === 't1')!.doc)).toContain('abcde"');
  expect(s.selection).toEqual(['t1']);
  await page.keyboard.press('Backspace');
  s = await state(page);
  expect(s.items.find((i) => i.id === 't1')).toBeUndefined();

  // Typing in the page title never deletes objects
  await page.getByTestId('page-title').click();
  await page.keyboard.type('xy');
  await page.keyboard.press('Backspace');
  s = await state(page);
  expect(s.items).toHaveLength(3);

  // Group r1 + r2, then click r1: the whole group is selected and deleted together
  await page.evaluate(() => (window as any).__glassnote.useStore.getState().setSelection(['r1', 'r2']));
  await page.getByTestId('canvas').focus();
  await page.keyboard.press(`${MOD}+G`);
  await page.evaluate(() => (window as any).__glassnote.useStore.getState().setSelection([]));
  const p = await toScreen(page, 60, 240); // left edge of r1
  await page.mouse.click(p.x, p.y);
  s = await state(page);
  expect(s.selection.sort()).toEqual(['r1', 'r2']);
  await page.keyboard.press('Delete');
  s = await state(page);
  expect(s.items.map((i) => i.id)).toEqual(['r3']);
  // Undo restores the group
  await page.keyboard.press(`${MOD}+Z`);
  s = await state(page);
  expect(s.items).toHaveLength(3);
  expect(s.items.find((i) => i.id === 'r1')!.groupId).toBe(s.items.find((i) => i.id === 'r2')!.groupId);

  // Multi-selection across different groups deletes exactly the selected items
  await page.evaluate(() => (window as any).__glassnote.useStore.getState().setSelection(['r1', 'r2', 'r3']));
  await page.getByTestId('canvas').focus();
  await page.keyboard.press('Backspace');
  s = await state(page);
  expect(s.items).toHaveLength(0);
});

test('connectors attach anywhere on the perimeter of any object and follow it', async ({ page }) => {
  await newPage(page);
  // two text blocks and two images
  await addItems(page, [textItem('a', 60, 40, 'Teorema'), textItem('b', 600, 40, 'Dimostrazione')]);
  await page.evaluate(async () => {
    const make = async (name: string) => {
      const c = document.createElement('canvas');
      c.width = 200;
      c.height = 120;
      c.getContext('2d')!.fillRect(0, 0, 200, 120);
      const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/png'));
      return new File([blob], name, { type: 'image/png' });
    };
    const dt = new DataTransfer();
    dt.items.add(await make('i1.png'));
    dt.items.add(await make('i2.png'));
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
  });
  await expect(page.locator('.image-item')).toHaveCount(2);
  // place images deterministically
  const ids = (await state(page)).items.filter((i) => i.type === 'image').map((i) => i.id);
  await page.evaluate((imgIds) => {
    const s = (window as any).__glassnote.useStore.getState();
    s.updatePage((p: any) => ({ ...p, items: { ...p.items, [imgIds[0]]: { ...p.items[imgIds[0]], x: 60, y: 300 }, [imgIds[1]]: { ...p.items[imgIds[1]], x: 600, y: 300 } } }));
    s.setSelection([]);
  }, ids);

  await page.getByTestId('canvas').focus();
  await page.keyboard.press('c');
  const drag = async (from: [number, number], to: [number, number]) => {
    const a = await toScreen(page, from[0], from[1]);
    const b = await toScreen(page, to[0], to[1]);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 8 });
    await page.mouse.up();
  };
  // text → text, released on the left edge of b (perimeter point)
  await drag([170, 55], [601, 55]);
  // text → image (inside → automatic)
  await drag([120, 60], [160, 360]);
  // image → image, starting on the right edge of image 1, ending on the bottom edge of image 2
  await drag([259, 360], [700, 419]);
  let s = await state(page);
  const conns = s.items.filter((i) => i.type === 'connector');
  expect(conns).toHaveLength(3);
  expect(conns.map((c) => `${c.fromId}>${c.toId}`)).toEqual(['a>b', `a>${ids[0]}`, `${ids[0]}>${ids[1]}`]);
  expect(typeof conns[0].toAnchor).toBe('object');
  expect(conns[0].toAnchor.x).toBeCloseTo(0, 1);
  expect(typeof conns[2].fromAnchor).toBe('object');
  expect(conns[2].fromAnchor.x).toBeCloseTo(1, 1);
  expect(conns[2].toAnchor.y).toBeCloseTo(1, 1);

  // Move image 2 and resize it: the attached end follows the same perimeter point
  const endBefore = await page.evaluate((cid) => {
    const el = document.querySelector(`[data-id="${cid}"] line`)!;
    return { x2: Number(el.getAttribute('x2')), y2: Number(el.getAttribute('y2')), box: (el.closest('svg') as SVGElement).getBoundingClientRect().toJSON() };
  }, conns[2].id);
  await page.keyboard.press('v');
  const i2 = await toScreen(page, 700, 330);
  await page.mouse.move(i2.x, i2.y);
  await page.mouse.down();
  await page.mouse.move(i2.x, i2.y + 150, { steps: 6 });
  await page.mouse.up();
  const endAfter = await page.evaluate((cid) => (document.querySelector(`[data-id="${cid}"]`) as SVGElement).getBoundingClientRect().toJSON(), conns[2].id);
  expect(endAfter.height).toBeGreaterThan(endBefore.box.height + 100);
  s = await state(page);
  const moved = s.items.find((i) => i.id === ids[1])!;
  expect(moved.y).toBeGreaterThan(400);

  // Re-attach an end by dragging its handle onto another object
  await page.evaluate((cid) => (window as any).__glassnote.useStore.getState().setSelection([cid]), conns[0].id);
  const h = page.locator('[data-handle="c2"]');
  await expect(h).toBeVisible();
  const hb = (await h.boundingBox())!;
  const target = await toScreen(page, 160, 360); // image 1
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 8 });
  await page.mouse.up();
  s = await state(page);
  if (process.env.E2E_DEBUG) console.log(JSON.stringify({ hb, target, sel: s.selection, tool: s.tool, c: s.items.find((i) => i.id === conns[0].id) }));
  expect(s.items.find((i) => i.id === conns[0].id)!.toId).toBe(ids[0]);

  // Deleting image 1 removes every connector attached to it (no orphans)
  await page.evaluate((id) => (window as any).__glassnote.useStore.getState().setSelection([id]), ids[0]);
  await page.getByTestId('canvas').focus();
  await page.keyboard.press('Delete');
  s = await state(page);
  expect(s.items.filter((i) => i.type === 'connector')).toHaveLength(0);
  await page.screenshot({ path: path.join(OUT, '11-connectors.png') });
});

test('page background switch: white by default, squared or dotted per page, saved', async ({ page }) => {
  await newPage(page);
  const cls = () => page.locator('.sheet-paper').getAttribute('class');
  expect(await cls()).toContain('pattern-plain');
  await expect(page.getByTestId('bg-plain')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('bg-grid').click();
  expect(await cls()).toContain('pattern-grid');
  await page.getByTestId('bg-dots').click();
  expect(await cls()).toContain('pattern-dots');
  await page.screenshot({ path: path.join(OUT, '12-bg-dots.png') });
  // other pages keep their own background
  await page.locator('.nav-item.page').first().click();
  expect(await cls()).toContain('pattern-plain');
  await page.locator('.nav-item.page').last().click();
  expect(await cls()).toContain('pattern-dots');
  // saved across reload
  await page.keyboard.press(`${MOD}+S`);
  await expect(page.getByTestId('save-status')).toContainText('Salvato');
  await page.reload();
  await page.locator('.nav-item.page').last().click();
  expect(await cls()).toContain('pattern-dots');
});
