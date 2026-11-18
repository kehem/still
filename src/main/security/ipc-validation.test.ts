import { describe, expect, it } from 'vitest';
import {
  createFollowUpSchema,
  followUpStatusSchema,
  idSchema,
  messageListOptionsSchema,
  newAccountSchema,
  parseOrThrow,
  saveDraftSchema,
  scheduleInputSchema,
  schedulePatchSchema,
  settingsPatchSchema,
  updateAccountSchema,
} from './ipc-validation';

/**
 * The renderer is untrusted input even though we ship it: every writable IPC
 * channel is validated before it reaches the database (spec §3, §18).
 */
describe('parseOrThrow', () => {
  it('returns parsed data for valid input', () => {
    expect(parseOrThrow(idSchema, 'conv-1')).toBe('conv-1');
  });

  it('throws on malformed input instead of coercing it', () => {
    expect(() => parseOrThrow(idSchema, 123)).toThrow();
    expect(() => parseOrThrow(idSchema, '')).toThrow();
    expect(() => parseOrThrow(idSchema, null)).toThrow();
    expect(() => parseOrThrow(idSchema, undefined)).toThrow();
    expect(() => parseOrThrow(idSchema, {})).toThrow();
  });

  it('rejects ids long enough to be an injection attempt', () => {
    expect(() => parseOrThrow(idSchema, 'a'.repeat(129))).toThrow();
    expect(parseOrThrow(idSchema, 'a'.repeat(128))).toHaveLength(128);
  });
});

describe('settingsPatchSchema', () => {
  it('accepts a valid partial patch', () => {
    expect(parseOrThrow(settingsPatchSchema, { theme: 'dark', density: 'compact' })).toEqual({
      theme: 'dark',
      density: 'compact',
    });
  });

  it('strips unknown keys so the renderer cannot invent settings', () => {
    const parsed = parseOrThrow(settingsPatchSchema, { theme: 'dark', isAdmin: true }) as Record<
      string,
      unknown
    >;
    expect(parsed).toEqual({ theme: 'dark' });
    expect('isAdmin' in parsed).toBe(false);
  });

  it('rejects values outside their enum', () => {
    expect(() => parseOrThrow(settingsPatchSchema, { theme: 'neon' })).toThrow();
    expect(() => parseOrThrow(settingsPatchSchema, { fontSize: 'huge' })).toThrow();
    expect(() => parseOrThrow(settingsPatchSchema, { sortOrder: 'sideways' })).toThrow();
  });

  it('rejects wrong types', () => {
    expect(() => parseOrThrow(settingsPatchSchema, { sidebarVisible: 'yes' })).toThrow();
    expect(() => parseOrThrow(settingsPatchSchema, { maxStages: 'six' })).toThrow();
    expect(() => parseOrThrow(settingsPatchSchema, { reminderTime: 900 })).toThrow();
  });

  it('rejects a non-object payload', () => {
    expect(() => parseOrThrow(settingsPatchSchema, 'theme=dark')).toThrow();
    expect(() => parseOrThrow(settingsPatchSchema, [])).toThrow();
  });
});

describe('newAccountSchema', () => {
  const valid = {
    provider: 'imap',
    displayName: 'Personal',
    email: 'alex@example.com',
  };

  it('accepts a minimal IMAP account', () => {
    expect(parseOrThrow(newAccountSchema, valid).email).toBe('alex@example.com');
  });

  it('rejects an unknown provider', () => {
    expect(() => parseOrThrow(newAccountSchema, { ...valid, provider: 'aol' })).toThrow();
  });

  it('rejects a missing display name or email', () => {
    expect(() => parseOrThrow(newAccountSchema, { provider: 'imap' })).toThrow();
    expect(() =>
      parseOrThrow(newAccountSchema, { provider: 'imap', displayName: 'Personal' }),
    ).toThrow();
  });

  it('rejects out-of-range ports', () => {
    expect(() => parseOrThrow(newAccountSchema, { ...valid, imapPort: 0 })).toThrow();
    expect(() => parseOrThrow(newAccountSchema, { ...valid, smtpPort: 99999 })).toThrow();
  });

  it('drops nothing the caller sent but refuses a non-string password', () => {
    expect(() => parseOrThrow(newAccountSchema, { ...valid, password: 12345 })).toThrow();
  });
});

