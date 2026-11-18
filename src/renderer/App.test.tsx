// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Account, FollowUpListItem, FollowUpSequence, Message } from '../shared/types';

const LS = 'still-preview:';

async function renderApp() {
  vi.resetModules();
  const { App } = await import('./App');
  return render(<App />);
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-density');
});

afterEach(() => {
  cleanup();
  vi.resetModules();
});

describe('first launch (spec §4 Scenario A)', () => {
  it('opens account setup — not a dashboard or an empty inbox — when no account exists', async () => {
    localStorage.setItem(LS + 'accounts', '[]');
    await renderApp();

    expect(await screen.findByText('Welcome to Still.')).toBeTruthy();
    expect(screen.getByText('Continue with Google')).toBeTruthy();
    expect(screen.getByText('Continue with Microsoft')).toBeTruthy();
    expect(screen.getByText('Connect using IMAP/SMTP')).toBeTruthy();
    expect(screen.queryByText('All Inbox')).toBeNull();
  });

  it('opens the IMAP/SMTP form and connects an account', async () => {
    localStorage.setItem(LS + 'accounts', '[]');
    await renderApp();

    fireEvent.click(await screen.findByText('Connect using IMAP/SMTP'));
    fireEvent.change(screen.getByPlaceholderText('Personal'), { target: { value: 'Personal' } });
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), {
      target: { value: 'alex@example.com' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Connect account' }));

    // Scenario B: one account → its inbox opens immediately.
    expect(await screen.findByRole('heading', { name: 'Personal' })).toBeTruthy();
    const saved = JSON.parse(localStorage.getItem(LS + 'accounts') ?? '[]');
    expect(saved).toHaveLength(1);
    expect(saved[0].email).toBe('alex@example.com');
  });
});

describe('unified inbox (spec §5)', () => {
  it('aggregates messages from every connected account', async () => {
    await renderApp();

    await screen.findByRole('heading', { name: 'All Inbox' });
    // Personal account mail…
    expect(await screen.findByText('Q4 planning sync')).toBeTruthy();
    // …and work account mail in the same chronological list.
    expect(await screen.findByText('Budget approval needed')).toBeTruthy();
    expect(await screen.findByText('Renewal quote')).toBeTruthy();
    // The list header shows the aggregated count of received messages.
    const header = screen.getByRole('heading', { name: 'All Inbox' })
      .parentElement as HTMLElement;
    expect(within(header).getByText('8')).toBeTruthy();
  });

  it('filters to a single account instantly when that account is selected', async () => {
    await renderApp();
    await screen.findByRole('heading', { name: 'All Inbox' });
    await screen.findByText('Q4 planning sync');

    fireEvent.click(screen.getByRole('button', { name: /^Work$/ }));

    expect(await screen.findByRole('heading', { name: 'Work' })).toBeTruthy();
    expect(await screen.findByText('Budget approval needed')).toBeTruthy();
    expect(screen.queryByText('Q4 planning sync')).toBeNull();
  });

  it('shows received mail only in the inbox and outbound mail in Sent', async () => {
    await renderApp();
    await screen.findByRole('heading', { name: 'All Inbox' });
    await screen.findByText('Q4 planning sync');
    expect(screen.queryByText('Partnership inquiry')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /^Sent$/ }));
    expect(await screen.findByText('Partnership inquiry')).toBeTruthy();
    expect(screen.queryByText('Q4 planning sync')).toBeNull();
  });

  it('finds messages by sender, subject and body text', async () => {
    await renderApp();
    await screen.findByRole('heading', { name: 'All Inbox' });
    await screen.findByText('Q4 planning sync');

    fireEvent.change(screen.getByPlaceholderText('Search'), { target: { value: 'budget' } });
    expect(screen.getByText('Budget approval needed')).toBeTruthy();
    expect(screen.queryByText('Renewal quote')).toBeNull();

    // Body text of the renewal quote mentions hosting.
    fireEvent.change(screen.getByPlaceholderText('Search'), { target: { value: 'hosting' } });
    expect(await screen.findByText('Renewal quote')).toBeTruthy();
  });
});

