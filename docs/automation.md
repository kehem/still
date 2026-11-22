# Spreadsheet automation

Open **Productivity → Automation** in the desktop app.

1. Choose a CSV or `.xlsx` file (up to 5 MB, 1,000 data rows, 200 columns). Legacy `.xls` is not supported. The first row supplies headers; Excel uses the first sheet. On successful import the **original file bytes and parsed cells are saved immediately in SQLite**, before building a queue. An import failure keeps the previously saved workspace.
2. Map the email, subject and body columns, then **Build queue**. Mapping selections are saved too.
3. Choose the sending account, daily maximum and interval. Daily limits start at 1, not 0. Every successfully sent Automation email automatically starts follow-up tracking with the schedule selected in Settings → Follow-up. Its stage limit, working-day rules and reminder time apply too. No extra toggle is required.
4. Click **Send mail** on any valid pending row to send that particular email. No checkbox is required for per-row sending. Or select multiple rows and use **Send next** / **Start automatic sending**.
5. Inspect **Done**, sent dates and **Follow-up active** badges. Click a message subject to expand its full body before sending.

## Saved workspace and progress

The latest original spreadsheet, parsed table, mapping, queue, selection and sending preferences survive tab changes and application restarts. Open **Manage spreadsheet** to change the mapping or replace the file. Still retains one active spreadsheet workspace, not a multi-file archive. Replacement asks for confirmation. Do not delete the original on your computer if you need an independent backup.

In the desktop app, data is in the local SQLite database. Original file bytes are a BLOB; delivery attempts and counters are recorded separately from the active queue. Clearing/replacing/rebuilding a queue does not delete delivery history or reset daily limits. The old localStorage queue is migrated on first successful load where possible. Original bytes from old imports cannot be recovered if they were never stored.

The progress summary displays **Done in this queue**, **Ready to send**, **Sent today**, and **Automation sends · all time**. The latter two include matching sent history reconciled from local messages. Sent history is retained when clearing the workspace. Counts refer to known locally recorded deliveries, not provider-wide statistics.

## Matching previous sends and follow-ups

Still compares queued rows with **successful delivery records and local outbound messages**, scoped to the selected sending account and recipient. Matching normalizes subject case, Unicode composition, line endings, non-breaking spaces and repeated whitespace. The body must still match after normalization. The currently configured default signature may be omitted from either side. A match is marked **Done**, with its send date and current follow-up status. It cannot be sent again from that row. Re-importing the same data does not reset those matches. Matching history is reflected in the daily/lifetime counters once, not on every refresh.

Matching deliberately does not rely on recipient alone: a genuinely different message to the same person must not be marked done accidentally. Substantively different messages, edited wording or unrecognized signatures are not automatically marked done. Durable successful send records still count even if the local message was removed or the spreadsheet was rebuilt. Failed attempts never count as proof of delivery. Use **Refresh sent status** to recheck immediately. Follow-up status is refreshed when you return to Automation and periodically while it is visible or running. Detection uses data already stored on this device; it does not fetch provider Sent folders, and cannot discover mail that has never been recorded locally.

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


## Follow-up date tabs

Follow-ups opens on **Today**, showing only active conversations whose effective reminder date is today in your local timezone, including reminder hours later today. **Due** contains unfinished follow-ups dated before today. **Upcoming** contains future dates, including future snoozes. Snoozed items use the snoozed-until date, not the original reminder date. **Waiting** and **Completed** (including replied/cancelled) remain separate.

The displayed date buckets update every 30 seconds and when the window regains focus, so yesterday’s items move from Today to Due without restarting. This changes the list presentation, not reminder delivery times or automatic message sending.


Clicking a follow-up opens a reply draft addressed to its recipient using the original sending account and conversation. **Open conversation** remains available for reading without composing. Clicking a row never sends email automatically. Replies resolve `In-Reply-To` and `References` from saved message headers, so reopening a draft preserves threading. If the original Message-ID is missing, sending is blocked with a request to sync instead of silently creating an unthreaded message.


## Recipient email providers

