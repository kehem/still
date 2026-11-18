# Feature audit

Checked against the master specification section by section, on 2026-11-17, against the code in
this repository — not against intent. Every line was verified by reading the implementation or by
a test that exercises it.

Legend: **Done** = implemented and verified · **Partial** = real but incomplete ·
**Missing** = not implemented · **N/A yet** = depends on a subsystem that does not exist.

Verification at the time of this audit:

```
npm run typecheck   clean (both TS projects)
npm test            211 tests / 12 files, all passing
                    + verified under TZ = UTC, Asia/Dhaka, America/New_York,
                      Pacific/Midway (UTC-11) and Pacific/Kiritimati (UTC+14)
npm run build       renderer + main + preload bundles built
Electron GUI        cannot launch in this sandbox (missing libnspr4.so)
```

---

## §1 Product identity

| Item | State | Evidence |
|---|---|---|
| Product name Still, English UI | Done *(evidence corrected in pass 4)* | All UI strings English. This row originally cited `APP_NAME` as evidence, but the constant had **zero consumers** — the wordmark and the About panel both hardcoded the string. It is now actually used by both |
| Manrope everywhere | Done | `@fontsource/manrope` 400–700 imported in `main.tsx`; `--font-sans` token |
| Scandinavian minimalism, no dashboard | Done | Inbox is the home screen; no dashboard route exists |
| Premium through restraint | Done | Zero `shadow-*` and zero `rounded-lg/xl` utilities in the renderer (verified by grep) |

## §2 Technology stack

| Item | State | Notes |
|---|---|---|
| Electron, React, TypeScript, Vite, Tailwind, SQLite | Done | Electron 33-era pinned for Node 20; Tailwind v4 via `@tailwindcss/vite` |
| Manrope font | Done | Self-hosted woff2, no CDN |
| IMAP/SMTP | **Missing** | Phase 3. No transport library added yet |
| Gmail API | **Missing** | Phase 2 |
| Microsoft Graph API | **Missing** | Phase 2 |
| Native notifications | Done *(pass 3)* | Electron `Notification` banners driven by the reminder engine; gated on `desktopNotifications`, `followUpNotifications` and `notificationSound`. Requires the desktop app — the browser preview shows the reminder list only |
| Process separation (main / preload / renderer / db / security) | Done | Directory layout matches §2 |
| Provider adapter architecture | **Missing** | Seams exist (`StillAPI`, repositories) but no `email/` adapters |
| Business logic outside UI | Done | `src/shared/*` pure modules + repositories; 74 unit tests over the shared modules alone (29 reminder engine, 15 messages, 12 navigation, 10 scheduler, 8 dates) |

## §3 Privacy-first architecture

| Item | State | Evidence |
|---|---|---|
| No Still account / cloud backend / remote DB / telemetry | Done | No network calls exist anywhere in `src/main`; no analytics dependency |
| Local storage of accounts, metadata, drafts, schedules, settings, indexes | Done | SQLite schema in `migrations.ts`; migration test asserts all tables |
| OS secure credential storage | Done | `security/credentials.ts` via `safeStorage`; ciphertext-only column |
| No plaintext passwords | Done | Handler strips `password` before writing the account row |
| Secure OAuth refresh tokens | N/A yet | No OAuth yet (Phase 2); the credential store already supports a `kind` per secret |
| Context isolation / no Node in renderer / sandbox | Done | `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` |
| Strict CSP | Done *(corrected in pass 2)* | Build-time `<meta>` policy in `dist/renderer/index.html` — verified present — plus a header policy for dev. **My first audit called this Done on the strength of the header alone, which was wrong:** `onHeadersReceived` does not reliably fire for `file://`, so the packaged app could have run with no CSP |
| Validate all IPC | Done *(claim was false until pass 4)* | zod `parseOrThrow` on all 19 writable channels of 28. This row was marked Done in pass 1, but `drafts:save` actually did a `typeof input === 'object'` check and then an unchecked `as SaveDraftInput` cast — see pass 4 |
| Sanitize incoming email HTML | N/A yet | HTML is not rendered at all today; only `bodyText` is displayed |
| Block remote images by default | **Partial** | Setting exists and defaults to blocked, but there is no HTML renderer to enforce it yet. CSP already denies remote origins |
| Prevent arbitrary script execution | Done | CSP + sandbox + no `dangerouslySetInnerHTML` anywhere (verified by grep) |
| Handle untrusted attachments safely | N/A yet | Attachments are not downloaded yet |
| Validate external links before opening | Done | `setWindowOpenHandler` allows `https:` only; `will-navigate` restricted |
| Local encryption strategy | **Partial** | Credentials encrypted; whole-database encryption is Phase 6 and labelled as such in Settings |
| Usable offline | Done | All reads are local; nothing requires network |

## §4 Startup and first launch

| Scenario | State | Evidence |
|---|---|---|
| A — no account → setup screen, not an empty inbox or dashboard | Done | Tested: "Welcome to Still." + the three connect options render; no `All Inbox` in the DOM |
| A — Continue with Google | **Missing** | Shows an honest notice that OAuth arrives in Phase 2; not a dead button |
| A — Continue with Microsoft | **Missing** | Same |
| A — Connect using IMAP/SMTP | Done | Full form; tested end-to-end including persistence |
| A — save securely, initialize DB, start sync, open that inbox | **Partial** | Save + open inbox work and are tested; sync does not exist yet |
| B — one account → that inbox immediately | Done | `resolveHomeFolder` returns the single account's inbox; 12 navigation tests |
| C — multiple accounts → default/last-used, else All Inbox | Done | Tested, including deleted-account fallback |
| C — remember last-used inbox | Done | `localStorage` + `rememberLastInbox`; tested |
| D — auth expired → visible with subtle warning, non-blocking | **Partial** | `authStatus !== 'connected'` renders "Reconnect needed"; the reconnect action itself needs OAuth (Phase 2) |

