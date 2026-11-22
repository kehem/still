import { decodeFollowUpDraftText } from '../../../shared/followup-import';
import type { FollowUpImportWorkspace } from '../../../shared/followup-import';
import type { FollowUpListItem } from '../../../shared/types';
import { matchFollowUp } from './spreadsheet';

/** Resolve saved templates for the normal list/reading-pane follow-up action. */
export function importedFollowUpMessage(workspace: FollowUpImportWorkspace, item: FollowUpListItem, items: FollowUpListItem[]): { body: string; subject?: string } | null {
  const candidates = workspace.rows.filter(row => matchFollowUp(row, items).item?.sequence.id === item.sequence.id);
  if (!candidates.length) {
    const related = workspace.rows.filter(row => row.email.trim().toLowerCase() === item.recipient.trim().toLowerCase()
      && (!row.account || row.account.trim().toLowerCase() === item.account.email.trim().toLowerCase()));
    if (related.length) throw new Error(`Saved messages exist for ${item.recipient}, but cannot be matched safely to this conversation. Check the Original Subject or Conversation ID in the import table.`);
    return null;
  }
  if (candidates.length > 1) throw new Error('More than one imported row matches this conversation. Choose the intended row in the import table.');
  const row = candidates[0];
  const stage = Math.max(item.sentFollowUpCount ?? 0, item.currentStage ?? 0);
  const body = workspace.bodySource === 'custom' ? workspace.customBodies[stage] : decodeFollowUpDraftText(row.messages[stage] || '');
  if (!body?.trim()) throw new Error(`The saved Follow-up ${stage + 1} body for ${item.recipient} is empty. Choose a message in the import table first.`);
  return { body, subject: workspace.bodySource === 'spreadsheet' ? decodeFollowUpDraftText(row.subjects?.[stage] || '') || undefined : undefined };
}
