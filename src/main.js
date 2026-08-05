const { app, BrowserWindow, shell, Menu, dialog } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');

log.transports.file.level = 'info';
autoUpdater.logger = log;
autoUpdater.autoDownload = false;

// In dev this points at afreemail-web's own Vite dev server. Note: vite.config.ts
// defaults to :8080, but that collides with the local backend's HTTP API (also
// :8080 per config/http.ini) -- this repo's own dev tooling (.claude/launch.json)
// runs afreemail-web on :5273 instead to avoid that clash, so that's the default
// here too. In a packaged build this points at the real production app. Both are
// overridable via env var for testing against a staging URL.
const DEFAULT_DEV_URL = 'http://localhost:5273/mail';
const DEFAULT_PROD_URL = 'https://mail.afreemail.com/mail';
const APP_URL = process.env.AFREEMAIL_DESKTOP_URL
  || (app.isPackaged ? DEFAULT_PROD_URL : DEFAULT_DEV_URL);

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

let mainWindow = null;

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

  mainWindow.webContents.on('did-finish-load', () => {
    console.log(`[afreemail-desktop] loaded ${mainWindow.webContents.getURL()}`);
  });
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`[afreemail-desktop] failed to load ${validatedURL}: ${errorDescription} (${errorCode})`);
  });

  mainWindow.loadURL(APP_URL);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Minimal menu -- the default Electron menu carries items (About Electron, Node/
// Chromium version dialogs, etc.) that don't belong in a branded mail client.
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
