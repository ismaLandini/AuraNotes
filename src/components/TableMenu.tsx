import { useState } from 'react';
import type { Editor } from '@tiptap/core';
import {
  TableCellsMerge,
  ArrowUpToLine,
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  Trash2,
  Columns,
  Rows,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { toast } from '../store/ui';
import { insertionPoint } from '../canvas/viewport';
import { createTextBlock } from '../canvas/actions';
import { createTableDoc } from '../editor/extensions';

const GRID_COLS = 10;
const GRID_ROWS = 8;

const SHADING_COLORS = [
  { label: 'Nessuno', color: '' },
  { label: 'Grigio', color: 'rgba(120, 130, 160, 0.2)' },
  { label: 'Azzurro', color: 'rgba(58, 130, 246, 0.22)' },
  { label: 'Giallo', color: 'rgba(234, 179, 8, 0.24)' },
  { label: 'Verde', color: 'rgba(34, 197, 94, 0.22)' },
  { label: 'Rosa', color: 'rgba(236, 72, 153, 0.22)' },
  { label: 'Viola', color: 'rgba(168, 85, 247, 0.22)' },
  { label: 'Arancione', color: 'rgba(249, 115, 22, 0.22)' },
];

export function TableMenu({ editor, close }: { editor?: Editor | null; close: () => void }) {
  const inTable = !!editor?.isActive('table');
  const [showInsertGrid, setShowInsertGrid] = useState(!inTable);
  const [hoverRow, setHoverRow] = useState(0);
  const [hoverCol, setHoverCol] = useState(0);
  const [withHeaderRow, setWithHeaderRow] = useState(true);
  const [showCustom, setShowCustom] = useState(false);
  const [customRows, setCustomRows] = useState(4);
  const [customCols, setCustomCols] = useState(4);

  const c = () => editor?.chain().focus();

  const handleInsert = (rows: number, cols: number, withHeader: boolean) => {
    close();
    if (editor) {
      editor.chain().focus().insertTable({ rows, cols, withHeaderRow: withHeader }).run();
    } else {
      const page = useStore.getState().currentPage();
      if (!page) {
        toast('Apri o crea una pagina prima di inserire una tabella', 'error');
        return;
      }
      const pt = insertionPoint();
      const doc = createTableDoc(rows, cols, withHeader);
      createTextBlock(pt, { doc, edit: true, w: Math.max(520, cols * 130) });
    }
  };

  if (inTable && !showInsertGrid) {
    return (
      <div className="word-table-menu" data-testid="table-tools-menu">
        <div className="table-picker-header">
          <span>Strumenti tabella</span>
          <button
            className="table-preset-btn"
            style={{ flex: 'none', padding: '2px 6px', fontSize: '11px' }}
            onClick={() => setShowInsertGrid(true)}
            title="Inserisci nuova tabella"
          >
            + Nuova
          </button>
        </div>

        {/* Righe */}
        <div className="table-tools-section">
          <div className="table-tools-title">Righe</div>
          <div className="table-tools-actions">
            <button className="table-tools-btn" onClick={() => c()?.addRowBefore().run()} title="Inserisci riga sopra">
              <ArrowUpToLine size={14} /> Riga sopra
            </button>
            <button className="table-tools-btn" onClick={() => c()?.addRowAfter().run()} title="Inserisci riga sotto">
              <ArrowDownToLine size={14} /> Riga sotto
            </button>
            <button className="table-tools-btn danger" onClick={() => c()?.deleteRow().run()} title="Elimina riga corrente">
              <Trash2 size={14} /> Elimina riga
            </button>
          </div>
        </div>

        {/* Colonne */}
        <div className="table-tools-section">
          <div className="table-tools-title">Colonne</div>
          <div className="table-tools-actions">
            <button className="table-tools-btn" onClick={() => c()?.addColumnBefore().run()} title="Inserisci colonna a sinistra">
              <ArrowLeftToLine size={14} /> Col. sinistra
            </button>
            <button className="table-tools-btn" onClick={() => c()?.addColumnAfter().run()} title="Inserisci colonna a destra">
              <ArrowRightToLine size={14} /> Col. destra
            </button>
            <button className="table-tools-btn danger" onClick={() => c()?.deleteColumn().run()} title="Elimina colonna corrente">
              <Trash2 size={14} /> Elimina col.
            </button>
          </div>
        </div>

        {/* Celle & Intestazione */}
        <div className="table-tools-section">
          <div className="table-tools-title">Celle e intestazioni</div>
          <div className="table-tools-actions">
            <button className="table-tools-btn" onClick={() => c()?.mergeOrSplit().run()} title="Unisci o dividi le celle selezionate">
              <TableCellsMerge size={14} /> Unisci / Dividi
            </button>
            <button className="table-tools-btn" onClick={() => c()?.toggleHeaderRow().run()} title="Alterna riga intestazione">
              <Rows size={14} /> Riga intest.
            </button>
            <button className="table-tools-btn" onClick={() => c()?.toggleHeaderColumn().run()} title="Alterna colonna intestazione">
              <Columns size={14} /> Col. intest.
            </button>
          </div>
        </div>

        {/* Sfondo cella */}
        <div className="table-tools-section">
          <div className="table-tools-title">Sfondo cella</div>
          <div className="table-color-grid">
            {SHADING_COLORS.map(({ label, color }) => (
              <button
                key={label}
                className="table-color-swatch"
                style={{ backgroundColor: color || 'var(--surface)' }}
                title={label}
                onClick={() => {
                  c()?.setCellAttribute('backgroundColor', color || null).run();
                }}
              >
                {!color && '×'}
              </button>
            ))}
          </div>
        </div>

        {/* Elimina tabella intera */}
        <div style={{ borderTop: '1px solid var(--line, #eee)', paddingTop: '6px', marginTop: '4px' }}>
          <button
            className="table-tools-btn danger"
            style={{ width: '100%', justifyContent: 'center' }}
            onClick={() => {
              close();
              c()?.deleteTable().run();
            }}
          >
            <Trash2 size={14} /> Elimina tabella intera
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="word-table-menu" data-testid="table-picker-menu">
      <div className="table-picker-header">
        <span>{hoverRow > 0 && hoverCol > 0 ? `Tabella ${hoverCol} × ${hoverRow}` : 'Inserisci tabella (Word)'}</span>
        {inTable && (
          <button
            className="table-preset-btn"
            style={{ flex: 'none', padding: '2px 6px', fontSize: '11px' }}
            onClick={() => setShowInsertGrid(false)}
            title="Torna agli strumenti della tabella attiva"
          >
            Strumenti
          </button>
        )}
      </div>

      {/* Grid selector (10 cols x 8 rows) */}
      <div
        className="table-picker-grid"
        onMouseLeave={() => {
          setHoverRow(0);
          setHoverCol(0);
        }}
      >
        {Array.from({ length: GRID_ROWS }).map((_, r) =>
          Array.from({ length: GRID_COLS }).map((_, col) => {
            const rowIndex = r + 1;
            const colIndex = col + 1;
            const active = rowIndex <= hoverRow && colIndex <= hoverCol;
            return (
              <div
                key={`${rowIndex}-${colIndex}`}
                className={`table-picker-cell${active ? ' active' : ''}`}
                onMouseEnter={() => {
                  setHoverRow(rowIndex);
                  setHoverCol(colIndex);
                }}
                onClick={() => handleInsert(rowIndex, colIndex, withHeaderRow)}
                title={`${colIndex} × ${rowIndex}`}
              />
            );
          }),
        )}
      </div>

      <label className="table-header-toggle">
        <input
          type="checkbox"
          checked={withHeaderRow}
          onChange={(e) => setWithHeaderRow(e.target.checked)}
        />
        <span>Riga di intestazione</span>
      </label>

      {/* Quick presets */}
      <div className="table-presets">
        {[
          [2, 2],
          [3, 3],
          [4, 4],
          [5, 5],
        ].map(([r, col]) => (
          <button
            key={`${col}x${r}`}
            className="table-preset-btn"
            onClick={() => handleInsert(r, col, withHeaderRow)}
          >
            {col}×{r}
          </button>
        ))}
      </div>

      {/* Custom size dialog */}
      {!showCustom ? (
        <button
          className="table-preset-btn"
          style={{ width: '100%', marginTop: '4px', textAlign: 'center' }}
          onClick={() => setShowCustom(true)}
        >
          Altre dimensioni...
        </button>
      ) : (
        <div className="table-custom-row">
          <span>Col:</span>
          <input
            type="number"
            min={1}
            max={30}
            className="table-custom-input"
            value={customCols}
            onChange={(e) => setCustomCols(Math.max(1, parseInt(e.target.value, 10) || 1))}
          />
          <span>Righe:</span>
          <input
            type="number"
            min={1}
            max={50}
            className="table-custom-input"
            value={customRows}
            onChange={(e) => setCustomRows(Math.max(1, parseInt(e.target.value, 10) || 1))}
          />
          <button
            className="table-preset-btn"
            style={{ background: 'var(--accent)', color: '#fff', border: 'none', padding: '3px 8px' }}
            onClick={() => handleInsert(customRows, customCols, withHeaderRow)}
          >
            Crea
          </button>
        </div>
      )}
    </div>
  );
}
