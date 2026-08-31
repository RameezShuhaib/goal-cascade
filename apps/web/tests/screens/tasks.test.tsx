import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { TaskView } from '@goal-cascade/shared';
import { AppShell } from '../../src/AppShell';
import { renderApp } from '../render';
import { apiError, bodyOf, lastRequest, requests, server } from '../msw/handlers';
import * as F from '../msw/fixtures';

/**
 * The Tasks screen: the week switcher, the three exits, the carry labels, and the uncheck follow-up.
 *
 * Every task in these fixtures carries its ABSOLUTE `originWeekStart` and the `carryWeeks` the server
 * computed for the week being asked about (D-1). No test derives an age from a stored offset, because no
 * offset is stored anywhere any more.
 */

const THREE_WEEKS_AGO = '2026-08-10';

function withWeek(tasks: TaskView[], over: Record<string, Partial<ReturnType<typeof F.goal>>> = {}, week = F.week()) {
  server.use(
    http.get('/api/goals', () => HttpResponse.json(F.treeResponse(over, week))),
    http.get('/api/tasks', () => HttpResponse.json({ week, tasks, plan: [F.planEntry()], serverNow: F.NOW })),
  );
}

describe('Tasks — the week and its sections', () => {
  it('S-nav-8-1: an active leaf with no tasks still gets a section, its focus sentence and + Task', async () => {
    withWeek([]);
    renderApp(<AppShell />);
    expect(await screen.findByText('Three sessions, no excuses.')).toBeInTheDocument();
    expect(screen.getByText('Be strong at 60 › Get back under 80kg › Rebuild the gym habit › Lift three times a week')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Task' })).toBeInTheDocument();
  });

  it('S-task-9-1: a DORMANT leaf carrying an open task still shows it — with no focus and no + Task', async () => {
    // D-11 — dormancy removes the empty section, the sentence and the affordance. It never hides work.
    withWeek([F.task({ id: F.ulid(21), goalId: F.D, title: 'Set a bedtime alarm', carryWeeks: 1, originWeekStart: F.LAST_MONDAY })], {
      [F.M]: { isActive: false, focus: '', dormant: true },
    });
    renderApp(<AppShell />);
    expect(await screen.findByText('Set a bedtime alarm')).toBeInTheDocument();
    expect(screen.queryByText('Three sessions, no excuses.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Task' })).not.toBeInTheDocument();
  });

  it('S-nav-9-1: week 0 with nothing planned offers the plan; a past week offers no CTA', async () => {
    withWeek([], { [F.M]: { isActive: false, focus: '', dormant: true } });
    const { user } = renderApp(<AppShell />);
    expect(await screen.findByText('A new week, still unplanned.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Plan this week' })).toBeInTheDocument();

    withWeek([], { [F.M]: { isActive: false, focus: '', dormant: true } }, F.week({ weekStart: F.LAST_MONDAY, offset: -1, isCurrent: false }));
    await user.click(screen.getByRole('button', { name: 'Earlier week' }));
    expect(await screen.findByText('Nothing happened this week.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Plan this week' })).not.toBeInTheDocument();
    // R-nav-5 — a past week is labelled, and stays fully interactive.
    expect(screen.getByText('Past week — still editable')).toBeInTheDocument();
  });

  it('S-nav-3-1: the future is not reachable by chevron or picker', async () => {
    withWeek([F.task()]);
    const { user } = renderApp(<AppShell />);
    await screen.findByText('Book the Tuesday slot');

    expect(screen.getByRole('button', { name: 'Later week' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /^Week of/ }));
    const chips = screen.getAllByRole('button', { name: /^(This week|Week of)/ });
    // Every chip the picker offers is this week or earlier — there is no forward option to click.
    expect(chips.some((c) => c.textContent === 'This week')).toBe(true);
    // S-nav-4-1 — the picker and the back chevron reach the same earliest week (D-24: one bound).
    expect(chips).toHaveLength(1 + 8); // the header button + 8 weeks of history
  });

  it('S-nav-6-1: changing the week resets the goal filter to All', async () => {
    withWeek([F.task()]);
    const { user } = renderApp(<AppShell />);
    await screen.findByText('Book the Tuesday slot');

    await user.click(screen.getByRole('button', { name: 'Be strong at 60 · 1' }));
    withWeek([], {}, F.week({ weekStart: F.LAST_MONDAY, offset: -1, isCurrent: false }));
    await user.click(screen.getByRole('button', { name: 'Earlier week' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'All' })).toHaveStyle({ background: 'oklch(0.42 0.09 125)' }));
  });
});

