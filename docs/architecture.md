# Architecture

## Processes and boundaries

```
┌──────────────────────────────┐      ┌──────────────────────────┐
│ Renderer (React, sandboxed)  │      │ Main process (Node)      │
│                              │      │                          │
│ components ── hooks ── api.ts│─IPC─▶│ ipc/handlers.ts          │
│                              │      │   ├─ security/validation │
│ No Node APIs. No direct DB.  │      │   ├─ database/repos      │
│ No network access to mail.   │      │   ├─ security/credentials│
└──────────────────────────────┘      │   └─ (Phase 3) email/    │
            ▲                         │        synchronization/  │
            │ contextBridge           │        notifications/    │
┌───────────┴──────────┐              └───────────┬──────────────┘
│ Preload (window.still)│                         │
│ typed surface only    │                 ┌───────▼────────┐
└──────────────────────┘                 │ SQLite (local) │
                                         │ + OS keychain  │
                                         └────────────────┘
```

Four rules hold the boundaries together:

1. The renderer reaches the outside world **only** through `window.still`, the typed object the
   preload script exposes with `contextBridge`. `contextIsolation: true`,
   `nodeIntegration: false`, `sandbox: true`.
2. Every IPC argument is validated in the main process with zod
   (`src/main/security/ipc-validation.ts`) before it touches the database. Invalid input throws
   rather than being coerced.
3. Business logic lives in `src/shared/` (pure, tested) or in `src/main/` (stateful). Renderer
   components present state and dispatch intent; they do not compute schedules, thread rules or
   folder semantics.
4. All persistence is local: one SQLite database in the Electron `userData` directory, plus
   credentials encrypted by `safeStorage` in the OS keychain.

## Shared kernel (`src/shared/`)

Types, constants and pure functions used by both processes:

- `types.ts` — domain types (`Account`, `Message`, `Conversation`, `FollowUpSequence`,
  `FollowUpListItem`, `Settings`, …), the `FolderFilter` vocabulary, and `StillAPI`, the contract
  the preload implements and the renderer consumes. Because `StillAPI` is a typed interface, the
  preload, the main handlers and the preview implementation cannot drift apart silently —
  `npm run typecheck` fails if they do.
- `constants.ts` — default settings, default follow-up stages `[3, 7, 15, 30]`, account colours,
  shortcut definitions (each marked active or not), `ALL_INBOX`.
- `followup/scheduler.ts` — the follow-up engine's core rules.
- `utils/dates.ts` — calendar-day and working-day arithmetic, relative and full date labels.
- `utils/messages.ts` — list shaping: sorting, conversation collapsing, unread rollup, account
  partitioning, folder membership, local text matching.
- `utils/navigation.ts` — startup folder resolution and the sidebar-folder → query translation.

Keeping these pure is what makes the follow-up rules and the inbox rules testable without
Electron, and it means the browser preview and the desktop app share one implementation of the
logic that matters.

## Data layer (`src/main/database/`)

- `migrations.ts` — ordered, versioned migrations recorded in `schema_migrations`. Applied
  migrations are never edited; changes are added as new migrations.
- `db.ts` — `DatabaseService`: opens the database, sets `journal_mode = WAL`,
  `foreign_keys = ON`, `synchronous = NORMAL`, runs migrations, seeds the default follow-up
  schedule.
- `repositories.ts` — one repository per aggregate (settings, accounts, schedules,
  messages/conversations, follow-ups, drafts). Repositories map snake_case rows to camelCase
  domain types and run multi-statement changes inside transactions.

Schema highlights:

- `messages` is deduplicated by a partial unique index on `(account_id, provider_message_id)`,
  so synchronising the same message twice cannot create duplicates.
- Threading columns (`message_id_header`, `in_reply_to`, `references_header`, `thread_id`) are
  stored per message; `conversations` is per **account**, so identical subjects in two accounts
  can never merge.