## §5 Multi-account

| Item | State | Notes |
|---|---|---|
| Add / remove / edit account | Done | Tested, including cascade delete of local data |
| Display name, colour | Done | Colour dots; used as the account indicator everywhere |
| Incoming / outgoing server config | Done | IMAP + SMTP host/port/SSL fields |
| Test connectivity | **Missing** | Needs the IMAP/SMTP client (Phase 3). Deliberately not a fake button |
| Enable/disable synchronization | Done | Per-account toggle; tested that it does not affect other accounts |
| Set default sending account | Done | "Make default" updates the account flag and the setting together; tested |
| Reauthenticate | **Missing** | Phase 2 |
| View synchronization status | **Partial** | Top bar shows an honest "Local data only" state; per-account status needs the sync engine |
| All Inbox aggregation | Done | Tested: personal + work mail in one chronological list |
| Preserve account identity per message | Done | Colour dot + account name; only shown in the unified inbox |
| Never duplicate the same email | Done | Partial unique index on `(account_id, provider_message_id)`; migration test asserts the constraint throws |
| Instant account switching | Done | Tested: switching filters the list, same interface |
| Reply uses the receiving account by default | Done | Tested: replying to work mail preselects the work identity |

## §6 Follow-up management (core differentiator)

| Item | State | Evidence |
|---|---|---|
| One-click activation in the composer | Done | "Follow-up: Off/On" toggle + interval select; tested |
| 3 / 7 / 15 / 30 day choices + Custom | Done | Options come from the user's schedule; "Custom…" reveals a day input |
| Control also in Sent / conversation view / threads | Done | Reading pane: "Enable follow-up" on outbound threads, "Reply with follow-up" on inbound-only threads |
| Enable **and** disable with one click | Done | "Stop tracking" in the reading pane; `disableFollowUp` tested at repository and UI level |
| Never auto-send a follow-up | Done | No send path exists; "Send follow-up" opens the composer for the user to send |
| Default stages 3/7/15/30, configurable | Done | Seeded default schedule; add/remove/edit/reorder stages; tested incl. validation |
| Restore default schedule | Done | Explicit "Restore default schedule" resets the default row to 3/7/15/30 and keeps sequence references intact; tested |
| Custom schedules (multiple) | Done | Create/rename/delete/set-default; tested |
| Working-day vs calendar-day | Done | Setting consumed by both create paths; tested (Friday + 3 working days = Wednesday) |
| Next interval from the **actual** previous send time | Done | `advanceOnFollowUpSent`; scheduler tests cover the spec's Nov 17 → Nov 20 → Nov 27 → Dec 12 → Jan 11 chain |
| Stage advances only after the user sends | Done | Nothing advances on due; `currentStage` changes only in `advanceOnFollowUpSent` |
| Statuses: scheduled, due, overdue, waiting, replied, completed, snoozed, cancelled | Done | All eight in the type, the repository and the Follow-ups grouping |
| Subtle indicators, no big badges | Done | 13px clock icon + text line; no badge components |
| Reply detection (Message-ID / In-Reply-To / References / thread ids) | **Missing** | Columns exist in the schema; detection needs live inbound mail (Phase 3) |
| Auto-replies / OOO handled separately | **Missing** | Setting stored and labelled as arriving with reply detection |
| Follow-ups list grouped: Due Today / Upcoming / Overdue / Waiting for Reply / Completed | Done | Tested, including items moving between groups |
| Row shows recipient, subject, sent date, last follow-up, next due, stage, account | Done | All present |
| Quick actions: open, send follow-up, snooze, complete, cancel, edit schedule | Done | All six work and are tested. Per-item "Edit schedule" applies another schedule to that conversation and recomputes the pending reminder from the actual last send time |
| Desktop notification when due | Done *(pass 3)* | Raised from stored timestamps by `NotificationRepository.scan`, surfaced as a bell in the top bar with an unread badge and an OS banner in the desktop app |
| Follow-ups navigation indicator | Done | Due + overdue count in the sidebar |
| Reminder visible until handled | Done | Due/overdue rows persist; terminal statuses clear `next_due_at` (tested) |
| Notification settings (time, quiet hours, sounds, repeats, working days) | Done *(pass 3)* | Every one is now consumed: quiet hours defer delivery, frequency batches into hourly/daily digests, repeat hours re-raise unhandled reminders, sound gates the banner. The "arrives in Phase 4" notes were removed from the UI |
| Works when the app was closed; recalculate overdue on startup | Done *(pass 3)* | The startup scan raises anything that fell due while the app was shut. Proven by tests that close and reopen a real file database — including one that simulates a crash leaving WAL sidecars behind. The 60 s interval is only a poll; correctness never depends on it |

## §7 Composer

| Item | State | Notes |
|---|---|---|
| To / Cc / Bcc / Subject | Done | Cc/Bcc revealed on demand |
| Rich-text editing | **Missing** | Plain textarea; the setting says so explicitly |
| Plain-text editing | Done | That is what the composer is |
| Attachments | **Missing** | Phase 3 |
| Signatures | Done | Default signature prefills new messages |
| Reply / Reply all / Forward | Done | Buttons + R / A / F shortcuts; reply-all Cc honours `ccOnReplyAll` |
| Draft saving | Done | Debounced autosave + explicit save; tested that no duplicate draft is created |
| Sending | **Missing** | Phase 3. The button states plainly what happens instead of pretending |
| Send later | **Missing** | Phase 3 |
| Shows the sending account | Done | "From" select with display name and address |
| Follow-up control inside the composer | Done | Toggle + interval, `Ctrl/⌘+Shift+F` |
| No decorative composer card | Done | Flat panel docked to the right, separator-driven |

