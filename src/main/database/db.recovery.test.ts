import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir() },
}));

const { DatabaseService, openDatabaseWithRecovery } = await import('./db');

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'still-db-'));
  dbPath = path.join(dir, 'nested', 'still.db');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('openDatabaseWithRecovery', () => {
  it('creates the database and its parent directory on first run', () => {
    const { service, recovered, quarantined, error } = openDatabaseWithRecovery(dbPath);

    expect(recovered).toBe(false);
    expect(quarantined).toEqual([]);
    expect(error).toBeNull();
    expect(fs.existsSync(dbPath)).toBe(true);
    expect(
      (service.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'accounts'").get() as { n: number }).n,
    ).toBe(1);
    service.close();
  });

  it('reopens an existing database without touching its data', () => {
    const first = openDatabaseWithRecovery(dbPath).service;
    first.db
      .prepare(
        "INSERT INTO accounts(id, provider, display_name, email, created_at, updated_at) VALUES('a1','imap','Personal','a@example.com','2026-01-01','2026-01-01')",
      )
      .run();
    first.close();

    const { service, recovered } = openDatabaseWithRecovery(dbPath);
    expect(recovered).toBe(false);
    expect((service.db.prepare('SELECT COUNT(*) AS n FROM accounts').get() as { n: number }).n).toBe(1);
    service.close();
  });

  it('quarantines a corrupt database and starts a working one instead of failing', () => {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    // 4KB of garbage: SQLite rejects this with "file is not a database".
    fs.writeFileSync(dbPath, Buffer.alloc(4096, 0x2f));

    const { service, recovered, quarantined, error } = openDatabaseWithRecovery(dbPath);

    expect(recovered).toBe(true);
    expect(error).toBeTruthy();
    expect(quarantined).toHaveLength(1);
    // The user's file is renamed, never deleted.
    expect(fs.existsSync(quarantined[0])).toBe(true);
    expect(fs.statSync(quarantined[0]).size).toBe(4096);
    // And the app still gets a usable, fully migrated database.
    expect(
      (service.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'messages'").get() as { n: number }).n,
    ).toBe(1);
    service.close();
  });

  it('quarantines the WAL and SHM sidecars alongside the main file', () => {
    const first = openDatabaseWithRecovery(dbPath).service;
    first.db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').run();
    // Corrupt the main file while leaving plausible sidecars behind.
    first.close();
    fs.writeFileSync(dbPath, Buffer.alloc(4096, 0x5a));
    fs.writeFileSync(dbPath + '-wal', Buffer.alloc(64, 1));
    fs.writeFileSync(dbPath + '-shm', Buffer.alloc(64, 2));

    const { service, recovered, quarantined } = openDatabaseWithRecovery(dbPath);
    expect(recovered).toBe(true);
    expect(quarantined).toHaveLength(3);
    // Each original file was moved aside, never deleted.
    for (const file of quarantined) {
      expect(fs.existsSync(file)).toBe(true);
      expect(fs.statSync(file).size).toBeGreaterThan(0);
    }
    expect(quarantined.some((f) => f.includes('-wal.corrupt-'))).toBe(true);
    expect(quarantined.some((f) => f.includes('-shm.corrupt-'))).toBe(true);
    // The reopened database recreates its own sidecars, which is expected.
    service.close();
  });

  it('seeds the default follow-up schedule exactly once across recovery', () => {
    const first = openDatabaseWithRecovery(dbPath).service;
    first.close();
    fs.writeFileSync(dbPath, Buffer.alloc(4096, 0x11));
    const second = openDatabaseWithRecovery(dbPath).service;

    const count = second.db.prepare('SELECT COUNT(*) AS n FROM followup_schedules').get() as {
      n: number;
    };
    expect(count.n).toBe(1);
    const stages = second.db.prepare('SELECT stages FROM followup_schedules').get() as {
      stages: string;
    };
    expect(JSON.parse(stages.stages)).toEqual([3, 7, 15, 30]);
    second.close();
  });

  it('still constructs a DatabaseService directly for callers that want the raw error', () => {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    fs.writeFileSync(dbPath, Buffer.alloc(4096, 0x2f));
    expect(() => new DatabaseService(dbPath)).toThrow();
  });
});
