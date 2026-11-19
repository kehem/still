# Spreadsheet automation

Open **Productivity → Automation** in the desktop app.

1. Import a CSV or `.xlsx` file (up to 5 MB, 1,000 data rows). Legacy `.xls` is not supported; save it as `.xlsx` first. The first row is treated as headers; the first Excel sheet is read.
2. Map three different columns to recipient email, subject and plain-text body.
3. Build the queue, inspect previews and select the rows to send. Each row sends one individual email to one recipient. Invalid rows cannot be sent. Formula expressions are not executed.
4. Choose a sending account, daily maximum and minimum interval in seconds.
5. Use **Send next** for one email at a time, or explicitly confirm **Start automatic sending**. Both modes obey the daily/interval limits.

Only send messages to recipients who expect them and observe your provider's sending rules.

## Execution and recovery

- Still must remain open. Navigating to another section does not stop the queue; use Pause in Automation. Pause allows an already-started SMTP send to finish.
- Closing or reloading stops automation. The queue survives locally, but sending never resumes without your confirmation. Keep only one Still instance open when using automation; the queue is not a multi-process scheduler.
- Daily counters use local calendar days and count **attempts**, including failed attempts, conservatively. Automatic mode waits until the next day when the daily cap is reached. Intervals are minimum delays, not exact deadlines; sleeping devices and throttled windows can delay delivery.
- Sending is serial. Failed or interrupted sends are marked for inspection, pause the queue, and are never retried automatically. An SMTP error can be ambiguous: check Sent and your provider before importing the same recipient again.
- Importing a replacement queue asks for confirmation and does not reset daily counters. Clearing the queue removes its local message content but not already-sent email or daily counters.
- Queue content, delivery states, settings and counters are stored in renderer localStorage on this device, not in the credential vault or encrypted database. Browser preview can import/inspect but cannot send automation mail.
- Automation sends initial emails only. It does not automatically send follow-up replies.

## Local Trash

The inbox list and reading pane can move whole conversations to local Trash and restore them. These actions preserve original folders and do not delete or move provider-side mail. Permanent deletion and individual-message deletion are not implemented.
