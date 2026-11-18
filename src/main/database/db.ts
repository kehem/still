import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { app } from 'electron';
import { MIGRATIONS } from './migrations';
import { DEFAULT_FOLLOWUP_STAGES } from '../../shared/constants';

export class DatabaseService {
  readonly db: Database.Database;
  readonly dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('synchronous = NORMAL');
    this.runMigrations();
    this.seedDefaults();
  }

  private runMigrations(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);
    const applied = new Set(
      (
        this.db.prepare('SELECT version FROM schema_migrations').all() as {
          version: number;
        }[]
      ).map((row) => row.version),
    );
    const apply = this.db.transaction((version: number, name: string, sql: string) => {
      this.db.exec(sql);
      this.db
        .prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES(?, ?, ?)')
        .run(version, name, new Date().toISOString());
    });
    for (const migration of MIGRATIONS) {
      if (!applied.has(migration.version)) {
        apply(migration.version, migration.name, migration.sql);
      }
    }
  }

  private seedDefaults(): void {
    const count = this.db
      .prepare('SELECT COUNT(*) AS n FROM followup_schedules')
      .get() as { n: number };
    if (count.n === 0) {
      const ts = new Date().toISOString();
      this.db
        .prepare(
          'INSERT INTO followup_schedules(id, name, stages, is_default, created_at, updated_at) VALUES(?, ?, ?, 1, ?, ?)',
        )
        .run(randomUUID(), 'Default', JSON.stringify(DEFAULT_FOLLOWUP_STAGES), ts, ts);
    }
  }

  close(): void {
    this.db.close();
  }
}

export function getDefaultDbPath(): string {
  return path.join(app.getPath('userData'), 'still.db');
}

/**
 * Opens the local database, quarantining a corrupt file instead of failing
 * silently (spec §16 "Recovery mechanisms").
 *
 * A corrupt or locked database used to mean no window and no explanation. Now
 * the damaged files are renamed with a `.corrupt-<timestamp>` suffix — the
 * user's data is never deleted — and a fresh database is created so the app
 * still starts. Returns the service plus what happened, so the caller can tell
 * the user.
 */
export function openDatabaseWithRecovery(dbPath: string): {
  service: DatabaseService;
  recovered: boolean;
  quarantined: string[];
  error: string | null;
} {
  try {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    return { service: new DatabaseService(dbPath), recovered: false, quarantined: [], error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const quarantined: string[] = [];
    for (const suffix of ['', '-wal', '-shm']) {
      const candidate = dbPath + suffix;
      if (fs.existsSync(candidate)) {
        const target = `${candidate}.corrupt-${stamp}`;
        try {
          fs.renameSync(candidate, target);
          quarantined.push(target);
        } catch {
          // If a file cannot be moved, fall through and let the retry surface it.
        }
      }
    }
    // One retry on a clean path; if this throws, the caller sees the real error.
    return {
      service: new DatabaseService(dbPath),
      recovered: true,
      quarantined,
      error: message,
    };
  }
}