describe('reading pane', () => {
  it('opens the whole conversation when a message is selected', async () => {
    await renderApp();
    await screen.findByRole('heading', { name: 'All Inbox' });

    fireEvent.click(await screen.findByRole('button', { name: /Q4 planning sync/ }));

    const heading = await screen.findByRole('heading', { level: 1, name: 'Q4 planning sync' });
    expect(heading).toBeTruthy();
    expect(await screen.findByText(/Sharing the agenda for Thursday/)).toBeTruthy();
    // The sender address appears in the header and on the message itself.
    expect(screen.getAllByText('sarah.chen@example.com').length).toBeGreaterThan(0);
  });

  it('marks the conversation as read on open when the setting is enabled', async () => {
    await renderApp();
    await screen.findByRole('heading', { name: 'All Inbox' });

    fireEvent.click(await screen.findByRole('button', { name: /Q4 planning sync/ }));
    await screen.findByRole('heading', { level: 1, name: 'Q4 planning sync' });

    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(LS + 'messages') ?? 'null') as
        | Message[]
        | null;
      expect(stored).not.toBeNull();
      const thread = (stored as Message[]).filter((m) => m.conversationId === 'c1');
      expect(thread.length).toBeGreaterThan(0);
      expect(thread.every((m) => m.isRead)).toBe(true);
    });
  });

  it('opens a threaded conversation with its full history', async () => {
    await renderApp();
    await screen.findByRole('heading', { name: 'All Inbox' });

    fireEvent.click(await screen.findByRole('button', { name: /Website redesign proposal/ }));

    await screen.findByRole('heading', { level: 1, name: 'Website redesign proposal' });
    // The thread contains both directions of the conversation.
    expect(screen.getAllByText(/Website redesign proposal/).length).toBeGreaterThan(1);
    expect(screen.getAllByText('lena@studio.example').length).toBeGreaterThan(0);
  });
});

describe('composer and follow-up control (spec §6.1, §7)', () => {
  it('opens with C and toggles follow-up with one click', async () => {
    await renderApp();
    await screen.findByRole('heading', { name: 'All Inbox' });

    fireEvent.keyDown(window, { key: 'c' });

    expect(await screen.findByRole('heading', { name: 'New message' })).toBeTruthy();
    const toggle = screen.getByRole('button', { name: /Follow-up: Off/ });
    fireEvent.click(toggle);

    expect(screen.getByRole('button', { name: /Follow-up: On/ })).toBeTruthy();
    expect(screen.getByText('Remind in 3 days')).toBeTruthy();
  });

  it('toggles follow-up with Ctrl/⌘+Shift+F and closes with Escape', async () => {
    await renderApp();
    await screen.findByRole('heading', { name: 'All Inbox' });

    fireEvent.keyDown(window, { key: 'c' });
    await screen.findByRole('heading', { name: 'New message' });

    fireEvent.keyDown(screen.getByRole('heading', { name: 'New message' }), {
      key: 'F',
      ctrlKey: true,
      shiftKey: true,
    });
    expect(screen.getByRole('button', { name: /Follow-up: On/ })).toBeTruthy();

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByText('New message')).toBeNull());
  });

  it('saves a draft locally with the follow-up choice attached', async () => {
    await renderApp();
    await screen.findByRole('heading', { name: 'All Inbox' });

    fireEvent.keyDown(window, { key: 'c' });
    await screen.findByRole('heading', { name: 'New message' });
    fireEvent.change(screen.getByPlaceholderText('name@example.com'), {
      target: { value: 'marco@partner.example' },
    });
    fireEvent.change(screen.getByLabelText('Subject'), {
      target: { value: 'Proposal follow-up' },
    });
    fireEvent.change(screen.getByPlaceholderText('Write your message…'), {
      target: { value: 'Following up on the proposal.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Follow-up: Off/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => {
      const drafts = JSON.parse(localStorage.getItem(LS + 'drafts') ?? '[]');
      expect(drafts).toHaveLength(1);
      expect(drafts[0].toAddresses).toEqual(['marco@partner.example']);
      expect(drafts[0].followUpEnabled).toBe(true);
      expect(drafts[0].followUpIntervalDays).toBe(3);
    });

    // The draft is reachable from the Drafts folder — and there is only one,
    // so the debounced autosave did not duplicate it.
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: /^Drafts$/ }));
    expect(await screen.findByText('Proposal follow-up')).toBeTruthy();
    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem(LS + 'drafts') ?? '[]')).toHaveLength(1);
    });
  });

  it('does not create a phantom draft when merely opened with a signature configured', async () => {
    localStorage.setItem(
      LS + 'settings',
      JSON.stringify({ defaultSignature: 'Alex — alex@example.com' }),
    );

    await renderApp();
    await screen.findByRole('heading', { name: 'All Inbox' });

    fireEvent.keyDown(window, { key: 'c' });
    await screen.findByRole('heading', { name: 'New message' });
    // The signature is prefilled…
    expect(screen.getByDisplayValue(/Alex — alex@example.com/)).toBeTruthy();

    // …but opening the composer is not an edit, so nothing may be saved.
    // The autosave debounce is 800ms; wait past it.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(JSON.parse(localStorage.getItem(LS + 'drafts') ?? '[]')).toHaveLength(0);
  });

  it('replies from the account that received the mail', async () => {
    await renderApp();
    await screen.findByRole('heading', { name: 'All Inbox' });

    fireEvent.click(await screen.findByRole('button', { name: /Budget approval needed/ }));
    await screen.findByRole('heading', { level: 1, name: 'Budget approval needed' });

    fireEvent.click(screen.getByRole('button', { name: /^Reply$/ }));

    expect(await screen.findByRole('heading', { name: 'Reply' })).toBeTruthy();
    expect(screen.getByDisplayValue('priya@company.com')).toBeTruthy();
    const from = screen.getByRole('combobox') as HTMLSelectElement;
    expect(from.options[from.selectedIndex].text).toContain('alex@company.com');
  });
});

