# Architectural decisions

Each entry records the decision, why, and what it costs. Limitations that are still open have a
concrete plan rather than being silently omitted.

---

### 1. One typed contract (`StillAPI`) for preload, main and preview

`src/shared/types.ts` declares the full renderer-facing API. The preload implements it, the main
process registers a handler per method, and the browser preview implements the same interface.

**Why:** adding or renaming a channel breaks the build instead of failing at runtime in a
sandboxed renderer where errors are hard to trace.
**Cost:** every feature touches three files. That is the point.

### 2. SQLite with better-sqlite3, WAL, and versioned migrations

Synchronous better-sqlite3 in the main process; `journal_mode = WAL`; `foreign_keys = ON`;
migrations recorded in `schema_migrations`.

**Why:** local-only storage is a product requirement, and synchronous calls in the main process
keep repository code readable while staying off the renderer's thread.
**Cost:** the native module must be rebuilt for Electron's ABI (`npm run rebuild`), and packaging
needs a per-platform rebuild step.
**Plan:** Phase 6 adds the rebuild to the packaging pipeline and verifies installers on all three
platforms.

### 3. Credentials in the OS keychain, never in the database

`safeStorage` encrypts passwords and (later) refresh tokens; only ciphertext is written to the
`credentials` table. Account inputs are stripped of the password before the row is written.

**Why:** a stolen database file must not yield working credentials.
**Cost:** credentials do not roam between machines, and platforms without a keychain cannot store
them — `isAvailable()` lets the app refuse instead of degrading to plaintext.

### 4. All IPC arguments validated with zod at the boundary

`parseOrThrow` on every writable channel; enums for statuses and folder filters; bounded numbers
for stages, limits and offsets.

**Why:** the renderer is untrusted input even though we ship it. Validation is also the schema
documentation.
**Cost:** some duplication between TypeScript types and zod schemas.

### 5. Folder semantics defined once, in pure code, mirrored in SQL

`matchesFolder()` in `shared/utils/messages.ts` is the definition of which message belongs to
Inbox, Sent, Snoozed, Archive, Trash or Drafts. `MessageRepository.list()` implements the same
rules in SQL, and `repositories.folder-parity.test.ts` asserts the two agree for every filter.

**Why:** the preview implementation and the desktop implementation would otherwise drift, and
"inbox" is deceptively easy to get wrong (snoozed, filed and deleted mail all look like inbox
mail at a glance).
**Cost:** a parity test must be maintained whenever either side changes — which is exactly the
signal we want.

### 6. `FolderFilter` is distinct from `FolderKind`

`FolderKind` describes a synchronised provider folder (`inbox`, `sent`, `spam`, `custom`, …).
`FolderFilter` describes a sidebar view and includes `snoozed`, which is a Still-local state and
not a server folder.

**Why:** conflating them would eventually force a fake "Snoozed" folder onto IMAP servers.

### 7. Conversations are scoped per account

`conversations.account_id` is part of every threading decision; duplicate subjects across
accounts never merge.

**Why:** specification §16 explicitly warns against subject-based matching, and multi-account
users routinely see the same subject twice.
**Plan:** Phase 3 threading will match on `Message-ID` / `In-Reply-To` / `References` /
provider thread id, with subject normalisation only as a last-resort fallback inside one account.

### 8. Follow-up intervals chain from the actual previous send time

Implemented in `shared/followup/scheduler.ts` and covered by tests, including the specification's
worked example (Nov 17 → Nov 20 → Nov 27 → Dec 12 → Jan 11).

**Why:** pre-computing all stages from the original send date produces reminders that no longer
match what the user actually did. Stage advancement is tied to a real send event, never to a
reminder becoming due.

### 9. Reminders derived from stored timestamps, not live timers

Due and overdue state is computed from `next_due_at` and the current time.

**Why:** the app is closed most of the time a reminder is due; a JS timer would silently drop it.
**Plan (Phase 4):** on startup, recalculate every sequence, write rows to `notifications`, and
raise desktop notifications subject to reminder time, quiet hours and repeat settings. A
background check runs on an interval while the app is open; the timestamp derivation stays the
source of truth either way.

### 10. No dashboard, no cards

The inbox is the home screen. The Follow-ups section is a grouped list. Settings are section
pages with inline controls separated by thin rules.

**Why:** specification §9 and §11. Restraint is the product's positioning; card grids would make
it look like every other SaaS admin panel.
**Cost:** some affordances that cards give for free (visual grouping, per-item emphasis) have to
come from typography, whitespace, alignment and separators instead.

### 11. Design tokens instead of ad-hoc styling

