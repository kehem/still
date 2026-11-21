/** Test-only adapter. Production always loads better-sqlite3 for Electron. */
import { DatabaseSync } from 'node:sqlite';
export default class TestSQLite {
  private readonly sqlite: DatabaseSync;
  private depth = 0;
  constructor(file: string) { this.sqlite = new DatabaseSync(file); }
  prepare(sql: string) { return this.sqlite.prepare(sql); }
  exec(sql: string) { this.sqlite.exec(sql); return this; }
  close() { this.sqlite.close(); }
  pragma(sql: string, options?: { simple?: boolean }) {
    const rows = this.sqlite.prepare(`PRAGMA ${sql}`).all();
    return options?.simple ? Object.values(rows[0] || {})[0] : rows;
  }
  transaction<Args extends unknown[], Result>(fn: (...args: Args) => Result) {
    return (...args: Args): Result => {
      const name = `test_tx_${this.depth++}`;
      const nested = this.depth > 1;
      this.sqlite.exec(nested ? `SAVEPOINT ${name}` : 'BEGIN IMMEDIATE');
      try {
        const result = fn(...args);
        this.sqlite.exec(nested ? `RELEASE ${name}` : 'COMMIT'); return result;
      } catch (error) {
        this.sqlite.exec(nested ? `ROLLBACK TO ${name}; RELEASE ${name}` : 'ROLLBACK'); throw error;
      } finally { this.depth--; }
    };
  }
}
