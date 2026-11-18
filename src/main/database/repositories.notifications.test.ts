import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `db.ts` resolves an Electron userData path; these repositories do not need
// Electron itself.
vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir() },
}));

const { DatabaseService } = await import('./db');
const { NotificationRepository } = await import('./repositories');
const { DEFAULT_SETTINGS } = await import('../../shared/constants');
import type { ReminderOptions } from '../../shared/notifications/reminder-engine';

type Service = InstanceType<typeof DatabaseService>;
type Repo = InstanceType<typeof NotificationRepository>;

/**
 * A reminder fell due at 09:00 on 17 Nov; "now" is 10:00 the same day.
 *
 * These two are fixed instants, which is right for due/not-due, dedupe and
 * restart behaviour — all of which compare absolute points in time.
 */
const DUE_AT = new Date('2026-11-17T09:00:00.000Z');
const NOW = new Date('2026-11-17T10:00:00.000Z');

/**
 * A **local** wall-clock moment, for the two settings that are genuinely
 * local-time concepts: quiet hours ("do not disturb 22:00–08:00") and the
 * daily digest time. Anchoring those to a UTC string makes the assertion
 * depend on the machine's offset — 23:00Z is 18:00 in New York and 12:00 in
 * Kiritimati — so the fixture has to be built in local time and converted.
 */
function local(day: number, hour: number, minute = 0): Date {
  return new Date(2026, 10, day, hour, minute, 0, 0);
}

function opts(overrides: Partial<ReminderOptions> = {}): ReminderOptions {
  return {
    quietHours: {
      enabled: DEFAULT_SETTINGS.quietHoursEnabled,
      start: DEFAULT_SETTINGS.quietHoursStart,
      end: DEFAULT_SETTINGS.quietHoursEnd,
    },
    frequency: DEFAULT_SETTINGS.notificationFrequency,
    reminderTime: DEFAULT_SETTINGS.reminderTime,
    overdueRepeatHours: DEFAULT_SETTINGS.overdueReminderRepeatHours,
    ...overrides,
  };
}

