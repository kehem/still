# Still

A premium, privacy-focused desktop email client with intelligent follow-up management.

Still connects directly to your email provider. There is no Still account, no Still cloud
backend, no server-side storage and no telemetry. Mail metadata, messages, drafts,
follow-up schedules and settings live in a local SQLite database on your device, and
credentials are encrypted with the operating system's secure storage.

The differentiator is follow-up tracking: you send an email, switch follow-up on, and Still
reminds you when the recipient has not replied. **Still never sends a follow-up for you.**

---

## Running it

```bash
npm install
npm run rebuild      # fetch better-sqlite3 built for Electron's ABI
npm run dev          # Vite + Electron with hot reload
```

Requires **Node 22.12 or newer**. See below for why that is not arbitrary.

Other commands:

| Command | Purpose |
|---|---|
| `npm run dev:renderer` | Renderer only, in a browser (preview mode, see below) |
| `npm run typecheck` | Both TypeScript projects (renderer/shared and main/preload) |
| `npm test` | Unit and integration tests (Vitest) |
| `npm run rebuild` | Switch `better-sqlite3` to **Electron's** ABI — needed to run the app |
| `npm run rebuild:node` | Switch it back to **Node's** ABI — needed to run the tests |
| `npm run build` | Production renderer + bundled main/preload |
| `npm start` | Build, then launch Electron |
| `npm run dist` | Package installers with electron-builder (switches to the Electron ABI first) |
| `npm run dist:win` / `dist:linux` | Same, restricted to one platform (`release/` holds the artifacts) |

Packaging has its own traps (a packaged wrong-ABI binary means an installer
that crashes on launch) — see [`docs/packaging.md`](docs/packaging.md) before
building a release.

### The native module, and why the versions are pinned

`better-sqlite3` is a native module, and Electron embeds a *different* Node/V8 ABI than the Node
you install packages with. Only one binary can be in place at a time:

- `npm run dev` / `npm start` load it inside **Electron** → run `npm run rebuild` first.
- `npm test` runs Vitest under plain **Node** → run `npm run rebuild:node` first.

A wrong-ABI binary fails with `NODE_MODULE_VERSION xxx is required`, which is easy to misread as a
corrupt install. Both scripts print which ABI they targeted and verify the result.

`better-sqlite3` publishes prebuilt binaries, so **no C++ compiler is needed** — provided the
versions line up. `scripts/rebuild-native.mjs` downloads the matching prebuild and only falls back
to compiling when none exists. Coverage for `better-sqlite3@12.11.1`:

| Runtime | ABI | Prebuilt binary |
|---|---|---|
| Node 20 | 115 | **none** — must compile |
| Node 22 | 127 | yes |
| Node 24 | 137 | yes |
| Electron 42 | 146 | yes (win32 x64/ia32/arm64, darwin, linux) |
| Electron 43 / 44 / 45 | 148 / 149 / 150 | **none** — must compile |

That table is why `package.json` pins **Electron 42.11.18** and requires **Node ≥ 22.12**: it is
the combination where both binaries download and nothing compiles, on any platform. Electron was
previously declared as `"latest"`, which resolved to 45.x — an ABI with no prebuild anywhere, so
`npm run rebuild` fell through to node-gyp and failed on Windows with
`Could not find any Visual Studio installation to use`.

#### If you do need to compile

Only necessary when you deliberately move off the pinned versions. On Windows, install the
toolchain once:

```powershell
winget install Microsoft.VisualStudio.2022.BuildTools --override `
  "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

(or Visual Studio Installer → tick **Desktop development with C++**), with Python 3 on PATH.
On Linux: `sudo apt install build-essential python3`. On macOS: `xcode-select --install`.

### Browser preview mode

`npm run dev:renderer` serves the renderer without Electron so the interface can be reviewed
in a browser. In that mode `window.still` is absent, and `src/renderer/services/api.ts` falls
back to a clearly separated, localStorage-backed implementation with sample data. The top bar
shows a **Preview** badge. The fallback is never used inside Electron — there the renderer
talks to the main process through the preload bridge only.

Preview mode exists for interface evaluation. It is not a substitute for the desktop app:
sending, synchronisation, OS notification banners and OS credential storage only exist in Electron;
the reminder list and the whole follow-up engine work in the browser preview too.

---

## Status

| Phase | State |
|---|---|
| 1 — Foundation | **Complete and verified.** Electron/React/TypeScript/Vite/Tailwind, Manrope, design tokens, three-column layout, first-launch routing, SQLite with migrations, validated IPC, settings architecture. |
| 2 — Account management | **Partial.** IMAP/SMTP accounts can be added, edited and removed; credentials are encrypted via `safeStorage`. Google and Microsoft OAuth are not implemented yet. |
| 3 — Email functionality | **Not started.** No IMAP/SMTP synchronisation, no sending, no attachment handling, no server-side search. The UI, database schema and IPC contracts for it are in place. |
| 4 — Follow-up engine | **Partial.** One-click enable/disable of tracking, stage scheduling from the actual send time, all eight statuses, the grouped Follow-ups list, quick actions (open, send, snooze, complete, cancel, per-item schedule switch), schedule editing and restore-defaults are implemented and tested. The reminder engine is implemented and tested: reminders are derived from stored timestamps so they survive a restart, quiet hours defer delivery, hourly/daily digests batch, unhandled reminders repeat, and each occurrence is deduped by the database. Desktop banners fire in Electron. Only reply detection against live mail still awaits synchronisation. |
| 5 — Settings and polish | **Partial.** All settings pages exist and persist; theme, density, font size, accent, sidebar, unified inbox, grouping, sorting, previews, mark-as-read, follow-up schedules and shortcut reference are wired to real behaviour. Accessibility review, split reading pane and custom shortcuts are pending. |
| 6 — Production | **Not started.** Packaging config exists (`electron-builder.yml`) but no installer has been produced. No security audit, backup/restore or update mechanism yet. |