## §8 Layout

| Item | State |
|---|---|
| Three-column desktop layout | Done |
| Fixed-width sidebar | Done (224px, 56px collapsed) |
| Independently scrollable message list | Done |
| Row: sender, subject, preview, date, unread, attachment, follow-up, account indicators | Done |
| Thin separators, hover reveals contextual actions | Done |
| Reading pane: conversation, participants, content, history, reply/reply-all/forward, follow-up controls | Done |
| No enclosing decorative card | Done |
| Sidebar collapse | Done |
| Email-list width adjustment | Done (drag handle, 260–560px) |
| Reading pane keeps remaining width | Done |
| Smaller resolutions / no overflow | **Partial** | Verified down to ~1024px by construction (`min-w-0`, `min-h-0`); no automated viewport test |
| Toolbar and navigation fixed | Done |

## §9 Design system

| Item | State | Evidence |
|---|---|---|
| No card-based UI | Done | Grep for `shadow-*`, `rounded-lg/xl/2xl`, `bg-surface-raised` in renderer: **0 hits** |
| Flat layouts, whitespace, thin separators, typography hierarchy | Done | 1px `border-border` rules; 11/12/13/16/22px type scale |
| Minimal icons, inline controls, clean lists | Done | Single inline stroke icon set |
| Manrope + restrained palette | Done | Warm off-white `#faf8f5` / charcoal `#232323`, accent `#3e6fa3` |
| Light / Dark / System | Done | Tested, including following the OS media query |
| Design tokens (colour, type, spacing, radius, borders, hover, focus) | Done | `@theme inline` + `:root`/`[data-theme]`/`[data-density]` |
| Smallest practical radii | Done | `rounded-md` (6px) maximum |

## §10 Scrolling

| Item | State | Notes |
|---|---|---|
| Toolbar fixed, no scroll | Done | `h-11 shrink-0` |
| Message list scrolls independently | Done |
| Long messages scroll | Done |
| No nested scrollbars | **Partial** | Sidebar and settings nav carry `overflow-y-auto` as a safety net at very short window heights; in practice they never overflow, so no second scrollbar appears |
| Composer / settings content | Done | Composer body flexes; settings content scrolls naturally (11 sections) |
| Flexbox + `min-height: 0` discipline | Done | Applied at every scroll container |

## §11 Settings

All 54 settings persist locally and are reachable from their category page. 13 rows carry an
explicit note naming the phase that makes them take effect, so nothing pretends to work.

| Category | State | Wired today |
|---|---|---|
| General | Done | startup behaviour, default opening page, default inbox, remember last inbox, default sending account, date format, time format, confirmations |
| Appearance | Done | theme, font size, density, sidebar labels, accent colour, message-list layout. Split reading pane pending |
| Email Accounts | Done | add/remove/edit, colour, servers, sync toggle, default sender. Test-connection and reauth pending |
| Inbox | Done | unified inbox, group by account, sorting, preview, mark-as-read, conversation grouping. Refresh interval pending sync |
| Follow-up | Done | default on/off, default schedule, stages, max stages, reminder time, working days, weekend behaviour, snooze default, overdue repeat. Reply detection pending Phase 3 |
| Notifications | Done *(pass 3)* | Desktop toggle, follow-up toggle, quiet hours (start/end), sound and frequency all drive real behaviour; each row now describes what it does |
| Composition | Done | signature, reply behaviour, Cc on reply-all. Rich text pending |
| Security & Privacy | **Partial** | Remote images / external content pending HTML rendering; app lock, DB encryption, retention pending Phase 6. AI off by default and labelled |
| Keyboard Shortcuts | Done | Reference lists all 12; the 3 that need message actions are marked with their phase |
| Storage & Sync | **Partial** | DB path shown; sync-on-startup and attachment path pending |
| About | Done | Version, platform, license, privacy statement |

## §12 Search

| Item | State | Notes |
|---|---|---|
| Local search over sender, recipient, subject, body | **Partial** | Client-side filter over loaded messages; tested. Server-side FTS query path not exposed yet |
| SQLite FTS5 | Done (schema) | `messages_fts` + triggers; migration test proves a match query works |
| Filters: account, date, read/unread, attachments, follow-up status, sender | **Missing** | Phase 3 |
| No external search services | Done | Nothing leaves the device |

## §13 Keyboard shortcuts

| Shortcut | State |
|---|---|
| C compose | Done, tested |
| R reply (follows `replyBehavior`) | Done, tested |
| A reply all | Done |
| F forward | Done |
| J / K navigate | Done |
| / focus search | Done |
| Esc close view | Done, tested |
| Ctrl/⌘+Enter send | Done (send itself is Phase 3) |
| Ctrl/⌘+Shift+F toggle follow-up | Done, tested |
| E archive, Delete, S star | **Missing** — need message actions; shown in Settings with their phase |
| Customizable shortcuts | **Missing** — Phase 5 |

## §14 Synchronization

**Missing entirely** (Phase 3). Nothing is implemented: no initial or incremental sync, no IDLE,
no reconnection, no retry, no state reconciliation, no folder sync. What exists in its place:
the `sync_state` table, the dedupe index, `syncEnabled` per account, and an honest "Local data
only" indicator. The UI never claims to be up to date.

## §15 Optional AI

Done as a policy: disabled by default, provider selectable, no AI code path exists, no dependency
added, and nothing in the app requires it.

## §16 Database design

