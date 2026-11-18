import { describe, expect, it } from 'vitest';
import type { Account, Settings } from '../types';
import { DEFAULT_SETTINGS, ALL_INBOX } from '../constants';
import { folderToMessageOptions, resolveHomeFolder } from './navigation';

const personal: Account = {
  id: 'acc-personal',
  provider: 'google',
  displayName: 'Personal',
  email: 'alex@example.com',
  color: '#3E6FA3',
  imapHost: null,
  imapPort: null,
  imapSecure: true,
  smtpHost: null,
  smtpPort: null,
  smtpSecure: true,
  username: null,
  syncEnabled: true,
  isDefaultSender: true,
  authStatus: 'connected',
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
};

const work: Account = { ...personal, id: 'acc-work', displayName: 'Work', email: 'alex@company.com' };

function settings(patch: Partial<Settings> = {}): Settings {
  return { ...DEFAULT_SETTINGS, ...patch };
}

describe('resolveHomeFolder', () => {
  it('opens All Inbox for multiple accounts with no explicit default (Scenario C)', () => {
    expect(resolveHomeFolder(settings(), [personal, work], null)).toBe(ALL_INBOX);
  });

  it('opens that account inbox when only one account exists (Scenario B)', () => {
    expect(resolveHomeFolder(settings(), [personal], null)).toBe('acc-personal');
    expect(
      resolveHomeFolder(settings({ defaultInboxId: 'acc-personal' }), [personal], null),
    ).toBe('acc-personal');
  });

  it('restores the last-used folder when remembered and still valid', () => {
    expect(resolveHomeFolder(settings(), [personal, work], 'acc-work')).toBe('acc-work');
    expect(resolveHomeFolder(settings(), [personal, work], 'sent')).toBe('sent');
    // A remembered folder wins over the single-account rule.
    expect(resolveHomeFolder(settings(), [personal], 'sent')).toBe('sent');
  });

  it('ignores a last-used folder that no longer exists (deleted account)', () => {
    expect(resolveHomeFolder(settings(), [personal, work], 'acc-removed')).toBe(ALL_INBOX);
  });

  it('ignores the last-used folder when startup behaviour is "open inbox"', () => {
    expect(
      resolveHomeFolder(settings({ startupBehavior: 'inbox' }), [personal, work], 'sent'),
    ).toBe(ALL_INBOX);
  });

  it('ignores the last-used folder when remembering is disabled', () => {
    expect(
      resolveHomeFolder(settings({ rememberLastInbox: false }), [personal, work], 'sent'),
    ).toBe(ALL_INBOX);
  });

  it('falls back to an account inbox when the unified inbox is disabled', () => {
    expect(resolveHomeFolder(settings({ unifiedInboxEnabled: false }), [personal, work], null)).toBe(
      'acc-personal',
    );
    expect(
      resolveHomeFolder(
        settings({ unifiedInboxEnabled: false, defaultInboxId: 'acc-work' }),
        [personal, work],
        ALL_INBOX,
      ),
    ).toBe('acc-work');
  });

  it('honours an explicit default inbox', () => {
    expect(resolveHomeFolder(settings({ defaultInboxId: 'acc-work' }), [personal, work], null)).toBe(
      'acc-work',
    );
  });
});

describe('folderToMessageOptions', () => {
  it('queries received mail for the unified inbox', () => {
    expect(folderToMessageOptions(ALL_INBOX, [personal, work])).toEqual({ folderKind: 'inbox' });
  });

  it('scopes an account inbox to that account', () => {
    expect(folderToMessageOptions('acc-work', [personal, work])).toEqual({
      accountId: 'acc-work',
      folderKind: 'inbox',
    });
  });

  it('maps semantic folders to their kind', () => {
    expect(folderToMessageOptions('sent', [personal])).toEqual({ folderKind: 'sent' });
    expect(folderToMessageOptions('snoozed', [personal])).toEqual({ folderKind: 'snoozed' });
    expect(folderToMessageOptions('trash', [personal])).toEqual({ folderKind: 'trash' });
  });

  it('falls back to the inbox for an unknown folder id', () => {
    expect(folderToMessageOptions('folder-xyz', [personal])).toEqual({ folderKind: 'inbox' });
  });
});
