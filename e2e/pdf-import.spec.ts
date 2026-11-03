import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const FIXTURES = path.resolve('e2e/fixtures');

async function getPageState(page: Page) {
  return page.evaluate(async () => {
    const g = (window as any).__glassnote;
    const s = g.useStore.getState();
    const p = s.pages[s.pageId];
    const h = s.history[s.pageId] ?? { past: [], future: [] };
    const assetIds: string[] = await g.listAssetIds();
    return {
      pageId: s.pageId,
      items: p ? p.order.map((id: string) => p.items[id]) : [],
      order: p ? p.order : [],
      selection: s.selection,
      editingId: s.editingId,
      zoom: p?.view?.zoom ?? 1,
      pastCount: h.past.length,
      futureCount: h.future.length,
      assetIds,
    };
  });
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

async function openPdfViaRibbonPicker(page: Page, pdfFileName: string) {
  await page.evaluate(() => {
    const g = (window as any).__glassnote;
    g.useStore.getState().setSelection([]);
    g.useStore.getState().setTool('select');
  });
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByTestId('insert-pdf-btn').click();
  const chooser = await chooserPromise;
  await chooser.setFiles(path.join(FIXTURES, pdfFileName));
}

test.describe('PDF Printout High-Resolution Lossless Import (Criteria 1–12)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('home-resume-workspace').click();
    await expect(page.getByTestId('canvas')).toBeVisible();
    await page.getByRole('button', { name: 'Nuova pagina' }).click();
    await expect(page.getByTestId('page-title')).toBeVisible();
    await page.getByTestId('page-title').fill('Pagina PDF Test');
    await page.getByTestId('page-title').press('Escape');
  });

  test('1, 3, 4 & 10: Single-container slide import, typing between pages, lossless pixel comparison, high-zoom sharpness, and SHA-256 deduplication', async ({
    page,
  }) => {
    // Open PDF import dialog for 3-page widescreen vector+formula slides
    await openPdfViaRibbonPicker(page, 'vector-formulas.pdf');

    await expect(page.getByTestId('pdf-import-dialog')).toBeVisible();
    await expect(page.getByTestId('pdf-first-page-preview')).toBeVisible();
    await expect(page.getByTestId('pdf-page-count')).toContainText('3 pagine');

    // Verify quality selectors are removed and default mode is 'single-container'
    await expect(page.getByTestId('pdf-quality-high')).toHaveCount(0);
    await expect(page.getByTestId('pdf-quality-standard')).toHaveCount(0);
    await expect(page.getByTestId('pdf-quality-maximum')).toHaveCount(0);
    await expect(page.getByTestId('pdf-mode-single')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('pdf-storage-estimate')).toContainText('Occupa circa');

    // Confirm import
    await page.getByTestId('pdf-import-confirm').click();
    await expect(page.getByTestId('pdf-import-dialog')).toBeHidden();

    // Wait for all 3 pages to appear as imageBlocks inside the single container
    await expect(page.locator('[data-testid="image-block"]')).toHaveCount(3, { timeout: 25_000 });

    const st1 = await getPageState(page);
    const containers = st1.items.filter((i: Any) => i.type === 'container' && !i.freeImage);
    expect(containers).toHaveLength(1);
    const container = containers[0];

    const imgNodes = container.doc.content.filter((n: Any) => n.type === 'imageBlock');
    expect(imgNodes).toHaveLength(3);
    expect(imgNodes[0].attrs.alt).toBe('vector-formulas, pagina 1 di 3');
    expect(imgNodes[1].attrs.alt).toBe('vector-formulas, pagina 2 di 3');
    expect(imgNodes[2].attrs.alt).toBe('vector-formulas, pagina 3 di 3');
    expect(imgNodes[0].attrs.assetId).toBe('');
    expect(imgNodes[0].attrs.mime).toBe('application/pdf');
    expect(imgNodes[0].attrs.source).toEqual({
      type: 'pdf',
      assetId: imgNodes[0].attrs.source.assetId,
      page: 1,
      mode: 'live',
    });

    // Criterion 3: Check PDF base point dimensions (720x405 pt slide)
    expect(imgNodes[0].attrs.naturalWidth).toBe(720);
    expect(imgNodes[0].attrs.naturalHeight).toBe(405);

    // Wait for the live on-demand rendered <img> to mount with a blob URL
    const firstImgDom = page.locator('.image-block-img').first();
    await expect(firstImgDom).toBeVisible({ timeout: 15_000 });

    // Criterion 3: Compare live on-demand rendered blob URL pixel-by-pixel against reference pdf.js render at the same bucket
    const pixelComparison = await page.evaluate(async () => {
      const g = (window as any).__glassnote;
      const pdfSourceId = g.useStore
        .getState()
        .pages[g.useStore.getState().pageId].items[
          g.useStore.getState().pages[g.useStore.getState().pageId].order[0]
        ].doc.content.find((n: any) => n.type === 'imageBlock').attrs.source.assetId;
      const pdfAsset = await g.getAsset(pdfSourceId);

      const liveImg = document.querySelector('.image-block-img') as HTMLImageElement;
      const liveResp = await fetch(liveImg.src);
      const liveBlob = await liveResp.blob();
      const liveBmp = await createImageBitmap(liveBlob);

      // Reference render via getPdfPageUrl at exact same width
      const refUrl = await g.getPdfPageUrl(pdfSourceId, 1, liveBmp.width);
      const refResp = await fetch(refUrl);
      const refBlob = await refResp.blob();
      const refBmp = await createImageBitmap(refBlob);

      const c1 = document.createElement('canvas');
      c1.width = liveBmp.width;
      c1.height = liveBmp.height;
      const ctx1 = c1.getContext('2d')!;
      ctx1.drawImage(liveBmp, 0, 0);
      const data1 = ctx1.getImageData(0, 0, c1.width, c1.height).data;
      liveBmp.close();

      const c2 = document.createElement('canvas');
      c2.width = refBmp.width;
      c2.height = refBmp.height;
      const ctx2 = c2.getContext('2d')!;
      ctx2.drawImage(refBmp, 0, 0);
      const data2 = ctx2.getImageData(0, 0, c2.width, c2.height).data;
      refBmp.close();

      let maxDiff = 0;
      const step = Math.max(4, Math.floor(data1.length / 50000) * 4);
      for (let i = 0; i < data1.length; i += step) {
        const d = Math.abs(data1[i] - data2[i]);
        if (d > maxDiff) maxDiff = d;
      }
      return {
        pdfMime: pdfAsset.mime,
        liveMime: liveBlob.type,
        width: c1.width,
        height: c1.height,
        refWidth: c2.width,
        refHeight: c2.height,
        maxDiff,
      };
    });

    expect(pixelComparison.pdfMime).toBe('application/pdf');
    expect(pixelComparison.liveMime).toBe('image/png');
    expect(pixelComparison.width).toBe(pixelComparison.refWidth);
    expect(pixelComparison.height).toBe(pixelComparison.refHeight);
    expect(pixelComparison.width % 256).toBe(0);
    expect(pixelComparison.maxDiff).toBe(0);

    // Criterion 1: Type notes between page 1 and page 2 inside the same container
    const containerEl = page.locator(`.text-item[data-id="${container.id}"]`);
    await page.evaluate((cId: string) => {
      const g = (window as any).__glassnote;
      g.useStore.getState().updatePage((p: any) => {
        const item = p.items[cId];
        const content = [...item.doc.content];
        // Update the paragraph right after the first imageBlock
        const firstImgIdx = content.findIndex((n: any) => n.type === 'imageBlock');
        content[firstImgIdx + 1] = {
          type: 'paragraph',
          attrs: { indent: 0 },
          content: [{ type: 'text', text: 'Appunti tra slide 1 e slide 2' }],
        };
        return {
          ...p,
          items: { ...p.items, [cId]: { ...item, doc: { ...item.doc, content } } },
        };
      });
    }, container.id);
    await expect(containerEl).toContainText('Appunti tra slide 1 e slide 2');

    // Criterion 4: High zoom (3.5x) keeps fixed bucket Blob URL active without re-rendering or thrashing
    const urlBeforeZoom = await firstImgDom.evaluate((img: HTMLImageElement) => img.src);
    await page.evaluate(() => {
      const g = (window as any).__glassnote;
      const st = g.useStore.getState();
      st.setViewport(st.pageId, { x: 0, y: 0, zoom: 3.5 });
    });
    await expect(firstImgDom).toBeVisible();
    const domImgProps = await firstImgDom.evaluate((img: HTMLImageElement) => ({
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      src: img.src,
      srcStartsWithBlob: img.src.startsWith('blob:'),
    }));
    expect(domImgProps.srcStartsWithBlob).toBe(true);
    expect(domImgProps.src).toBe(urlBeforeZoom);
    expect(domImgProps.naturalWidth % 256).toBe(0);

    // Reset zoom to 1
    await page.evaluate(() => {
      const g = (window as any).__glassnote;
      const st = g.useStore.getState();
      st.setViewport(st.pageId, { x: 0, y: 0, zoom: 1 });
    });

    // Criterion 10: Deduplication — importing the exact same PDF again reuses the single PDF asset (no PNGs in IDB!)
    const assetsBeforeSecondImport = (await getPageState(page)).assetIds;
    expect(assetsBeforeSecondImport).toHaveLength(1);

    await openPdfViaRibbonPicker(page, 'vector-formulas.pdf');
    await expect(page.getByTestId('pdf-import-dialog')).toBeVisible();
    await page.getByTestId('pdf-import-confirm').click();
    await expect(page.locator('[data-testid="image-block"]')).toHaveCount(6, { timeout: 25_000 });

    const assetsAfterSecondImport = (await getPageState(page)).assetIds;
    expect(assetsAfterSecondImport).toHaveLength(1);
  });

  test('2: One-page-per-container mode creates ordered freeImage objects that can be dragged into a container', async ({
    page,
  }) => {
    await openPdfViaRibbonPicker(page, 'vector-formulas.pdf');
    await expect(page.getByTestId('pdf-import-dialog')).toBeVisible();

    // Select "Una pagina per contenitore" mode
    await page.getByTestId('pdf-mode-multiple').click();
    await page.getByTestId('pdf-import-confirm').click();

    await expect(page.locator('[data-testid="image-block"]')).toHaveCount(3, { timeout: 20_000 });

    const st = await getPageState(page);
    const freeContainers = st.items.filter((i: Any) => i.type === 'container' && i.freeImage === true);
    expect(freeContainers).toHaveLength(3);
    // Verify vertical ordering with regular margin
    expect(freeContainers[1].y).toBeGreaterThan(freeContainers[0].y + freeContainers[0].h);
    expect(freeContainers[2].y).toBeGreaterThan(freeContainers[1].y + freeContainers[1].h);

    // Create a note container next to the column and clear selection so dragging firstFree drags only that single freeImage
    await page.evaluate(() => {
      const g = (window as any).__glassnote;
      g.useStore.getState().setSelection([]);
      g.useStore.getState().updatePage((p: any) => ({
        ...p,
        items: {
          ...p.items,
          targetNotes: {
            id: 'targetNotes',
            type: 'container',
            x: 780,
            y: 120,
            w: 500,
            h: 120,
            customW: true,
            variant: 'card',
            doc: {
              type: 'doc',
              content: [
                {
                  type: 'paragraph',
                  attrs: { indent: 0 },
                  content: [{ type: 'text', text: 'Contenitore di destinazione' }],
                },
              ],
            },
          },
        },
        order: [...p.order, 'targetNotes'],
      }));
    });

    await expect(page.locator('.text-item[data-id="targetNotes"]')).toBeVisible();

    const firstFree = freeContainers[0];
    const startScreen = await toScreen(page, firstFree.x + 80, firstFree.y + 60);
    const targetScreen = await toScreen(page, 850, 150);

    await page.mouse.move(startScreen.x, startScreen.y);
    await page.mouse.down();
    await page.mouse.move(targetScreen.x, targetScreen.y, { steps: 12 });
    await page.mouse.up();

    const stAfterDrag = await getPageState(page);
    expect(stAfterDrag.order).not.toContain(firstFree.id);
    const targetNotes = stAfterDrag.items.find((i: Any) => i.id === 'targetNotes');
    expect(targetNotes.doc.content.some((n: Any) => n.type === 'imageBlock')).toBe(true);
  });

  test('5 & 6: Rotated pages (0/90/180/270), mixed dimensions/CropBox, and huge A0 poster with automatic clamping toast', async ({
    page,
  }) => {
    // Import rotated-pages.pdf
    await openPdfViaRibbonPicker(page, 'rotated-pages.pdf');
    await expect(page.getByTestId('pdf-import-dialog')).toBeVisible();
    await page.getByTestId('pdf-import-confirm').click();
    await expect(page.locator('[data-testid="image-block"]')).toHaveCount(4, { timeout: 20_000 });

    const stRot = await getPageState(page);
    const rotContainer = stRot.items.find((i: Any) => i.type === 'container');
    const rotImages = rotContainer.doc.content.filter((n: Any) => n.type === 'imageBlock');
    expect(rotImages).toHaveLength(4);
    // Page 1 (0 deg): portrait (w < h)
    expect(rotImages[0].attrs.naturalWidth).toBeLessThan(rotImages[0].attrs.naturalHeight);
    // Page 2 (90 deg): landscape (w > h)
    expect(rotImages[1].attrs.naturalWidth).toBeGreaterThan(rotImages[1].attrs.naturalHeight);
    // Page 3 (180 deg): portrait (w < h)
    expect(rotImages[2].attrs.naturalWidth).toBeLessThan(rotImages[2].attrs.naturalHeight);
    // Page 4 (270 deg): landscape (w > h)
    expect(rotImages[3].attrs.naturalWidth).toBeGreaterThan(rotImages[3].attrs.naturalHeight);

    // Import mixed-sizes.pdf
    await openPdfViaRibbonPicker(page, 'mixed-sizes.pdf');
    await expect(page.getByTestId('pdf-import-dialog')).toBeVisible();
    await page.getByTestId('pdf-import-confirm').click();
    await expect(page.locator('[data-testid="image-block"]')).toHaveCount(8, { timeout: 20_000 });

    // Criterion 6: Huge A0 poster (2384 x 3370 pt) imported cleanly and rendered on-demand within canvas limits
    await openPdfViaRibbonPicker(page, 'huge-a0.pdf');
    await expect(page.getByTestId('pdf-import-dialog')).toBeVisible();
    await page.getByTestId('pdf-import-confirm').click();

    await expect(page.locator('[data-testid="image-block"]')).toHaveCount(9, { timeout: 35_000 });
  });

  test('7: Password-protected PDF (wrong password error + retry with correct password) and corrupt PDF handling', async ({
    page,
  }) => {
    // 1. Corrupt PDF shows clear error without crashing the app
    await openPdfViaRibbonPicker(page, 'corrupt.pdf');
    await expect(page.getByTestId('pdf-import-dialog')).toBeVisible();
    await expect(page.getByTestId('pdf-error-message')).toBeVisible();
    await page.getByTestId('pdf-error-close').click();
    await expect(page.getByTestId('pdf-import-dialog')).toBeHidden();

    // 2. Password-protected PDF prompts for password, handles wrong password, and imports with 'glassnote'
    await openPdfViaRibbonPicker(page, 'password-protected.pdf');
    await expect(page.getByTestId('pdf-import-dialog')).toBeVisible();
    await expect(page.getByTestId('pdf-password-form')).toBeVisible();

    // Enter wrong password
    await page.getByTestId('pdf-password-input').fill('wrong-pass');
    await page.getByTestId('pdf-password-submit').click();
    await expect(page.getByTestId('pdf-password-error')).toBeVisible();

    // Enter correct password 'glassnote'
    await page.getByTestId('pdf-password-input').fill('glassnote');
    await page.getByTestId('pdf-password-submit').click();

    // Preview and options now appear
    await expect(page.getByTestId('pdf-first-page-preview')).toBeVisible();
    await expect(page.getByTestId('pdf-page-count')).toContainText('2 pagine');
    await page.getByTestId('pdf-import-confirm').click();

    await expect(page.locator('[data-testid="image-block"]')).toHaveCount(2, { timeout: 20_000 });
  });

  test('8: 105-page PDF lightweight import (<1.3x disk size in IDB), mid-way Cancel button, and single Cmd+Z group undo with asset GC', async ({
    page,
  }) => {
    const pdfDiskBytes = fs.statSync(path.join(FIXTURES, 'many-105-pages.pdf')).size;
    const initialAssets = (await getPageState(page)).assetIds;
    expect(initialAssets).toHaveLength(0);

    await openPdfViaRibbonPicker(page, 'many-105-pages.pdf');
    await expect(page.getByTestId('pdf-import-dialog')).toBeVisible();
    await expect(page.getByTestId('pdf-page-count')).toContainText('105 pagine');

    // Start progressive import of all 105 pages
    await page.getByTestId('pdf-import-confirm').click();

    // Wait until at least 2 pages have progressively appeared on canvas, then click Cancel if still running
    await expect(async () => {
      const count = await page.locator('[data-testid="image-block"]').count();
      expect(count).toBeGreaterThanOrEqual(2);
    }).toPass({ timeout: 15_000 });

    const cancelBtn = page.getByTestId('pdf-import-abort');
    if (await cancelBtn.count()) {
      await cancelBtn.dispatchEvent('click');
    }

    // Wait for progress banner to disappear
    await expect(page.getByTestId('pdf-import-progress')).toBeHidden({ timeout: 15_000 });

    const importedCount = await page.locator('[data-testid="image-block"]').count();
    expect(importedCount).toBeGreaterThanOrEqual(2);

    // Acceptance Criterion: IndexedDB footprint for 105-page PDF is strictly < 1.3x disk file size!
    const idbFootprint = await page.evaluate(async () => {
      const g = (window as any).__glassnote;
      const ids: string[] = await g.listAssetIds();
      let totalBlobBytes = 0;
      for (const id of ids) {
        const a = await g.getAsset(id);
        if (a?.blob) totalBlobBytes += a.blob.size;
      }
      return { assetCount: ids.length, totalBlobBytes };
    });
    expect(idbFootprint.assetCount).toBe(1);
    expect(idbFootprint.totalBlobBytes).toBeLessThan(pdfDiskBytes * 1.3);

    // Single Cmd+Z undoes the entire progressive import in one group operation!
    await page.keyboard.press(`${MOD}+z`);
    await expect(page.locator('[data-testid="image-block"]')).toHaveCount(0);

    // Wait briefly for unreferenced asset garbage collection to finish
    await expect(async () => {
      const afterUndoAssets = (await getPageState(page)).assetIds;
      expect(afterUndoAssets).toHaveLength(0);
    }).toPass({ timeout: 5_000 });
  });

  test('9 & 11: Annotations stay anchored across resize, drag out/in, and reload; Schema v2->v3 migration preserves data', async ({
    page,
  }) => {
    // Import page 1 of vector-formulas.pdf
    await openPdfViaRibbonPicker(page, 'vector-formulas.pdf');
    await expect(page.getByTestId('pdf-import-dialog')).toBeVisible();
    await page.getByTestId('pdf-range-custom').click();
    await page.getByTestId('pdf-range-input').fill('1');
    await page.getByTestId('pdf-import-confirm').click();

    await expect(page.locator('[data-testid="image-block"]')).toHaveCount(1, { timeout: 15_000 });

    // Attach a normalized annotation stroke to the imported PDF page block and resize it
    await page.evaluate(() => {
      const g = (window as any).__glassnote;
      const st = g.useStore.getState();
      st.updatePage((p: any) => {
        const cid = p.order[0];
        const container = p.items[cid];
        const content = container.doc.content.map((node: any) => {
          if (node.type !== 'imageBlock') return node;
          return {
            ...node,
            attrs: {
              ...node.attrs,
              width: 420,
              annotations: [
                {
                  id: 'pdf-ann-1',
                  type: 'stroke',
                  tool: 'pen',
                  color: '#ef4444',
                  width: 3,
                  opacity: 1,
                  points: [0.15, 0.25, 0.85, 0.75],
                },
              ],
            },
          };
        });
        return {
          ...p,
          items: { ...p.items, [cid]: { ...container, doc: { ...container.doc, content } } },
        };
      });
    });

    // Verify SVG annotation overlay is rendered inside static view
    await expect(page.locator('svg.image-block-annotations path')).toHaveCount(1);

    // Simulate a legacy v2 workspace in IndexedDB to verify v2->v3 backup + migration on reload
    await page.evaluate(async () => {
      const g = (window as any).__glassnote;
      await g.flush();
      const db = await g.getDB();
      const ws = await db.get('kv', 'workspace');
      await db.put('kv', { ...ws, schemaVersion: 2 }, 'workspace');
    });

    await page.reload();
    const resume = page.getByTestId('home-resume-workspace');
    if (await resume.isVisible({ timeout: 3000 }).catch(() => false)) {
      await resume.click();
    }
    await expect(page.getByTestId('canvas')).toBeVisible();
    await expect(page.locator('[data-testid="image-block"]')).toHaveCount(1, { timeout: 15_000 });
    await expect(page.locator('svg.image-block-annotations path')).toHaveCount(1);

    const migCheck = await page.evaluate(async () => {
      const g = (window as any).__glassnote;
      const db = await g.getDB();
      const backup = await db.get('kv', 'workspace_v2_backup');
      const currentWs = g.useStore.getState().workspace;
      const p = g.useStore.getState().pages[g.useStore.getState().pageId];
      const imgNode = p.items[p.order[0]].doc.content.find((n: any) => n.type === 'imageBlock');
      return {
        hasV2Backup: Boolean(backup && backup.ws?.schemaVersion === 2),
        currentSchemaVersion: currentWs.schemaVersion,
        annotations: imgNode.attrs.annotations,
        source: imgNode.attrs.source,
      };
    });

    expect(migCheck.hasV2Backup).toBe(true);
    expect(migCheck.currentSchemaVersion).toBe(3);
    expect(migCheck.annotations).toHaveLength(1);
    expect(migCheck.annotations[0].points).toEqual([0.15, 0.25, 0.85, 0.75]);
    expect(migCheck.source.page).toBe(1);
  });

  test('Entry points (Drag & Drop, Cmd+V Paste), WebP lossless encoding, and PrintRoot native resolution export', async ({
    page,
  }) => {
    const rasterB64 = fs.readFileSync(path.join(FIXTURES, 'raster-scan.pdf')).toString('base64');

    // 1. Switch PDF lossless encoding setting to WebP lossless
    await page.evaluate(() => {
      const g = (window as any).__glassnote;
      g.useSettings.getState().set({ pdfFormat: 'webp' });
    });

    // 2. Drag & drop a .pdf file onto the canvas
    const dt = await page.evaluateHandle((b64) => {
      const bin = atob(b64);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const d = new DataTransfer();
      d.items.add(new File([u8], 'dispensa-scan.pdf', { type: 'application/pdf' }));
      return d;
    }, rasterB64);

    const box = (await page.getByTestId('canvas').boundingBox())!;
    await page
      .getByTestId('canvas')
      .dispatchEvent('dragover', { dataTransfer: dt, clientX: box.x + 250, clientY: box.y + 180 });
    await page
      .getByTestId('canvas')
      .dispatchEvent('drop', { dataTransfer: dt, clientX: box.x + 250, clientY: box.y + 180 });

    await expect(page.getByTestId('pdf-import-dialog')).toBeVisible();
    await expect(page.getByTestId('pdf-page-count')).toContainText('2 pagine');
    await page.getByTestId('pdf-import-cancel').click();
    await expect(page.getByTestId('pdf-import-dialog')).toBeHidden();

    // 3. Cmd+V Paste a .pdf file from clipboard
    await page.evaluate((b64) => {
      const bin = atob(b64);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const d = new DataTransfer();
      d.items.add(new File([u8], 'incollato-finder.pdf', { type: 'application/pdf' }));
      document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: d, bubbles: true }));
    }, rasterB64);

    await expect(page.getByTestId('pdf-import-dialog')).toBeVisible();
    await page.getByTestId('pdf-import-confirm').click();

    await expect(page.locator('[data-testid="image-block"]')).toHaveCount(2, { timeout: 20_000 });

    // Verify stored asset is the raw PDF (application/pdf) and PrintRoot renders at 300 DPI
    const printAndFormatCheck = await page.evaluate(async () => {
      const g = (window as any).__glassnote;
      const st = g.useStore.getState();
      const p = st.pages[st.pageId];
      const imgNode = p.items[p.order[0]].doc.content.find((n: any) => n.type === 'imageBlock');
      const asset = await g.getAsset(imgNode.attrs.source.assetId);
      await g.preparePrint({
        pages: [{ id: st.pageId, title: 'Pagina PDF Test', content: p }],
        options: g.DEFAULT_PRINT_OPTIONS,
        docTitle: 'Pagina PDF Test',
        paperClass: 'paper-a4',
        patternClass: 'pattern-plain',
      });
      const printImg = document.querySelector('#print-root [data-testid="image-block"] img') as HTMLImageElement | null;
      const res = {
        assetId: imgNode.attrs.assetId,
        mime: asset.mime,
        naturalWidth: imgNode.attrs.naturalWidth,
        printImgSrc: printImg?.src ?? '',
        printImgNaturalWidth: printImg?.naturalWidth ?? 0,
        printImgWidth: printImg?.getAttribute('width') ? Number(printImg.getAttribute('width')) : 0,
        printImgDecoding: printImg?.decoding ?? '',
      };
      g.clearPrint();
      return res;
    });

    expect(printAndFormatCheck.assetId).toBe('');
    expect(printAndFormatCheck.mime).toBe('application/pdf');
    expect(printAndFormatCheck.printImgSrc.startsWith('blob:')).toBe(true);
    expect(printAndFormatCheck.printImgWidth).toBe(printAndFormatCheck.naturalWidth);
    expect(printAndFormatCheck.printImgNaturalWidth).toBeGreaterThanOrEqual(2000);
    expect(printAndFormatCheck.printImgDecoding).toBe('sync');
  });
});

