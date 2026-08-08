# AFreeMail Desktop

An Electron app that bundles a real copy of `afreemail-web`'s production build (mail,
settings, Contribion, AURA Voice) so the app shell opens instantly with **no internet
connection at all** -- only real data (mail sync, sending, AURA, etc.) depends on
reaching the backend, exactly as it would on the web. It deliberately never bundles
the marketing/blog/legal/docs routes (already code-split out of `afreemail-web`'s main
bundle), since the shell only ever loads `/mail` and `/auth`.

Before this, the shell was a thin wrapper that always did
`mainWindow.loadURL('https://www.afreemail.com/mail')` -- with no internet, there was
nothing to load beyond a retry-loop error screen. `main.js` now serves a bundled copy
of the web app through a custom `afreemail://` scheme
(`protocol.handle`/`protocol.registerSchemesAsPrivileged`), so the shell itself never
depends on the network; the already-real offline mail cache/outbox
(`afreemail-web`'s `src/lib/offline/`) does the rest once real data is involved.

## Dev

Run `afreemail-web`'s dev server first, on port 5273 (its `vite.config.ts` default of
8080 collides with the local backend's HTTP API):

```
cd /Users/mac/afreemail-web && npm run dev -- --port 5273
```

then:

```
npm install
npm run dev
```

By default this points at `http://localhost:5273/mail`. Override with
`AFREEMAIL_DESKTOP_URL` if the web dev server is running elsewhere -- or point it at
the bundled build itself (see below) to test the offline path without the dev server
running at all:

```
npm run build:web
AFREEMAIL_DESKTOP_URL=afreemail://app/mail npm run dev
```

## Build

```
npm run build:web  # builds ../afreemail-web and copies its dist/ into src/web-dist/
npm run dist:mac   # or dist:win / dist:linux
```

`build:web` assumes `afreemail-web` is checked out as a sibling directory
(`../afreemail-web`) -- same layout this whole project already uses. Packaged builds
load `afreemail://app/mail` (the bundle, always) by default, overridable via
`AFREEMAIL_DESKTOP_URL` for testing against a staging build.

## The top menu

`main.js`'s `buildMenu()` is a real, functional menu bar, not just OS chrome -- **Mail**
(New Message, Search, Inbox) and **AURA** (Voice Assistant, AURA Settings) send an IPC
action (`preload.js`'s `onMenuAction` bridge) that `afreemail-web`'s
`src/lib/desktopBridge.ts` picks up and routes to the same handlers the in-app UI
already calls. Add a new menu item by adding a `click: () => sendMenuAction('...')`
entry here and a matching handler in `desktopBridge.ts`'s subscriber in `Mail.tsx` --
the menu itself never duplicates app logic.

## Releasing

Locally (any platform you have creds for):

```
npm run release        # builds mac+win+linux and publishes to GitHub Releases
npm run release:mac    # mac only
```

Or via CI (`.github/workflows/release.yml`): push a tag matching `v*` (e.g.
`git tag v0.1.0 && git push origin v0.1.0`), or trigger it manually from the repo's
Actions tab / `gh workflow run release.yml`. This builds macOS (signed, notarized) and
Linux (AppImage, unsigned -- no Linux-side equivalent of Gatekeeper to satisfy) on
their real respective runners, checking out and building `afreemail-web` on each
runner first (same `build:web` step as local dev, just via an explicit checkout
instead of a sibling directory) before packaging, then publishes both once both
finish. Your Apple signing credentials only ever live in this repo's Actions secrets,
never on a laptop disk or in a shell history.

To add the secrets (GitHub repo -> Settings -> Secrets and variables -> Actions -> New
repository secret), six values are needed:

| Secret | Where it comes from |
|---|---|
| `CSC_LINK` | Your Developer ID Application cert exported as `.p12` from Keychain Access, then base64-encoded: `base64 -i Certificates.p12 \| pbcopy`, paste the clipboard contents as the secret value |
| `CSC_KEY_PASSWORD` | The password you set when exporting that `.p12` |
| `APPLE_ID` | Your Apple ID email |
| `APPLE_APP_SPECIFIC_PASSWORD` | Generated at appleid.apple.com -> Sign-In and Security -> App-Specific Passwords -- not your real Apple ID password |
| `APPLE_TEAM_ID` | developer.apple.com -> Membership -- a 10-character code |
| `AFREEMAIL_WEB_CHECKOUT_TOKEN` | A GitHub fine-grained personal access token (github.com -> Settings -> Developer settings -> Fine-grained tokens) scoped to read-only **Contents** access on the `Emplug/afreemail-web` repo only. Needed because the default `GITHUB_TOKEN` a workflow gets only has access to the repo it runs in -- this workflow also needs to check out a second, separate repo to bundle its build output. |

`build.publish` points at `Emplug/afreemail-desktop`. `electron-updater` checks that
feed on launch (packaged builds only) and asks before downloading/installing -- never
silent, since this is a mail client.

## App icon

`build/icon.icns` / `.ico` / `.png` are generated from the brand mark in
`build/source/` (a diagonal gradient from the logo's native blue `#0550EE` to the
app's in-app primary indigo `#6366F1`, white glyph on top, rounded-square canvas). To
regenerate after a brand refresh, see the compositing steps this was built with --
extract the glyph as an alpha-masked layer, composite onto a gradient rounded-square,
export at 1024x1024, then downsample to the standard icon sets (`iconutil` for
`.icns`, Pillow's ICO writer for `.ico`).

## Not yet done

- Windows isn't built by CI yet -- there's no code-signing certificate, and an
  unsigned `.exe` triggers a "Windows protected your PC" SmartScreen warning severe
  enough that handing it out unsigned would do more harm than good. Add a `windows`
  job to `release.yml` (matching the `mac` job's `CSC_LINK`/`CSC_KEY_PASSWORD`
  pattern, with a real Authenticode cert instead of an Apple one, and the same
  `afreemail-web` bundling step) once that exists. `/product/desktop` on
  `afreemail-web` already handles this correctly either way -- it only shows a
  Windows download button once a `.exe` asset actually exists on the release.
- Mobile voice input for AURA Voice (`afreemail-backend`'s
  `docs/aura-voice/README.md`) hasn't shipped yet -- unrelated to this repo, noted
  here only because the desktop AURA menu is now live ahead of mobile's equivalent.
