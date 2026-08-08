const { contextBridge, ipcRenderer } = require('electron');

// Exposes window.afreemailDesktop so the web app can detect it's running inside the
// desktop shell (e.g. to hide a "Download desktop app" CTA it would otherwise show
// web users) and, since the real top menu (main.js's buildMenu) was added, receive
// menu actions -- see afreemail-web's src/lib/desktopBridge.ts, the only consumer of
// onMenuAction. contextIsolation stays on and nodeIntegration stays off (main.js's
// BrowserWindow config) -- this bridge is the one deliberate, narrow crossing point,
// same as it's always been.
contextBridge.exposeInMainWorld('afreemailDesktop', {
  isDesktop: true,
  platform: process.platform,
  // callback receives the action string sent by main.js's sendMenuAction (e.g.
  // 'compose', 'search', 'inbox', 'aura-voice', 'aura-settings'). Returns an
  // unsubscribe function.
  onMenuAction: (callback) => {
    const listener = (_event, action) => callback(action);
    ipcRenderer.on('menu-action', listener);
    return () => ipcRenderer.removeListener('menu-action', listener);
  },
});
