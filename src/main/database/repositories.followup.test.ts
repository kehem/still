import { beforeAll, describe, expect, it, vi } from 'vitest';

// `db.ts` resolves an Electron userData path; the repositories under test do
// not need Electron itself.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/still-test' },
}));

const { DatabaseService } = await import('./db');
const { FollowUpRepository, ScheduleRepository } = await import('./repositories');

/** Local-time ISO strings (no zone suffix) keep assertions timezone-safe. */
const SENT_AT = '2026-11-17T10:00:00.000';

describe('FollowUpRepository.create', () => {
  let service: InstanceType<typeof DatabaseService>;
  let followups: InstanceType<typeof FollowUpRepository>;
  let scheduleId: string;

  beforeAll(() => {
    service = new DatabaseService(':memory:');
    const ts = new Date().toISOString();
    service.db
      .prepare(
        "INSERT INTO accounts(id, provider, display_name, email, created_at, updated_at) VALUES('acc-1', 'imap', 'Personal', 'alex@example.com', ?, ?)",
      )
      .run(ts, ts);

    const insertConversation = service.db.prepare(
      "INSERT INTO conversations(id, account_id, subject, participants, last_message_at, created_at, updated_at) VALUES(?, 'acc-1', ?, ?, ?, ?, ?)",
    );
    insertConversation.run(
      'conv-outbound',
      'Proposal',
      JSON.stringify(['marco@partner.example']),
      SENT_AT,
      ts,
      ts,
    );
    insertConversation.run(
      'conv-inbound-only',
      'Newsletter',
      JSON.stringify(['news@example.com']),
      SENT_AT,
      ts,
      ts,
    );

    const insertMessage = service.db.prepare(
      `INSERT INTO messages(id, account_id, conversation_id, subject, from_address, to_addresses,
         sent_at, direction, created_at)
       VALUES(?, 'acc-1', ?, ?, ?, ?, ?, ?, ?)`,
    );
    insertMessage.run(
      'm-out',
      'conv-outbound',
      'Proposal',
      'alex@example.com',
      JSON.stringify(['marco@partner.example']),
      SENT_AT,
      'outbound',
      SENT_AT,
    );
    insertMessage.run(
      'm-in',
      'conv-inbound-only',
      'Newsletter',
      'news@example.com',
      JSON.stringify(['alex@example.com']),
      SENT_AT,
      'inbound',
      SENT_AT,
    );

    const schedules = new ScheduleRepository(service);
    scheduleId = schedules.create({ name: 'Default', stages: [3, 7, 15, 30] }).id;
    followups = new FollowUpRepository(service);
  });

  it('starts tracking from the actual outbound send time using stage 0', () => {
    const item = followups.create('conv-outbound', {
      stages: [3, 7, 15, 30],
      scheduleId,
      useWorkingDays: false,
      reminderTime: '09:00',
    });

    expect(item).not.toBeNull();
    expect(item!.sequence.status).toBe('scheduled');
    expect(item!.sequence.currentStage).toBe(0);
    expect(item!.sequence.lastSentAt).toBe(SENT_AT);

    // Nov 17 + 3 calendar days = Nov 20, at the configured reminder time.
    const due = new Date(item!.sequence.nextDueAt as string);
    expect(due.getDate()).toBe(20);
    expect(due.getHours()).toBe(9);
    expect(due.getMinutes()).toBe(0);

    expect(item!.recipient).toBe('marco@partner.example');
    expect(item!.stageCount).toBe(4);
    expect(item!.account.email).toBe('alex@example.com');
  });

  it('never creates a duplicate sequence when enabled twice (spec §17)', () => {
    const again = followups.create('conv-outbound', {
      stages: [3, 7, 15, 30],
      scheduleId,
      useWorkingDays: false,
      reminderTime: '09:00',
    });
    const all = followups.list().filter((i) => i.conversation.id === 'conv-outbound');
    expect(all).toHaveLength(1);
    expect(again!.sequence.id).toBe(all[0].sequence.id);
  });

  it('refuses to track a conversation with no outbound message', () => {
    expect(
      followups.create('conv-inbound-only', {
        stages: [3],
        scheduleId,
        useWorkingDays: false,
        reminderTime: '09:00',
      }),
    ).toBeNull();
  });

  it('refuses an unknown conversation and an empty stage list', () => {
    expect(
      followups.create('nope', {
        stages: [3],
        scheduleId,
        useWorkingDays: false,
        reminderTime: '09:00',
      }),
    ).toBeNull();

    // A conversation that is trackable but has no sequence yet, so the empty
    // stage list — not idempotency — is what makes this return null.
    const ts = new Date().toISOString();
    service.db
      .prepare(
        "INSERT INTO conversations(id, account_id, subject, participants, last_message_at, created_at, updated_at) VALUES('conv-empty', 'acc-1', 'No stages', '[]', ?, ?, ?)",
      )
      .run(ts, ts, ts);
    service.db
      .prepare(
        `INSERT INTO messages(id, account_id, conversation_id, subject, from_address, to_addresses,
           sent_at, direction, created_at)
         VALUES('m-empty', 'acc-1', 'conv-empty', 'No stages', 'alex@example.com', '["marco@partner.example"]',
           ?, 'outbound', ?)`,
      )
      .run(SENT_AT, SENT_AT);

    expect(
      followups.create('conv-empty', {
        stages: [],
        scheduleId,
        useWorkingDays: false,
        reminderTime: '09:00',
      }),
    ).toBeNull();
    expect(
      followups.create('conv-empty', {
        stages: [0, -3],
        scheduleId,
        useWorkingDays: false,
        reminderTime: '09:00',
      }),
    ).toBeNull();
  });

  it('skips weekends when working-day counting is enabled', () => {
    // A second conversation sent on a Friday: 2026-11-13 is a Friday.
    const ts = new Date().toISOString();
    service.db
      .prepare(
        "INSERT INTO conversations(id, account_id, subject, participants, last_message_at, created_at, updated_at) VALUES('conv-fri', 'acc-1', 'Friday mail', '[]', ?, ?, ?)",
      )
      .run(ts, ts, ts);
    service.db
      .prepare(
        `INSERT INTO messages(id, account_id, conversation_id, subject, from_address, to_addresses,
           sent_at, direction, created_at)
         VALUES('m-fri', 'acc-1', 'conv-fri', 'Friday mail', 'alex@example.com', '["marco@partner.example"]',
           '2026-11-13T10:00:00.000', 'outbound', '2026-11-13T10:00:00.000')`,
      )
      .run();

    const item = followups.create('conv-fri', {
      stages: [3],
      scheduleId,
      useWorkingDays: true,
      reminderTime: '09:00',
    });
    const due = new Date(item!.sequence.nextDueAt as string);
    // Friday + 3 working days = Wednesday 18 Nov.
    expect(due.getDay()).toBe(3);
    expect(due.getDate()).toBe(18);
  });

  it('writes an enabling event so history is preserved', () => {
    const events = service.db
      .prepare(
        `SELECT kind FROM followup_events WHERE sequence_id = (
           SELECT id FROM followup_sequences WHERE conversation_id = 'conv-outbound')`,
      )
      .all() as { kind: string }[];
    expect(events.map((e) => e.kind)).toContain('enabled');
  });
});

