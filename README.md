<div align="center">

# Still

### A quieter place for email.

A considered desktop email experience, built around privacy, focus and thoughtful follow-up.

**Local-first · No telemetry · Follow-up on your terms**

[The experience](#the-experience) · [Privacy](#private-by-design) · [Get started](#get-started) · [Development](docs/development.md)

</div>

---

Email deserves your attention. Not all of it.

Still is being built for people who value a calm workspace and intentional communication. A refined three-column layout keeps accounts, conversations and reading in view. Thoughtful reminders help you return to the conversations that matter—without handing over control of what gets sent.

> **In active development · v0.1.0**<br>
> The interface, local storage and follow-up reminder engine are implemented. Live email synchronisation, sending, attachment handling and Google/Microsoft OAuth are not yet available. Still is not ready to replace your everyday email client.

## The experience

### Room to focus

A restrained interface with Manrope typography, light and dark themes, and adjustable density, font size and accent colour. Shape the workspace around the way you read and work.

### Follow through, thoughtfully

Keep follow-ups in one dedicated view. Set a schedule, snooze a reminder, switch cadence or mark a conversation complete. Quiet hours and hourly or daily digests let reminders fit around your day.

**Still reminds you. It never sends a follow-up for you.** Live reply detection will arrive with email synchronisation.

### Your workspace, your preferences

Account management, unified-inbox preferences, conversation grouping, sorting and saved settings form the foundation of a personal workspace. Explore the interface with sample conversations in browser preview mode while live mail support is in development.

## Private by design

Privacy is an architectural choice, not an optional mode.

- **No Still account.** No separate sign-up or Still cloud backend.
- **Local-first storage.** Mail data, drafts, schedules and settings use a local SQLite database in the desktop app.
- **Protected credentials.** Credentials use Electron’s OS-backed `safeStorage`; the app refuses plaintext storage when secure storage is unavailable.
- **No telemetry.** No analytics pipeline or update server.
- **A direct connection model.** Account settings are designed for your provider’s IMAP and SMTP servers, without a Still relay. Live transport is still in development.

Local-first does not mean a fully encrypted database. Credentials are encrypted separately; a security audit, backup and restore, and automatic updates remain planned work. See the [security notes](docs/development.md#security-notes) for implementation details.

## Get started

Requires **Node.js 22.12 or newer** and npm.

```bash
npm install
npm run rebuild
npm run dev
```

`npm run rebuild` prepares the native SQLite module for Electron. Before running tests under Node.js, switch it back with `npm run rebuild:node`.

### Explore the interface

```bash
npm run dev:renderer
```

Browser preview uses sample data stored in localStorage and is labelled **Preview**. It is for interface evaluation, not a connected email experience. OS notifications and secure credential storage require the desktop app.

### Development commands

| Command | Purpose |
| :--- | :--- |
| `npm run typecheck` | Check renderer, shared and main-process TypeScript |
| `npm run rebuild:node && npm test` | Prepare native SQLite for Node.js and run tests |
| `npm run build` | Build the renderer, main process and preload bridge |
| `npm run rebuild && npm start` | Prepare native SQLite for Electron, build and launch |
| `npm run dist` | Build and package desktop installers |

Read the [development guide](docs/development.md) for native-module troubleshooting, detailed implementation status and verification notes. Review the [packaging guide](docs/packaging.md) before creating a release. Packaging configuration is present; a production installer has not yet been verified.

## Built with intention

Electron · React · TypeScript · Vite · Tailwind CSS · SQLite

Business logic lives in the shared and main-process layers. The renderer presents state and dispatches intent through a validated preload bridge.

[Architecture](docs/architecture.md) · [Engineering decisions](docs/decisions.md) · [Development guide](docs/development.md) · [Packaging](docs/packaging.md)

---

<div align="center">

**Less noise. More intention.**

Still is proprietary software. All rights reserved.

</div>

## Spreadsheet automation

Use **Productivity → Automation** to import CSV or Excel (`.xlsx`), map email/subject/body columns, select rows, and send manually or automatically with daily and interval limits. See the [automation guide](docs/automation.md) for setup, local storage and delivery/recovery limitations.
