const { contextBridge } = require('electron');

// The app doesn't need any native/OS-privileged API from the page today -- this
// just exposes a `window.afreemailDesktop` marker so the web app can, if useful
// later, detect it's running inside the desktop shell (e.g. to hide a "Download
// desktop app" CTA it would otherwise show web users).
contextBridge.exposeInMainWorld('afreemailDesktop', {
  isDesktop: true,
  platform: process.platform,
});
