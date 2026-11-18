import type { Account, FolderFilter, Settings } from '../types';
import { FOLDER_FILTERS } from '../types';
import { ALL_INBOX } from '../constants';

/**
 * Startup navigation rules (spec §4 Scenarios B/C and §11 General/Inbox).
 *
 * Pure so the first-launch routing can be unit tested without rendering UI.
 */

function isFolderFilter(value: string): value is FolderFilter {
  return (FOLDER_FILTERS as string[]).includes(value);
}

/** The folder Still opens on launch, given settings, accounts and last use. */
export function resolveHomeFolder(
  settings: Settings,
  accounts: readonly Account[],
  lastUsedFolder: string | null,
): string {
  const accountIds = new Set(accounts.map((a) => a.id));
  const unifiedAllowed = settings.unifiedInboxEnabled;

  const firstAccountFolder = (): string => accounts[0]?.id ?? ALL_INBOX;

  // With the unified inbox turned off, an account inbox is always the home.
  if (!unifiedAllowed) {
    return settings.defaultInboxId && accountIds.has(settings.defaultInboxId)
      ? settings.defaultInboxId
      : firstAccountFolder();
  }

  // "Restore last session" honours the remembered folder when it is still valid.
  if (settings.startupBehavior === 'restore' && settings.rememberLastInbox && lastUsedFolder) {
    if (
      lastUsedFolder === ALL_INBOX ||
      isFolderFilter(lastUsedFolder) ||
      accountIds.has(lastUsedFolder)
    ) {
      return lastUsedFolder;
    }
  }

  // Scenario B: exactly one account → open that account's inbox directly.
  if (accounts.length === 1) return accounts[0].id;

  // Scenario C: multiple accounts → default inbox, otherwise All Inbox.
  if (settings.defaultOpeningPage === 'all-inbox') return ALL_INBOX;

  if (settings.defaultInboxId && accountIds.has(settings.defaultInboxId)) {
    return settings.defaultInboxId;
  }
  return ALL_INBOX;
}

/** Translate a sidebar selection into a message-list query. */
export function folderToMessageOptions(
  folder: string,
  accounts: readonly Account[],
): { accountId?: string; folderKind?: FolderFilter } {
  if (folder === ALL_INBOX) return { folderKind: 'inbox' };
  if (accounts.some((a) => a.id === folder)) return { accountId: folder, folderKind: 'inbox' };
  if (isFolderFilter(folder)) return { folderKind: folder };
  return { folderKind: 'inbox' };
}
