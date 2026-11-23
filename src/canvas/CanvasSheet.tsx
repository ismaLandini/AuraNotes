import { useMemo } from 'react';
import type { SheetDef, PageBackground, PdfSourceAttr } from '../types';
import { usePdfPageUrl } from '../pdf/pageCache';
import { Plus } from 'lucide-react';
import { useStore } from '../store/useStore';
import { finishEditing } from './actions';
import { getViewport, setLastPointerWorld, setVp } from './viewport';
import { SHEET_GAP } from '../lib/page';

interface CanvasSheetProps {
  sheet: SheetDef;
  index: number;
  totalSheets: number;
  x: number;
  y: number;
  w: number;
  h: number;
  bg: PageBackground;
}

function PdfSheetLayer({ sheet, w }: { sheet: SheetDef; w: number }) {
  const source: PdfSourceAttr | null = useMemo(
    () =>
      sheet.pdfAssetId && sheet.pdfPage
        ? { type: 'pdf', assetId: sheet.pdfAssetId, page: sheet.pdfPage, mode: 'live' }
        : null,
    [sheet.pdfAssetId, sheet.pdfPage],
  );
  // High resolution target width with oversampling
  const { url, loading } = usePdfPageUrl(source, Math.round(w * 1.5), true);

  if (!url) {
    return (
      <div className="sheet-pdf-loading">
        <span>{loading ? 'Rendering PDF…' : ''}</span>
      </div>
    );
  }

  return (
    <img
      src={url}
      alt={`Pagina PDF ${sheet.pdfPage ?? ''}`}
      className="sheet-pdf-render-img"
      draggable={false}
    />
  );
}

export function CanvasSheet({ sheet, index, x, y, w, h, bg }: CanvasSheetProps) {
  const isPdf = sheet.type === 'pdf';

  const handleAddBlankSheetBelow = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const st = useStore.getState();
    if (st.editingId) {
      finishEditing(st.editingId);
    }
    if (st.selection.length) {
      st.setSelection([]);
    }
    st.insertSheetAfterCurrent(index, {
      width: sheet.width,
      height: sheet.height,
      type: 'blank',
    });
    // Scroll the newly inserted blank sheet to the top of the viewport and place subsequent pastes inside it.
    const newSheetY = y + h + SHEET_GAP;
    const vp = getViewport();
    setVp({ ...vp, y: newSheetY - 24 });
    setLastPointerWorld({
      x: x + Math.min(48, Math.max(16, sheet.width / 4)),
      y: newSheetY + 48,
    });
    e.currentTarget.blur();
    document.querySelector<HTMLElement>('[data-canvas-root]')?.focus({ preventScroll: true });
  };

  return (
    <div
      className={`sheet-paper sheet-goodnotes-paper${isPdf ? ' is-pdf' : ` pattern-${bg.pattern}`}`}
      style={{
        left: x,
        top: y,
        width: w,
        height: h,
      }}
      data-sheet-index={index}
      data-testid={`canvas-sheet-${index + 1}`}
    >
      {isPdf && <PdfSheetLayer sheet={sheet} w={w} />}

      <div className="sheet-page-indicator" aria-hidden="true">
        {index + 1}
      </div>

      <div className="sheet-add-below-wrap">
        <button
          type="button"
          className="sheet-add-below-btn"
          data-ui="true"
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onClick={handleAddBlankSheetBelow}
          data-testid={`add-sheet-below-${index + 1}`}
          title={isPdf ? 'Aggiungi un foglio bianco sottostante (stesso formato del PDF)' : 'Aggiungi un foglio bianco sotto'}
          aria-label="Aggiungi foglio bianco sotto"
        >
          <Plus size={13} />
          <span>{isPdf ? 'Aggiungi foglio bianco sotto' : 'Aggiungi foglio'}</span>
        </button>
      </div>
    </div>
  );
}