describe('follow-ups section (spec §6.6)', () => {
  it('groups tracked conversations and keeps quick actions working', async () => {
    await renderApp();
    await screen.findByRole('heading', { name: 'All Inbox' });

    fireEvent.click(screen.getByRole('button', { name: /Follow-ups/ }));

    expect(await screen.findByRole('heading', { name: 'Follow-ups' })).toBeTruthy();
    expect(screen.getByText('Due Today')).toBeTruthy();
    expect(screen.getByText('Overdue')).toBeTruthy();
    expect(screen.getByText('Upcoming')).toBeTruthy();
    expect(screen.getByText('Waiting for Reply')).toBeTruthy();
    expect(screen.getByText('Completed')).toBeTruthy();

    const dueToday = screen.getByText('Due Today').parentElement as HTMLElement;
    expect(within(dueToday).getByText('Partnership inquiry')).toBeTruthy();

    // Mark the due item complete: it must leave Due Today.
    fireEvent.click(screen.getAllByTitle('Mark complete')[0]);

    await waitFor(() => expect(screen.queryByText('Due Today')).toBeNull());
    const stored = JSON.parse(localStorage.getItem(LS + 'followups') ?? '[]');
    expect(stored.find((f: { sequence: { id: string } }) => f.sequence.id === 'f3').status).toBe(
      'completed',
    );
  });

  it('snoozes a reminder from the list', async () => {
    await renderApp();
    await screen.findByRole('heading', { name: 'All Inbox' });
    fireEvent.click(screen.getByRole('button', { name: /Follow-ups/ }));
    await screen.findByRole('heading', { name: 'Follow-ups' });

    fireEvent.click(screen.getAllByTitle('Snooze')[0]);
    fireEvent.click(await screen.findByText('Tomorrow'));

    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(LS + 'followups') ?? '[]');
      const snoozed = stored.filter(
        (f: { status: string }) => f.status === 'snoozed',
      );
      expect(snoozed.length).toBeGreaterThan(0);
    });
  });

  it('applies a different schedule to one conversation from the list', async () => {
    // Seeded before launch: the preview data layer reads schedules once at start.
    localStorage.setItem(
      LS + 'schedules',
      JSON.stringify([
        {
          id: 'default',
          name: 'Default',
          stages: [3, 7, 15, 30],
          isDefault: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'quick',
          name: 'Quick',
          stages: [1, 2],
          isDefault: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]),
    );

    await renderApp();
    await screen.findByRole('heading', { name: 'All Inbox' });

    fireEvent.click(screen.getByRole('button', { name: /Follow-ups/ }));
    await screen.findByRole('heading', { name: 'Follow-ups' });

    fireEvent.click(screen.getAllByTitle('Edit schedule')[0]);
    fireEvent.click(await screen.findByText('Quick'));

    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(LS + 'followups') ?? '[]');
      const moved = stored.find((f: { sequence: { id: string } }) => f.sequence.id === 'f3');
      expect(moved.sequence.scheduleId).toBe('quick');
      expect(moved.stageCount).toBe(2);
    });
  });

  it('opens the tracked conversation from the follow-up list', async () => {
    await renderApp();
    await screen.findByRole('heading', { name: 'All Inbox' });
    fireEvent.click(screen.getByRole('button', { name: /Follow-ups/ }));
    await screen.findByRole('heading', { name: 'Follow-ups' });

    fireEvent.click(screen.getByText('Partnership inquiry'));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Partnership inquiry' }),
    ).toBeTruthy();
  });
});