describe('FollowUpRepository.disable', () => {
  let service: InstanceType<typeof DatabaseService>;
  let followups: InstanceType<typeof FollowUpRepository>;

  beforeAll(() => {
    service = new DatabaseService(':memory:');
    const ts = new Date().toISOString();
    service.db
      .prepare(
        "INSERT INTO accounts(id, provider, display_name, email, created_at, updated_at) VALUES('acc-1', 'imap', 'Personal', 'alex@example.com', ?, ?)",
      )
      .run(ts, ts);
    service.db
      .prepare(
        "INSERT INTO conversations(id, account_id, subject, participants, last_message_at, created_at, updated_at) VALUES('c1', 'acc-1', 'Proposal', '[]', ?, ?, ?)",
      )
      .run(ts, ts, ts);
    service.db
      .prepare(
        `INSERT INTO messages(id, account_id, conversation_id, subject, from_address, to_addresses, sent_at, direction, created_at)
         VALUES('m1', 'acc-1', 'c1', 'Proposal', 'alex@example.com', '["marco@partner.example"]', ?, 'outbound', ?)`,
      )
      .run(SENT_AT, SENT_AT);
    followups = new FollowUpRepository(service);
    followups.create('c1', {
      stages: [3, 7],
      scheduleId: null,
      useWorkingDays: false,
      reminderTime: '09:00',
    });
  });

  it('cancels tracking, clears the pending reminder and keeps the history', () => {
    followups.disable('c1');

    const item = followups.list().find((i) => i.conversation.id === 'c1')!;
    expect(item.status).toBe('cancelled');
    expect(item.sequence.nextDueAt).toBeNull();

    const events = service.db
      .prepare('SELECT kind FROM followup_events ORDER BY created_at')
      .all() as { kind: string }[];
    expect(events.map((e) => e.kind)).toEqual(['enabled', 'cancelled']);
  });

  it('is a no-op when nothing is being tracked', () => {
    expect(() => followups.disable('unknown-conversation')).not.toThrow();
    expect(followups.list()).toHaveLength(1);
  });
});

