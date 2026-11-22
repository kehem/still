import { expect, it } from 'vitest';
import { emptyFollowUpImport } from '../../../shared/followup-import';
import type { FollowUpListItem } from '../../../shared/types';
import { importedFollowUpMessage } from './imported-message';
const item = { sequence: { id: 'f' }, conversation: { id: 'c' }, account: { email: 'sender@example.com' }, recipient: 'person@example.com', subject: 'Original', currentStage: 0, status: 'scheduled' } as FollowUpListItem;
const row = { row: 2, email: item.recipient, account: '', conversationId: 'c', subject: 'Original', messages: ['First', 'Second', 'Third'], subjects: ['Re: First', 'Re: Second', 'Re: Third'] };
it('uses the recipient-specific next follow-up based on retained send history without requiring row selection', () => {
  const workspace = { ...emptyFollowUpImport(), rows: [row], rowStages: { '2': 0 } };
  const second = { ...item, sentFollowUpCount: 1 };
  expect(importedFollowUpMessage(workspace, second, [second])).toEqual({ body: 'Second', subject: 'Re: Second' });
});
it('uses the actual send count or custom body source', () => {
  const workspace = { ...emptyFollowUpImport(), rows: [row], stage: 0 };
  const third = { ...item, sentFollowUpCount: 2 };
  expect(importedFollowUpMessage(workspace, third, [third])?.body).toBe('Third');
  expect(importedFollowUpMessage({ ...workspace, bodySource: 'custom', customBodies: ['', '', 'My third'] }, third, [third])).toEqual({ body: 'My third', subject: undefined });
});
it('never substitutes another recipient and refuses duplicate or empty matched templates', () => {
  const workspace = { ...emptyFollowUpImport(), rows: [row] };
  expect(importedFollowUpMessage({ ...workspace, rows: [{ ...row, email: 'other@example.com' }] }, item, [item])).toBeNull();
  expect(() => importedFollowUpMessage({ ...workspace, rows: [row, { ...row, row: 3 }] }, item, [item])).toThrow('More than one');
  expect(() => importedFollowUpMessage(workspace, { ...item, sentFollowUpCount: 9 }, [{ ...item, sentFollowUpCount: 9 }])).toThrow('empty');
});
