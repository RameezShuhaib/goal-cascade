import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { AppShell } from '../../src/AppShell';
import { renderApp } from '../render';
import { apiError, bodyOf, lastRequest, requests, server } from '../msw/handlers';
import * as F from '../msw/fixtures';

/**
 * Creation — UX §6.7 and R-task-48/49.
 *
 * The two entry points answer different questions: the cluster row's `+ <Horizon> goal` means "add
 * something to this period", the per-group one means "add something to *this line* in this period". The
 * second is the good one, and it is why grouping earns its keep: sitting inside a group in a
 * period-scoped lens, **every field of the form except the title is already known.**
 */

describe('Creating a goal (§6.7)', () => {
  it('the heading names the horizon, and the period is a read-only chip with its reason', async () => {
    const { user } = renderApp(<AppShell />, { route: '/quarter/2026-Q3' });
    await user.click(await screen.findByRole('button', { name: '+ Quarterly goal' }));

    const sheet = await screen.findByRole('dialog', { name: 'New Quarterly goal' });
    // The horizon picker is gone entirely — the heading says it.
    expect(within(sheet).queryByText('HORIZON')).not.toBeInTheDocument();
    // R-goal-33 — and the period is not an editable text field any more. That field is what let you type
    // `Q9 3026`, which under the canonical key would put the goal in NO lens at all.
    expect(within(sheet).queryByLabelText('Target period')).not.toBeInTheDocument();
    expect(within(sheet).getByText("Because you're looking at Q3 2026.")).toBeInTheDocument();
  });

  it('S-goal-5-1: the parent picker lists only legal parents in the enclosing period', async () => {
    const { user } = renderApp(<AppShell />, { route: '/quarter/2026-Q3' });
    await user.click(await screen.findByRole('button', { name: '+ Quarterly goal' }));
    const sheet = await screen.findByRole('dialog', { name: 'New Quarterly goal' });

    // A Quarterly goal's legal parents are the Life goals and the Yearly goals of the enclosing year.
    expect(await within(sheet).findByRole('button', { name: /Get back under 80kg/ })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: /Be strong at 60/ })).toBeInTheDocument();
    // Never a shorter or equal horizon: a Monthly goal cannot parent a Quarterly one (R-goal-5).
    expect(within(sheet).queryByRole('button', { name: /Lift three times a week/ })).not.toBeInTheDocument();
  });

  it('the per-group create knows the line as well as the period, and writes the canonical key', async () => {
    const { user } = renderApp(<AppShell />, { route: '/month/2026-08' });
    await screen.findByText('Lift three times a week');
    // Two groups, so two group feet; the first belongs to `Be strong at 60`.
    await user.click(screen.getAllByRole('button', { name: '+ Monthly goal' })[1]!);

    const sheet = await screen.findByRole('dialog', { name: 'New Monthly goal' });
    // Narrowed to that line: `Launch v1` belongs to the other one and is not offered.
    const parent = await within(sheet).findByRole('button', { name: /Rebuild the gym habit/ });
    expect(within(sheet).queryByRole('button', { name: /Launch v1/ })).not.toBeInTheDocument();

    await user.click(parent);
    await user.type(within(sheet).getByLabelText('Goal title'), 'Deadlift twice a week');
    await user.click(within(sheet).getByRole('button', { name: 'Save goal' }));

    await waitFor(async () => {
      const body = await bodyOf(lastRequest('POST', '/api/goals'));
      // ⚠ **A2** — `periodKey`, never `period`: the label is server-derived and there is no `period`
      // field on any request schema at all (S-goal-33-3).
      expect(body).toMatchObject({ horizon: 'Monthly', periodKey: '2026-08', parentId: F.Q, title: 'Deadlift twice a week' });
      expect(body).not.toHaveProperty('period');
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Added to Aug 2026');
  });

  it('R-goal-3: a Life goal is created with no parent and no period', async () => {
    const { user } = renderApp(<AppShell />, { route: '/life' });
    await user.click(await screen.findByRole('button', { name: '+ Life goal' }));
    const sheet = await screen.findByRole('dialog', { name: 'New Life goal' });
    expect(within(sheet).queryByText('UNDER')).not.toBeInTheDocument();

    await user.type(within(sheet).getByLabelText('Goal title'), 'Stay curious');
    await user.click(within(sheet).getByRole('button', { name: 'Save goal' }));

    await waitFor(async () => {
      const body = await bodyOf(lastRequest('POST', '/api/goals'));
      expect(body).toMatchObject({ title: 'Stay curious', horizon: 'Life', parentId: null });
      expect(body).not.toHaveProperty('periodKey');
    });
  });

  it('§6.7: with nothing to hang it on, the sheet closes the loop in one tap', async () => {
    server.use(http.get('/api/goals', ({ request }) => HttpResponse.json(F.lens({ lens: (new URL(request.url).searchParams.get('lens') ?? 'Weekly') as 'Life', items: [] }))));
    const { user } = renderApp(<AppShell />, { route: '/quarter/2026-Q3' });
    await user.click(await screen.findByRole('button', { name: '+ Quarterly goal' }));

    const sheet = await screen.findByRole('dialog', { name: 'New Quarterly goal' });
    expect(await within(sheet).findByText('Nothing to hang this on yet — a quarterly goal needs a Life or Yearly goal above it.')).toBeInTheDocument();

    // The handoff must not drop the intent: it zooms to Life AND opens `New Life goal`.
    await user.click(within(sheet).getByRole('button', { name: 'Start with a Life goal →' }));
    expect(await screen.findByRole('dialog', { name: 'New Life goal' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Life lens, Life. Change lens or period.' })).toBeInTheDocument();
  });

  it('S-goal-29-1 / R-goal-36: a refusal is stated at the form, never swallowed', async () => {
    server.use(http.post('/api/goals', () => apiError('PERIOD_IN_PAST')));
    const { user } = renderApp(<AppShell />, { route: '/quarter/2026-Q3' });
    await user.click(await screen.findByRole('button', { name: '+ Quarterly goal' }));
    const sheet = await screen.findByRole('dialog', { name: 'New Quarterly goal' });
    await user.click(await within(sheet).findByRole('button', { name: /Get back under 80kg/ }));
    await user.type(within(sheet).getByLabelText('Goal title'), 'Something');
    await user.click(within(sheet).getByRole('button', { name: 'Save goal' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('That period has already passed');
  });
});

/**
 * R-task-49 — **`+ Task` from a Monthly goal.** Tasks live on weekly goals, so this is structurally two
 * creates; made literal it is the worst flow in the product. The second step is inferred, never asked.
 */
describe('Creating a task from a Monthly goal — the two-step, made one (R-task-48/49)', () => {
  it('with NO weekly goal in the target week, one is created — and the sheet says so before you save', async () => {
    server.use(
      http.get('/api/goals', ({ request }) => {
        const lens = new URL(request.url).searchParams.get('lens') ?? 'Weekly';
        // Nothing under the Monthly goal this week, which is the "none" row of R-task-49's table.
        if (lens === 'Weekly') return HttpResponse.json(F.lens({ lens: 'Weekly', period: F.period({ periodKey: F.THIS_MONDAY }), items: [] }));
        return HttpResponse.json(F.lensFor(lens as 'Monthly'));
      }),
    );
    const { user } = renderApp(<AppShell />, { route: '/month/2026-08' });
    await screen.findByText('Lift three times a week');
    await user.click(screen.getAllByRole('button', { name: '+ Task' })[0]!);

    const sheet = await screen.findByRole('dialog', { name: 'New task' });
    // Nothing may be created invisibly (R-task-49).
    expect(
      await within(sheet).findByText('This starts a weekly goal "Lift three times a week" for the week of Mon 31 Aug. You can rename it after.'),
    ).toBeInTheDocument();

    await user.type(within(sheet).getByLabelText('What needs doing?'), 'Tuesday easy 6k');
    server.use(
      http.post(
        '/api/tasks',
        cmdJson(() =>
          HttpResponse.json(F.createTaskResponse({ title: 'Tuesday easy 6k' }, F.weeklyGoal({ id: F.ulid(55), title: 'Lift three times a week' })), { status: 201 }),
        ),
      ),
    );
    await user.click(within(sheet).getByRole('button', { name: 'Save task' }));

    await waitFor(async () => {
      const body = await bodyOf(lastRequest('POST', '/api/tasks'));
      // R-task-48's wire: exactly one of `goalId` or `newWeeklyGoal`, and NO week field of any kind.
      expect(body).toMatchObject({ newWeeklyGoal: { parentId: F.M, title: 'Lift three times a week' }, title: 'Tuesday easy 6k' });
      expect(body).not.toHaveProperty('goalId');
      expect(body).not.toHaveProperty('week');
    });

    // Named after: the toast names the week, and the live region names the goal that was made for it.
    const toast = await screen.findByRole('status');
    expect(toast).toHaveTextContent('Added to week of Mon 31 Aug');
    expect(toast).toHaveTextContent('under Lift three times a week');
    // R-nav-19 / R-task-41 — and the app MOVES to that week. Staying put would read as a lost write.
    expect(await screen.findByRole('button', { name: 'Weekly lens, Week of 31 Aug. Change lens or period.' })).toBeInTheDocument();
  });

  it('with exactly ONE weekly goal it is used silently — no picker, no extra field, no extra tap', async () => {
    const { user } = renderApp(<AppShell />, { route: '/month/2026-08' });
    await screen.findByText('Lift three times a week');
    await user.click(screen.getAllByRole('button', { name: '+ Task' })[0]!);

    const sheet = await screen.findByRole('dialog', { name: 'New task' });
    await waitFor(() => expect(within(sheet).queryByText(/This starts a weekly goal/)).not.toBeInTheDocument());
    expect(within(sheet).queryByText('WHICH WEEKLY GOAL?')).not.toBeInTheDocument();

    await user.type(within(sheet).getByLabelText('What needs doing?'), 'Tuesday easy 6k');
    await user.click(within(sheet).getByRole('button', { name: 'Save task' }));

    await waitFor(async () => {
      const body = await bodyOf(lastRequest('POST', '/api/tasks'));
      expect(body).toMatchObject({ goalId: F.W, title: 'Tuesday easy 6k' });
      expect(body).not.toHaveProperty('newWeeklyGoal');
    });
  });

  it('with MORE than one, the first is preselected — one tap to change, zero to accept', async () => {
    server.use(
      http.get('/api/goals', ({ request }) => {
        const lens = new URL(request.url).searchParams.get('lens') ?? 'Weekly';
        if (lens === 'Weekly')
          return HttpResponse.json(
            F.lens({
              lens: 'Weekly',
              period: F.period({ periodKey: F.THIS_MONDAY }),
              items: [F.weeklyGoal(), F.weeklyGoal({ id: F.ulid(56), title: 'Two gym sessions' })],
              groups: [F.group({ id: F.L })],
            }),
          );
        return HttpResponse.json(F.lensFor(lens as 'Monthly'));
      }),
    );
    const { user } = renderApp(<AppShell />, { route: '/month/2026-08' });
    await screen.findByText('Lift three times a week');
    await user.click(screen.getAllByRole('button', { name: '+ Task' })[0]!);

    const sheet = await screen.findByRole('dialog', { name: 'New task' });
    expect(await within(sheet).findByText('WHICH WEEKLY GOAL?')).toBeInTheDocument();
    await user.type(within(sheet).getByLabelText('What needs doing?'), 'Tuesday easy 6k');
    await user.click(within(sheet).getByRole('button', { name: 'Save task' }));

    // Accepting the preselection costs zero taps, and it is the FIRST, never an arbitrary one.
    await waitFor(async () => expect(await bodyOf(lastRequest('POST', '/api/tasks'))).toMatchObject({ goalId: F.W }));
  });

  it('R-task-3: a title and no done-condition is enough, and a blank title cannot be saved', async () => {
    const { user } = renderApp(<AppShell />, { route: '/week/2026-08-31' });
    await user.click(await screen.findByRole('button', { name: '+ Task' }));
    const sheet = await screen.findByRole('dialog', { name: 'New task' });

    expect(within(sheet).getByRole('button', { name: 'Save task' })).toBeDisabled();
    await user.type(within(sheet).getByLabelText('What needs doing?'), 'Tuesday easy 6k');
    await user.click(within(sheet).getByRole('button', { name: 'Save task' }));

    await waitFor(async () => {
      const body = await bodyOf(lastRequest('POST', '/api/tasks'));
      expect(body).toMatchObject({ goalId: F.W, title: 'Tuesday easy 6k', cond: '' });
      // Q-8 — no client-minted id, and A2 adds: no week of any kind (S-task-40-3).
      expect(body).not.toHaveProperty('id');
      expect(body).not.toHaveProperty('week');
      expect(body).not.toHaveProperty('originWeek');
    });
  });

  it('R-task-49: the dead end is gone — there is no "this branch isn\'t active this week" anywhere', async () => {
    server.use(
      http.get('/api/goals', ({ request }) => {
        const lens = new URL(request.url).searchParams.get('lens') ?? 'Weekly';
        if (lens === 'Weekly') return HttpResponse.json(F.lens({ lens: 'Weekly', period: F.period({ periodKey: F.THIS_MONDAY }), items: [] }));
        return HttpResponse.json(F.lensFor(lens as 'Monthly'));
      }),
    );
    const { user } = renderApp(<AppShell />, { route: '/month/2026-08' });
    await screen.findByText('Lift three times a week');
    await user.click(screen.getAllByRole('button', { name: '+ Task' })[0]!);
    await screen.findByRole('dialog', { name: 'New task' });

    // The state that used to send the owner to a planning screen no longer exists: the thing the work
    // needed to hang off is created for it.
    expect(screen.queryByText(/isn't active this week/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Set a weekly focus' })).not.toBeInTheDocument();
    expect(requests('GET', '/api/plan')).toHaveLength(0);
  });
});

/** MSW's `cmd` wrapper, re-declared locally where a test needs to override a command handler. */
function cmdJson(respond: () => Response) {
  return ({ request }: { request: Request }) =>
    request.headers.get('Idempotency-Key') ? respond() : apiError('IDEMPOTENCY_KEY_MISSING');
}
