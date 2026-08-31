import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { BacklogItemView } from '@goal-cascade/shared';
import { AppShell } from '../../src/AppShell';
import { renderApp } from '../render';
import { apiError, bodyOf, lastRequest, requests, server } from '../msw/handlers';
import * as F from '../msw/fixtures';

/**
 * The backlog, and its one conversion.
 *
 * R-backlog-6 is the rule the mockup broke in three separate ways (D-19): it created the task, filtered
 * the item out of a local array, and never told the API about the removal — so a second attempt made a
 * duplicate task from an item the server still thought existed. Here it is one atomic command, and every
 * refusal it can answer with has a screen.
 */

const onQ = F.backlogItem({ id: F.ulid(41), goalId: F.Q, title: 'Find a squat rack free at 7am' });

function withBacklog(items: BacklogItemView[] = [onQ], over: Record<string, Partial<ReturnType<typeof F.goal>>> = {}) {
  server.use(
    http.get('/api/goals', () => HttpResponse.json(F.treeResponse(over))),
    http.get('/api/backlog', () => HttpResponse.json({ items, serverNow: F.NOW })),
  );
}

async function openBacklog(user: ReturnType<typeof renderApp>['user']) {
  await user.click(await screen.findByRole('button', { name: 'Add' }));
  await user.click(await screen.findByRole('button', { name: 'View Backlog →' }));
  return screen.findByText('Backlog');
}

describe('Backlog — the page', () => {
  it('S-backlog-13: grouped by branch path, with the from-week note the exit left behind', async () => {
    withBacklog([F.backlogItem({ id: F.ulid(41), goalId: F.Q, title: 'Find a squat rack free at 7am', fromWeekStart: F.LAST_MONDAY })]);
    const { user } = renderApp(<AppShell />);
    await openBacklog(user);

    expect(await screen.findByText('Be strong at 60 › Rebuild the gym habit')).toBeInTheDocument();
    expect(screen.getByText('from week of Mon 24 Aug')).toBeInTheDocument();
  });

  it('R-backlog-13: the empty state, which the mockup could never reach', async () => {
    withBacklog([]);
    const { user } = renderApp(<AppShell />);
    await openBacklog(user);
    expect(await screen.findByText('Nothing in the backlog.')).toBeInTheDocument();
  });

  it('S-backlog-2-1: no goal picker in any backlog flow offers a Life goal', async () => {
    withBacklog();
    const { user } = renderApp(<AppShell />);
    await openBacklog(user);

    await user.click(screen.getByText('Find a squat rack free at 7am'));
    await user.click(screen.getByRole('button', { name: 'Move to another goal' }));
    expect(screen.queryByRole('button', { name: 'Be strong at 60' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ship the thing' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Launch v1' })).toBeInTheDocument();
  });

  it('S-backlog-10-1: a move names the new goal in the toast', async () => {
    withBacklog();
    const { user } = renderApp(<AppShell />);
    await openBacklog(user);

    await user.click(screen.getByText('Find a squat rack free at 7am'));
    await user.click(screen.getByRole('button', { name: 'Move to another goal' }));
    await user.click(screen.getByRole('button', { name: 'Launch v1' }));

    await waitFor(async () => expect(await bodyOf(lastRequest('POST', '/backlog/'))).toMatchObject({ goalId: F.Y2 }));
    expect(await screen.findByRole('status')).toHaveTextContent('Moved to Launch v1');
  });

  it('R-backlog-2: a Life-goal target is refused, and the refusal is said out loud', async () => {
    withBacklog();
    server.use(http.post('/api/backlog/:id/move', () => apiError('LIFE_GOAL_NO_BACKLOG')));
    const { user } = renderApp(<AppShell />);
    await openBacklog(user);

    await user.click(screen.getByText('Find a squat rack free at 7am'));
    await user.click(screen.getByRole('button', { name: 'Move to another goal' }));
    await user.click(screen.getByRole('button', { name: 'Launch v1' }));
    expect(await screen.findByRole('status')).toHaveTextContent('not a Life goal');
  });
});

