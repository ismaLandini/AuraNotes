import { test, expect, type Page } from '@playwright/test';

type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function newPage(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('home-view')).toBeVisible();
  await page.getByTestId('home-notebook-Benvenuto in AuraNotes').click();
  await expect(page.getByTestId('home-sections-grid')).toBeVisible();
  await page.getByTestId('home-section-Per iniziare').click();
  await expect(page.getByTestId('canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Nuova pagina' }).click();
  await expect(page.getByTestId('page-title')).toBeFocused();
  await page.getByTestId('page-title').press('Escape');
}

test('two-row organized ribbon, breadcrumb and floating format bar', async ({ page }) => {
  await newPage(page);

  // ribbon is two-row and exposes tools directly without submenus
  const box = (await page.locator('.ribbon').boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(80);
  await expect(page.getByRole('button', { name: /Apice/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Pedice/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Codice in linea/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Blocco di codice/ })).toBeVisible();

  // breadcrumb shows Blocco › Sezione › Pagina and navigates to each dashboard level
  await expect(page.getByTestId('breadcrumb')).toBeVisible();
  await page.getByTestId('crumb-section').click();
  await expect(page.getByTestId('home-sections-grid')).toBeVisible();
  await page.getByTestId('home-resume-workspace').click();
  await expect(page.getByTestId('canvas')).toBeVisible();

  // text box with a selection → floating bar appears, and is hidden without a selection
  await page.evaluate(() => {
    const s = (window as Any).__glassnote.useStore.getState();
    const item = { id: 't1', type: 'text', x: 200, y: 200, w: 260, h: 40, variant: 'plain', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Testo di prova' }] }] } };
    s.updatePage((p: Any) => ({ ...p, items: { ...p.items, t1: item }, order: [...p.order, 't1'] }));
  });
  const textEl = page.locator('.text-item, .container-item').first();
  const b = (await textEl.boundingBox())!;
  await page.mouse.dblclick(b.x + 30, b.y + b.height / 2);
  await expect(page.getByTestId('floating-format-bar')).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+a');
  await expect(page.getByTestId('floating-format-bar')).toBeVisible();
  await page.getByTestId('floating-format-bar').getByRole('button', { name: /Grassetto/ }).click();
  await expect(page.locator('.ProseMirror strong, .rich strong').first()).toBeVisible();
  await page.keyboard.press('Escape');

  // dragging a section onto another notebook moves it into that notebook
  await page.getByRole('button', { name: 'Mostra Quaderni' }).click();
  await page.evaluate(() => {
    const s = (window as Any).__glassnote.useStore.getState();
    const nb2 = s.addNotebook('Secondo Quaderno');
    const firstNb = s.workspace.notebookIds[0];
    s.selectNotebook(firstNb);
    s.addSection(firstNb, 'Sezione Mobile');
    void nb2;
  });
  const secItem = page.locator('.nav-item.section', { hasText: 'Sezione Mobile' });
  const targetNb = page.locator('.nav-item', { hasText: 'Secondo Quaderno' }).first();
  await secItem.dragTo(targetNb);
  await expect(targetNb).toHaveClass(/active/);
  await expect(page.locator('.nav-item.section', { hasText: 'Sezione Mobile' })).toBeVisible();
});

test('page tags, sidebar/search tag filtering, wiki-links [[...]] and backlinks panel', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('home-resume-workspace').click();
  await expect(page.getByTestId('canvas')).toBeVisible();

  // Create Page A ("Teorema di Bayes") and add a tag #esame
  await page.getByRole('button', { name: 'Nuova pagina' }).click();
  await expect(page.getByTestId('page-title')).toBeFocused();
  await page.getByTestId('page-title').fill('Teorema di Bayes');
  await page.getByTestId('page-title').press('Enter');

  await page.getByTestId('add-tag-btn').click();
  await expect(page.getByTestId('tag-input')).toBeVisible();
  await page.getByTestId('tag-input').fill('Esame');
  await page.getByTestId('tag-input').press('Enter');
  await expect(page.getByTestId('page-tag-esame')).toBeVisible();

  // Sidebar tag filter appears and filters pages in the current section
  await expect(page.getByTestId('sidebar-tag-filter')).toBeVisible();
  await page.getByTestId('sidebar-filter-tag-esame').click();
  await expect(page.locator('.nav-item.page')).toHaveCount(1);
  await page.getByTestId('sidebar-filter-tag-esame').click(); // clear filter

  // Create Page B ("Probabilità Condizionata") that links to [[Teorema di Bayes]] and a new page [[Catene di Markov]]
  await page.getByRole('button', { name: 'Nuova pagina' }).click();
  await page.getByTestId('page-title').fill('Probabilità Condizionata');
  await page.getByTestId('page-title').press('Escape');

  await page.evaluate(() => {
    const s = (window as Any).__glassnote.useStore.getState();
    const before = s.currentPage();
    const item = {
      id: 'w1',
      type: 'text',
      x: 160,
      y: 160,
      w: 420,
      h: 60,
      variant: 'plain',
      doc: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Si veda [[Teorema di Bayes]] e [[Catene di Markov]] per approfondire.' }],
          },
        ],
      },
    };
    s.updatePage((p: Any) => ({ ...p, items: { ...p.items, w1: item }, order: [...p.order, 'w1'] }));
    s.commitFrom(before);
  });

  // Static rich text renders clickable .wiki-link buttons
  const bayesLink = page.getByTestId('wiki-link-Teorema di Bayes');
  await expect(bayesLink).toBeVisible();

  // Clicking [[Teorema di Bayes]] navigates directly to "Teorema di Bayes"
  await bayesLink.click();
  await expect(page.getByTestId('page-title')).toHaveValue('Teorema di Bayes');

  // "Teorema di Bayes" shows the backlinks pill in the sheet header; clicking it opens the Outline & Backlinks panel
  const backlinksBtn = page.getByTestId('sheet-backlinks-btn');
  await expect(backlinksBtn).toBeVisible();
  await expect(backlinksBtn).toContainText('1 backlink');
  await backlinksBtn.click();

  await expect(page.getByTestId('backlinks-list')).toContainText('Probabilità Condizionata');

  // Navigate back to "Probabilità Condizionata" via the backlink card
  await page.getByTestId('backlinks-list').locator('.backlink-card').first().click();
  await expect(page.getByTestId('page-title')).toHaveValue('Probabilità Condizionata');

  // Clicking a wiki-link to a non-existent page ("Catene di Markov") creates and opens it
  await page.getByTestId('wiki-link-Catene di Markov').click();
  await expect(page.getByTestId('page-title')).toHaveValue('Catene di Markov');
});
