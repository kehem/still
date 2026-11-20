import { randomUUID } from 'node:crypto';
import type { DatabaseService } from './db';
import { automationDay, emptyAutomation, validAutomationRow, type AutomationSnapshot, type AutomationWorkspace } from '../../shared/automation';

export class AutomationRepository {
  constructor(private readonly db: DatabaseService) {}
  recover(): void {
    // A previous process may have closed after SMTP accepted mail. Never retry it.
    this.db.db.prepare("UPDATE automation_deliveries SET status = 'failed', error = 'Interrupted send. Check your provider before retrying.' WHERE status = 'sending'").run();
    const ws = this.read();
    ws.rows = ws.rows.map(r => r.status === 'sending' ? { ...r, status: 'failed', error: 'Interrupted send. Check Sent before retrying.' } : r);
    this.write(ws);
  }
  private read(): AutomationWorkspace {
    const row = this.db.db.prepare('SELECT document FROM automation_workspace WHERE id = 1').get() as { document: string } | undefined;
    return row ? JSON.parse(row.document) : emptyAutomation();
  }
  private write(ws: AutomationWorkspace): void {
    this.db.db.prepare(`INSERT INTO automation_workspace(id, document, updated_at) VALUES(1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET document = excluded.document, updated_at = excluded.updated_at`).run(JSON.stringify(ws), new Date().toISOString());
  }
  snapshot(): AutomationSnapshot {
    const ws = this.read();
    for (const row of ws.rows) {
      const match = this.db.db.prepare(`SELECT m.id, m.conversation_id, m.sent_at,
        EXISTS(SELECT 1 FROM followup_sequences f WHERE f.conversation_id = m.conversation_id
          AND f.status NOT IN ('completed','replied','cancelled')) AS tracking
        FROM messages m WHERE m.direction = 'outbound' AND m.account_id = ?
          AND m.subject = ? AND trim(COALESCE(m.body_text, '')) = trim(?)
          AND EXISTS(SELECT 1 FROM json_each(m.to_addresses) WHERE lower(trim(value)) = lower(trim(?)))
        ORDER BY m.sent_at DESC LIMIT 1`).get(ws.accountId, row.subject || '(no subject)', row.body, row.to) as { id: string; conversation_id: string; sent_at: string; tracking: number } | undefined;
      if (match) {
        // Import known outbound history once, including mail sent from Compose.
        // Re-importing the same sheet must not reset progress or daily limits.
        this.db.db.prepare(`INSERT OR IGNORE INTO automation_deliveries
          (id, row_id, account_id, recipient, subject, body, status, attempted_at, day, conversation_id, sent_at)
          SELECT ?, ?, ?, ?, ?, ?, 'sent', ?, ?, ?, ?
          WHERE NOT EXISTS(SELECT 1 FROM automation_deliveries WHERE conversation_id = ? AND status = 'sent')`)
          .run(`history:${match.id}`, row.id, ws.accountId, row.to, row.subject, row.body,
            match.sent_at, automationDay(new Date(match.sent_at)), match.conversation_id, match.sent_at, match.conversation_id);
        row.status = 'sent'; row.sentAt = match.sent_at; row.conversationId = match.conversation_id;
        row.followUpActive = Boolean(match.tracking); row.selected = false; if (!row.error?.startsWith('Mail sent')) delete row.error;
      } else if (row.conversationId) {
        const tracking = this.db.db.prepare("SELECT 1 FROM followup_sequences WHERE conversation_id = ? AND status NOT IN ('completed','replied','cancelled')").get(row.conversationId);
        row.followUpActive = Boolean(tracking);
      }
    }
    this.write(ws);
    const day = automationDay();
    const counts = this.db.db.prepare(`SELECT COUNT(*) AS attempted,
      COALESCE(SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END), 0) AS sent
      FROM automation_deliveries WHERE day = ?`).get(day) as { attempted: number; sent: number };
    const total = this.db.db.prepare("SELECT COUNT(*) AS n FROM automation_deliveries WHERE status = 'sent'").get() as { n: number };
    const last = this.db.db.prepare('SELECT MAX(attempted_at) AS ts FROM automation_deliveries').get() as { ts: string | null };
    return { workspace: ws, sentToday: counts.sent, attemptedToday: counts.attempted, sentTotal: total.n, lastAttemptAt: last.ts ? Date.parse(last.ts) : 0 };
  }
  save(input: AutomationWorkspace): AutomationSnapshot {
    const previous = this.read();
    const existing = new Map(previous.rows.map(r => [r.id, r]));
    input.rows = input.rows.map(row => {
      const old = existing.get(row.id);
      // Renderer edits cannot reset a delivered or uncertain row to pending.
      return old && old.status !== 'pending' ? { ...old, selected: false } : { ...row, status: row.status === 'sending' ? 'failed' : row.status };
    });
    this.write(input);
    if (!input.fileName && !input.table.length) this.db.db.prepare('UPDATE automation_workspace SET source_name = NULL, source_bytes = NULL WHERE id = 1').run();
    return this.snapshot();
  }
  importFile(name: string, base64: string, table: string[][]): AutomationSnapshot {
    const bytes = Buffer.from(base64, 'base64');
    if (bytes.length > 5 * 1024 * 1024) throw new Error('Maximum source file size is 5 MB');
    if (!table[0] || table[0].length < 3) throw new Error('At least three header columns are required');
    return this.db.db.transaction(() => {
      const ws = this.read();
      ws.fileName = name; ws.table = table; ws.columns = [0, 1, 2]; ws.rows = [];
      this.write(ws);
      this.db.db.prepare('UPDATE automation_workspace SET source_name = ?, source_bytes = ? WHERE id = 1').run(name, bytes);
      return this.snapshot();
    })();
  }
  claim(id: string): { deliveryId: string; workspace: AutomationWorkspace; row: AutomationWorkspace['rows'][number] } {
    return this.db.db.transaction(() => {
      const snapshot = this.snapshot();
      const ws = snapshot.workspace;
      const row = ws.rows.find(r => r.id === id);
      if (!row || row.status !== 'pending' || !validAutomationRow(row)) throw new Error('This row is invalid or already sent. Refresh the queue.');
      if (!ws.accountId) throw new Error('Choose a sending account');
      if (snapshot.attemptedToday >= ws.daily) throw new Error('Daily limit reached. Waiting for tomorrow.');
      if (Date.now() - snapshot.lastAttemptAt < ws.seconds * 1000) throw new Error('Waiting for the send interval.');
      const deliveryId = randomUUID();
      const now = new Date().toISOString();
      this.db.db.prepare(`INSERT INTO automation_deliveries(id, row_id, account_id, recipient, subject, body, status, attempted_at, day)
        VALUES(?, ?, ?, ?, ?, ?, 'sending', ?, ?)`).run(deliveryId, row.id, ws.accountId, row.to, row.subject, row.body, now, automationDay());
      row.status = 'sending'; this.write(ws);
      return { deliveryId, workspace: ws, row };
    })();
  }
  finish(deliveryId: string, rowId: string, result: { conversationId: string; sentAt: string; warning?: string } | { error: string }): AutomationSnapshot {
    return this.db.db.transaction(() => {
      const ws = this.read(); const row = ws.rows.find(r => r.id === rowId);
      if ('error' in result) {
        this.db.db.prepare("UPDATE automation_deliveries SET status = 'failed', error = ? WHERE id = ?").run(result.error, deliveryId);
        if (row) { row.status = 'failed'; row.error = result.error; }
      } else {
        this.db.db.prepare("UPDATE automation_deliveries SET status = 'sent', conversation_id = ?, sent_at = ? WHERE id = ?").run(result.conversationId, result.sentAt, deliveryId);
        if (row) { row.status = 'sent'; row.sentAt = result.sentAt; row.conversationId = result.conversationId; row.selected = false; row.error = result.warning; }
      }
      this.write(ws); return this.snapshot();
    })();
  }
}
