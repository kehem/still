import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { MIGRATIONS } from './migrations';
import { FollowUpImportRepository } from './followup-import';
import { emptyFollowUpImport } from '../../shared/followup-import';
import type { DatabaseService } from './db';
it('restores original bytes, messages and choices after closing and reopening SQLite', () => {
  const dir = mkdtempSync(join(tmpdir(), 'still-followup-import-'));
  let db = new DatabaseSync(join(dir, 'mail.sqlite'));
  try {
    for (const migration of MIGRATIONS) db.exec(migration.sql);
    const value = { ...emptyFollowUpImport(), fileName: 'followups.xlsx', sourceBase64: Buffer.from('test source bytes').toString('base64'),
      rows: [{ row: 2, email: 'person@example.com', account: '', conversationId: 'thread', subject: 'Original', messages: ['First', 'Second', 'Third'] }], selectedRows: [2], rowStages: { '2': 2 }, customBodies: ['Custom first', '', ''] };
    const repository = () => new FollowUpImportRepository({ db } as unknown as DatabaseService);
    expect(repository().get()).toEqual(emptyFollowUpImport());
    repository().save(value); db.close(); db = new DatabaseSync(join(dir, 'mail.sqlite'));
    expect(repository().get()).toEqual(value);
    expect(() => repository().save({ ...value, stage: 999 })).toThrow();
    expect(repository().get()).toEqual(value);
    repository().save(emptyFollowUpImport());
    expect(repository().get()).toEqual(emptyFollowUpImport());
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});
