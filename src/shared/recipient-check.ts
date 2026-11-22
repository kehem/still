import type { RecipientCheck } from './types';

/** SMTP acceptance allows sending, but never proves mailbox existence. */
export const recipientCanSend = (check?: RecipientCheck): boolean => Boolean(check && (check.status === 'valid' || check.status === 'catch_all') && (check.expiresAt === undefined || check.expiresAt > Date.now()));
