/** Narrow, explicit bridge between the AuraNotes page and the macOS shell. */
const { contextBridge, ipcRenderer } = require('electron');

const bridge = {
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
  setTheme: (theme, dark) => ipcRenderer.invoke('glassnotes:set-theme', { theme, dark }),
};

contextBridge.exposeInMainWorld('auranotesDesktop', bridge);
contextBridge.exposeInMainWorld('glassnotesDesktop', bridge);