| Item | State |
|---|---|
| All 12 suggested entities | Done (accounts, folders, messages, conversations, attachments, drafts, followup_schedules/sequences/events, notifications, settings, sync_state) |
| Migrations, foreign keys, indexes, transactions | Done; migration tests assert cascades and constraints |
| Duplicate prevention | Done; tested |
| Per-account conversations (no subject merging) | Done; tested |
| Recovery mechanisms | Done for corrupt-database startup | `openDatabaseWithRecovery` quarantines the damaged file (renamed, never deleted) and rebuilds, with a dialog explaining what happened; 6 tests. Backup/restore is still Phase 6 |

## §17 Edge cases

| # | Case | State |
|---|---|---|
| 1 | Send + 3-day reminder | **Partial** — enabling tracking works and is tested; sending does not exist |
| 2–4 | Reply before reminder / reminder stops / no reply | **Missing** — needs inbound sync |
| 5 | Reminder becomes due | Done — `deriveTimingStatus`, tested |
| 6–7 | User sends follow-up, next stage scheduled | **Partial** — `advanceOnFollowUpSent` implemented and tested in isolation; no send path calls it yet |
| 8–9 | Reply after follow-up stops the rest | **Missing** — needs reply detection |
| 10 | Snooze | Done, tested |
| 11–12 | Closed when due, reopen detects overdue | **Partial** — timestamps-based design; the startup pass lands in Phase 4 |
| 13 | Similar subjects across accounts | Done, tested |
| 14 | Same message synced twice | Done at schema level, tested |
| 15 | Disable follow-up | Done, tested |
| 16 | Change the schedule | Done, tested |
| 17 | Reply using another account | **Partial** — account switching in the composer works; cross-account reply detection does not |
| 18 | Out-of-office response | **Missing** |
| 19–20 | Provider auth expires / connection lost | **Partial** — status shown; no connection exists yet |
| 21 | Delete an account | Done, tested (cascade) |
| 22 | Restore a backup | **Missing** — Phase 6 |
| 23 | Timezone change | **Partial** — dates stored as ISO; no explicit test |
| 24 | Working-day preference change | Done, tested |
| 25 | Due during quiet hours | Done — deferred to the close of the window; the follow-up stays visible in the list meanwhile. Tested at both the planner and repository level |

## §18 Testing

| Area | State |
|---|---|
| Database operations | Done (11 migration + 7 folder-parity + 11 follow-up tests) |
| Follow-up scheduling and stages | Done (10 scheduler tests incl. the spec chain) |
| Unified inbox aggregation / account filtering | Done (jsdom App tests) |
| Settings persistence | Done |
| Security-sensitive IPC | Done — 29 tests assert malformed payloads, unknown keys, enum violations, out-of-range ports/limits and oversized ids are rejected or stripped |
| Conversation threading | **Partial** — collapsing tested; real header-based threading is Phase 3 |
| Notification scheduling | Done — 29 planner tests + 20 repository tests, including dedupe across restart |
| Reply detection, duplicate sync, offline, sync recovery | **Missing** — need Phase 3 |
| End-to-end against real provider accounts | **Missing** — Phase 2/3 |

## §19 Roadmap status

| Phase | State |
|---|---|
| 1 Foundation | **Done and verified** |
| 2 Account management | **Partial** — IMAP/SMTP accounts only; no OAuth, no connection test |
| 3 Email functionality | **Missing** |
| 4 Follow-up engine | **Partial** — creation, stages, statuses, list, quick actions, schedules and the reminder/notification engine done; reply detection still needs Phase 3 |
| 5 Settings and polish | **Partial** — settings complete and honest; accessibility audit, split pane, custom shortcuts pending |
| 6 Production | **Missing** — packaging config only; no installer built |

---

## Summary

**Working end to end today:** first-launch routing, IMAP/SMTP account management with encrypted
credentials, unified and per-account inboxes, conversation reading with threading, local search
over loaded mail, drafts, the composer with one-click follow-up, follow-up tracking with real
scheduling maths, the Follow-ups list with quick actions, and the full settings surface with
theme/density/format wiring.

**Not working yet, and labelled as such in the UI:** sending and receiving mail, OAuth,
synchronization, reply detection, attachments, rich text, HTML rendering, backup, packaging.

**No known inaccuracies remain in the Phase 1 scope.** The three gaps this audit found in the
follow-up surface (restore default schedule, per-item edit schedule, IPC rejection tests) were
fixed and tested in the same pass.

Everything still missing belongs to Phase 2/3/4/6 and is either labelled in the UI with the phase
that delivers it, or listed in `docs/decisions.md` with a concrete plan.

---

## Second audit pass — defects found in code written during the first pass

Re-checked on the same day, this time hunting specifically for defects in the newest code rather
than confirming what was already believed. Seven real problems, all fixed and covered by tests.