describe('Tasks — the carry labels (the only escalation in the product)', () => {
  it('S-task-12-1: a task created this week carries no label', async () => {
    withWeek([F.task({ carryWeeks: 0 })]);
    renderApp(<AppShell />);
    await screen.findByText('Book the Tuesday slot');
    expect(screen.queryByText(/since /)).not.toBeInTheDocument();
  });

  it('S-task-10-1: at one week, a gray "since <Monday>" label', async () => {
    withWeek([F.task({ carryWeeks: 1, originWeekStart: F.LAST_MONDAY })]);
    renderApp(<AppShell />);
    expect(await screen.findByText('since Mon 24 Aug')).toBeInTheDocument();
    expect(screen.queryByText(/weeks · since/)).not.toBeInTheDocument();
  });

  it('S-task-11-1: at two or more, the red chip — and no popup, modal or nag', async () => {
    withWeek([F.task({ carryWeeks: 3, originWeekStart: THREE_WEEKS_AGO })]);
    renderApp(<AppShell />);
    expect(await screen.findByText('3 weeks · since 10 Aug')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('Tasks — creating', () => {
  it('S-task-3-1: a title and no done-condition is enough', async () => {
    withWeek([]);
    const { user } = renderApp(<AppShell />);
    await user.click(await screen.findByRole('button', { name: '+ Task' }));

    // R-task-3-2 — a whitespace-only title keeps Save disabled.
    expect(screen.getByRole('button', { name: 'Save task' })).toBeDisabled();
    await user.type(screen.getByLabelText('Task title'), 'Book the Tuesday slot');
    await user.click(screen.getByRole('button', { name: 'Save task' }));

    await waitFor(async () => {
      const body = await bodyOf(lastRequest('POST', '/api/tasks'));
      // Q-8 — no client-minted id. The mockup sent `'t' + Date.now()`; `.strict()` would refuse it now.
      expect(body).toMatchObject({ goalId: F.M, title: 'Book the Tuesday slot', cond: '' });
      expect(body).not.toHaveProperty('id');
      expect(body).not.toHaveProperty('originWeek');
    });
  });

  it('S-task-4-1: with nothing active there is no target, no fallback goal, and a route to planning', async () => {
    // D-10 — the mockup fell back to the literal seed id `'g4'`, which against a real account is nothing.
    withWeek([F.task({ goalId: F.D })], { [F.M]: { isActive: false, focus: '', dormant: true } });
    const { user } = renderApp(<AppShell />);
    await user.click(await screen.findByText('Book the Tuesday slot'));
    await user.click(await screen.findByRole('button', { name: 'Move to Backlog' }));
    // (getting to a create sheet needs an entry point; use the drawer's, which has the same guard)
    await user.click(screen.getByTestId('sheet-overlay'));
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await user.click(screen.getByRole('button', { name: 'Add to this week instead' }));
    expect(await screen.findByText(/isn't active this week/)).toBeInTheDocument();
  });
});

describe('Tasks — the three exits, and nothing else', () => {
  it('S-task-14-1: complete names the week being VIEWED, not "now"', async () => {
    withWeek([F.task()], {}, F.week({ weekStart: F.LAST_MONDAY, offset: -1, isCurrent: false }));
    const { user } = renderApp(<AppShell />);
    await user.click(await screen.findByRole('button', { name: 'Earlier week' }));
    await user.click(await screen.findByRole('button', { name: 'Complete Book the Tuesday slot' }));

    await waitFor(async () => {
      const body = await bodyOf(lastRequest('POST', '/complete'));
      expect(body).toMatchObject({ week: -1 });
    });
  });

  it('S-task-14-2: a refused complete is stated, not swallowed', async () => {
    withWeek([F.task()]);
    server.use(http.post('/api/tasks/:id/complete', () => apiError('WEEK_OUT_OF_RANGE')));
    const { user } = renderApp(<AppShell />);
    await user.click(await screen.findByRole('button', { name: 'Complete Book the Tuesday slot' }));
    expect(await screen.findByRole('status')).toHaveTextContent("isn't addressable");
  });

  it('S-task-15-1: Move to Backlog keeps the record, sends the viewed week, and notes the reason', async () => {
    withWeek([F.task()]);
    const { user } = renderApp(<AppShell />);
    await user.click(await screen.findByText('Book the Tuesday slot'));
    await user.click(await screen.findByRole('button', { name: 'Move to Backlog' }));
    await user.type(screen.getByLabelText('Reason (optional)'), 'not this month after all');
    await user.click(screen.getByRole('button', { name: 'Move it' }));

    await waitFor(async () => {
      const body = await bodyOf(lastRequest('POST', '/move-to-backlog'));
      // D-12 — `fromWeekStart` follows the week the task was live in, which is the week we are viewing.
      expect(body).toMatchObject({ week: 0, reason: 'not this month after all' });
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Moved to Backlog — reason noted');
    // D-15 — nothing was deleted: the task keeps its row so the `Moved to Backlog` entry has a home.
    expect(requests('DELETE', '/api/tasks')).toHaveLength(0);
  });

  it('S-task-15-2: the reason really is optional', async () => {
    withWeek([F.task()]);
    const { user } = renderApp(<AppShell />);
    await user.click(await screen.findByText('Book the Tuesday slot'));
    await user.click(await screen.findByRole('button', { name: 'Move to Backlog' }));
    await user.click(screen.getByRole('button', { name: 'Move it' }));

    await waitFor(async () => {
      const body = await bodyOf(lastRequest('POST', '/move-to-backlog'));
      expect(body).not.toHaveProperty('reason');
    });
    expect(await screen.findByRole('status')).toHaveTextContent(/^Moved to Backlog$/);
  });

  it('S-task-16-1: Cancel drops the task from the board and keeps the reason on the record', async () => {
    withWeek([F.task()]);
    const { user } = renderApp(<AppShell />);
    await user.click(await screen.findByText('Book the Tuesday slot'));
    await user.click(await screen.findByRole('button', { name: 'Cancel task' }));
    await user.type(screen.getByLabelText('Reason (optional)'), 'overtaken by events');
    await user.click(screen.getByRole('button', { name: 'Cancel it' }));

    await waitFor(async () => {
      expect(await bodyOf(lastRequest('POST', '/cancel'))).toMatchObject({ reason: 'overtaken by events' });
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Task canceled');
    expect(requests('DELETE', '/api/tasks')).toHaveLength(0);
  });

  it('S-task-17-1 / S-task-13-1: a done task offers neither exit, and no fourth one exists anywhere', async () => {
    withWeek([F.task({ status: 'done', done: true, doneWeekStart: F.THIS_MONDAY, doneAt: F.NOW })]);
    server.use(http.get('/api/tasks/:id', () => HttpResponse.json(F.taskResponse({ status: 'done', done: true, doneWeekStart: F.THIS_MONDAY, doneAt: F.NOW }))));
    const { user } = renderApp(<AppShell />);
    await user.click(await screen.findByText('Book the Tuesday slot'));

    const sheet = await screen.findByRole('dialog', { name: 'Task detail' });
    expect(within(sheet).queryByRole('button', { name: 'Move to Backlog' })).not.toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: 'Cancel task' })).not.toBeInTheDocument();
    // R-task-26 — but it stays editable.
    expect(within(sheet).getByLabelText('Title')).toBeEnabled();
    // R-task-13 — there is no defer, snooze, reschedule or move-to-another-week.
    expect(within(sheet).queryByRole('button', { name: /defer|snooze|reschedul/i })).not.toBeInTheDocument();
  });
});

describe('Tasks — uncheck and its skippable follow-up', () => {
  const done = F.task({ status: 'done', done: true, doneWeekStart: F.THIS_MONDAY, doneAt: F.NOW, cond: 'confirmation in the calendar' });

  it('S-task-19-1 / S-task-21-1: unchecking opens the prompt, and Skip writes nothing', async () => {
    withWeek([done]);
    const { user } = renderApp(<AppShell />);
    await user.click(await screen.findByRole('button', { name: 'Uncheck Book the Tuesday slot' }));

    expect(await screen.findByText('Update the done-condition?')).toBeInTheDocument();
    // R-task-21 — pre-filled with the current condition.
    expect(screen.getByLabelText('Done-condition')).toHaveValue('confirmation in the calendar');
    await user.click(screen.getByRole('button', { name: 'Skip' }));

    expect(screen.queryByText('Update the done-condition?')).not.toBeInTheDocument();
    expect(requests('PATCH', '/api/tasks/')).toHaveLength(0);
  });

  it('S-task-21-3: saving an unchanged value is also a no-op', async () => {
    withWeek([done]);
    const { user } = renderApp(<AppShell />);
    await user.click(await screen.findByRole('button', { name: 'Uncheck Book the Tuesday slot' }));
    await screen.findByText('Update the done-condition?');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.queryByText('Update the done-condition?')).not.toBeInTheDocument());
    expect(requests('PATCH', '/api/tasks/')).toHaveLength(0);
  });

  it('S-task-21-2: a changed condition is written once, and the event text is the server’s', async () => {
    withWeek([done]);
    const { user } = renderApp(<AppShell />);
    await user.click(await screen.findByRole('button', { name: 'Uncheck Book the Tuesday slot' }));
    const field = await screen.findByLabelText('Done-condition');
    await user.clear(field);
    await user.type(field, 'a slot on the calendar and a confirmation email');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(async () => {
      expect(await bodyOf(lastRequest('PATCH', '/api/tasks/'))).toMatchObject({ cond: 'a slot on the calendar and a confirmation email' });
    });
    // R-task-27/31 — the client never builds the `Done-condition edited: "…" → "…"` string.
    expect(requests('PATCH', '/api/tasks/')).toHaveLength(1);
  });
});

describe('Tasks — the detail sheet', () => {
  it('S-task-23-1: only changed fields are sent, and the activity timeline is rendered as the server wrote it', async () => {
    withWeek([F.task()]);
    server.use(
      http.get('/api/tasks/:id', () =>
        HttpResponse.json(
          F.taskResponse({
            events: [
              { id: F.ulid(31), kind: 'renamed', at: F.NOW, text: 'Renamed: “Book a slot” → “Book the Tuesday slot”', glyph: '✎', detail: null },
              { id: F.ulid(30), kind: 'created', at: F.NOW, text: 'Created — weekly planning', glyph: '＋', detail: null },
            ],
          }),
        ),
      ),
    );
    const { user } = renderApp(<AppShell />);
    await user.click(await screen.findByText('Book the Tuesday slot'));

    const sheet = await screen.findByRole('dialog', { name: 'Task detail' });
    expect(within(sheet).getByText('Renamed: “Book a slot” → “Book the Tuesday slot”')).toBeInTheDocument();
    expect(within(sheet).getByText('Created — weekly planning')).toBeInTheDocument();

    await user.type(within(sheet).getByLabelText('Description'), 'ask about the 7am slot');
    await user.click(within(sheet).getByRole('button', { name: 'Save changes' }));

    await waitFor(async () => {
      const body = await bodyOf(lastRequest('PATCH', '/api/tasks/'));
      expect(body).toMatchObject({ description: 'ask about the 7am slot' });
      expect(body).not.toHaveProperty('title');
      expect(body).not.toHaveProperty('cond');
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Task updated');
  });

  it('R-task-24 / D-13: a link is added by URL and removed by ID, and a bad URL is stated at the field', async () => {
    withWeek([F.task()]);
    server.use(
      http.get('/api/tasks/:id', () =>
        HttpResponse.json(F.taskResponse({ links: [{ id: F.ulid(70), url: 'https://www.github.com/acme/pr/1', createdAt: F.NOW }] })),
      ),
      http.post('/api/tasks/:id/links', () => apiError('VALIDATION_FAILED', 'invalid', { issues: [{ message: 'link must be http(s)' }] })),
    );
    const { user } = renderApp(<AppShell />);
    await user.click(await screen.findByText('Book the Tuesday slot'));
    const sheet = await screen.findByRole('dialog', { name: 'Task detail' });

    expect(within(sheet).getByText('github.com')).toBeInTheDocument();
    // Was a silent `return` on a blank or unparseable URL; now it is a 422 with a message at the field.
    await user.type(within(sheet).getByLabelText('Link URL'), 'not-a-url');
    await user.click(within(sheet).getByRole('button', { name: 'Add' }));
    expect(await within(sheet).findByRole('alert')).toHaveTextContent('link must be http(s)');

    await user.click(within(sheet).getByRole('button', { name: 'Remove link github.com' }));
    await waitFor(() => expect(lastRequest('DELETE', '/links/')?.url).toContain(F.ulid(70)));
  });
});