Automation displays the recipient's email service beneath their address and in the per-row send confirmation. Public domains such as Gmail and Outlook are recognized locally. For custom domains, the desktop app looks up DNS MX records to identify hosts such as Google Workspace, Microsoft 365 or Zoho. These domain-only DNS queries use the system-configured DNS resolver; the mailbox name, subject and body are not included. Results are cached temporarily, with bounded lookup concurrency and timeouts.

Provider identification is a best-effort hint, not mailbox validation or a delivery guarantee. MX gateways (for example Proofpoint or Mimecast) are labelled as gateways because they can hide the actual mailbox host. Unsupported providers, offline DNS and missing MX records show Unknown. Sending does not wait for provider detection. Browser preview does not query DNS for custom domains.


## MX and SMTP recipient checks

Automation now requires a receiving MX record and successful SMTP `RCPT TO` acceptance before a pending recipient can be selected or sent. The row's **Send mail** button is hidden for invalid, checking, or inconclusive recipients. Manual batch and automatic sending skip these recipients, and the desktop send handler enforces the same check independently of the UI. Use **Recheck recipients** to refresh the display; successful/rejected results are cached for five minutes and inconclusive results for one minute.

Checks disclose the recipient address to the destination mail server on TCP port 25, using `EHLO`, an empty envelope sender, and `RCPT TO`. They do not authenticate, issue `DATA`, or send message content. Connections use pinned public IPv4 addresses only; private, loopback, link-local, multicast, and reserved destinations are blocked. IPv6-only destinations are inconclusive. DNS and SMTP have bounded timeouts; at most three MX hosts are considered. Browser preview cannot verify recipients and never unlocks sending.

**This is not proof of delivery.** Catch-all domains may accept nonexistent recipients. Servers may reject probes due to policy or block port 25, greylist, require TLS, or refuse verification. Such inconclusive checks do not unlock sending. A recipient rejection may reflect policy rather than a nonexistent mailbox. MX/SMTP checks are separate from the provider-name hint described above. Live DNS/SMTP verification must be tested from the desktop network; this development sandbox does not permit outbound mail-server connections.

## Follow-up Excel / CSV import and export

The **Follow-ups** page includes **Import Excel / CSV**, **Download Excel template**, **Export Excel**, and **Export CSV**. Exports include all tracked conversations across the date tabs, not just the visible tab. They contain Email, Account (sending email address), Conversation ID, Subject, three empty message columns, Status, Next due, and Current stage (one-based). Exported message columns are intentionally blank: fill them with your own follow-up templates. Downloads contain recipient data; store and share them carefully.

1. Export your tracked conversations to Excel, or download the template.
2. Fill **Follow-up 1**, **Follow-up 2**, and **Follow-up 3** with the desired message bodies. Leave Account, Conversation ID, Email, and Subject unchanged when using an export.
3. Upload `.xlsx` or `.csv` (maximum 5 MB / 5,000 rows; first worksheet for Excel). Legacy `.xls` files are not supported. Only the Email header is required. Follow-up message columns are optional; choose Write my own message to enter bodies in the app.
4. Choose **Use spreadsheet messages** or **Write my own message**. With custom bodies, type your first, second, and third messages in the app; **Add another follow-up body** supports up to ten. Select recipient rows with their checkboxes (or Select all matched rows), choose a follow-up number separately on each row, then click **Review follow-up 1/2/3** on a selected matched row. Still opens a normal reply composer using the original account, recipient, subject and conversation thread, with the chosen body filled in. Review it and click Send normally. Uploading never sends anything.

Only existing tracked conversations can be matched. For an existing sent email not yet tracked, enable follow-up from Sent first. Unknown recipients, ambiguous matches, completed/replied/cancelled conversations and empty message cells cannot open replies. Email matching is case-insensitive; optional Account, Conversation ID and Subject disambiguate recipients with multiple conversations. Status, due dates and exported stage values are informational and never overwrite tracking data. Choosing a third message template does not skip or reset the reminder schedule: the normal stage advances only after a successful send.