| # | Defect | Severity | Fix |
|---|---|---|---|
| 1 | **No CSP in the packaged app.** The policy was installed only via `session.webRequest.onHeadersReceived`, which does not reliably fire for `file://` loads — how the production app is served. `index.html` had no policy at all. | High (security) | Strict CSP injected as a `<meta>` tag at build time by a Vite plugin; verified present in `dist/renderer/index.html`. Header policy kept for dev, where HMR needs it |
| 2 | **Phantom drafts.** With a default signature configured, merely opening the composer saved a draft 800 ms later: the signature prefill changed `body`, which was an autosave dependency. | Medium (data) | Autosave now requires a real user edit (`touched` gate on every control). Regression test written first and watched fail |
| 3 | **Invalid nested interactive element.** The draft row was a `<button>` containing a `<span role="button">` delete control — invalid HTML, broken for keyboard and assistive tech. | Medium (a11y) | Row is now a container with two sibling `<button>`s; delete has an `aria-label` naming the draft |
| 4 | **No database recovery.** A corrupt or locked SQLite file threw during startup: no window, no message, no explanation. | Medium (reliability) | `openDatabaseWithRecovery` renames the damaged file (plus `-wal`/`-shm`) with a `.corrupt-<timestamp>` suffix, rebuilds, and shows a dialog naming the quarantined files. Data is never deleted. 6 tests |
| 5 | **`will-navigate` allowed any `file://` URL**, so a crafted link could open arbitrary local files inside the app window. | Medium (security) | Navigation is confined to the renderer directory, resolved with `fileURLToPath` so Windows drive-letter URLs work |
| 6 | **Theme flash on launch.** The window background was hardcoded to the light colour, so dark-theme users saw a white flash. | Low (polish) | Background derived from the stored theme (or `nativeTheme` when on System), and updated on OS theme changes |
| 7 | **Race in the reading pane's follow-up lookup.** Sequences were keyed into a map by conversation with last-write-wins, so a re-enabled conversation could display its cancelled sequence depending on array order. | Medium (correctness) | The map now prefers an active sequence over a terminal one, independent of order. Found because a test passed in isolation but failed in the full run — the test was also tightened, since it had been waiting on a string both states satisfy |

Also corrected while in there: the dev CSP header was being re-registered on every window
creation; it is now installed once at `whenReady`.

### What this changes about the earlier verdict

The feature inventory in the tables above stands — the missing subsystems (sync, OAuth, sending,
notifications, reply detection, attachments, packaging) are unchanged and still labelled in the
UI. But the first pass under-reported risk in two places it had marked Done: the CSP was not
actually enforced in a packaged build, and database recovery did not exist. Both are fixed now,
and both are the reason a second pass was worth running.

### Still unverifiable here

The Electron GUI cannot start in this sandbox (`libnspr4.so` missing), so the following are
verified by code and unit tests only, not by running the app: window creation, the CSP as
Chromium applies it to `file://`, `safeStorage` against a real OS keychain, the recovery dialog,
and `titleBarOverlay` behaviour on Windows. On a normal machine the first checks should be
`npm run rebuild && npm run dev`, then `npm start` with DevTools open to confirm the CSP reports
no violations, then corrupt a copy of `still.db` to watch the recovery path fire.

---

## Third pass — the reminder engine (spec §6.7, §17)

The previous two passes audited and repaired what existed. This one builds the largest remaining
piece that can be verified without a mail provider: **reminders**.

### Design rule

A reminder is a *derived fact*, never a scheduled callback. `planReminders` is a pure function of
stored timestamps plus the current time, so:

- closing Still loses nothing — the next scan re-derives the same answer;
- a reminder that fell due while the app was closed is raised on launch;
- nothing is raised twice, because each occurrence has a stable dedupe key that the database
  enforces with a partial unique index;
- a clock or timezone change cannot double-fire a reminder.

The 60-second interval in the main process is only a **poll**. If it never fired, the reminder
list would still be correct — only the desktop banners would lag. This is the property the spec
demands and the reason there are no `setTimeout` chains anywhere in the follow-up path.

### What was added

| Piece | File | Behaviour |
|---|---|---|
| Quiet-hours maths | `src/shared/notifications/quiethours.ts` | Local wall-clock windows, including midnight-crossing ones. An empty or unparsable window is treated as *off*, never as all-day silence, so a typo cannot suppress every reminder |
| Reminder planner | `src/shared/notifications/reminder-engine.ts` | Pure: repeat rounds, hourly/daily batching, overdue detection, dedupe keys, notification copy |
| Migration v2 | `src/main/database/migrations.ts` | `sequence_id`, `stage_index`, `due_at`, `dedupe_key`, `deliver_at`, `delivered_at` on `notifications`, plus a unique dedupe index and delivery/pending indexes |
| Repository | `NotificationRepository` in `repositories.ts` | `scan`, `readyToDeliver`, `markDelivered`, `list`, `unreadCount`, `markRead`, `markAllRead`, `remove`, `removeForSequence` |
| IPC | 6 new channels | `notifications:scan|list|unreadCount|markRead|markAllRead|dismiss`, each validated with zod |
| Delivery | `src/main/index.ts` | Electron `Notification` banners gated on the user's preferences; marked delivered even when banners are off, so a disabled preference cannot re-raise the same reminder every tick |
| UI | bell in `TopBar.tsx` | Unread badge, popover list, open-conversation, dismiss, mark-all-read, Escape/outside-click to close. Overdue reminders render in the danger colour |
| Preview parity | `services/api.ts` | The browser preview runs the *same* pure planner, so tested behaviour matches the shipped app |

### Honesty correction

The Notifications settings section said: *"These preferences are stored now and consumed by the
notification engine, which arrives in Phase 4… Until then Still does not raise desktop
notifications."* That was accurate when written and became **false** with this pass, so it was
rewritten. The `pending=` note on "Overdue reminder repeat" was removed, and all seven
notification controls now carry a description of what they actually do. Twelve `pending=` notes
remain in Settings, all for genuinely future work (language, refresh interval, sync on startup,
attachments path, rich text, remote images, external content, app lock, DB encryption, retention,
reply detection, auto-reply handling).

### A bug this pass caught in its own new code

`better-sqlite3`'s `db.transaction(fn)` **returns** a function; it does not run it. The first
version of `scan` built the transaction and never called it, so every insert was silently
discarded and `scan` always returned an empty list. Twenty repository tests failed on the first
run and the defect was traced with a scratch script rather than guessed at. Both call sites are
fixed, and the restart-survival tests would now fail loudly if the pattern regressed.

### Test coverage added

