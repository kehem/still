import { safeStorage } from 'electron';
import type { DatabaseService } from '../database/db';

/**
 * OS-backed credential storage (spec §3).
 * Passwords and OAuth tokens are encrypted with the platform keychain
 * (DPAPI on Windows, Keychain on macOS, libsecret on Linux) and stored
 * as ciphertext in the local database. Plaintext never touches disk.
 */
export class CredentialStore {
  constructor(private readonly db: DatabaseService) {}

  isAvailable(): boolean {
    return safeStorage.isEncryptionAvailable();
  }

  set(accountId: string, kind: string, plaintext: string): void {
    if (!this.isAvailable()) {
      throw new Error(
        'OS credential encryption is unavailable on this device. ' +
          'Connect an account after unlocking your system keychain.',
      );
    }
    const ciphertext = safeStorage.encryptString(plaintext);
    this.db.db
      .prepare(
        'INSERT INTO credentials(account_id, kind, ciphertext) VALUES(?, ?, ?) ' +
          'ON CONFLICT(account_id, kind) DO UPDATE SET ciphertext = excluded.ciphertext',
      )
      .run(accountId, kind, ciphertext);
  }

  get(accountId: string, kind: string): string | null {
    const row = this.db.db
      .prepare('SELECT ciphertext FROM credentials WHERE account_id = ? AND kind = ?')
      .get(accountId, kind) as { ciphertext: Buffer } | undefined;
    if (!row) return null;
    return safeStorage.decryptString(row.ciphertext);
  }

  remove(accountId: string, kind: string): void {
    this.db.db
      .prepare('DELETE FROM credentials WHERE account_id = ? AND kind = ?')
      .run(accountId, kind);
  }
}
