# Packaging Still for production

`npm run dist` produces a real, installable desktop app. This document records
what was verified, where the traps are, and the exact commands per platform.

## Build it

On the machine whose OS you are targeting (usually your own):

```bash
npm install          # once; downloads the Electron-42 prebuilt native binary
npm run dist         # build + switch to Electron ABI + package
```

Platform-specific:

| Command            | Produces (in `release/`)                                            |
| ------------------ | ------------------------------------------------------------------- |
| `npm run dist:win` | `Still-Setup-0.1.0-x64.exe` (NSIS installer), `Still-Portable-0.1.0-x64.exe`, `Still-0.1.0-win-x64.zip` |
| `npm run dist:linux` | `Still-0.1.0.AppImage`, `still_0.1.0_amd64.deb`                  |
| macOS (`npm run dist`) | `Still-0.1.0.dmg`, `Still-0.1.0-mac.zip`                       |

No C++ toolchain is needed on any platform: `scripts/rebuild-native.mjs`
downloads a prebuilt `better-sqlite3` binary for Electron 42 (ABI 146), which
`better-sqlite3@12.11.1` publishes for win32 (x64/ia32/arm64), macOS (x64/arm64)
and linux (x64/arm64). `electron-builder.yml` sets `npmRebuild: false` so
electron-builder never tries to compile anything itself.

## The trap this configuration exists to prevent

`better-sqlite3` is a native module: exactly one `.node` binary can exist in
`node_modules` at a time, compiled for either Node's ABI (115 on Node 20, 127 on
Node 22) or Electron's (146 on Electron 42). `electron-builder` with
`npmRebuild: false` packages **whatever binary happens to be on disk**.

So the sequence

```bash
npm test        # needs the Node ABI -> rebuild:node runs
npm run dist    # packages the Node-ABI binary into the installer
```

produces an installer that crashes on first launch with
`NODE_MODULE_VERSION 115 … was compiled against … 146`. The reverse order
breaks `npm test` instead. This is why `dist`, `dist:win` and `dist:linux` all
run `npm run rebuild` (Electron ABI) immediately before `electron-builder`:
the ABI switch is part of packaging, not a manual step you can forget.

After any `dist`, run `npm run rebuild:node` if you want the test suite back.

### Verifying a packaged binary's ABI

Inside the built app the native module lives at
`resources/app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node`
(`asarUnpack: ["**/*.node"]` in `electron-builder.yml` — native code cannot be
`dlopen`ed from inside an asar archive). Compare its SHA-256 with the file in
`node_modules/better-sqlite3/build/Release/` right after `npm run rebuild`;
they must be identical. That check was performed on the Windows build
(see below).

## What was verified end-to-end (Linux host, 2026-11-18)

1. `npx electron-builder --linux dir` with the **old** config packaged the
   Node-ABI binary — the trap above is real, not theoretical.
2. `npm run rebuild` → "Prebuilt binary in place", ABI 146, nothing compiled.
3. `npx electron-builder --win --x64`:
   * full `release/win-unpacked/` tree built (Electron 42.11.18 win32-x64),
     `Still.exe` carries the generated icon (`release/.icon-ico/icon.ico`),
     asar integrity resource updated;
   * the packaged `better_sqlite3.node` is **byte-identical** (SHA-256
     `addaad40…`) to the ABI-146 source binary;
   * the packaged renderer HTML still contains the production CSP `<meta>`
     and the bundled Manrope fonts;
   * `main/index.cjs` + `preload/index.cjs` present in the asar;
   * `--win zip` produced `Still-0.1.0-win-x64.zip` (145 MB) with all 146
     entries, including the unpacked native module.
4. The NSIS installer step itself could **not** finish on this Linux sandbox:
   NSIS resource editing requires **wine**, which is absent
   (`wine process failed ENOENT`). The same step runs natively on Windows —
   this is a sandbox limitation, not a config defect. The Windows run is the
   authoritative one; see "First production build on Windows" below.
5. `npm run rebuild:node` restored the Node ABI; `npx vitest run` → 211/211.

## App metadata and icon

* `build/icon.svg` is the source of truth for the brand mark (deep-green
  rounded square, cream dot, 45 %-opacity orbit ring). `build/icon.png`
  (1024×1024, transparent corners) is rasterized from it:
  `magick -background none -density 2304 build/icon.svg -resize 1024x1024 build/icon.png`.
  electron-builder derives `icon.ico` (Windows) and `.icns` (macOS) from the
  PNG — verified: the generated `.ico` carries 7 frames (16…256 px) of exactly
  this artwork, and `Still.exe` embeds it.
* The same SVG ships as the renderer favicon (`src/renderer/public/icon.svg`,
  linked from `index.html`); inside the package it lives at
  `dist/renderer/icon.svg` in the asar. Keep both copies identical.
* `electron-builder.yml`: `appId: app.still.mail`, `productName: Still`,
  `publish: null` (no telemetry, no update server — spec §3).
* NSIS is configured for an assisted per-user install
  (`oneClick: false`, `allowToChangeInstallationDirectory: true`), which keeps
  the database under the user's `%APPDATA%` and needs no admin rights.

## Windows-specific notes

* **SmartScreen warning.** The build is unsigned, so first launch shows
  "Windows protected your PC". Click *More info → Run anyway*. Removing this
  requires a code-signing certificate (`win.certificateFile` / `sign` config);
  none is configured.
* **Antivirus heuristics** occasionally flag unsigned Electron installers.
  The zip target is provided as a no-installer alternative: unzip and run
  `Still.exe` directly.
* Portable and installer builds share the same `app.asar`; only the launcher
  differs.

## First production build on Windows — checklist

```bash
git pull                        # or copy the project over
npm install
npm run dist:win
```

Expected console highlights: `runtime electron 42.11.18 (ABI 146)`,
`✔ Prebuilt binary in place`, `building target=nsis … oneClick=false`,
then three artifacts in `release/`. Install `Still-Setup-0.1.0-x64.exe`,
launch, and confirm: window opens to account setup or All Inbox; no CSP
violations in DevTools; the app icon shows in the taskbar; uninstalling via
Settings keeps `%APPDATA%\still` (your mail database) unless you opt in to
deleting it.
