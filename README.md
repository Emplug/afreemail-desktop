# AFreeMail Desktop

A thin Electron shell around the authenticated `afreemail-web` app. It is not a
separate frontend -- it loads the real web app's `/mail` route directly, so mail,
settings, secure messaging, and Contribion all work identically to the web app.
It deliberately never navigates to the marketing/blog/legal/docs routes, so that
code (already code-split out of the main bundle in `afreemail-web`) never loads.

## Dev

Run `afreemail-web`'s dev server first, on port 5273 (its `vite.config.ts`
default of 8080 collides with the local backend's HTTP API):

```
cd /Users/mac/afreemail-web && npm run dev -- --port 5273
```

then:

```
npm install
npm run dev
```

By default this points at `http://localhost:5273/mail`. Override with
`AFREEMAIL_DESKTOP_URL` if the web dev server is running elsewhere.

## Build

```
npm run dist:mac   # or dist:win / dist:linux
```

Packaged builds point at `https://mail.afreemail.com/mail` by default (also
overridable via `AFREEMAIL_DESKTOP_URL`, e.g. to point at a staging deploy).

## Not yet done

- No app icon is configured (`build.mac/win/linux` in `package.json` has no
  `icon` field) -- electron-builder will fall back to its default icon. Needs a
  real `.icns`/`.ico`/`.png` set before shipping.
- No auto-update wiring (`electron-updater`) -- installs are manual downloads
  for now.
- Not code-signed/notarized -- `dist:mac` output will trigger Gatekeeper
  warnings until signing is set up.