describe('FollowUpRepository.setSchedule', () => {
  let service: InstanceType<typeof DatabaseService>;
  let followups: InstanceType<typeof FollowUpRepository>;
  let schedules: InstanceType<typeof ScheduleRepository>;
  let sequenceId: string;
  let shortId: string;

  beforeAll(() => {
    service = new DatabaseService(':memory:');
    const ts = new Date().toISOString();
    service.db
      .prepare(
        "INSERT INTO accounts(id, provider, display_name, email, created_at, updated_at) VALUES('acc-1', 'imap', 'Personal', 'alex@example.com', ?, ?)",
      )
      .run(ts, ts);
    service.db
      .prepare(
        "INSERT INTO conversations(id, account_id, subject, participants, last_message_at, created_at, updated_at) VALUES('c1', 'acc-1', 'Proposal', '[]', ?, ?, ?)",
      )
      .run(ts, ts, ts);
    service.db
      .prepare(
        `INSERT INTO messages(id, account_id, conversation_id, subject, from_address, to_addresses, sent_at, direction, created_at)
         VALUES('m1', 'acc-1', 'c1', 'Proposal', 'alex@example.com', '["marco@partner.example"]', ?, 'outbound', ?)`,
      )
      .run(SENT_AT, SENT_AT);

    schedules = new ScheduleRepository(service);
    schedules.create({ name: 'Default', stages: [3, 7, 15, 30] });
    shortId = schedules.create({ name: 'Short', stages: [1, 2] }).id;
    followups = new FollowUpRepository(service);
    sequenceId = followups.create('c1', {
      stages: [3, 7, 15, 30],
      scheduleId: null,
      useWorkingDays: false,
      reminderTime: '09:00',
    })!.sequence.id;
  });

  it('recomputes the pending reminder from the actual last send time', () => {
    const longId = schedules.list().find((s) => s.name === 'Default')!.id;
    const before = followups.list()[0].sequence.nextDueAt;

    const item = followups.setSchedule(sequenceId, longId, {
      useWorkingDays: false,
      reminderTime: '17:30',
    });

    // Same 3-day stage, but the reminder time moved to 17:30.
    expect(item!.sequence.nextDueAt).not.toBe(before);
    const due = new Date(item!.sequence.nextDueAt as string);
    expect(due.getDate()).toBe(20);
    expect(due.getHours()).toBe(17);
    expect(due.getMinutes()).toBe(30);
    expect(item!.sequence.currentStage).toBe(0);
  });

  it('switches to a shorter schedule and keeps the stage index honest', () => {
    const item = followups.setSchedule(sequenceId, shortId, {
      useWorkingDays: false,
      reminderTime: '09:00',
    });
    // Stage 0 of the new schedule is 1 day: Nov 17 + 1 = Nov 18.
    const due = new Date(item!.sequence.nextDueAt as string);
    expect(due.getDate()).toBe(18);
    expect(item!.stageCount).toBe(2);
  });

  it('waits for a reply when the new schedule has no stage left to send', () => {
    // Move past the end of the 2-stage schedule.
    service.db
      .prepare('UPDATE followup_sequences SET current_stage = 2 WHERE id = ?')
      .run(sequenceId);

    const item = followups.setSchedule(sequenceId, shortId, {
      useWorkingDays: false,
      reminderTime: '09:00',
    });
    expect(item!.sequence.nextDueAt).toBeNull();
    expect(item!.status).toBe('waiting');
  });

  it('does not resurrect a cancelled sequence', () => {
    followups.disable('c1');
    const cancelled = followups.list()[0];
    expect(cancelled.status).toBe('cancelled');

    const longId = schedules.list().find((s) => s.name === 'Default')!.id;
    const item = followups.setSchedule(cancelled.sequence.id, longId, {
      useWorkingDays: false,
      reminderTime: '09:00',
    });
    expect(item!.status).toBe('cancelled');
  });

  it('records a schedule_changed event and rejects unknown ids', () => {
    const events = service.db
      .prepare("SELECT kind FROM followup_events WHERE kind = 'schedule_changed'")
      .all() as { kind: string }[];
    expect(events.length).toBeGreaterThan(0);

    expect(
      followups.setSchedule('nope', shortId, { useWorkingDays: false, reminderTime: '09:00' }),
    ).toBeNull();
    expect(
      followups.setSchedule(sequenceId, 'nope', { useWorkingDays: false, reminderTime: '09:00' }),
    ).toBeNull();
  });
});