describe('one-click follow-up tracking (spec §6.1)', () => {
  it('offers to answer with follow-up on a thread where nothing was sent', async () => {
    await renderApp();
    await screen.findByRole('heading', { name: 'All Inbox' });

    fireEvent.click(await screen.findByRole('button', { name: /Q4 planning sync/ }));
    await screen.findByRole('heading', { level: 1, name: 'Q4 planning sync' });

    expect(screen.getByRole('button', { name: 'Reply with follow-up' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Enable follow-up' })).toBeNull();
  });

  it('re-enables tracking in one click after it was cancelled, and records it', async () => {
    await renderApp();
    await screen.findByRole('heading', { name: 'All Inbox' });

    // Cancel the tracked "Partnership inquiry" conversation first.
    fireEvent.click(screen.getByRole('button', { name: /Follow-ups/ }));
    await screen.findByRole('heading', { name: 'Follow-ups' });
    fireEvent.click(screen.getAllByTitle('Cancel tracking')[0]);
    await waitFor(() => expect(screen.queryByText('Due Today')).toBeNull());

    // Open the same conversation from Sent and enable follow-up again.
    fireEvent.click(screen.getByRole('button', { name: /^Sent$/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Partnership inquiry/ }));
    await screen.findByRole('heading', { level: 1, name: 'Partnership inquiry' });

    expect(await screen.findByText(/Cancelled/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Enable follow-up' }));

    // One click is enough: the status line flips from Cancelled to Scheduled.
    // Awaited, because the cancelled line also reads "Stage 1 of 4".
    expect(await screen.findByText(/Scheduled/)).toBeTruthy();
    expect(screen.getByText(/Stage 1 of 4/)).toBeTruthy();
    expect(screen.queryByText(/Cancelled/)).toBeNull();

    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(LS + 'followups') ?? '[]');
      const active = stored.filter(
        (f: { conversation: { id: string }; status: string }) =>
          f.conversation.id === 'c3' && f.status === 'scheduled',
      );
      expect(active).toHaveLength(1);
      // Due 3 days after the actual outbound send time, at the reminder time.
      expect(active[0].sequence.nextDueAt).toBeTruthy();
    });
  });

  it('stops tracking from the reading pane and keeps the history', async () => {
    await renderApp();
    await screen.findByRole('heading', { name: 'All Inbox' });

    fireEvent.click(await screen.findByRole('button', { name: /Website redesign proposal/ }));
    await screen.findByRole('heading', { level: 1, name: 'Website redesign proposal' });

    fireEvent.click(await screen.findByRole('button', { name: 'Stop tracking' }));

    expect(await screen.findByText(/Cancelled/)).toBeTruthy();
    const stored = JSON.parse(localStorage.getItem(LS + 'followups') ?? '[]');
    expect(stored.find((f: { sequence: { id: string } }) => f.sequence.id === 'f2').status).toBe(
      'cancelled',
    );
  });
});

describe('account controls (spec §5)', () => {
  it('pauses synchronization for one account without touching the others', async () => {
    await renderApp();
    await screen.findByRole('heading', { name: 'All Inbox' });
    fireEvent.click(screen.getByRole('button', { name: /^Settings$/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Email Accounts' }));

    fireEvent.click(await screen.findByRole('switch', { name: 'Synchronize Personal' }));

    await waitFor(() => {
      const accounts = JSON.parse(localStorage.getItem(LS + 'accounts') ?? '[]');
      expect(accounts.find((a: { id: string }) => a.id === 'acc-personal').syncEnabled).toBe(
        false,
      );
      expect(accounts.find((a: { id: string }) => a.id === 'acc-work').syncEnabled).toBe(true);
    });
    expect(await screen.findByText(/Sync paused/)).toBeTruthy();
  });

  it('changes the default sending account', async () => {
    await renderApp();
    await screen.findByRole('heading', { name: 'All Inbox' });
    fireEvent.click(screen.getByRole('button', { name: /^Settings$/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Email Accounts' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Make default' }));

    await waitFor(() => {
      const accounts = JSON.parse(localStorage.getItem(LS + 'accounts') ?? '[]');
      expect(accounts.find((a: { id: string }) => a.id === 'acc-work').isDefaultSender).toBe(true);
      expect(accounts.find((a: { id: string }) => a.id === 'acc-personal').isDefaultSender).toBe(
        false,
      );
      expect(JSON.parse(localStorage.getItem(LS + 'settings') ?? '{}').defaultSendingAccountId).toBe(
        'acc-work',
      );
    });
  });
});

describe('drafts', () => {
  it('deletes a draft from the list', async () => {
    localStorage.setItem(
      LS + 'drafts',
      JSON.stringify([
        {
          id: 'd1',
          accountId: 'acc-personal',
          toAddresses: ['marco@partner.example'],
          ccAddresses: [],
          bccAddresses: [],
          subject: 'Old draft',
          body: 'Body',
          followUpEnabled: false,
          followUpIntervalDays: null,
          inReplyToConversationId: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]),
    );
    window.confirm = vi.fn(() => true);

    await renderApp();
    await screen.findByRole('heading', { name: 'All Inbox' });
    fireEvent.click(screen.getByRole('button', { name: /^Drafts$/ }));

    expect(await screen.findByText('Old draft')).toBeTruthy();
    fireEvent.click(screen.getByTitle('Delete draft'));

    await waitFor(() => expect(screen.queryByText('Old draft')).toBeNull());
    expect(JSON.parse(localStorage.getItem(LS + 'drafts') ?? '[]')).toHaveLength(0);
  });
});

describe('date and time format (spec §11 General)', () => {
  it('switches the message list to a 24-hour clock', async () => {
    await renderApp();
    await screen.findByRole('heading', { name: 'All Inbox' });
    fireEvent.click(screen.getByRole('button', { name: /^Settings$/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'General' }));

    const timeRow = screen.getByRole('group', { name: 'Time format' });
    fireEvent.click(within(timeRow).getByRole('combobox'));
    fireEvent.change(within(timeRow).getByRole('combobox'), { target: { value: '24h' } });

    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem(LS + 'settings') ?? '{}').timeFormat).toBe('24h'),
    );
  });
});

describe('settings (spec §9, §11)', () => {
  it('applies and persists the theme', async () => {
    await renderApp();
    await screen.findByRole('heading', { name: 'All Inbox' });

    fireEvent.click(screen.getByRole('button', { name: /^Settings$/ }));
    expect(await screen.findByText('Startup behavior')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Appearance' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dark' }));

    await waitFor(() =>
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark'),
    );
    expect(JSON.parse(localStorage.getItem(LS + 'settings') ?? '{}').theme).toBe('dark');

    fireEvent.click(screen.getByRole('button', { name: 'Light' }));
    await waitFor(() =>
      expect(document.documentElement.getAttribute('data-theme')).toBe('light'),
    );
  });

  it('applies density and font size', async () => {
    await renderApp();
    await screen.findByRole('heading', { name: 'All Inbox' });
    fireEvent.click(screen.getByRole('button', { name: /^Settings$/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Appearance' }));

    // "Compact" exists for both density and message-list layout, so scope by row.
    const densityRow = screen.getByRole('group', { name: 'Interface density' });
    fireEvent.click(within(densityRow).getByRole('button', { name: 'Compact' }));
    await waitFor(() =>
      expect(document.documentElement.getAttribute('data-density')).toBe('compact'),
    );

    const fontRow = screen.getByRole('group', { name: 'Font size' });
    fireEvent.click(within(fontRow).getByRole('button', { name: 'Large' }));
    await waitFor(() => expect(document.body.style.fontSize).toBe('15px'));

    const listRow = screen.getByRole('group', { name: 'Message list layout' });
    fireEvent.click(within(listRow).getByRole('button', { name: 'Compact' }));
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem(LS + 'settings') ?? '{}').messageListLayout).toBe(
        'compact',
      ),
    );
  });

  it('collapses the sidebar from Appearance and from the top bar', async () => {
    await renderApp();
    await screen.findByRole('heading', { name: 'All Inbox' });

    fireEvent.click(screen.getByRole('button', { name: 'Still' }));
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem(LS + 'settings') ?? '{}').sidebarVisible).toBe(false),
    );
    // Collapsed: labels are gone, icons remain.
    await waitFor(() => expect(screen.queryByText('Follow-ups')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Still' }));
    expect(await screen.findByText('Follow-ups')).toBeTruthy();
  });

  it('hides All Inbox when the unified inbox is turned off', async () => {
    await renderApp();
    await screen.findByRole('heading', { name: 'All Inbox' });

    fireEvent.click(screen.getByRole('button', { name: /^Settings$/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Inbox' }));

    const unifiedRow = screen.getByRole('group', { name: 'Unified inbox (All Inbox)' });
    fireEvent.click(within(unifiedRow).getByRole('switch'));

    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem(LS + 'settings') ?? '{}').unifiedInboxEnabled).toBe(
        false,
      ),
    );
    // All Inbox disappears from navigation…
    await waitFor(() => expect(screen.queryByRole('button', { name: /^All Inbox$/ })).toBeNull());
    // …and leaving Settings lands on an account inbox, never on the removed one.
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(await screen.findByRole('heading', { name: 'Personal' })).toBeTruthy();
  });

  it('persists follow-up schedule edits', async () => {
    await renderApp();
    await screen.findByRole('heading', { name: 'All Inbox' });
    fireEvent.click(screen.getByRole('button', { name: /^Settings$/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Follow-up' }));

    const input = await screen.findByLabelText('Default stage intervals in days');
    fireEvent.change(input, { target: { value: '2, 5, 10, 20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const schedules = JSON.parse(localStorage.getItem(LS + 'schedules') ?? '[]');
      expect(schedules[0].stages).toEqual([2, 5, 10, 20]);
    });
  });

  it('rejects an invalid follow-up schedule', async () => {
    await renderApp();
    await screen.findByRole('heading', { name: 'All Inbox' });
    fireEvent.click(screen.getByRole('button', { name: /^Settings$/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Follow-up' }));

    const input = await screen.findByLabelText('Default stage intervals in days');
    fireEvent.change(input, { target: { value: '0, abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Enter at least one interval of 1 day or more.')).toBeTruthy();
    // Nothing was written: the default schedule is untouched.
    expect(localStorage.getItem(LS + 'schedules')).toBeNull();
    expect((input as HTMLInputElement).value).toBe('0, abc');
  });

  it('restores the shipped default schedule', async () => {
    localStorage.setItem(
      LS + 'schedules',
      JSON.stringify([
        {
          id: 'default',
          name: 'Default',
          stages: [2, 4, 9],
          isDefault: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]),
    );

    await renderApp();
    await screen.findByRole('heading', { name: 'All Inbox' });
    fireEvent.click(screen.getByRole('button', { name: /^Settings$/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Follow-up' }));

    const input = await screen.findByLabelText('Default stage intervals in days');
    expect((input as HTMLInputElement).value).toBe('2, 4, 9');

    fireEvent.click(screen.getByRole('button', { name: 'Restore default schedule' }));

    await waitFor(() => {
      const schedules = JSON.parse(localStorage.getItem(LS + 'schedules') ?? '[]');
      expect(schedules[0].stages).toEqual([3, 7, 15, 30]);
      expect(schedules[0].name).toBe('Default');
    });
  });

  it('shows which shortcuts are active instead of claiming all of them work', async () => {
    await renderApp();
    await screen.findByRole('heading', { name: 'All Inbox' });
    fireEvent.click(screen.getByRole('button', { name: /^Settings$/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Keyboard Shortcuts' }));

    expect(await screen.findByText('Compose new message')).toBeTruthy();
    expect(screen.getAllByText(/arrives with message actions in Phase 3/).length).toBe(3);
  });
});

// ─── Follow-up reminders (spec §6.7) ─────────────────────────────────────────
//
// These tests seed their own follow-ups with **elapsed-hour** offsets rather
// than relying on the app's sample data, which anchors due times to fixed clock
// hours (`daysAgoIso(0, 8)` = "today at 08:00"). That anchoring makes whether
// an item is due — or overdue — depend on the time of day the suite happens to
// run, so the same assertions passed in the afternoon and failed the next
// morning. Offsets from `Date.now()` are stable at any hour.

const HOUR_MS = 3_600_000;

function hoursAgoIso(hours: number): string {
  return new Date(Date.now() - hours * HOUR_MS).toISOString();
}

function fixtureAccount(): Account {
  const ts = hoursAgoIso(72);
  return {
    id: 'acc-personal',
    provider: 'imap',
    displayName: 'Personal',
    email: 'alex@example.com',
    color: null,
    imapHost: 'imap.example.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.example.com',
    smtpPort: 465,
    smtpSecure: true,
    username: 'alex@example.com',
    syncEnabled: true,
    isDefaultSender: true,
    authStatus: 'connected',
    createdAt: ts,
    updatedAt: ts,
  };
}

function fixtureFollowUp(input: {
  sequenceId: string;
  conversationId: string;
  dueHoursAgo: number;
  subject: string;
  recipient: string;
  stage: number;
}): FollowUpListItem {
  const account = fixtureAccount();
  const dueAt = hoursAgoIso(input.dueHoursAgo);
  const lastSentAt = hoursAgoIso(input.dueHoursAgo + 72);
  const sequence: FollowUpSequence = {
    id: input.sequenceId,
    conversationId: input.conversationId,
    accountId: account.id,
    scheduleId: 'default',
    currentStage: input.stage,
    // Derived on load by the app; the reminder engine only reads nextDueAt.
    status: input.dueHoursAgo >= 24 ? 'overdue' : 'due',
    lastSentAt,
    nextDueAt: dueAt,
    snoozedUntil: null,
    createdAt: lastSentAt,
    updatedAt: lastSentAt,
  };
  return {
    sequence,
    conversation: {
      id: input.conversationId,
      accountId: account.id,
      subject: input.subject,
      participants: [account.email, input.recipient],
      lastMessageAt: lastSentAt,
      unreadCount: 0,
      isStarred: false,
    },
    account,
    recipient: input.recipient,
    subject: input.subject,
    lastSentAt,
    nextDueAt: dueAt,
    currentStage: input.stage,
    stageCount: 4,
    status: sequence.status,
  };
}

/**
 * Two reminders that are unambiguous at any hour: one fell due 2 hours ago
 * (due, not yet overdue) and one 36 hours ago (past the 24-hour boundary).
 */
function seedReminderFixtures(): void {
  const items = [
    fixtureFollowUp({
      sequenceId: 'r-due',
      conversationId: 'rc-due',
      dueHoursAgo: 2,
      subject: 'Design review notes',
      recipient: 'marco@partner.example',
      stage: 0,
    }),
    fixtureFollowUp({
      sequenceId: 'r-over',
      conversationId: 'rc-over',
      dueHoursAgo: 36,
      subject: 'Contract review — Q4',
      recipient: 'priya@legal.example',
      stage: 2,
    }),
  ];
  localStorage.setItem(LS + 'followups', JSON.stringify(items));
}

describe('follow-up reminders (spec §6.7)', () => {
  /** The bell in the top bar, whether or not it carries an unread badge. */
  function bell(): HTMLElement {
    return screen.getByRole('button', { name: /^Reminders/ });
  }

  async function openPanel(): Promise<HTMLElement> {
    fireEvent.click(bell());
    return screen.findByRole('dialog', { name: 'Follow-up reminders' });
  }

  function storedNotifications(): { dedupeKey: string; isRead: boolean }[] {
    return JSON.parse(localStorage.getItem(LS + 'notifications') ?? '[]');
  }

  it('shows an unread badge on launch for follow-ups that fell due', async () => {
    seedReminderFixtures();
    await renderApp();
    await screen.findByRole('heading', { name: 'All Inbox' });

    expect(await screen.findByRole('button', { name: /Reminders, \d+ unread/ })).toBeTruthy();
  });

  it('lists both the due and the overdue reminder with stage, recipient and subject', async () => {
    seedReminderFixtures();
    await renderApp();
    await screen.findByRole('heading', { name: 'All Inbox' });
    const panel = await openPanel();

    await waitFor(() => expect(within(panel).getAllByRole('listitem')).toHaveLength(2));
    // The 36-hour-old one is described as overdue, the 2-hour-old one as due.
    expect(within(panel).getByText('Follow-up overdue')).toBeTruthy();
    expect(within(panel).getByText('Follow-up due')).toBeTruthy();
    expect(panel.textContent).toContain('Stage 3 of 4');
    expect(panel.textContent).toContain('priya@legal.example');
    expect(panel.textContent).toContain('Contract review — Q4');
    expect(panel.textContent).toContain('marco@partner.example');
  });

  it('persists raised reminders so a relaunch does not duplicate them', async () => {
    seedReminderFixtures();
    await renderApp();
    await screen.findByRole('heading', { name: 'All Inbox' });
    await openPanel();
    await waitFor(() => expect(storedNotifications()).toHaveLength(2));
    const firstRun = storedNotifications().map((n) => n.dedupeKey).sort();
    cleanup();

    // Relaunch: the same derived keys, no second copy of any occurrence.
    await renderApp();
    await screen.findByRole('heading', { name: 'All Inbox' });
    await waitFor(() => expect(storedNotifications().map((n) => n.dedupeKey).sort()).toEqual(firstRun));
    expect(storedNotifications()).toHaveLength(2);
  });

  it('opens the conversation behind a reminder and marks it read', async () => {
    seedReminderFixtures();
    await renderApp();
    await screen.findByRole('heading', { name: 'All Inbox' });
    const panel = await openPanel();
    await waitFor(() => expect(within(panel).getAllByRole('listitem')).toHaveLength(2));

    fireEvent.click(within(panel).getAllByRole('button', { name: /^Open reminder/ })[0]);

    // The popover closes and the read state is stored.
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Follow-up reminders' })).toBeNull(),
    );
    await waitFor(() => expect(storedNotifications().some((n) => n.isRead)).toBe(true));
  });

  it('dismisses a single reminder and stores that decision', async () => {
    seedReminderFixtures();
    await renderApp();
    await screen.findByRole('heading', { name: 'All Inbox' });
    const panel = await openPanel();
    await waitFor(() => expect(within(panel).getAllByRole('listitem')).toHaveLength(2));

    fireEvent.click(within(panel).getAllByRole('button', { name: /^Dismiss reminder/ })[0]);

    await waitFor(() => expect(storedNotifications()).toHaveLength(1));
  });

  it('marks every reminder read and clears the badge', async () => {
    seedReminderFixtures();
    await renderApp();
    await screen.findByRole('heading', { name: 'All Inbox' });
    const panel = await openPanel();
    await waitFor(() => expect(within(panel).getAllByRole('listitem')).toHaveLength(2));

    fireEvent.click(within(panel).getByRole('button', { name: /Mark all read/ }));

    await waitFor(() => expect(storedNotifications().every((n) => n.isRead)).toBe(true));
    await waitFor(() => expect(screen.queryByRole('button', { name: /unread/ })).toBeNull());
  });

  it('closes the popover with Escape', async () => {
    seedReminderFixtures();
    await renderApp();
    await screen.findByRole('heading', { name: 'All Inbox' });
    await openPanel();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Follow-up reminders' })).toBeNull(),
    );
  });
});

describe('reminder lifecycle in the UI (spec §6.4, §6.7)', () => {
  async function openBell(): Promise<HTMLElement> {
    fireEvent.click(screen.getByRole('button', { name: /^Reminders/ }));
    return screen.findByRole('dialog', { name: 'Follow-up reminders' });
  }

  function stored(): { conversationId: string | null; isRead: boolean }[] {
    return JSON.parse(localStorage.getItem(LS + 'notifications') ?? '[]');
  }

  it('clears a conversation\'s reminders when tracking is turned off', async () => {
    // One tracked conversation that also carries message history, so it can be
    // opened from the list and stopped from the reading pane.
    localStorage.setItem(
      LS + 'followups',
      JSON.stringify([
        fixtureFollowUp({
          sequenceId: 'r-stop',
          conversationId: 'c2',
          dueHoursAgo: 2,
          subject: 'Website redesign proposal',
          recipient: 'lena@studio.example',
          stage: 1,
        }),
      ]),
    );

    await renderApp();
    await screen.findByRole('heading', { name: 'All Inbox' });

    let panel = await openBell();
    await waitFor(() => expect(within(panel).getAllByRole('listitem')).toHaveLength(1));
    fireEvent.keyDown(document, { key: 'Escape' });

    // Stop tracking from the reading pane.
    fireEvent.click(await screen.findByRole('button', { name: /Website redesign proposal/ }));
    await screen.findByRole('heading', { level: 1, name: 'Website redesign proposal' });
    fireEvent.click(await screen.findByRole('button', { name: 'Stop tracking' }));
    expect(await screen.findByText(/Cancelled/)).toBeTruthy();

    // The bell must not keep offering a reminder for a stopped conversation.
    panel = await openBell();
    await waitFor(() => expect(within(panel).queryAllByRole('listitem')).toHaveLength(0));
    // The empty state is two lines split by a <br/>, so match loosely.
    expect(within(panel).getByText(/No reminders/)).toBeTruthy();
    await waitFor(() => expect(stored()).toHaveLength(0));
  });

  it('opens the conversation from Settings, where the mail pane is not on screen', async () => {
    // A reminder whose sequence is gone: tracking was turned off in an earlier
    // session, but the stored reminder is still in the list.
    localStorage.setItem(LS + 'followups', '[]');
    localStorage.setItem(
      LS + 'notifications',
      JSON.stringify([
        {
          id: 'n-orphan',
          kind: 'followup_due',
          title: 'Follow-up due',
          body: 'Stage 1 of 4 · marco@partner.example',
          conversationId: 'c2',
          sequenceId: 'gone',
          stageIndex: 0,
          isRead: false,
          dueAt: hoursAgoIso(3),
          deliverAt: hoursAgoIso(3),
          deliveredAt: null,
          dedupeKey: 'followup:gone:stage:0',
          createdAt: hoursAgoIso(3),
        },
      ]),
    );

    await renderApp();
    await screen.findByRole('heading', { name: 'All Inbox' });

    // Leave the mail view entirely.
    fireEvent.click(screen.getByRole('button', { name: /^Settings$/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Email Accounts' }));
    expect(screen.queryByRole('heading', { name: 'All Inbox' })).toBeNull();

    const panel = await openBell();
    fireEvent.click(within(panel).getByRole('button', { name: /^Open reminder/ }));

    // The click must actually navigate back to mail, not just select a row the
    // user cannot see.
    expect(await screen.findByRole('heading', { name: 'All Inbox' })).toBeTruthy();
    await waitFor(() => expect(stored().every((n) => n.isRead)).toBe(true));
  });
});

describe('custom follow-up interval (spec §6.2, §7)', () => {
  it('clamps an out-of-range interval so the draft still saves', async () => {
    await renderApp();
    await screen.findByRole('heading', { name: 'All Inbox' });

    fireEvent.keyDown(window, { key: 'c' });
    await screen.findByRole('heading', { name: 'New message' });

    // Turn tracking on if it is not already the default.
    const toggle = screen.getByRole('button', { name: /^Follow-up:/ });
    if (/Off/.test(toggle.textContent ?? '')) fireEvent.click(toggle);

    // Choose the custom interval and type a value past the supported maximum.
    fireEvent.change(screen.getByLabelText('Follow-up interval'), {
      target: { value: 'custom' },
    });
    const input = await screen.findByLabelText('Custom follow-up interval in days');
    fireEvent.change(input, { target: { value: '9999' } });

    // The field itself is clamped: `max` on a number input only steers the
    // spinner, so the clamp has to happen in the handler.
    expect((input as HTMLInputElement).value).toBe('365');

    // And the draft survives the autosave round-trip instead of being refused
    // by IPC validation and silently dropped.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const drafts = JSON.parse(localStorage.getItem(LS + 'drafts') ?? '[]') as {
      followUpIntervalDays: number | null;
      followUpEnabled: boolean;
    }[];
    expect(drafts).toHaveLength(1);
    expect(drafts[0].followUpEnabled).toBe(true);
    expect(drafts[0].followUpIntervalDays).toBe(365);
    expect(screen.queryByText('Draft not saved.')).toBeNull();
  });

  it('clamps below the minimum rather than saving an unusable interval', async () => {
    await renderApp();
    await screen.findByRole('heading', { name: 'All Inbox' });

    fireEvent.keyDown(window, { key: 'c' });
    await screen.findByRole('heading', { name: 'New message' });

    const toggle = screen.getByRole('button', { name: /^Follow-up:/ });
    if (/Off/.test(toggle.textContent ?? '')) fireEvent.click(toggle);
    fireEvent.change(screen.getByLabelText('Follow-up interval'), {
      target: { value: 'custom' },
    });

    const input = await screen.findByLabelText('Custom follow-up interval in days');
    fireEvent.change(input, { target: { value: '0' } });
    expect((input as HTMLInputElement).value).toBe('1');

    // Clearing the field must not produce NaN either.
    fireEvent.change(input, { target: { value: '' } });
    expect((input as HTMLInputElement).value).toBe('1');

    await new Promise((resolve) => setTimeout(resolve, 1100));
    const drafts = JSON.parse(localStorage.getItem(LS + 'drafts') ?? '[]') as {
      followUpIntervalDays: number | null;
    }[];
    expect(drafts).toHaveLength(1);
    expect(drafts[0].followUpIntervalDays).toBe(1);
  });
});