Nothing in the interface is decorative: every control either does something now or states the
phase that delivers it.

### Security notes

- Reminders are derived from stored timestamps, never from a timer. One that falls due while the
  app is closed is raised on the next launch, and the 60-second main-process interval is only a
  poll — correctness does not depend on it.
- The production Content Security Policy is injected into `dist/renderer/index.html` at build
  time. It is not delivered only through response headers, because `onHeadersReceived` does not
  reliably fire for `file://` loads — which is how the packaged app is served.
- A corrupt local database is quarantined with a `.corrupt-<timestamp>` suffix and rebuilt, so
  the app still starts and the old files are never deleted.
- Credentials are encrypted with `safeStorage`; when the OS keychain is unavailable the store
  throws rather than writing plaintext.
- Renderer navigation is confined to the app's own directory, and external links open only for
  `https:` in the system browser.

### Verification

```
npm run typecheck   → clean (both tsconfig projects)
npm test            → 211 tests, 12 files, all passing (also green under 6 timezones)
npm run build       → renderer + main + preload bundles built
```

Test coverage today:

- **Follow-up scheduler** — interval chaining from the actual previous send time, working-day
  vs calendar-day maths, the specification's November 17 → November 20 → November 27 →
  December 12 → January 11 example.
- **Date utilities** — relative and full formatting, day arithmetic.
- **Message list logic** — sorting, conversation collapsing, per-conversation unread state,
  account partitioning, folder semantics, local text matching.
- **Startup navigation** — Scenarios B and C, last-used inbox memory, unified inbox off.
- **SQLite migrations** — schema creation, foreign-key cascades, duplicate provider-message
  prevention, FTS5 triggers.
- **Repository folder parity** — the SQL folder filters and the shared pure predicate return
  identical results for every folder, plus limits, offsets, account scoping and
  mark-as-read in one transaction.
- **Follow-up repository** — creating a sequence from the actual outbound send time, idempotency
  (no duplicate reminders), refusal to track inbound-only threads, working-day maths, disabling
  with history preserved, snooze/completion state transitions, and switching schedules.
- **IPC validation** — malformed payloads, invented settings keys, enum violations, out-of-range
  ports and limits, oversized ids, and provider changes are rejected or stripped. All 19 writable
  channels of 28 are covered, including draft saves (bounded address lists, subject and body
  lengths, unknown keys stripped rather than persisted).
- **Database recovery** — first run, reopen, and a corrupt database (including WAL/SHM sidecars)
  quarantined and rebuilt without deleting user data.
- **Reminder engine** — quiet hours (including midnight-crossing windows), hourly/daily digest
  batching, repeat rounds for unhandled reminders, overdue boundaries, and dedupe keys that stay
  stable across a restart.
- **Reminder persistence** — reminders raised once and never twice, verified by closing and
  reopening a real file database, relaunching days later, and simulating a crash that leaves WAL
  sidecars behind.
- **Renderer integration (jsdom)** — first launch with no account, connecting an account,
  no phantom draft when the composer is merely opened, the reminder bell and its popover,
  unified inbox aggregation and account filtering, Sent vs inbox, search, opening a
  conversation and its thread, mark-as-read persistence, composer with follow-up toggle and
  draft saving, draft deletion, reply from the receiving account, one-click follow-up
  enable/re-enable/stop, per-item schedule switching, follow-up grouping and quick actions,
  account sync and default-sender controls, theme/density/font-size/date-format/sidebar/
  unified-inbox settings, schedule editing, validation and restore-defaults.

The Electron GUI itself cannot launch in the current sandbox (missing `libnspr4.so`), so
desktop-window behaviour is verified by code review plus the main-process tests above, not by
running the app. That is a real gap and is the first thing to check on a normal machine.

---

## Layout

```
src/
  main/          Electron main process
    database/    migrations, DatabaseService, repositories
    security/    safeStorage credential store, zod IPC validation
    ipc/         IPC handler registration
    index.ts     window creation, CSP, navigation guards, lifecycle
  preload/       the only bridge exposed to the renderer (window.still)
  renderer/      React UI
    components/  TopBar, Sidebar, MessageList, ReadingPane, Composer,
                 FollowUpsPage, SettingsPage, icons, settings controls
    features/    setup (first launch, account form)
    hooks/       useSettings
    services/    api.ts (preload bridge + browser preview fallback)
    styles/      design tokens
  shared/        types, constants and pure logic used by both processes
    followup/    scheduler
    utils/       dates, messages, navigation
```

Business logic lives in `shared/` and `main/`; renderer components only present state and
dispatch intent. See `docs/architecture.md` and `docs/decisions.md`.