describe('FollowUpRepository.updateStatus', () => {
  let service: InstanceType<typeof DatabaseService>;
  let followups: InstanceType<typeof FollowUpRepository>;
  let sequenceId: string;

  beforeAll(() => {
    service = new DatabaseService(':memory:');
    const ts = new Date().toISOString();
    service.db
      .prepare(
        "INSERT INTO accounts(id, provider, display_name, email, created_at, updated_at) VALUES('acc-1', 'imap', 'Personal', 'alex@example.com', ?, ?)",
      )
      .run(ts, ts);
    service.db
      .prepare(
        "INSERT INTO conversations(id, account_id, subject, participants, last_message_at, created_at, updated_at) VALUES('c1', 'acc-1', 'Proposal', '[]', ?, ?, ?)",
      )
      .run(ts, ts, ts);
    service.db
      .prepare(
        `INSERT INTO messages(id, account_id, conversation_id, subject, from_address, to_addresses, sent_at, direction, created_at)
         VALUES('m1', 'acc-1', 'c1', 'Proposal', 'alex@example.com', '["marco@partner.example"]', ?, 'outbound', ?)`,
      )
      .run(SENT_AT, SENT_AT);
    followups = new FollowUpRepository(service);
    sequenceId = followups.create('c1', {
      stages: [3, 7],
      scheduleId: null,
      useWorkingDays: false,
      reminderTime: '09:00',
    })!.sequence.id;
  });

  it('keeps the stored due date when snoozing', () => {
    const before = followups.list()[0].sequence.nextDueAt;
    followups.updateStatus(sequenceId, 'snoozed', 3);

    const after = followups.list()[0].sequence;
    expect(after.status).toBe('snoozed');
    expect(after.nextDueAt).toBe(before);
    expect(after.snoozedUntil).not.toBeNull();
    const days =
      (new Date(after.snoozedUntil as string).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(2);
    expect(days).toBeLessThanOrEqual(3.01);
  });

  it('clears the pending reminder when a sequence is completed', () => {
    followups.updateStatus(sequenceId, 'completed');
    const after = followups.list()[0].sequence;
    expect(after.status).toBe('completed');
    expect(after.nextDueAt).toBeNull();
    expect(after.snoozedUntil).toBeNull();
  });

  it('records a replied event and preserves history', () => {
    followups.updateStatus(sequenceId, 'replied');
    const events = service.db
      .prepare('SELECT kind FROM followup_events ORDER BY created_at')
      .all() as { kind: string }[];
    expect(events.map((e) => e.kind)).toEqual([
      'enabled',
      'snoozed',
      'completed',
      'replied',
    ]);
  });
});
