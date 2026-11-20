# Spreadsheet automation

Open **Productivity → Automation** in the desktop app.

1. Choose a CSV or `.xlsx` file (up to 5 MB, 1,000 data rows, 200 columns). Legacy `.xls` is not supported. The first row supplies headers; Excel uses the first sheet. On successful import the **original file bytes and parsed cells are saved immediately in SQLite**, before building a queue. An import failure keeps the previously saved workspace.
2. Map the email, subject and body columns, then **Build queue**. Mapping selections are saved too.
3. Choose the sending account, daily maximum and interval. Daily limits start at 1, not 0. Enable **Track follow-ups** to use your default follow-up schedule for these messages.
4. Click **Send mail** on any valid pending row to send that particular email. No checkbox is required for per-row sending. Or select multiple rows and use **Send next** / **Start automatic sending**.
5. Inspect **Done**, sent dates and **Follow-up active** badges. Click a message subject to expand its full body before sending.

## Saved workspace and progress

The latest original spreadsheet, parsed table, mapping, queue, selection and sending preferences survive tab changes and application restarts. Open **Manage spreadsheet** to change the mapping or replace the file. Still retains one active spreadsheet workspace, not a multi-file archive. Replacement asks for confirmation. Do not delete the original on your computer if you need an independent backup.

In the desktop app, data is in the local SQLite database. Original file bytes are a BLOB; delivery attempts and counters are recorded separately from the active queue. Clearing/replacing/rebuilding a queue does not delete delivery history or reset daily limits. The old localStorage queue is migrated on first successful load where possible. Original bytes from old imports cannot be recovered if they were never stored.

The progress summary displays **Done in this queue**, **Ready to send**, **Sent today**, and **Automation sends · all time**. The latter two include matching sent history reconciled from local messages. Sent history is retained when clearing the workspace. Counts refer to known locally recorded deliveries, not provider-wide statistics.

## Matching previous sends and follow-ups

Still compares queued rows with local outbound messages using **the selected sending account, recipient (case-insensitive), exact subject and trimmed plain-text body**. A match is marked **Done**, with its send date and current follow-up status. It cannot be sent again from that row. Re-importing the same data does not reset those matches. Matching history is reflected in the daily/lifetime counters once, not on every refresh.

Matching deliberately does not rely on recipient alone: a genuinely different message to the same person must not be marked done accidentally. Messages with different subjects, signatures or body formatting may not match. Follow-up status is refreshed when you return to Automation and periodically while it is visible or running.

## Execution and recovery

- Sending uses the main process and SQLite. Claims, daily attempts and intervals are enforced there, not only in the interface. Sends are serial; all per-row and bulk actions share the same limits. Attempts, including failures and reconciled known sends, conservatively count toward the daily cap.
- Still must remain open for automatic sending. Navigating away does not stop it. Pause allows an already-started SMTP send to finish. Restart always requires explicit confirmation to resume.
- Failed or interrupted sends require review and are never retried automatically. SMTP acceptance can be ambiguous: inspect Sent and your provider before starting a replacement send. Provider delivery is not exactly-once guaranteed.
- At the daily cap, automatic mode waits for the next local calendar day. Intervals are minimum delays, not exact deadlines. Device sleep can delay delivery.
- SQLite content is local, but **not encrypted**; it includes imported spreadsheets, message content and send history. Browser preview persists parsed data in localStorage only and cannot send automation mail or save original file bytes in SQLite.
- Automation sends initial messages only. Follow-up tracking creates reminders, not automatic follow-up replies.

Only send to recipients who expect your mail and respect your provider's sending rules.

## Local Trash

Inbox and reading-pane actions move whole conversations to local Trash and restore them. They do not move/delete provider-side mail. Permanent deletion and individual-message deletion are not implemented.