- `reminder-engine.test.ts` — 29 tests: quiet hours (midnight-crossing, same-day, disabled,
  unparsable, empty), deferral never moving earlier, repeat rounds, hourly/daily batching,
  overdue boundary, and an assertion that `isOverdue` agrees with `deriveTimingStatus` so a list
  row and its banner can never contradict each other.
- `repositories.notifications.test.ts` — 20 tests: due/not-due, idempotency, excluded statuses,
  cleared due times, quiet-hour deferral, digest batching, repeats, multi-conversation,
  recipient naming, delivery and read state, dismissal, limit clamping — plus three
  **restart-survival** cases against a real file database: reopen after close, relaunch days
  later, and a simulated crash that leaves WAL sidecars on disk.
- `App.test.tsx` — 7 new UI tests: badge on launch, reminder contents, no duplication across a
  relaunch, open-and-mark-read, dismiss, mark-all-read, Escape.

**Total at the end of this pass: 196 tests across 12 files.** Typecheck clean on both TS projects; production
build succeeds (`dist/main/index.cjs` 184.5 kb, `dist/preload/index.cjs` 2.7 kb).

### What is still missing here

OS banners themselves cannot be observed in this sandbox — Electron will not start
(`libnspr4.so`). The banner path is verified by review and by the repository tests that decide
*what* is ready to deliver; the `new Notification(...)` call is not executed by any test. On a
real machine, set a follow-up due one minute out, quit Still, wait, relaunch, and confirm the
banner appears once and only once.

---

## Fourth pass — time-fragility, dead code, and two behaviour gaps

This pass re-ran everything and then attacked the two things the earlier passes could not see:
assertions that depend on **when** the suite runs, and exports that nothing consumes.

### 1. Four tests were time-fragile — they passed in the afternoon and failed the next morning

Found by running the suite under five timezones spanning UTC−11 to UTC+14, and by the sandbox
clock rolling past midnight mid-session.

| Test | Why it broke | Fix |
|---|---|---|
| 2 renderer reminder tests | The sample data anchors due times to fixed clock hours (`daysAgoIso(0, 8)` = "today at 08:00"). Run at 07:46 and nothing is due; run in the afternoon and it is. Whether an item counted as *overdue* flipped with the time of day | Seeded their own fixtures using **elapsed-hour offsets** from `Date.now()`, which are stable at any hour |
| 2 repository reminder tests | Quiet hours and the daily digest are **local wall-clock** concepts, but the fixtures were anchored to UTC strings. `23:00Z` is 18:00 in New York and 12:00 in Kiritimati, so it fell outside the 22:00–08:00 window entirely | Added a `local(day, hour, minute)` helper and built those fixtures in local time, then asserted on `deliverAt`'s local hours so the intent is explicit |

Both classes are now proven, not assumed: the full suite passes under **UTC, Asia/Dhaka,
America/New_York, Pacific/Midway, Pacific/Kiritimati and Australia/Sydney**, and the reminder
tests were re-run under each after the fix.

This matters beyond the test suite. The product decision underneath it — quiet hours are local
wall-clock, due/overdue comparisons are absolute instants — is now pinned by tests in both
directions, so a future refactor cannot silently swap one for the other.

### 2. Two behaviour gaps in code written during pass 3

| Gap | Effect | Fix |
|---|---|---|
| Turning tracking off did **not** clear that conversation's reminders in Electron | The bell kept offering a reminder for a conversation the user had stopped tracking. The browser preview filtered them, so preview and desktop **disagreed** — breaking the parity the docs claimed | `NotificationRepository.removeForConversation`, called from the `followups:disable` handler. `removeForSequence` (written in pass 3 and never called by anything) was replaced by it |
| Changing a schedule left a pending reminder carrying the **old** due time | The bell would report a stale "due Xh ago" after the user moved the date | `removePendingForSequence` on `followups:setSchedule` — drops reminders not yet shown so the next scan re-derives them, and keeps ones already delivered, since a banner the user has seen is history rather than something to repeat. Mirrored in the preview API |

Also fixed: clicking a reminder for an untracked conversation only set the selection, so from
Settings or Follow-ups — where the mail pane is not on screen — the click visibly did nothing. It
now navigates to a folder that can show the conversation first. Both gaps have UI tests.

### 3. Dead code removed

Verified to have **zero references anywhere**, including tests, before deletion:

- `silencedAt`, `deliveryTimeFor` — thin wrappers added in pass 3 and never called.
- `startOfDay`, `formatDayLabel` — date helpers with no consumer; the message list has no day
  separators, and keeping a helper that implies an unbuilt feature makes audits noisy.
- `ChevronDownIcon`, `StarIcon`, `FlagIcon`, `MailIcon`, `LockIcon` — `Select` is a native
  `<select>`, which draws its own arrow, and the star/flag message actions are Phase 3. A comment
  in `icons.tsx` records that their absence is deliberate. Icon exports: 26 → 23.

Deliberately **kept**: `advanceOnFollowUpSent` and `completeOnReply` are referenced only by tests,
but they are the documented Phase 3 seams for reply detection and stage advancement, and §17 of
this audit already says so.

### 4. What this pass says about the earlier verdicts

Passes 1–3 each reported a clean suite, and each was wrong in a different way: pass 1 missed a
security control it had marked Done, pass 3 shipped a transaction that never executed and tests
that only passed at certain hours of the day. The lesson applied here is that a green suite is
evidence about *this machine at this time*, so the checks now include a timezone matrix and a
dead-reference scan alongside typecheck, tests and build.

**Still unverifiable in this sandbox:** Electron will not start (`libnspr4.so`), so OS banners,
`safeStorage` against a real keychain, the CSP as Chromium applies it to `file://`, the recovery
dialog and Windows `titleBarOverlay` remain verified by review and unit tests only.

