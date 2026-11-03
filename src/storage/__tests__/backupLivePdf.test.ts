import { describe, expect, it } from 'vitest';
import { BACKUP_FORMAT, remapBackup, type BackupFile } from '../backup';
import * as W from '../../model/workspaceOps';
import * as P from '../../model/pageOps';
import { SCHEMA_VERSION, type NoteContainerItem } from '../../types';

describe('remapBackup with live vector PDF blocks', () => {
  it('preserves empty string assetId on live PDF blocks and remaps source.assetId', () => {
    const rawPdfAssetId = 'pdf-raw-asset-123';
    let ws = W.emptyWorkspace();
    ws = W.createNotebook(ws, 'Notebook 1', 'nb1');
    ws = W.createSection(ws, 'nb1', 'Section 1', 'sec1');
    ws = W.createPage(ws, 'sec1', 'Page 1', 'page1');

    const container: NoteContainerItem = {
      id: 'c1',
      type: 'container',
      x: 100,
      y: 100,
      w: 600,
      h: 800,
      doc: {
        type: 'doc',
        content: [
          {
            type: 'imageBlock',
            attrs: {
              id: 'ib1',
              assetId: '', // live vector block: empty string raster asset ID
              width: 600,
              naturalWidth: 1200,
              naturalHeight: 1600,
              source: {
                type: 'pdf',
                assetId: rawPdfAssetId,
                page: 1,
                mode: 'live',
              },
            },
          },
        ],
      },
    };

    const page = P.addItems(P.emptyPage('page1'), [container]);

    const backup: BackupFile = {
      format: BACKUP_FORMAT,
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      workspace: ws,
      pages: [page],
      assets: [
        {
          id: rawPdfAssetId,
          mime: 'application/pdf',
          data: 'data:application/pdf;base64,JVBERi0xLjQK',
        },
      ],
    };

    const remapped = remapBackup(backup);

    // 1. Check container was remapped
    const remappedPage = remapped.pages[0];
    const remappedContainer = Object.values(remappedPage.items)[0] as NoteContainerItem;
    const imageBlock = (remappedContainer.doc as { content: Array<{ attrs: any }> }).content[0];

    // 2. assetId MUST remain strictly empty string ''
    expect(imageBlock.attrs.assetId).toBe('');

    // 3. source.assetId MUST be remapped to the new asset ID
    expect(imageBlock.attrs.source.assetId).not.toBe(rawPdfAssetId);
    expect(imageBlock.attrs.source.assetId).toBe(remapped.assets[0].id);
    expect(imageBlock.attrs.source.page).toBe(1);
    expect(imageBlock.attrs.source.mode).toBe('live');
  });
});