describe('updateAccountSchema', () => {
  it('accepts a partial update', () => {
    expect(parseOrThrow(updateAccountSchema, { syncEnabled: false }).syncEnabled).toBe(false);
  });

  it('cannot change an account provider: the key is stripped, not applied', () => {
    const parsed = parseOrThrow(updateAccountSchema, {
      provider: 'google',
      displayName: 'Renamed',
    }) as Record<string, unknown>;
    expect(parsed).toEqual({ displayName: 'Renamed' });
    expect('provider' in parsed).toBe(false);
  });

  it('refuses an invalid auth status', () => {
    expect(() => parseOrThrow(updateAccountSchema, { authStatus: 'hacked' })).toThrow();
  });
});

describe('schedule schemas', () => {
  it('accepts valid stage intervals', () => {
    expect(parseOrThrow(scheduleInputSchema, { name: 'Sales', stages: [3, 7, 15, 30] }).stages)
      .toEqual([3, 7, 15, 30]);
  });

  it('rejects zero, negative, fractional and absurd intervals', () => {
    for (const stages of [[0], [-3], [1.5], [400], []]) {
      expect(() => parseOrThrow(scheduleInputSchema, { name: 'Bad', stages }), JSON.stringify(stages)).toThrow();
    }
  });

  it('rejects more stages than the engine supports', () => {
    const tooMany = Array.from({ length: 21 }, (_v, i) => i + 1);
    expect(() => parseOrThrow(scheduleInputSchema, { name: 'Many', stages: tooMany })).toThrow();
  });

  it('rejects an empty name', () => {
    expect(() => parseOrThrow(scheduleInputSchema, { name: '', stages: [3] })).toThrow();
  });

  it('validates patches too', () => {
    expect(() => parseOrThrow(schedulePatchSchema, { stages: [0] })).toThrow();
    expect(parseOrThrow(schedulePatchSchema, { isDefault: true }).isDefault).toBe(true);
  });
});

describe('messageListOptionsSchema', () => {
  it('accepts valid list options', () => {
    expect(
      parseOrThrow(messageListOptionsSchema, {
        accountId: 'acc-1',
        folderKind: 'inbox',
        limit: 50,
        offset: 10,
      }).limit,
    ).toBe(50);
  });

  it('rejects an unknown folder filter', () => {
    expect(() =>
      parseOrThrow(messageListOptionsSchema, { folderKind: 'everything' }),
    ).toThrow();
  });

  it('rejects limits that could be used to dump the database', () => {
    expect(() => parseOrThrow(messageListOptionsSchema, { limit: 0 })).toThrow();
    expect(() => parseOrThrow(messageListOptionsSchema, { limit: 100000 })).toThrow();
    expect(() => parseOrThrow(messageListOptionsSchema, { offset: -1 })).toThrow();
  });
});

describe('createFollowUpSchema', () => {
  it('accepts a conversation id with optional overrides', () => {
    expect(parseOrThrow(createFollowUpSchema, { conversationId: 'c1' }).conversationId).toBe('c1');
    expect(
      parseOrThrow(createFollowUpSchema, { conversationId: 'c1', intervalDays: 5 }).intervalDays,
    ).toBe(5);
  });

  it('rejects an empty conversation id and absurd intervals', () => {
    expect(() => parseOrThrow(createFollowUpSchema, { conversationId: '' })).toThrow();
    expect(() =>
      parseOrThrow(createFollowUpSchema, { conversationId: 'c1', intervalDays: 0 }),
    ).toThrow();
    expect(() =>
      parseOrThrow(createFollowUpSchema, { conversationId: 'c1', intervalDays: 9999 }),
    ).toThrow();
  });

  it('rejects a payload without a conversation', () => {
    expect(() => parseOrThrow(createFollowUpSchema, {})).toThrow();
  });
});

describe('followUpStatusSchema', () => {
  it('accepts exactly the eight specification statuses', () => {
    for (const status of [
      'scheduled',
      'due',
      'overdue',
      'waiting',
      'replied',
      'completed',
      'snoozed',
      'cancelled',
    ]) {
      expect(parseOrThrow(followUpStatusSchema, status)).toBe(status);
    }
  });

  it('rejects anything else, including statuses that would skip a stage', () => {
    for (const status of ['done', 'SCHEDULED', 'sent', '', null, 3]) {
      expect(() => parseOrThrow(followUpStatusSchema, status), String(status)).toThrow();
    }
  });
});