### 5. A security claim from pass 1 was false: `drafts:save` was never validated

Pass 1 recorded *"zod `parseOrThrow` on every writable channel"* as Done. Auditing the claim
mechanically — parsing each `ipcMain.handle` block and checking whether it takes arguments and
whether it calls `parseOrThrow` — showed one exception:

```ts
// before
ipcMain.handle('drafts:save', (_event, input: unknown) => {
  if (typeof input !== 'object' || input === null) {
    throw new Error('Invalid IPC request: draft must be an object');
  }
  return s.drafts.save(input as Parameters<DraftRepository['save']>[0]);
});
```

Any object at all passed that check, then went through an unchecked cast into the repository and
into SQL parameters: arbitrary extra keys, `createdAt`/`updatedAt` the caller should never own,
unbounded strings, wrong types. Drafts are written by an 800 ms autosave on every keystroke, so
this is the most frequently called writable channel in the app.

Now validated by `saveDraftSchema`: bounded address lists (100 entries, 320 chars each), subject
(1000), body (1 MB — generous but not an upload channel), interval range, id lengths, and unknown
keys **stripped** rather than persisted. 9 new tests cover it, including the strip behaviour, which
is easy to get wrong: zod removes unknown keys by default, so a test asserting "rejects unknown
keys" would have been asserting the opposite of the truth.

Mechanical re-audit after the fix:

```
total channels: 28   writable (take input): 19   read-only: 9
writable without validation: NONE
handled but never invoked by preload: none
invoked but not handled (would throw at runtime): none
```

The channel count also corrects an earlier figure: it is **28**, not the 21 and 26 previously
recorded. Both earlier counts came from a regex that only matched single-line `ipcMain.handle('…'`
calls and silently skipped the multi-line ones.

### Pass 4 totals

```
typecheck   clean (both TS projects)
tests       211 passed / 12 files — stable over repeated runs
timezones   211 passed under UTC, Asia/Dhaka, America/New_York,
            Pacific/Midway (UTC-11) and Pacific/Kiritimati (UTC+14)
build       dist/main 186.0 kb · dist/preload 2.7 kb
IPC         28 channels · 19 writable · all validated · preload parity exact
settings    54/54 fields surfaced · 12 remaining pending= notes, all future-phase
invariants  0 shadow/lg-radius utilities · 0 handler-less buttons ·
            0 dangerouslySetInnerHTML · 0 network calls in main/preload
```

### 6. Tightening validation exposed a latent bug in the composer

Adding `saveDraftSchema` was not free: zod *rejects* what the old unchecked cast silently
accepted. The custom follow-up interval input clamped its lower bound but not its upper one —
`max={365}` on a number input only steers the spinner, it does not constrain the value — so typing
`9999` produced an interval the new schema refused. Because draft autosave treats errors as
best-effort and swallowed them, the failure mode would have been a draft that silently stopped
saving.

Three fixes, so the UI and the wire format cannot disagree:

- `MIN_FOLLOWUP_INTERVAL_DAYS` / `MAX_FOLLOWUP_INTERVAL_DAYS` in `shared/constants.ts` are the
  single source of truth, used by both the IPC schemas and the composer's clamp.
- The composer now clamps both ends and rounds, and a cleared field yields `1` rather than `NaN`.
- A failed autosave sets a visible "Draft not saved." notice instead of failing silently. A draft
  the user believes is stored is worse than an error message.

Two renderer tests cover it end to end: typing `9999` clamps to `365` **and** the draft is actually
persisted; typing `0` and then clearing the field both clamp to `1` and persist.

---

## Fifth pass — found by a real install failure on Windows

A user ran `npm run rebuild` on Windows and hit:

```
Error: Could not find any Visual Studio installation to use
```

That is not a user environment problem. It is a **defect in `package.json`**, and the audit had
never covered it because no earlier pass tried to install the project on a clean machine.

### Root cause: `"electron": "latest"`

Three devDependencies were declared as `"latest"` — `electron`, `electron-builder` and
`electron-rebuild`. `latest` resolved to Electron **45.3.3**, whose ABI is **150**.

`better-sqlite3` publishes prebuilt binaries per ABI. For 12.11.1 the newest Electron prebuild is
**ABI 146**, and the newest release (13.2.0) ships **no Electron prebuilds at all**. So no version
of `better-sqlite3` has a binary for ABI 150 — `prebuild-install` finds nothing, falls through to
`node-gyp`, and node-gyp needs a C++ toolchain. On Windows that means Visual Studio Build Tools.

The chain only becomes visible when you know to check the ABI table:

| Runtime | ABI | Prebuilt? |
|---|---|---|
| Node 20 | 115 | **no** — must compile |
| Node 22 | 127 | yes |
| Electron 42 | 146 | yes |
| Electron 43/44/45 | 148/149/150 | **no** — must compile |

Two independent pins were wrong: Electron was too new for any prebuild, and Node 20 is too old for
one either. A clean Windows machine on Node 20 would have had to compile **twice**.

### Fix

- `electron` pinned to **42.11.18** (ABI 146 — prebuilds exist for win32 x64/ia32/arm64, darwin
  and linux). `electron-builder` pinned to 26.18.0. The deprecated `electron-rebuild` shim was
  replaced by `@electron/rebuild` ^4.2.1, which provides the same binary.
- `engines.node` raised from `>=20` to **`>=22.12.0`** — Node 22 is ABI 127 (has a prebuild), and
  22.12.0 is what Electron 42 itself requires, so the two constraints now agree instead of
  producing an `EBADENGINE` warning.
- New `scripts/rebuild-native.mjs`, wired to `npm run rebuild` (Electron ABI) and
  `npm run rebuild:node` (Node ABI). It prints the resolved runtime and ABI, **downloads the
  prebuild first**, and only compiles when no prebuild exists — printing the exact platform
  toolchain command when it does. For the Node direction it loads the module and runs a query to
  prove the ABI matches.