Colours, density and radii are CSS custom properties in `styles/index.css`, mapped into Tailwind
v4 through `@theme inline`. Theme (light/dark/system), density and font size are applied by
setting `data-theme`, `data-density` and the root font size.

**Why:** one place to change the palette, and settings can drive appearance without component
changes.
**Cost:** token names must exist, or Tailwind silently emits no CSS. Verified by checking compiled
utilities against the token classes used in components.

### 12. Browser preview fallback, clearly separated

`api.ts` uses `window.still` when present; otherwise a localStorage-backed implementation with
sample data, plus a **Preview** badge in the top bar.

**Why:** the interface must be reviewable without a desktop build, and the sandbox here cannot run
Electron's GUI.
**Cost:** two implementations of the same interface — accepted because the shared pure logic is
common to both and the parity test guards the parts that can diverge.
**Rule:** the fallback is never used inside Electron, and it never pretends to send mail; the
composer says what will happen and when.

### 13. Settings must be functional or labelled

Every setting either changes behaviour now or its row states the phase that delivers it (sync
interval, split reading pane, application lock, database encryption, AI provider).

**Why:** specification §20 forbids decorative controls. A settings page full of switches that do
nothing is worse than no settings page.

### 14. Shortcuts listed honestly

`SHORTCUTS` carries an `active` flag. Compose, reply, reply all, forward, J/K, `/`, Esc,
Ctrl/⌘+Enter and Ctrl/⌘+Shift+F work today. Archive, delete and star are shown as arriving with
message actions in Phase 3.

**Why:** a shortcut reference that lists dead keys teaches users that the documentation lies.
**Plan (Phase 3):** add `archive`, `trash` and `star` IPC channels plus repository methods, then
flip the flags and make them customisable (Phase 5).

---

### 15. Reminders are derived, never scheduled

There is no timer chain in the follow-up path. `planReminders` is a pure function of stored
timestamps and the current time; the main process merely polls it every 60 seconds and once on
launch. Each occurrence carries a stable dedupe key —
`followup:<sequenceId>:stage:<n>[:repeat:<r>]` — enforced by a partial unique index, so the
database, not application memory, guarantees a reminder is raised once.

Quiet hours, digest batching and repeat rounds are all computed from the same inputs, and delivery
state lives in `notifications.delivered_at`.

**Why:** the specification requires reminders to survive the app being closed, and a
`setTimeout`-based design fails that the moment the process exits — or fires twice after a clock
change. Deriving state means a reminder that fell due while Still was shut appears on the next
launch, and one already shown never reappears. It also makes the whole engine testable as pure
functions plus a repository over a real database file, with no fake timers.

**Cost:** reminders can be up to one poll interval late, and the scan reads every active sequence
each time. Both are acceptable at desktop scale; the query is indexed on `next_due_at`.

**Plan:** when synchronisation lands (Phase 3), the same scan runs after each sync so a newly
detected reply can complete a sequence before its reminder is raised.

---

## Open limitations and their plans

| Limitation | Plan |
|---|---|
| No IMAP/SMTP connection yet — accounts are stored but not synchronised | Phase 3: provider adapter interface (`email/`), one adapter for IMAP/SMTP, folder discovery, incremental sync with UIDVALIDITY/UIDNEXT cursors in `sync_state`, IDLE where supported, retry with backoff. |
| No sending | Phase 3: SMTP transport in the adapter, `messages:send` IPC, then create the follow-up sequence in the same transaction when follow-up is on. |
| Google and Microsoft OAuth missing | Phase 2: loopback redirect flow in the main process, tokens in the credential store, Gmail API and Graph adapters behind the same interface, `authStatus = 'reconnect'` when a refresh fails. |
| Email HTML not rendered | Phase 3: sanitiser with an allowlist, remote image rewriting governed by `blockRemoteImages`, links validated before opening, no script execution, rendered inside the existing CSP. |
| OS notification banners cannot be observed in this sandbox | The engine is implemented and tested (quiet hours, digests, repeats, dedupe, restart survival). What remains unverified is the Electron `Notification` call itself, because the GUI will not start here. First check on a real machine: set a follow-up due one minute out, quit, relaunch, confirm exactly one banner. |
| Search is client-side over loaded messages | Phase 3: `search` IPC over `messages_fts` with account/date/read/attachment/follow-up filters; the FTS table and triggers already exist and are tested. |
| No backup/restore, no packaging verification | Phase 6: encrypted local backup of the database plus attachment store, restore flow, electron-builder runs on Windows/macOS/Linux, update mechanism. |
| Electron GUI unverified in this environment | First task on a normal machine: `npm run rebuild && npm run dev`, then walk the specification §17 edge-case list. |
