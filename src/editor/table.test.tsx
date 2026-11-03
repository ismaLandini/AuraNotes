import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Editor } from '@tiptap/core';
import { createTableDoc, sharedExtensions } from './extensions';
import { StaticRichText, docToHTML } from './StaticRichText';
import { TableMenu } from '../components/TableMenu';

describe('Table functionality', () => {
  it('creates valid table document structure with custom dimensions', () => {
    const doc = createTableDoc(4, 5, true);
    expect(doc.type).toBe('doc');
    const table = doc.content?.[0];
    expect(table?.type).toBe('table');
    expect(table?.content?.length).toBe(4); // 4 rows
    // first row is header
    expect(table?.content?.[0].content?.length).toBe(5);
    expect(table?.content?.[0].content?.[0].type).toBe('tableHeader');
    // second row is normal cell
    expect(table?.content?.[1].content?.[0].type).toBe('tableCell');
  });

  it('serialises and renders table with header and cells to HTML', () => {
    const doc = createTableDoc(2, 3, true);
    const html = docToHTML(doc);
    expect(html).toContain('<table');
    expect(html).toContain('<th');
    expect(html).toContain('<td');

    const { container } = render(<StaticRichText doc={doc} />);
    expect(container.querySelectorAll('th').length).toBe(3);
    expect(container.querySelectorAll('td').length).toBe(3);
  });

  it('supports cell shading (background color)', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableCell',
                  attrs: { backgroundColor: 'rgba(58, 130, 246, 0.22)' },
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Colorata' }] }],
                },
              ],
            },
          ],
        },
      ],
    };
    const html = docToHTML(doc);
    expect(html).toContain('background-color');

    const { container } = render(<StaticRichText doc={doc} />);
    const cell = container.querySelector('td');
    expect(cell).toHaveStyle('background-color: rgba(58, 130, 246, 0.22)');
  });

  it('executes table modification commands on TipTap editor', () => {
    const editor = new Editor({
      extensions: sharedExtensions(),
      content: '<p>Inizio</p>',
    });

    // 1. Insert table
    editor.commands.insertTable({ rows: 3, cols: 3, withHeaderRow: true });
    expect(editor.isActive('table')).toBe(true);

    // 2. Add row after
    editor.commands.addRowAfter();
    // 3. Add column after
    editor.commands.addColumnAfter();
    // 4. Set cell background
    editor.commands.setCellAttribute('backgroundColor', 'rgba(34, 197, 94, 0.22)');
    const json = editor.getJSON();
    const str = JSON.stringify(json);
    expect(str).toContain('"backgroundColor":"rgba(34, 197, 94, 0.22)"');

    // 5. Delete column & row
    editor.commands.deleteColumn();
    editor.commands.deleteRow();

    // 6. Delete table
    editor.commands.deleteTable();
    expect(editor.isActive('table')).toBe(false);

    editor.destroy();
  });

  it('renders WordTablePicker grid and handles cell selection', () => {
    const close = vi.fn();
    render(<TableMenu editor={null} close={close} />);

    expect(screen.getByTestId('table-picker-menu')).toBeInTheDocument();
    expect(screen.getByText('Riga di intestazione')).toBeInTheDocument();
    expect(screen.getByText('3×3')).toBeInTheDocument();

    // Clicking a preset button triggers insertion
    fireEvent.click(screen.getByText('3×3'));
    expect(close).toHaveBeenCalled();
  });
});
