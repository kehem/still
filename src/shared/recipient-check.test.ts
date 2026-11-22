import { expect, it } from 'vitest';
import { recipientCanSend } from './recipient-check';
it('allows SMTP acceptance and catch-all results without allowing unknown/invalid checks', () => {
  expect(recipientCanSend({ status: 'valid', detail: 'Accepted' })).toBe(true);
  expect(recipientCanSend({ status: 'catch_all', detail: 'Unverified mailbox' })).toBe(true);
  expect(recipientCanSend({ status: 'invalid', detail: 'No mailbox' })).toBe(false);
  expect(recipientCanSend({ status: 'unknown', detail: 'Timeout' })).toBe(false);
  expect(recipientCanSend()).toBe(false);
});
it('treats expired accepted and catch-all checks as not sendable', () => {
  expect(recipientCanSend({ status: 'valid', detail: 'Old acceptance', expiresAt: Date.now() - 1 })).toBe(false);
  expect(recipientCanSend({ status: 'catch_all', detail: 'Old catch-all', expiresAt: Date.now() - 1 })).toBe(false);
  expect(recipientCanSend({ status: 'valid', detail: 'Fresh', expiresAt: Date.now() + 300000 })).toBe(true);
});
