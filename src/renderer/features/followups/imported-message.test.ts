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
it('fills distinct bodies for multiple recipients at first, second and third follow-ups', () => {
  const recipients = [0, 1, 2].map(index => ({ ...item, recipient: `person${index}@example.com`, conversation: { ...item.conversation, id: `c${index}` }, sequence: { ...item.sequence, id: `f${index}` }, sentFollowUpCount: index, subject: 'Re: Original' }));
  const workspace = { ...emptyFollowUpImport(), rows: recipients.map((recipient, index) => ({ ...row, row: index + 2, email: recipient.recipient, conversationId: '', messages: [`First ${index}`, `Second ${index}`, `Third ${index}`] })) };
  expect(recipients.map(recipient => importedFollowUpMessage(workspace, recipient, recipients)?.body)).toEqual(['First 0', 'Second 1', 'Third 2']);
});
it('shows a matching problem rather than silently opening a blank imported reply', () => {
  expect(() => importedFollowUpMessage({ ...emptyFollowUpImport(), rows: [{ ...row, conversationId: '', subject: 'Different thread' }] }, item, [item])).toThrow('cannot be matched safely');
});
it('uses already-saved single-escaped subjects and bodies without reimporting the workbook', () => {
  const target = { ...item, subject: 'Original — Example' };
  const saved = { ...row, conversationId: '', subject: String.raw`Original \u2014 Example`, messages: [String.raw`First\n\nHello`, 'Second', 'Third'], subjects: [String.raw`Re: Original \u2014 Example`] };
  expect(importedFollowUpMessage({ ...emptyFollowUpImport(), rows: [saved] }, target, [target])).toEqual({ body: 'First\n\nHello', subject: 'Re: Original — Example' });
});