describe('Backlog — conversion, the only way backlog becomes work', () => {
  it('S-backlog-7-1 / S-backlog-6-1: one active leaf beneath means one conversion, target resolved', async () => {
    withBacklog();
    const { user } = renderApp(<AppShell />);
    await openBacklog(user);

    await user.click(screen.getByText('Find a squat rack free at 7am'));
    await user.click(screen.getByRole('button', { name: 'Add to this week' }));

    // R-backlog-6 — the standard create modal, pre-filled with the item's title.
    const sheet = await screen.findByRole('dialog', { name: 'Task create' });
    expect(within(sheet).getByLabelText('Task title')).toHaveValue('Find a squat rack free at 7am');
    await user.click(within(sheet).getByRole('button', { name: 'Save task' }));

    await waitFor(async () => {
      const req = lastRequest('POST', '/convert-to-task');
      expect(req?.url).toContain(F.ulid(41));
      expect(await bodyOf(req)).toMatchObject({ goalId: F.M, title: 'Find a squat rack free at 7am' });
    });
    // It is ONE operation: no separate task create, and no separate delete of the item.
    expect(requests('POST', '/api/tasks')).toHaveLength(0);
    expect(requests('DELETE', '/backlog/')).toHaveLength(0);
  });

  it('S-backlog-6-3: abandoning the modal leaves the item alone and creates nothing', async () => {
    withBacklog();
    const { user } = renderApp(<AppShell />);
    await openBacklog(user);

    await user.click(screen.getByText('Find a squat rack free at 7am'));
    await user.click(screen.getByRole('button', { name: 'Add to this week' }));
    await user.click(await screen.findByTestId('sheet-overlay'));

    expect(requests('POST', '/convert-to-task')).toHaveLength(0);
    expect(await screen.findByText('Find a squat rack free at 7am')).toBeInTheDocument();
  });

  it('S-backlog-6-2: a second conversion is refused, and no second task appears', async () => {
    withBacklog();
    server.use(http.post('/api/backlog/:id/convert-to-task', () => apiError('ALREADY_CONVERTED')));
    const { user } = renderApp(<AppShell />);
    await openBacklog(user);

    await user.click(screen.getByText('Find a squat rack free at 7am'));
    await user.click(screen.getByRole('button', { name: 'Add to this week' }));
    await user.click(await screen.findByRole('button', { name: 'Save task' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('already this week — nothing new was created');
    expect(requests('POST', '/api/tasks')).toHaveLength(0);
  });

  it('S-backlog-8-1 / S-backlog-8-2: a dormant branch gets the sheet, not a modal — and the item is untouched', async () => {
    // No leaf at or under Q holds a focus this week.
    withBacklog([onQ], { [F.M]: { isActive: false, focus: '', dormant: true, subtreeActive: false } });
    const { user } = renderApp(<AppShell />);
    await openBacklog(user);

    await user.click(screen.getByText('Find a squat rack free at 7am'));
    await user.click(screen.getByRole('button', { name: 'Add to this week' }));

    expect(await screen.findByText("This branch isn't active this week")).toBeInTheDocument();
    expect(screen.getByText('"Find a squat rack free at 7am" can only become a task under an active weekly focus.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Task create' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Set a weekly focus' }));
    expect(await screen.findByText('Weekly planning')).toBeInTheDocument();
    expect(requests('POST', '/convert-to-task')).toHaveLength(0);
    expect(requests('POST', '/api/tasks')).toHaveLength(0);
  });

  it('S-backlog-8-3: the server’s own refusal drives the same sheet — the client guard is not the only one', async () => {
    withBacklog();
    server.use(http.post('/api/backlog/:id/convert-to-task', () => apiError('BRANCH_NOT_ACTIVE')));
    const { user } = renderApp(<AppShell />);
    await openBacklog(user);

    await user.click(screen.getByText('Find a squat rack free at 7am'));
    await user.click(screen.getByRole('button', { name: 'Add to this week' }));
    await user.click(await screen.findByRole('button', { name: 'Save task' }));

    expect(await screen.findByText("This branch isn't active this week")).toBeInTheDocument();
  });

  it('S-backlog-7-2: two active leaves beneath — the user is asked, and nothing is picked silently', async () => {
    withBacklog([onQ], { [F.D]: { isActive: true, dormant: false, subtreeActive: true, focus: 'Lights out by 23:30.' } });
    const { user } = renderApp(<AppShell />);
    await openBacklog(user);

    await user.click(screen.getByText('Find a squat rack free at 7am'));
    await user.click(screen.getByRole('button', { name: 'Add to this week' }));

    const sheet = await screen.findByRole('dialog', { name: 'Task create' });
    // D-18 — no default selection: `activeLeafFor`'s "first in array order" is exactly what is gone.
    expect(within(sheet).getByLabelText('Weekly focus')).toHaveValue('');
    expect(within(sheet).getByRole('button', { name: 'Save task' })).toBeDisabled();

    await user.selectOptions(within(sheet).getByLabelText('Weekly focus'), F.D);
    await user.click(within(sheet).getByRole('button', { name: 'Save task' }));
    await waitFor(async () => expect(await bodyOf(lastRequest('POST', '/convert-to-task'))).toMatchObject({ goalId: F.D }));
  });

  it('S-backlog-7-2: an ambiguous refusal from the server re-renders the picker from ITS candidate list', async () => {
    // The server answers `422 VALIDATION_FAILED` with `details.candidates` (there is no dedicated code in
    // the shared error table yet), so the sheet branches on the details rather than on the code.
    withBacklog();
    let attempt = 0;
    server.use(
      http.post('/api/backlog/:id/convert-to-task', () => {
        attempt += 1;
        return attempt === 1
          ? apiError('VALIDATION_FAILED', 'ambiguous conversion target', {
              candidates: [
                { id: F.M, title: 'Lift three times a week' },
                { id: F.D, title: 'Sleep before midnight' },
              ],
            })
          : HttpResponse.json({ task: F.taskDetail(), item: F.backlogItem({ status: 'converted' }), serverNow: F.NOW }, { status: 201 });
      }),
    );
    const { user } = renderApp(<AppShell />);
    await openBacklog(user);

    await user.click(screen.getByText('Find a squat rack free at 7am'));
    await user.click(screen.getByRole('button', { name: 'Add to this week' }));
    await user.click(await screen.findByRole('button', { name: 'Save task' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('More than one focus could take this');
    const select = screen.getByLabelText('Weekly focus');
    expect(select).toHaveValue('');
    // R-task-4 — each option reads `<Life root> — <focus sentence>`, so the two are told apart by what
    // each week is actually for, not by a goal id.
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Choose a focus…',
      'Be strong at 60 — Three sessions, no excuses.',
      'Be strong at 60 — Sleep before midnight',
    ]);

    await user.selectOptions(select, F.D);
    await user.click(screen.getByRole('button', { name: 'Save task' }));
    await waitFor(async () => expect(await bodyOf(lastRequest('POST', '/convert-to-task'))).toMatchObject({ goalId: F.D }));
  });
});

describe('Backlog — the + drawer', () => {
  it('S-backlog-15-1: "Add to this week instead" creates a task and NO backlog item', async () => {
    withBacklog();
    const { user } = renderApp(<AppShell />);
    await user.click(await screen.findByRole('button', { name: 'Add' }));

    await user.click(await screen.findByRole('button', { name: 'Rebuild the gym habit' }));
    await user.type(screen.getByLabelText('What needs doing, someday?'), 'Book an induction');
    await user.click(screen.getByRole('button', { name: 'Add to this week instead' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(async () => expect(await bodyOf(lastRequest('POST', '/api/tasks'))).toMatchObject({ goalId: F.M, source: 'drawer' }));
    // D-21 — exactly one entity. The label says "instead" because that is what happens.
    expect(requests('POST', '/api/backlog')).toHaveLength(0);
    expect(await screen.findByRole('status')).toHaveTextContent('Added to this week');
  });

  it('S-backlog-15-2: with no active leaf it parks in the Backlog instead, and says why', async () => {
    withBacklog([onQ], { [F.M]: { isActive: false, focus: '', dormant: true, subtreeActive: false } });
    const { user } = renderApp(<AppShell />);
    await user.click(await screen.findByRole('button', { name: 'Add' }));

    await user.click(await screen.findByRole('button', { name: 'Rebuild the gym habit' }));
    await user.type(screen.getByLabelText('What needs doing, someday?'), 'Book an induction');
    await user.click(screen.getByRole('button', { name: 'Add to this week instead' }));
    expect(screen.getByText("This branch isn't active this week — it will be parked in the Backlog.")).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(async () => expect(await bodyOf(lastRequest('POST', '/api/backlog'))).toMatchObject({ goalId: F.Q, title: 'Book an induction' }));
    expect(requests('POST', '/api/tasks')).toHaveLength(0);
    expect(await screen.findByRole('status')).toHaveTextContent('parked in Backlog');
  });

  it('D-10 / R-auth-6: an empty tree gets an empty state, never a hardcoded fixture goal', async () => {
    server.use(
      http.get('/api/goals', () => HttpResponse.json({ week: F.week(), goals: [], serverNow: F.NOW })),
      http.get('/api/backlog', () => HttpResponse.json({ items: [], serverNow: F.NOW })),
    );
    const { user } = renderApp(<AppShell />);
    await user.click(await screen.findByRole('button', { name: 'Add' }));

    expect(await screen.findByText(/Nothing to file this under yet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});