describe('saveDraftSchema', () => {
  const full = {
    id: 'draft-1',
    accountId: 'acc-personal',
    toAddresses: ['marco@partner.example'],
    ccAddresses: [],
    bccAddresses: [],
    subject: 'Proposal for Q1',
    body: 'Hello Marco,',
    followUpEnabled: true,
    followUpIntervalDays: 3,
    inReplyToConversationId: null,
  };

  it('accepts a complete draft unchanged', () => {
    expect(parseOrThrow(saveDraftSchema, full)).toEqual(full);
  });

  it('accepts a partial autosave, since drafts are written as the user types', () => {
    expect(parseOrThrow(saveDraftSchema, { subject: 'Half written' })).toEqual({
      subject: 'Half written',
    });
    expect(parseOrThrow(saveDraftSchema, {})).toEqual({});
  });

  it('strips keys that are not part of the draft contract', () => {
    const parsed = parseOrThrow(saveDraftSchema, {
      ...full,
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-01T00:00:00.000Z',
      isAdmin: true,
    }) as Record<string, unknown>;
    // Timestamps are owned by the repository, never by the caller.
    expect('createdAt' in parsed).toBe(false);
    expect('updatedAt' in parsed).toBe(false);
    expect('isAdmin' in parsed).toBe(false);
    expect(parsed.subject).toBe('Proposal for Q1');
  });

  it('rejects payloads that are not objects', () => {
    for (const bad of [null, undefined, 'draft', 42, []]) {
      expect(() => parseOrThrow(saveDraftSchema, bad), String(bad)).toThrow();
    }
  });

  it('rejects wrong types in every field', () => {
    const wrongTypes = [
      { ...full, subject: 123 },
      { ...full, body: null },
      { ...full, followUpEnabled: 'yes' },
      { ...full, toAddresses: 'marco@partner.example' },
      { ...full, toAddresses: [1, 2, 3] },
      { ...full, accountId: 7 },
      { ...full, id: '' },
    ];
    for (const bad of wrongTypes) {
      expect(() => parseOrThrow(saveDraftSchema, bad), JSON.stringify(bad)).toThrow();
    }
  });

  it('bounds recipient lists so a malformed draft cannot bloat the database', () => {
    const tooMany = { toAddresses: Array.from({ length: 101 }, (_, i) => `a${i}@example.com`) };
    expect(() => parseOrThrow(saveDraftSchema, tooMany)).toThrow();
    // 100 is allowed.
    const atLimit = { toAddresses: Array.from({ length: 100 }, (_, i) => `a${i}@example.com`) };
    expect(parseOrThrow(saveDraftSchema, atLimit).toAddresses).toHaveLength(100);
  });

  it('bounds address, subject and body lengths', () => {
    expect(() =>
      parseOrThrow(saveDraftSchema, { toAddresses: ['a'.repeat(321)] }),
    ).toThrow();
    expect(() => parseOrThrow(saveDraftSchema, { subject: 'x'.repeat(1001) })).toThrow();
    expect(() => parseOrThrow(saveDraftSchema, { body: 'x'.repeat(1_000_001) })).toThrow();
    // Just inside each limit is fine.
    expect(parseOrThrow(saveDraftSchema, { subject: 'x'.repeat(1000) }).subject).toHaveLength(1000);
  });

  it('rejects follow-up intervals outside the supported range', () => {
    for (const bad of [0, -3, 366, 1.5, '3']) {
      expect(
        () => parseOrThrow(saveDraftSchema, { ...full, followUpIntervalDays: bad }),
        String(bad),
      ).toThrow();
    }
    // null means "no interval chosen", which is legitimate.
    expect(parseOrThrow(saveDraftSchema, { followUpIntervalDays: null })).toEqual({
      followUpIntervalDays: null,
    });
  });

  it('rejects oversized ids', () => {
    expect(() => parseOrThrow(saveDraftSchema, { id: 'x'.repeat(129) })).toThrow();
    expect(() =>
      parseOrThrow(saveDraftSchema, { inReplyToConversationId: 'x'.repeat(129) }),
    ).toThrow();
  });
});
