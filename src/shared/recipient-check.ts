import type { RecipientCheck } from './types';

/** SMTP acceptance allows sending, but never proves mailbox existence. */
export const recipientCanSend = (check?: RecipientCheck): boolean => check?.status === 'valid' || check?.status === 'catch_all';
