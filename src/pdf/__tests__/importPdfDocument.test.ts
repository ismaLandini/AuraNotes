import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../../store/useStore';
import { importPdfAsDocument } from '../importPdfDocument';
import { createVectorFormulasPdf, pdfBytesToFile } from '../pdfTestFixtures';
import * as P from '../../model/pageOps';
import type { TextItem } from '../../types';
import { getAsset, loadPage } from '../../storage/db';
import { clampViewport } from '../../canvas/viewport';

describe('importPdfAsDocument', () => {
  beforeEach(async () => {
    await useStore.getState().init();
  });

  it('imports an entire PDF into a single Page with all sheets grouped inside it', async () => {
    const pdfBytes = createVectorFormulasPdf(3);
    const file = pdfBytesToFile(pdfBytes, 'Lezione_Analisi.pdf');

    const secId = useStore.getState().sectionId!;
    expect(secId).toBeDefined();

    const result = await importPdfAsDocument(file, file.name, secId);

    expect(result.title).toBe('Lezione_Analisi');
    expect(result.sheetCount).toBe(3);

    // Verify workspace metadata
    const ws = useStore.getState().workspace;
    const pageMeta = ws.pages[result.pageId];
    expect(pageMeta).toBeDefined();
    expect(pageMeta.title).toBe('Lezione_Analisi');
    expect(pageMeta.sheetCount).toBe(3);
    expect(pageMeta.firstSheetType).toBe('pdf');
    expect(pageMeta.pdfAssetId).toBeDefined();

    // Verify PageContent sheets
    const pageContent = useStore.getState().pages[result.pageId];
    expect(pageContent).toBeDefined();
    expect(pageContent.sheets).toHaveLength(3);
    expect(pageContent.sheets![0].type).toBe('pdf');
    expect(pageContent.sheets![0].pdfPage).toBe(1);
    expect(pageContent.sheets![1].pdfPage).toBe(2);
    expect(pageContent.sheets![2].pdfPage).toBe(3);

    // Verify landscape slide comfortable desk sizing (~1040px width)
    expect(pageContent.sheets![0].width).toBe(1040);
  });

  it('inserts a blank sheet matching the exact dimensions below a specific PDF slide', () => {
    const pid = 'test-doc-id';
    const initialPage = {
      ...P.emptyPage(pid),
      sheets: [
        { id: 's1', width: 1040, height: 585, type: 'pdf' as const, pdfPage: 1 },
        { id: 's2', width: 1040, height: 585, type: 'pdf' as const, pdfPage: 2 },
      ],
      items: {
        itemOnSlide2: {
          id: 'itemOnSlide2',
          type: 'text' as const,
          x: 50,
          y: 700,
          w: 200,
          h: 40,
          doc: P.EMPTY_DOC,
          variant: 'plain' as const,
        },
      },
      order: ['itemOnSlide2'],
    };

    // Insert blank sheet after sheet index 0 (after slide 1)
    const updated = P.insertSheetAfter(initialPage, 0, { type: 'blank', width: 1040, height: 585 });

    expect(updated.sheets).toHaveLength(3);
    expect(updated.sheets![0].type).toBe('pdf');
    expect(updated.sheets![1].type).toBe('blank');
    expect(updated.sheets![1].width).toBe(1040);
    expect(updated.sheets![1].height).toBe(585);
    expect(updated.sheets![2].type).toBe('pdf');

    // The item below slide 1 was shifted down by height + SHEET_GAP (585 + 36 = 621)
    const shifted = updated.items.itemOnSlide2 as TextItem;
    expect(shifted.y).toBe(700 + 585 + 36);
  });

  it('appends a standard A4 sheet to a page with addSheet', () => {
    const pid = 'a4-doc';
    const singleA4 = P.emptyPage(pid);
    const withTwoSheets = P.addSheet(singleA4);

    expect(withTwoSheets.sheets).toHaveLength(2);
    expect(withTwoSheets.sheets![0].width).toBe(794);
    expect(withTwoSheets.sheets![0].height).toBe(1123);
    expect(withTwoSheets.sheets![1].width).toBe(794);
    expect(withTwoSheets.sheets![1].height).toBe(1123);
  });

  it('retains imported PDF asset across garbage collection and app restart', async () => {
    const pdfBytes = createVectorFormulasPdf(2);
    const file = pdfBytesToFile(pdfBytes, 'Persistenza.pdf');
    const secId = useStore.getState().sectionId!;

    const result = await importPdfAsDocument(file, file.name, secId);
    const pageContent = useStore.getState().pages[result.pageId];
    const assetId = pageContent.pdfAssetId!;
    expect(assetId).toBeDefined();

    // referencedAssets must include the PDF assetId
    const refs = P.referencedAssets(pageContent);
    expect(refs.has(assetId)).toBe(true);

    // Run asset garbage collection (which runs on app startup)
    await useStore.getState().garbageCollectAssets();

    // PDF asset and persisted PageContent must still exist in IndexedDB
    const storedAsset = await getAsset(assetId);
    expect(storedAsset).toBeDefined();
    const storedPage = await loadPage(result.pageId);
    expect(storedPage).toBeDefined();
    expect(storedPage?.sheets).toHaveLength(2);
    expect(storedPage?.pdfAssetId).toBe(assetId);
  });

  it('centers the page horizontally in the workspace like Microsoft Word when viewport is wider than page', () => {
    const page = P.emptyPage('centered-p');
    const vp = clampViewport({ x: -1e6, y: -1e6, zoom: 1 }, { w: 1400, h: 900 }, 1123, page);
    // For a 794px page inside a 1400px viewport at zoom 1, centeredX = -(1400 - 794) / 2 = -303
    expect(vp.x).toBeCloseTo(-(1400 - 794) / 2);
  });
});