Follow-up imports persist in local SQLite, including the original file bytes, parsed rows, messages and subjects. They restore after navigating away or restarting the desktop app. No imported file is uploaded to an external service. Excel exports use explicit string cells to avoid formulas. CSV exports prefix formula-like values with an apostrophe for spreadsheet safety; use Excel export for exact text round trips. Browser/desktop download handling saves the generated files through the normal download mechanism.


Custom follow-up bodies, row selections, per-row follow-up numbers and message-source choices are saved in the same local workspace. They are not written back to the source spreadsheet. You can choose different follow-up numbers for different recipients, and deselect rows to disable their review buttons. The default follow-up applies to rows without an individual choice. Opening a review is not a delivery confirmation; sending still happens explicitly in the composer, and its normal draft saving applies. Spreadsheet mode detects numbered message columns (up to ten); custom mode supports up to ten bodies.

### Business-email draft sheet layout (five follow-ups)

The importer also accepts the **Follow-up drafts** layout: Company Name, Business Email, Email Verification Status, Official Website, Company Category, Draft Status, Original Subject, Initial Email, and numbered **Follow-up N Subject / Follow-up N Message** pairs. The Excel template now uses this five-follow-up layout. Existing Email / Follow-up 1–3 files and recipient-only files remain supported. Spreadsheet mode detects numbered columns through follow-up 10, with at least three choices shown; missing message columns are treated as empty.

Business Email identifies the recipient; Original Subject is used to match the existing tracked conversation. Company Name is shown in the preview. Each row's chosen Follow-up N Subject and Message populate the reply composer while keeping the original conversation/thread and sending account. Blank follow-up subjects fall back to the normal reply subject. Initial Email is never sent as a follow-up. Website, category and draft-status fields do not change eligibility. Email Verification Status is only a sheet-provided label, **not** proof of MX/SMTP validation.

Literal escaped `\n`, `\r\n` and `\uXXXX` sequences in imported message and subject fields are decoded for draft sheets that store escaped text; multiline subjects are rejected. Imported subjects are limited to 1,000 characters. Existing match/terminal-status checks, row selection, manual review, and no-stage-override safeguards still apply. Download a Google Sheet as Excel (.xlsx) or CSV and upload it in Still; this feature does not add live Google Sheets synchronization or change the source sheet. No recipient addresses or message content from a real customer sheet are bundled into the app or its regression fixtures.


### Saved follow-up workspace and sending before the due date

The Follow-ups importer stores one current workspace in SQLite using a versioned migration. A new upload replaces it only after parsing and a successful save; failed imports retain the previous workspace. File bytes are stored as a BLOB. Parsed messages, subjects, selections and custom bodies are saved alongside it. **Clear saved import** removes the uploaded source and rows from the saved workspace (custom bodies remain available). Storage is local and not encrypted. Browser preview uses localStorage instead of SQLite and may hit browser storage quotas; storage failures are displayed rather than reported as successful saves.

The **All active** date tab includes due, upcoming, snoozed and waiting conversations. Dates are organizational filters, not a prerequisite for sending: imported rows match against the complete tracked-conversation list regardless of the selected date tab. You can manually review and send before a due date. Completed, replied and cancelled tracking remains blocked in spreadsheet matching. Emails that have never had follow-up tracking enabled must still be enabled from Sent before matching; this change does not send new unthreaded emails to unknown recipients.


### Automatic body fill from a saved import

The normal **Send follow-up** action in the follow-up list and reading pane now loads the saved import and fills the matching recipient's subject/body automatically. It uses the per-row follow-up number, or the saved default number when no per-row choice exists, and respects the saved spreadsheet/custom body source. You do not need to select the row checkbox or open Review from the import table first. The composer retains the original conversation and sending account; click Send there without retyping. The normal send-confirmation setting still applies.

An explicitly reviewed row continues to use that row's chosen message directly. If no saved row matches, normal blank follow-up composition remains available. Duplicate matching imported rows, an empty chosen body, or a workspace-load failure show an error rather than silently substituting another message. Sending is never triggered merely by loading or filling a body.
