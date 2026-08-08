const { app, BrowserWindow, shell, Menu, dialog, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');

log.transports.file.level = 'info';
autoUpdater.logger = log;
autoUpdater.autoDownload = false;

// In dev this points at afreemail-web's own Vite dev server. Note: vite.config.ts
// defaults to :8080, but that collides with the local backend's HTTP API (also
// :8080 per config/http.ini) -- this repo's own dev tooling (.claude/launch.json)
// runs afreemail-web on :5273 instead to avoid that clash, so that's the default
// here too. Both are overridable via env var for testing against a staging URL.
//
// The packaged build no longer loads the live site over the network at all --
// it loads a bundled copy of afreemail-web's own production build (see
// scripts/build:web and README.md) through the custom `afreemail://` scheme
// registered below, so the app shell opens instantly with no internet
// connection at all. Real data (mail sync, sending, etc.) still goes over the
// network to the real backend exactly as before -- only the app *shell* is now
// local. See WEB_DIST_DIR/the protocol.handle block below.
const DEFAULT_DEV_URL = 'http://localhost:5273/mail';
const DEFAULT_PROD_URL = 'afreemail://app/mail';
const APP_URL = process.env.AFREEMAIL_DESKTOP_URL
  || (app.isPackaged ? DEFAULT_PROD_URL : DEFAULT_DEV_URL);

// Bundled copy of afreemail-web's `dist/` -- populated by `npm run build:web`
// locally, or by the CI step that checks out and builds afreemail-web before
// electron-builder runs (see .github/workflows/release.yml). Lives as a sibling
// of this file so it's picked up by package.json's existing `files: ["src/**/*"]`
// with no packaging config change needed.
const WEB_DIST_DIR = path.join(__dirname, 'web-dist');

// Must be called before the app is ready (Electron requirement) -- `standard:
// true` gives the scheme real origin/URL-resolution semantics (relative paths,
// history-API routing) instead of the more restricted default, which is what
// lets afreemail-web's BrowserRouter and root-absolute asset paths work
// unchanged from how they already work when served over http(s).
protocol.registerSchemesAsPrivileged([
  { scheme: 'afreemail', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

// afreemail-web is a single SPA that also serves the marketing site -- the desktop
// shell only ever loads /mail and /auth. Any top-level navigation to a different
// origin (a link the user clicked inside mail, for example) is sent to the OS
// browser instead of following it in this window, and any window.open() call
// (e.g. "open in new tab" style links) does the same. This keeps the shell scoped
// to the app itself and avoids the window becoming a general-purpose browser.
function isAppOrigin(url, appOrigin) {
  try {
    return new URL(url).origin === appOrigin;
  } catch {
    return false;
  }
}

// Shown in place of a blank window when APP_URL can't be reached (server down,
// no internet, etc.) -- without this, a load failure just leaves the user
// staring at the BrowserWindow's plain backgroundColor with no explanation.
// Retry re-navigates to the real APP_URL directly rather than reloading this
// page, since this page's own origin is `data:`, not the app's.
function errorPageHtml(targetUrl) {
  const safeUrl = targetUrl.replace(/'/g, "\\'");
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body { margin:0; height:100vh; display:flex; align-items:center; justify-content:center;
         background:#0f172a; color:#e2e8f0; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
  .box { text-align:center; max-width:360px; padding:0 24px; }
  h1 { font-size:18px; font-weight:600; margin:0 0 8px; }
  p { font-size:13px; color:#94a3b8; line-height:1.5; margin:0 0 20px; }
  button { background:#6366f1; color:#fff; border:none; border-radius:8px; padding:10px 20px;
           font-size:13px; font-weight:600; cursor:pointer; }
  button:hover { background:#4f46e5; }
</style></head>
<body>
  <div class="box">
    <h1>Can't reach AFreeMail</h1>
    <p>Check your internet connection, or the server may be temporarily unavailable. This retries automatically.</p>
    <button onclick="window.location.href='${safeUrl}'">Retry now</button>
  </div>
</body>
</html>`;
}

let mainWindow = null;
let retryTimer = null;
let hasRetriedUpdateCheck = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: 'AFreeMail',
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const appOrigin = new URL(APP_URL).origin;

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAppOrigin(url, appOrigin)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  function showLoadFailure(reason) {
    console.error(`[afreemail-desktop] ${reason}`);
    mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(errorPageHtml(APP_URL))}`);
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      if (mainWindow) mainWindow.loadURL(APP_URL);
    }, 10000);
    // A load failure that isn't a one-off blip is exactly the situation a newer
    // build might already fix -- this shell's own 0.1.1 shipped with a URL bug
    // that put every user in permanent retry loop, recoverable only by installing
    // 0.1.2. checkForUpdates() already runs once at startup, but a user who
    // dismissed or never saw that one-time dialog had no other way back to it --
    // stuck retrying the same broken URL forever with no path to the fix. Guarded
    // to fire once per app session (not once per 10s retry tick) so a user who
    // says "Later" doesn't get the same dialog stacked on top of itself.
    if (app.isPackaged && !hasRetriedUpdateCheck) {
      hasRetriedUpdateCheck = true;
      autoUpdater.checkForUpdates().catch((err) => log.error('[afreemail-desktop] update check on load failure', err));
    }
  }

  mainWindow.webContents.on('did-finish-load', () => {
    const url = mainWindow.webContents.getURL();
    console.log(`[afreemail-desktop] loaded ${url}`);
    // A data: URL here means it's our own error page, not a real recovery --
    // leave the pending retry (scheduled below) running.
    if (!url.startsWith('data:')) {
      clearTimeout(retryTimer);
    }
  });
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return; // ignore failed sub-resources (images, fonts, etc.)
    showLoadFailure(`failed to load ${validatedURL}: ${errorDescription} (${errorCode})`);
  });
  // A 4xx/5xx response (server down, bad gateway, etc.) is not a network-level
  // failure as far as Chromium is concerned -- it "successfully" loads the
  // error response body, so did-fail-load never fires for it. did-navigate's
  // httpResponseCode is the only place that status is visible.
  mainWindow.webContents.on('did-navigate', (_event, url, httpResponseCode) => {
    if (url.startsWith('data:')) return; // our own error page, not a real nav
    if (httpResponseCode >= 400) {
      showLoadFailure(`server responded ${httpResponseCode} for ${url}`);
    }
  });

  mainWindow.loadURL(APP_URL);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Serves the bundled copy of afreemail-web's production build through the
// `afreemail://` scheme registered above -- this is what makes the app shell
// itself open with no network connection (see WEB_DIST_DIR comment). Any
// request path that isn't a real file on disk (i.e. every client-side route
// afreemail-web's BrowserRouter owns, like /mail or /auth) falls back to
// index.html, the same rewrite rule any SPA host applies.
function registerAppProtocol() {
  protocol.handle('afreemail', async (request) => {
    try {
      const url = new URL(request.url);
      let pathname = decodeURIComponent(url.pathname);
      if (pathname === '' || pathname === '/') pathname = '/index.html';
      let filePath = path.normalize(path.join(WEB_DIST_DIR, pathname));
      if (!filePath.startsWith(WEB_DIST_DIR) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(WEB_DIST_DIR, 'index.html');
      }
      return net.fetch(pathToFileURL(filePath).toString());
    } catch (err) {
      log.error('[afreemail-desktop] afreemail:// protocol error: ' + err.message);
      return new Response('Internal error', { status: 500 });
    }
  });
}

// Sends a menu action to the renderer, where afreemail-web's src/lib/desktopBridge.ts
// picks it up via the onMenuAction bridge exposed in preload.js and routes it to the
// same handlers the in-app UI already calls (openCompose, etc.) -- the menu never
// duplicates that logic, only triggers it.
function sendMenuAction(action) {
  if (mainWindow) mainWindow.webContents.send('menu-action', action);
}

// Minimal-but-real menu -- the default Electron menu carries items (About Electron,
// Node/Chromium version dialogs, etc.) that don't belong in a branded mail client,
// and until now this menu bar had no app functionality in it at all beyond that
// default OS chrome. Mail/AURA below are real actions, not placeholders.
function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }] : []),
    {
      label: 'Mail',
      submenu: [
        { label: 'New Message', accelerator: 'CmdOrCtrl+N', click: () => sendMenuAction('compose') },
        { label: 'Search', accelerator: 'CmdOrCtrl+F', click: () => sendMenuAction('search') },
        { type: 'separator' },
        { label: 'Inbox', click: () => sendMenuAction('inbox') },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(!app.isPackaged ? [{ type: 'separator' }, { role: 'toggleDevTools' }] : []),
      ],
    },
    {
      label: 'AURA',
      submenu: [
        { label: 'Voice Assistant', accelerator: 'CmdOrCtrl+Shift+A', click: () => sendMenuAction('aura-voice') },
        { label: 'AURA Settings', click: () => sendMenuAction('aura-settings') },
      ],
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'close' }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Auto-update: checks GitHub Releases (see package.json "build.publish") for a
// newer version. No-ops in dev (unpackaged) since there's no signed feed to check
// against. Update download is user-confirmed rather than silent/automatic, since
// this reinstalls a mail client -- forcing an update mid-session is disruptive.
function setupAutoUpdate() {
  if (!app.isPackaged) return;

  autoUpdater.on('update-available', async (info) => {
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      buttons: ['Download', 'Later'],
      defaultId: 0,
      message: `AFreeMail ${info.version} is available`,
      detail: 'Download and install the update? AFreeMail will restart to apply it.',
    });
    if (response === 0) autoUpdater.downloadUpdate();
  });

  autoUpdater.on('update-downloaded', async () => {
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      message: 'Update ready',
      detail: 'Restart AFreeMail to finish installing the update.',
    });
    if (response === 0) autoUpdater.quitAndInstall();
  });

  autoUpdater.on('error', (err) => {
    log.error('[afreemail-desktop] auto-update error', err);
  });

  autoUpdater.checkForUpdates();
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    registerAppProtocol();
    buildMenu();
    createWindow();
    setupAutoUpdate();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
