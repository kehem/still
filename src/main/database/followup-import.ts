import { z } from 'zod';
import { emptyFollowUpImport, type FollowUpImportWorkspace } from '../../shared/followup-import';
import type { DatabaseService } from './db';
const text = z.string().max(50000);
export const followUpImportSchema = z.object({
  fileName: z.string().max(255), sourceBase64: z.string().max(7 * 1024 * 1024).regex(/^[A-Za-z0-9+/]*={0,2}$/),
  rows: z.array(z.object({ row: z.number().int().min(2).max(5001), email: text, account: text, conversationId: text, subject: text,
    messages: z.array(text).min(3).max(10), subjects: z.array(text).max(10).optional(), company: text.optional(), verification: text.optional() })).max(5000),
  stage: z.number().int().min(0).max(9), selectedRows: z.array(z.number().int().min(2).max(5001)).max(5000),
  rowStages: z.record(z.string().regex(/^\d{1,4}$/), z.number().int().min(0).max(9)),
  bodySource: z.enum(['spreadsheet', 'custom']), customBodies: z.array(text).min(3).max(10),
});
export class FollowUpImportRepository {
  constructor(private db: DatabaseService) {}
  get(): FollowUpImportWorkspace {
    const row = this.db.db.prepare('SELECT document, source_bytes FROM followup_import_workspace WHERE id = 1').get() as { document: string; source_bytes: Uint8Array } | undefined;
    return row ? { ...JSON.parse(row.document), sourceBase64: Buffer.from(row.source_bytes).toString('base64') } : emptyFollowUpImport();
  }
  save(input: unknown): FollowUpImportWorkspace {
    if (JSON.stringify(input).length > 20 * 1024 * 1024) throw new Error('Follow-up workspace is too large (maximum 20 MB).');
    const value = followUpImportSchema.parse(input);
    const { sourceBase64, ...document } = value;
    const bytes = Buffer.from(sourceBase64, 'base64');
    if (bytes.length > 5 * 1024 * 1024) throw new Error('Maximum source file size is 5 MB.');
    this.db.db.prepare(`INSERT INTO followup_import_workspace(id, document, source_bytes, updated_at) VALUES(1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET document = excluded.document, source_bytes = excluded.source_bytes, updated_at = excluded.updated_at`)
      .run(JSON.stringify(document), bytes, new Date().toISOString());
    return value;
  }
}
