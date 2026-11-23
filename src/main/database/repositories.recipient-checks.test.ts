import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { RecipientCheck } from '../../shared/types';

// `db.ts` resolves an Electron userData path; the repository under test does
// not need Electron itself.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/still-test' },
}));

const { DatabaseService } = await import('./db');
const { RecipientCheckRepository } = await import('./repositories');

describe('RecipientCheckRepository', () => {
  let service: InstanceType<typeof DatabaseService>;
  let checks: InstanceType<typeof RecipientCheckRepository>;

  beforeAll(() => {
    service = new DatabaseService(':memory:');
    checks = new RecipientCheckRepository(service);
  });

  it('returns undefined for addresses that were never checked', () => {
    expect(checks.load('nobody@example.com')).toBeUndefined();
  });

  it('saves and reloads a completed check', () => {
    checks.save('person@example.com', { status: 'valid', detail: 'Accepted' });
    expect(checks.load('person@example.com')).toEqual({ status: 'valid', detail: 'Accepted' });
  });

  it('replaces the stored result when a saved address is rechecked', () => {
    checks.save('retry@example.com', { status: 'invalid', detail: 'Not valid for sending' });
    checks.save('retry@example.com', { status: 'catch_all', detail: 'Unverified mailbox' });
    expect(checks.load('retry@example.com')).toEqual({ status: 'catch_all', detail: 'Unverified mailbox' });
  });

  it('persists every outcome without keeping session-only fields', () => {
    const result: RecipientCheck = {
      status: 'invalid',
      detail: 'Mailbox rejected',
      attempts: 3,
      verificationId: 'session-only',
    };
    checks.save('gone@example.com', result);
    expect(checks.load('gone@example.com')).toEqual({ status: 'invalid', detail: 'Mailbox rejected' });
    const row = service.db
      .prepare('SELECT checked_at FROM recipient_checks WHERE address = ?')
      .get('gone@example.com') as { checked_at: string };
    expect(row.checked_at).toBeTruthy();
  });
});
