/** Narrow, explicit bridge between the GlassNotes page and the macOS shell. */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('glassnotesDesktop', {
  platform: process.platform,
  /** Called by main before the window closes: the page saves, then confirms. */
  onFlushRequest(handler) {
    ipcRenderer.on('glassnotes:flush-request', async () => {
      try {
        await handler();
      } finally {
        ipcRenderer.send('glassnotes:flushed');
      }
    });
  },
  onMenu(handler) {
    ipcRenderer.on('glassnotes:menu', (_e, cmd) => handler(String(cmd)));
  },
  writeBackup: (json) => ipcRenderer.invoke('glassnotes:write-backup', json),
  openBackups: () => ipcRenderer.invoke('glassnotes:open-backups'),
  savePdf: (title) => ipcRenderer.invoke('glassnotes:save-pdf', { title }),
  info: () => ipcRenderer.invoke('glassnotes:info'),
});
