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

## Releasing

Locally (any platform you have creds for):

```
npm run release        # builds mac+win+linux and publishes to GitHub Releases
npm run release:mac    # mac only
```

Or via CI (`.github/workflows/release.yml`, macOS only for now): push a tag
matching `v*` (e.g. `git tag v0.1.0 && git push origin v0.1.0`), or trigger it
manually from the repo's Actions tab / `gh workflow run release.yml`. This
builds on a real macOS runner, signs, notarizes, and publishes -- your signing
credentials only ever live in this repo's Actions secrets, never on a laptop
disk or in a shell history.

To add the secrets (GitHub repo -> Settings -> Secrets and variables ->
Actions -> New repository secret), five values are needed:

| Secret | Where it comes from |
|---|---|
| `CSC_LINK` | Your Developer ID Application cert exported as `.p12` from Keychain Access, then base64-encoded: `base64 -i Certificates.p12 \| pbcopy`, paste the clipboard contents as the secret value |
| `CSC_KEY_PASSWORD` | The password you set when exporting that `.p12` |
| `APPLE_ID` | Your Apple ID email |
| `APPLE_APP_SPECIFIC_PASSWORD` | Generated at appleid.apple.com -> Sign-In and Security -> App-Specific Passwords -- not your real Apple ID password |
| `APPLE_TEAM_ID` | developer.apple.com -> Membership -- a 10-character code |

`build.publish` points at `Emplug/afreemail-desktop`. `electron-updater` checks
that feed on launch (packaged builds only) and asks before downloading/
installing -- never silent, since this is a mail client.

## App icon

`build/icon.icns` / `.ico` / `.png` are generated from the brand mark in
`build/source/` (a diagonal gradient from the logo's native blue `#0550EE` to
the app's in-app primary indigo `#6366F1`, white glyph on top, rounded-square
canvas). To regenerate after a brand refresh, see the compositing steps this
was built with -- extract the glyph as an alpha-masked layer, composite onto a
gradient rounded-square, export at 1024x1024, then downsample to the standard
icon sets (`iconutil` for `.icns`, Pillow's ICO writer for `.ico`).

## Not yet done

- Windows/Linux aren't signed or built by CI yet -- mac only, until those
  signing credentials exist (see `Not yet done` in the original scoping, or
  just add a `windows`/`linux` job to `release.yml` once you have a cert).