- `followup_sequences` holds one active sequence per conversation with `current_stage`, `status`,
  `last_sent_at`, `next_due_at`, `snoozed_until`. `followup_events` is an append-only history, so
  cancelling or completing a sequence preserves what happened.
- `credentials` stores `(account_id, kind, ciphertext)` only. There is no plaintext column
  anywhere in the schema.
- `messages_fts` is an FTS5 external-content table kept in step with `messages` by
  insert/update/delete triggers.

## Security layer (`src/main/security/`)

- `credentials.ts` — wraps Electron `safeStorage`. Passwords and (later) OAuth refresh tokens are
  encrypted with the OS-backed key and stored as ciphertext; `isAvailable()` reports platforms
  where the keychain is unavailable so callers can refuse rather than fall back to plaintext.
- `ipc-validation.ts` — zod schemas for every writable IPC channel: settings patches, account
  input, schedule stages (1–365 days, max 20 stages), message list options, follow-up status,
  ids. Handlers call `parseOrThrow`, so malformed renderer input is rejected at the boundary.
- Window hardening in `main/index.ts`: strict CSP installed via `onHeadersReceived`
  (`default-src 'self'`, no remote script or connect origins in production), `will-navigate`
  restricted to the app's own origin, `setWindowOpenHandler` allowing only `https:` and routing
  it to the system browser, and a single-instance lock.

Email HTML is not rendered yet. When Phase 3 renders message bodies it must sanitise first, keep
`blockRemoteImages` enforced by rewriting or stripping remote origins, and never allow script
execution — the CSP already denies remote content as a second line of defence.

## Follow-up engine

Rules (implemented in `shared/followup/scheduler.ts`, persisted by `FollowUpRepository`):

- The first reminder is due `stage[0]` days after the original send.
- Every later reminder is due `stage[n]` days after the **actual send time of the previous
  follow-up**, never after the original email.
- A stage advances only when the user sends a follow-up. A reminder becoming due does not advance
  anything.
- A qualifying reply completes the sequence and cancels pending reminders; history is preserved.
- Working-day or calendar-day counting is a per-settings choice; weekend behaviour is configurable.

Statuses: `scheduled`, `due`, `overdue`, `waiting`, `replied`, `completed`, `snoozed`,
`cancelled`.

Reminders must survive the app being closed. That means due/overdue state is derived from stored
timestamps on startup rather than from live timers — the recalculation pass and the notification
engine arrive with Phase 4's synchronisation work, using the `notifications` table that already
exists in the schema.

## Renderer

- `services/api.ts` — the single data-access point. In Electron it delegates to `window.still`.
  In a browser it uses a separated, localStorage-backed preview implementation seeded with sample
  data. Both satisfy `StillAPI`.
- `hooks/useSettings.tsx` — settings context; reads once, writes through, keeps the UI optimistic
  and reconciles with what the main process persisted.
- `components/` — presentational, flat, separator-driven. No card containers, no dashboard.
- `App.tsx` — routing (setup vs mail vs follow-ups vs settings), theme/density/accent token
  application, global shortcuts, selection state, resizable list column.

Selection keeps **both** a message id and a conversation id. They are different identifiers: the
list highlights a message, the reading pane loads a conversation. Conflating them was an early
bug and is now covered by a regression test.

## Testing strategy

- Pure shared logic: unit tests (scheduler, dates, messages, navigation).
- Main process: SQLite-backed integration tests against `:memory:` databases (migrations,
  repository behaviour, SQL/pure parity for folder semantics).
- Renderer: jsdom integration tests that render the real `App` against the preview data layer and
  exercise real user paths (first launch, aggregation, filtering, opening threads, composing,
  follow-up quick actions, settings changes) — asserting both DOM outcome and persisted state.
- Provider integration tests (real IMAP/SMTP/OAuth accounts) are not possible yet; they arrive
  with Phase 2/3 and must include the edge cases listed in the specification §17.