The split into two commands is necessary, not cosmetic: only one binary can exist at a time, so
`npm test` (plain Node) and `npm run dev` (Electron) need opposite builds. Before this, running the
app silently broke the test suite with a `NODE_MODULE_VERSION` error and nothing explained why.

### Verified, not assumed

Both directions were executed end to end:

```
npm run rebuild        → runtime electron 42.11.18 (ABI 146)
                         "Trying prebuilt binary (no compiler needed)…"
                         ✔ Prebuilt binary in place — nothing was compiled.  (2113 kb)

npm run rebuild:node   → No prebuild for node ABI 115 on linux-x64.
                         Falling back to compiling from source…
                         ✔ Compiled from source.  (2188 kb)
                         ✔ Verified: loads under Node 20.20.2 and runs a query.
```

The Electron download is therefore proven to need **no compiler**. The compile fallback was
exercised too, because this sandbox runs Node 20 — deliberately kept, since it is the worst case.

Two bugs were found and fixed in the script while verifying it: a top-level `return` (illegal in an
ES module), and a fallback that shelled out to `node_modules/.bin/electron-rebuild`, which npm had
**not** linked — it now resolves `@electron/rebuild/lib/cli.js` through `require.resolve`.

Also confirmed by direct test: swapping in the Electron-ABI binary makes `new Database()` throw
`NODE_MODULE_VERSION 146 … requires 115`, which is the exact failure users would otherwise see as a
blank window.

### What this says about the audit method

Every earlier pass verified the project **from inside an already-installed workspace**. Nothing in
that position can detect an unpinned dependency, because the damage is done at install time on
someone else's machine. The gap is now closed by pinning and by documenting the ABI table, but the
lesson is general: `package.json` version ranges are behaviour, and `"latest"` is a dependency on
whatever the registry happens to serve today.

Remaining unverified: the Windows toolchain path itself (no Windows machine here) and
`npm run dist` / electron-builder packaging, which is still Phase 6.

---

## Sixth pass — what "production" exposed (packaging)

The user rejected the browser preview: *"this is preview I want production."*
Phase 6 (packaging) had never been exercised. Four real defects, all fixed.

| # | Defect | Evidence | Fix |
|---|---|---|---|
| 6.1 | **Packaging shipped a wrong-ABI native binary.** `electron-builder.yml` sets `npmRebuild: false`, so electron-builder packages whatever `better_sqlite3.node` is on disk. Reproduced: `--linux dir` right after a test run embedded the Node-ABI-115 binary; Electron 42 needs ABI 146 → installer crashes on first launch. | Packed binary loaded under Node (= ABI 115) while `node-abi` reports Electron 42.11.18 = 146. | `dist`, `dist:win`, `dist:linux` now run `npm run rebuild` between `build` and `electron-builder`; `docs/packaging.md` documents the trap. |
| 6.2 | **No app icon existed** → default Electron icon on taskbar/installer. | `find` for `*.ico`/`*.icns`/`icon*.png` empty; no `build/` dir. | `build/icon.png` (1024×1024) added; `directories.buildResources: build`. Verified the Windows build consumed it. |
| 6.3 | **Native module not explicitly unpacked.** Relied on electron-builder's auto-detection of `.node` files. | Auto-unpack worked, but only by convention. | `asarUnpack: ["**/*.node"]` made explicit; verified at `resources/app.asar.unpacked/…`. |
| 6.4 | **Installer config defaulted to a silent per-machine install** and every artifact shared one misleading name (`Still-Setup-…` even for the zip). | Default `oneClick: true`, `perMachine` unset. | `nsis: oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true, deleteAppDataOnUninstall: false`; per-target `artifactName`s; `publish: null` (no update server, spec §3). |

### Verified end-to-end in this sandbox (Linux host)

- `npx electron-builder --win --x64` built the complete Windows app tree
  (Electron 42.11.18 win32-x64): `Still.exe` with generated icon + asar
  integrity resource, `app.asar` containing `dist/main`, `dist/preload`,
  `dist/renderer` **with the production CSP `<meta>` and bundled fonts**, and
  `app.asar.unpacked` holding the native module.
- Packaged `better_sqlite3.node` **SHA-256 identical** to the ABI-146 source
  (`addaad40515979837257d538c3aa76571946582485fdd2f2f16b742d526ea23f`).
- `--win zip` → `release/Still-0.1.0-win-x64.zip` (145 MB, 146 entries).
- Suite restored afterwards: `rebuild:node` → **211/211 tests pass**.

### Not verifiable here (sandbox limits, not config defects)

- The **NSIS installer executable** cannot be produced on Linux without
  **wine** (`wine process failed ENOENT` after the app tree was built).
  On Windows this step runs natively — the user's `npm run dist:win` is the
  authoritative build; `docs/packaging.md` carries the checklist.
- Running the packaged `Still.exe` (no Windows, no GUI in this sandbox).
- Code signing: none configured; first launch shows SmartScreen's
  unsigned-publisher warning by design.

### Addendum to pass 6 — icon replaced with the supplied brand mark

The AI-generated placeholder icon was replaced by the user-supplied SVG
(`build/icon.svg`): rasterized to `build/icon.png` at 1024×1024 with
transparent rounded corners, re-packaged, and verified — the regenerated
`icon.ico` contains 7 frames (16–256 px) of the new artwork and `Still.exe`
embeds it. The same SVG now also ships as the renderer favicon
(`src/renderer/public/icon.svg` → `dist/renderer/icon.svg` inside the asar).
Suite after the change: 211/211.
