import { test, expect, type Page } from '@playwright/test';

type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function state(page: Page): Promise<{ items: Any[]; order: string[]; selection: string[]; editingId: string | null; tool: string; pastCount: number; futureCount: number }> {
  return page.evaluate(() => {
    const s = (window as any).__glassnote.useStore.getState();
    const p = s.pages[s.pageId];
    const h = s.history[s.pageId] ?? { past: [], future: [] };
    return {
      items: p ? p.order.map((id: string) => p.items[id]) : [],
      order: p ? p.order : [],
      selection: s.selection,
      editingId: s.editingId,
      tool: s.tool,
      pastCount: h.past.length,
      futureCount: h.future.length,
    };
  });
}

async function addItems(page: Page, items: Any[]) {
  await page.evaluate((list) => {
    const s = (window as any).__glassnote.useStore.getState();
    s.updatePage((p: any) => ({
      ...p,
      items: { ...p.items, ...Object.fromEntries(list.map((i: any) => [i.id, i])) },
      order: [...p.order, ...list.map((i: any) => i.id)],
    }));
  }, items);
}

async function toScreen(page: Page, x: number, y: number) {
  return page.evaluate(
    ([wx, wy]) => {
      const c = document.querySelector('[data-testid="canvas"]')!.getBoundingClientRect();
      const world = document.querySelector('.world') as HTMLElement;
      const m = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)\)/.exec(world.style.transform)!;
      return { x: c.left + Number(m[1]) + wx * Number(m[3]), y: c.top + Number(m[2]) + wy * Number(m[3]) };
    },
    [x, y],
  );
}

test.describe('NoteContainer & FreeImage symmetric drag-and-drop', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('home-resume-workspace').click();
    await expect(page.getByTestId('canvas')).toBeVisible();
    await page.getByRole('button', { name: 'Nuova pagina' }).click();
    await expect(page.getByTestId('page-title')).toBeVisible();
    await page.getByTestId('page-title').press('Escape');
  });

  test('dragging a free image over a container reintegrates it into the flow and undoes with Cmd+Z', async ({ page }) => {
    // 1. Setup a text container and a free image container
    const cText = {
      id: 'cText',
      type: 'container',
      x: 100,
      y: 100,
      w: 480,
      h: 80,
      customW: true,
      variant: 'plain',
      doc: {
        type: 'doc',
        content: [
          { type: 'paragraph', attrs: { indent: 0 }, content: [{ type: 'text', text: 'Primo paragrafo di appunti' }] },
        ],
      },
    };

    const cFree = {
      id: 'cFree',
      type: 'container',
      x: 650,
      y: 100,
      w: 300,
      h: 200,
      customW: true,
      variant: 'plain',
      freeImage: true,
      doc: {
        type: 'doc',
        content: [
          {
            type: 'imageBlock',
            attrs: {
              assetId: 'test-asset-1',
              width: 300,
              naturalWidth: 600,
              naturalHeight: 400,
              alt: 'Illustrazione',
              annotations: [{ id: 'ann-1', type: 'stroke', points: [0.1, 0.1, 0.9, 0.9], color: '#f00', width: 2, opacity: 1, tool: 'pen' }],
            },
          },
        ],
      },
    };

    await addItems(page, [cText, cFree]);

    const sInitial = await state(page);
    expect(sInitial.order).toContain('cFree');
    expect(sInitial.order).toContain('cText');

    await expect(page.locator('.text-item[data-id="cFree"]')).toBeVisible();
    await expect(page.locator('.text-item[data-id="cText"]')).toBeVisible();

    // 2. Drag cFree to the middle of cText
    const start = await toScreen(page, 700, 150);
    const target = await toScreen(page, 200, 140);

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(target.x, target.y, { steps: 10 });

    // Release mouse to drop
    await page.mouse.up();

    // 3. Verify cFree is gone and cText now contains the image block in its flow
    const sAfter = await state(page);
    expect(sAfter.order).not.toContain('cFree');
    const targetItem = sAfter.items.find((i) => i.id === 'cText');
    expect(targetItem).toBeDefined();
    expect(targetItem!.doc.content).toHaveLength(2);
    expect(targetItem!.doc.content[1].type).toBe('imageBlock');
    expect(targetItem!.doc.content[1].attrs.assetId).toBe('test-asset-1');
    expect(targetItem!.doc.content[1].attrs.annotations).toHaveLength(1);

    // 4. Verify Cmd+Z restores the free image to canvas
    await page.keyboard.press(`${MOD}+z`);

    const sUndo = await state(page);
    expect(sUndo.order).toContain('cFree');
    const restoredFree = sUndo.items.find((i) => i.id === 'cFree');
    expect(restoredFree).toBeDefined();
    expect(restoredFree!.x).toBe(650);
    expect(restoredFree!.y).toBe(100);

    const restoredTarget = sUndo.items.find((i) => i.id === 'cText');
    expect(restoredTarget!.doc.content).toHaveLength(1);

    // 5. Verify Cmd+Shift+Z redoes the drop
    await page.keyboard.press(`${MOD}+Shift+z`);
    const sRedo = await state(page);
    expect(sRedo.order).not.toContain('cFree');
    const redoTarget = sRedo.items.find((i) => i.id === 'cText');
    expect(redoTarget!.doc.content).toHaveLength(2);
  });

  test('Escape key cancels drag and restores original position', async ({ page }) => {
    const cFree = {
      id: 'cFreeEsc',
      type: 'container',
      x: 650,
      y: 100,
      w: 300,
      h: 200,
      customW: true,
      variant: 'plain',
      freeImage: true,
      doc: {
        type: 'doc',
        content: [
          {
            type: 'imageBlock',
            attrs: { assetId: 'test-esc', width: 300, naturalWidth: 600, naturalHeight: 400 },
          },
        ],
      },
    };

    await addItems(page, [cFree]);

    const start = await toScreen(page, 700, 150);
    const moved = await toScreen(page, 300, 300);

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(moved.x, moved.y, { steps: 5 });

    // Press Escape during drag
    await page.keyboard.press('Escape');
    await page.mouse.up();

    // The item is at its original position
    const s = await state(page);
    const item = s.items.find((i) => i.id === 'cFreeEsc');
    expect(item).toBeDefined();
    expect(item!.x).toBe(650);
    expect(item!.y).toBe(100);
  });
});