/** Seeds one account, one conversation and one due follow-up sequence. */
function seed(
  service: Service,
  sequence: Partial<{
    id: string;
    conversationId: string;
    status: string;
    currentStage: number;
    nextDueAt: string | null;
    subject: string;
    participants: string[];
    stages: number[];
  }> = {},
): void {
  const ts = new Date().toISOString();
  const id = sequence.id ?? 'seq-1';
  const conversationId = sequence.conversationId ?? 'conv-1';

  service.db
    .prepare(
      "INSERT OR IGNORE INTO accounts(id, provider, display_name, email, created_at, updated_at) VALUES('acc-1','imap','Personal','alex@example.com',?,?)",
    )
    .run(ts, ts);
  // `DatabaseService` seeds one default schedule with a generated id; reuse it
  // rather than creating a second `is_default` row.
  const schedule = service.db
    .prepare('SELECT id FROM followup_schedules WHERE is_default = 1 LIMIT 1')
    .get() as { id: string };
  if (sequence.stages) {
    service.db
      .prepare('UPDATE followup_schedules SET stages = ? WHERE id = ?')
      .run(JSON.stringify(sequence.stages), schedule.id);
  }
  service.db
    .prepare(
      'INSERT INTO conversations(id, account_id, subject, participants, last_message_at, created_at, updated_at) VALUES(?,?,?,?,?,?,?)',
    )
    .run(
      conversationId,
      'acc-1',
      sequence.subject ?? 'Proposal for Q1',
      JSON.stringify(sequence.participants ?? ['marco@partner.example']),
      ts,
      ts,
      ts,
    );
  service.db
    .prepare(
      `INSERT INTO followup_sequences(id, conversation_id, account_id, schedule_id, current_stage,
         status, last_sent_at, next_due_at, created_at, updated_at)
       VALUES(?, ?, 'acc-1', ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      conversationId,
      schedule.id,
      sequence.currentStage ?? 0,
      sequence.status ?? 'scheduled',
      ts,
      sequence.nextDueAt === undefined ? DUE_AT.toISOString() : sequence.nextDueAt,
      ts,
      ts,
    );
}

describe('NotificationRepository.scan', () => {
  let service: Service;
  let notifications: Repo;

  beforeEach(() => {
    service = new DatabaseService(':memory:');
    notifications = new NotificationRepository(service);
  });

  afterEach(() => service.close());

  it('raises a reminder once a stored due time has passed', () => {
    seed(service);
    const ready = notifications.scan(NOW, opts());

    expect(ready).toHaveLength(1);
    expect(ready[0].kind).toBe('followup_due');
    expect(ready[0].title).toBe('Follow-up due');
    expect(ready[0].conversationId).toBe('conv-1');
    expect(ready[0].sequenceId).toBe('seq-1');
    expect(ready[0].dueAt).toBe(DUE_AT.toISOString());
    expect(ready[0].isRead).toBe(false);
  });

  it('raises nothing when the reminder is not due yet', () => {
    seed(service, { nextDueAt: new Date('2026-11-20T09:00:00.000Z').toISOString() });
    expect(notifications.scan(NOW, opts())).toEqual([]);
    expect(notifications.list()).toEqual([]);
  });

  it('is idempotent: scanning repeatedly never duplicates a reminder', () => {
    seed(service);
    notifications.scan(NOW, opts());
    notifications.scan(NOW, opts());
    notifications.scan(new Date(NOW.getTime() + 60_000), opts());

    expect(notifications.list()).toHaveLength(1);
    expect(notifications.unreadCount()).toBe(1);
  });

  it('ignores sequences that were cancelled, completed, replied or snoozed', () => {
    for (const status of ['cancelled', 'completed', 'replied', 'snoozed']) {
      const isolated = new DatabaseService(':memory:');
      seed(isolated, { status });
      expect(new NotificationRepository(isolated).scan(NOW, opts())).toEqual([]);
      isolated.close();
    }
  });

  it('ignores a sequence whose due time was cleared', () => {
    seed(service, { nextDueAt: null });
    expect(notifications.scan(NOW, opts())).toEqual([]);
  });

  it('raises a reminder that fell due while the app was closed', () => {
    // Due at 09:00; the app only starts again at 18:00 the same day.
    seed(service);
    const reopen = new Date('2026-11-17T18:00:00.000Z');
    const ready = notifications.scan(reopen, opts());

    expect(ready).toHaveLength(1);
    expect(ready[0].dueAt).toBe(DUE_AT.toISOString());
  });

  it('marks a reminder overdue once a day has passed', () => {
    seed(service);
    const nextDay = new Date('2026-11-18T12:00:00.000Z');
    const ready = notifications.scan(nextDay, opts());

    expect(ready).toHaveLength(1);
    expect(ready[0].kind).toBe('followup_overdue');
  });

  it('holds a reminder inside quiet hours instead of surfacing it', () => {
    // Due at 23:00 local, inside a 22:00–08:00 local window.
    seed(service, { nextDueAt: local(17, 23, 0).toISOString() });
    const night = local(17, 23, 30);
    const quiet = opts({
      quietHours: { enabled: true, start: '22:00', end: '08:00' },
    });

    // Planned and stored, but not ready to deliver yet.
    expect(notifications.scan(night, quiet)).toEqual([]);
    expect(notifications.list()).toHaveLength(1);
    // Held until the window closes at 08:00 the next morning.
    expect(new Date(notifications.list()[0].deliverAt as string).getHours()).toBe(8);

    // It surfaces once the window closes.
    const ready = notifications.scan(local(18, 8, 30), quiet);
    expect(ready).toHaveLength(1);
    expect(ready[0].title).toBe('Follow-up due');
  });

  it('delivers a batched digest at the configured time rather than immediately', () => {
    // 17:30 is a local wall-clock time, so the fixture is local too.
    seed(service, { nextDueAt: local(17, 9, 0).toISOString() });
    const daily = opts({ frequency: 'daily', reminderTime: '17:30' });

    // Due 09:00, now 10:00 — the daily digest is not ready until 17:30.
    expect(notifications.scan(local(17, 10, 0), daily)).toEqual([]);
    expect(notifications.list()).toHaveLength(1);
    const deliver = new Date(notifications.list()[0].deliverAt as string);
    expect(deliver.getHours()).toBe(17);
    expect(deliver.getMinutes()).toBe(30);

    expect(notifications.scan(local(17, 18, 0), daily)).toHaveLength(1);
  });

  it('raises a fresh reminder for each repeat of an unhandled one', () => {
    seed(service);
    const repeating = opts({ overdueRepeatHours: 4 });

    // Each scan is followed by marking delivered, exactly as the main process
    // pump does — otherwise pending rows keep being reported as ready.
    const round0 = notifications.scan(NOW, repeating);
    expect(round0).toHaveLength(1);
    notifications.markDelivered(round0.map((n) => n.id), NOW);

    const plus4 = new Date('2026-11-17T14:00:00.000Z');
    const round1 = notifications.scan(plus4, repeating);
    expect(round1).toHaveLength(1);
    expect(round1[0].dedupeKey).toBe('followup:seq-1:stage:0:repeat:1');
    notifications.markDelivered(round1.map((n) => n.id), plus4);

    expect(notifications.list()).toHaveLength(2);

    // The same clock reading never produces a third row.
    expect(notifications.scan(plus4, repeating)).toEqual([]);
    expect(notifications.list()).toHaveLength(2);
  });

  it('gives a second conversation its own reminder', () => {
    seed(service);
    seed(service, {
      id: 'seq-2',
      conversationId: 'conv-2',
      subject: 'Invoice 42',
      participants: ['dana@client.example'],
    });

    const ready = notifications.scan(NOW, opts());
    expect(ready).toHaveLength(2);
    expect(new Set(ready.map((n) => n.sequenceId))).toEqual(new Set(['seq-1', 'seq-2']));
  });

  it('names the recipient rather than the account owner', () => {
    seed(service);
    const [ready] = notifications.scan(NOW, opts());
    expect(ready.body).toContain('marco@partner.example');
    expect(ready.body).not.toContain('alex@example.com');
  });
});

describe('reminder delivery state', () => {
  let service: Service;
  let notifications: Repo;

  beforeEach(() => {
    service = new DatabaseService(':memory:');
    notifications = new NotificationRepository(service);
    seed(service);
  });

  afterEach(() => service.close());

  it('does not re-deliver a reminder already shown', () => {
    const first = notifications.scan(NOW, opts());
    notifications.markDelivered(first.map((n) => n.id), NOW);

    expect(notifications.scan(new Date(NOW.getTime() + 60_000), opts())).toEqual([]);
    // Still listed, just no longer pending.
    expect(notifications.list()).toHaveLength(1);
    expect(notifications.list()[0].deliveredAt).toBeTruthy();
  });

  it('tracks read state and unread counts', () => {
    const [item] = notifications.scan(NOW, opts());
    expect(notifications.unreadCount()).toBe(1);

    notifications.markRead(item.id);
    expect(notifications.unreadCount()).toBe(0);
    expect(notifications.list()[0].isRead).toBe(true);

    notifications.markAllRead();
    expect(notifications.unreadCount()).toBe(0);
  });

  it('dismisses a single reminder', () => {
    const [item] = notifications.scan(NOW, opts());
    notifications.remove(item.id);
    expect(notifications.list()).toEqual([]);
  });

  it('drops every reminder for a conversation whose tracking was turned off', () => {
    const [item] = notifications.scan(NOW, opts());
    notifications.removeForConversation(item.conversationId as string);
    expect(notifications.list()).toEqual([]);
  });

  it('leaves other conversations alone when one is cleared', () => {
    seed(service, {
      id: 'seq-2',
      conversationId: 'conv-2',
      subject: 'Invoice 42',
      participants: ['dana@client.example'],
    });
    notifications.scan(NOW, opts());
    expect(notifications.list()).toHaveLength(2);

    notifications.removeForConversation('conv-1');
    const remaining = notifications.list();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].conversationId).toBe('conv-2');
  });

  it('drops undelivered reminders on a schedule change but keeps ones already shown', () => {
    const [shown] = notifications.scan(NOW, opts());
    notifications.markDelivered([shown.id], NOW);

    // A second occurrence becomes due and has not been shown yet.
    const later = new Date('2026-11-17T14:00:00.000Z');
    const [pending] = notifications.scan(later, opts({ overdueRepeatHours: 4 }));
    expect(pending.deliveredAt).toBeNull();
    expect(notifications.list()).toHaveLength(2);

    notifications.removePendingForSequence('seq-1');

    const kept = notifications.list();
    expect(kept).toHaveLength(1);
    expect(kept[0].id).toBe(shown.id);
    expect(kept[0].deliveredAt).toBeTruthy();
  });

  it('clamps the list limit to a sane range', () => {
    notifications.scan(NOW, opts());
    expect(notifications.list(0)).toHaveLength(1);
    expect(notifications.list(10_000)).toHaveLength(1);
  });
});

describe('reminders survive an app restart', () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'still-notify-'));
    dbPath = path.join(dir, 'still.db');
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('keeps a raised reminder and never raises it a second time', () => {
    // First session: the reminder falls due and is raised.
    const first = new DatabaseService(dbPath);
    seed(first);
    const firstRepo = new NotificationRepository(first);
    // Repeats disabled so this test isolates restart behaviour from the
    // shipped 24h repeat default (covered separately above).
    const noRepeat = opts({ overdueRepeatHours: 0 });
    const raised = firstRepo.scan(NOW, noRepeat);
    expect(raised).toHaveLength(1);
    firstRepo.markDelivered(raised.map((n) => n.id), NOW);
    first.close();

    // Second session: a brand new connection over the same file.
    const second = new DatabaseService(dbPath);
    const secondRepo = new NotificationRepository(second);
    expect(secondRepo.scan(new Date(NOW.getTime() + 5 * 60_000), noRepeat)).toEqual([]);
    expect(secondRepo.list()).toHaveLength(1);
    expect(secondRepo.list()[0].dedupeKey).toBe(raised[0].dedupeKey);
    second.close();

    // Third session, a day later: still exactly the one original reminder.
    const third = new DatabaseService(dbPath);
    const thirdRepo = new NotificationRepository(third);
    thirdRepo.scan(new Date('2026-11-18T12:00:00.000Z'), noRepeat);
    expect(thirdRepo.list()).toHaveLength(1);
    third.close();
  });

  it('raises a reminder that fell due while the app was shut, on the next launch', () => {
    const first = new DatabaseService(dbPath);
    seed(first, { nextDueAt: new Date('2026-11-19T09:00:00.000Z').toISOString() });
    // Launched before it was due: nothing raised.
    expect(new NotificationRepository(first).scan(NOW, opts())).toEqual([]);
    first.close();

    // Relaunched two days later.
    const second = new DatabaseService(dbPath);
    const repo = new NotificationRepository(second);
    const ready = repo.scan(new Date('2026-11-21T08:00:00.000Z'), opts());
    expect(ready).toHaveLength(1);
    expect(ready[0].dueAt).toBe(new Date('2026-11-19T09:00:00.000Z').toISOString());
    second.close();
  });

  it('re-surfaces a reminder that was raised but never shown before a crash', () => {
    const first = new DatabaseService(dbPath);
    seed(first);
    const raised = new NotificationRepository(first).scan(NOW, opts());
    expect(raised).toHaveLength(1);
    // No close() and no markDelivered(): the app died before the banner showed.
    const second = new DatabaseService(dbPath);
    const repo = new NotificationRepository(second);

    // It is still pending, so the relaunched app shows it — but exactly once,
    // with the same dedupe key rather than a duplicate row.
    const again = repo.scan(new Date(NOW.getTime() + 60_000), opts());
    expect(again).toHaveLength(1);
    expect(again[0].dedupeKey).toBe(raised[0].dedupeKey);
    expect(repo.list()).toHaveLength(1);
    second.close();
  });
});
