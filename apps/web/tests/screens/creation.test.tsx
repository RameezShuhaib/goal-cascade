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

/**
 * `findAllByRole(...)[0]` throughout: the cluster row's create and each group foot's create share a name,
 * and DOM order puts the cluster row first (it is row 1). These used to read `findByRole`, which resolved
 * against a single match only because the cluster button rendered **during the read** — the always-true
 * `view !== undefined` guard in `LensScreen`. With that fixed both affordances appear on the same tick, so
 * the intended one is now named rather than won by a race.
 */
describe('Creating a goal (§6.7)', () => {
  it('the heading names the horizon, and the period is a read-only chip with its reason', async () => {
    const { user } = renderApp(<AppShell />, { route: '/quarter/2026-Q3' });
    await user.click((await screen.findAllByRole('button', { name: '+ Quarterly goal' }))[0]!);

    const sheet = await screen.findByRole('dialog', { name: 'New Quarterly goal' });
    // The horizon picker is gone entirely — the heading says it.
    expect(within(sheet).queryByText('HORIZON')).not.toBeInTheDocument();
    // R-goal-33 — and the period is not an editable text field any more. That field is what let you type
    // `Q9 3026`, which under the canonical key would put the goal in NO lens at all.
    expect(within(sheet).queryByLabelText('Target period')).not.toBeInTheDocument();
    expect(within(sheet).getByText("Because you're looking at Q3 2026.")).toBeInTheDocument();
  });

  /**
   * ⚠ **A9 — the two halves of this now sit on two surfaces, and both are asserted.**
   *
   * In the SHEET the picker is one row naming the current choice; the legal parents live in the picker it
   * opens. That is the fix to the owner's flooded sheet, and it is why the option assertions moved one tap
   * in.
   */
  it('S-goal-5-1: the parent picker lists only legal parents in the enclosing period', async () => {
    const { user } = renderApp(<AppShell />, { route: '/quarter/2026-Q3' });
    await user.click((await screen.findAllByRole('button', { name: '+ Quarterly goal' }))[0]!);
    const sheet = await screen.findByRole('dialog', { name: 'New Quarterly goal' });

    // A9 — inside the sheet: a row, never a list. The form's other fields keep their space.
    const field = await within(sheet).findByRole('button', { name: /^Choose a goal/ });
    expect(within(sheet).queryByRole('option')).not.toBeInTheDocument();
    await user.click(field);
    const picker = await screen.findByRole('dialog', { name: 'Choose a goal' });

    // A Quarterly goal's legal parents are the Life goals and the Yearly goals of the enclosing year, and
    // A9 scopes them by horizon: the selector offers exactly those two and opens on the more specific.
    expect(within(picker).getByRole('radio', { name: /^Yearly/ })).toHaveAttribute('aria-checked', 'true');
    expect(within(picker).getByRole('radio', { name: /^Life/ })).toHaveAttribute('aria-checked', 'false');
    expect(within(picker).queryByRole('radio', { name: /^Quarterly/ })).not.toBeInTheDocument();
    expect(within(picker).queryByRole('radio', { name: /^Monthly/ })).not.toBeInTheDocument();

    // ⚠ **R-nav-31** — the rows are `role="option"` in one listbox, and each name carries the Life line
    // and the period, so two same-titled goals in different lines are one utterance apart.
    expect(await within(picker).findByRole('option', { name: 'Get back under 80kg — Be strong at 60 · Yearly · 2026' })).toBeInTheDocument();
    await user.click(within(picker).getByRole('radio', { name: /^Life/ }));
    expect(within(picker).getByRole('option', { name: /^Be strong at 60/ })).toBeInTheDocument();
    // Never a shorter or equal horizon: a Monthly goal cannot parent a Quarterly one (R-goal-5), and A9
    // does not smuggle one in behind a horizon chip — there is no chip for it to hide behind.
    expect(within(picker).queryByRole('option', { name: /Lift three times a week/ })).not.toBeInTheDocument();
  });

  /**
   * ⚠ **A9 — defect 2: the default parent is the NEAREST legal ancestor.**
   *
   * The owner, creating a Monthly goal in `Sep 2026`, saw the Life goal at the top of the list looking
   * chosen. It was not chosen — nothing was, because §6.7 preselected only when exactly one parent was
   * legal, and the roving-focus ring on row 0 (which is a Life goal) did the rest.
   */
  it('A9: a new Monthly goal defaults its parent to the QUARTERLY goal of the enclosing quarter', async () => {
    const { user } = renderApp(<AppShell />, { route: '/month/2026-09' });
    await user.click((await screen.findAllByRole('button', { name: '+ Monthly goal' }))[0]!);
    const sheet = await screen.findByRole('dialog', { name: 'New Monthly goal' });

    // Q3 2026's `Rebuild the gym habit`, not the Life goal above it and not nothing at all.
    expect(await within(sheet).findByRole('button', { name: /^Choose a goal: Rebuild the gym habit/ })).toBeInTheDocument();

    await user.type(within(sheet).getByLabelText('Goal title'), 'Deadlift twice a week');
    await user.click(within(sheet).getByRole('button', { name: 'Save goal' }));
    await waitFor(async () => expect(await bodyOf(lastRequest('POST', '/api/goals'))).toMatchObject({ parentId: F.Q, periodKey: '2026-09' }));
  });

  it('A9: the picker opens ON that horizon, with the default parent already selected in it', async () => {
    const { user } = renderApp(<AppShell />, { route: '/month/2026-09' });
    await user.click((await screen.findAllByRole('button', { name: '+ Monthly goal' }))[0]!);
    const sheet = await screen.findByRole('dialog', { name: 'New Monthly goal' });
    await user.click(await within(sheet).findByRole('button', { name: /^Choose a goal:/ }));
    const picker = await screen.findByRole('dialog', { name: 'Choose a goal' });

    // The horizon follows the choice, so reopening shows you where your goal lives rather than resetting.
    expect(within(picker).getByRole('radio', { name: /^Quarterly/ })).toHaveAttribute('aria-checked', 'true');
    expect(within(picker).getByRole('option', { name: /^Rebuild the gym habit/ })).toHaveAttribute('aria-selected', 'true');
    // Every legal horizon is offered, and no illegal one is: a Monthly goal cannot parent a Monthly goal.
    expect(within(picker).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Life', 'Yearly', 'Quarterly']);
  });

  /**
   * ⚠ **A9 — the default is the MOST SPECIFIC legal horizon that has something, at every subject horizon.**
   * A Weekly goal may hang off any of the four longer horizons (R-goal-32), and the one it usually hangs
   * off is the nearest.
   */
  it('A9: a new Weekly goal offers all four longer horizons and opens on Monthly', async () => {
    const { user } = renderApp(<AppShell />, { route: '/week/2026-08-31' });
    await user.click((await screen.findAllByRole('button', { name: '+ Weekly goal' }))[0]!);
    const sheet = await screen.findByRole('dialog', { name: 'New Weekly goal' });
    await user.click(await within(sheet).findByRole('button', { name: /^Choose a goal/ }));
    const picker = await screen.findByRole('dialog', { name: 'Choose a goal' });

    expect(within(picker).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Life', 'Yearly', 'Quarterly', 'Monthly']);
    expect(within(picker).getByRole('radio', { name: /^Monthly/ })).toHaveAttribute('aria-checked', 'true');
    // Scoped, so the Life goal is not on screen until its own horizon is chosen — or until you search.
    expect(within(picker).queryByRole('option', { name: /^Be strong at 60/ })).not.toBeInTheDocument();
    expect(within(picker).getByRole('option', { name: /^Lift three times a week/ })).toBeInTheDocument();
  });

  it('the per-group create knows the line as well as the period, and writes the canonical key', async () => {
    const { user } = renderApp(<AppShell />, { route: '/month/2026-08' });
    await screen.findByText('Lift three times a week');
    // Two groups, so two group feet; the first belongs to `Be strong at 60`.
    await user.click(screen.getAllByRole('button', { name: '+ Monthly goal' })[1]!);

    const sheet = await screen.findByRole('dialog', { name: 'New Monthly goal' });
    // A9 — the nearest legal ancestor in that line is already the default, so the line is legible on the
    // row without opening anything: `Rebuild the gym habit` is Q3 2026's Quarterly goal in `Be strong at 60`.
    await user.click(await within(sheet).findByRole('button', { name: /^Choose a goal: Rebuild the gym habit/ }));
    const picker = await screen.findByRole('dialog', { name: 'Choose a goal' });
    // Narrowed to that line: `Launch v1` belongs to the other one and is not offered, at any horizon.
    expect(within(picker).getByRole('option', { name: /^Rebuild the gym habit/ })).toHaveAttribute('aria-selected', 'true');
    await user.click(within(picker).getByRole('radio', { name: /^Yearly/ }));
    expect(within(picker).queryByRole('option', { name: /^Launch v1/ })).not.toBeInTheDocument();
    expect(within(picker).getByRole('option', { name: /^Get back under 80kg/ })).toBeInTheDocument();

    await user.click(within(picker).getByRole('button', { name: '‹ New Monthly goal' }));
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
    await user.click((await screen.findAllByRole('button', { name: '+ Quarterly goal' }))[0]!);

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
    await user.click((await screen.findAllByRole('button', { name: '+ Quarterly goal' }))[0]!);
    const sheet = await screen.findByRole('dialog', { name: 'New Quarterly goal' });
    // A9 — the nearest legal ancestor is already chosen, so the refusal is reached without a parent tap.
    await within(sheet).findByRole('button', { name: /^Choose a goal: Get back under 80kg/ });
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
      await within(sheet).findByText('This starts a weekly goal "Lift three times a week" for the week of 31 Aug. You can rename it after.'),
    ).toBeInTheDocument();
    // ⚠ **A9** — and the week is named on the ZERO-candidate row too, with the month it belongs to.
    expect(within(sheet).getByText('WHERE THIS GOES')).toBeInTheDocument();
    expect(within(sheet).getByText('Lands in the week of 31 Aug · Aug 2026.')).toBeInTheDocument();

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
    // R-nav-24 — the toast and the lens title three lines below now name the week identically.
    expect(toast).toHaveTextContent('Added to week of 31 Aug');
    expect(toast).toHaveTextContent('under Lift three times a week');
    // R-nav-19 / R-task-41 — and the app MOVES to that week. Staying put would read as a lost write.
    expect(await screen.findByRole('button', { name: 'Weekly lens, Week of 31 Aug. Change lens or period.' })).toBeInTheDocument();
  });

  /**
   * ⚠ **A9 — defect 3, and the worst of the four.**
   *
   * This test used to be called *"with exactly ONE weekly goal it is used silently"*, and it asserted the
   * absence: no picker, no field, nothing said. That absence is the defect. The owner added three tasks
   * from a Monthly goal, was never told which weekly goal or which week they went to, and could not find
   * them again. **One candidate is not a choice; it is still an ANSWER, and the answer was what was owed.**
   */
  it('A9: with exactly ONE weekly goal it is named as a FILLED choice — never used silently', async () => {
    const { user } = renderApp(<AppShell />, { route: '/month/2026-08' });
    await screen.findByText('Lift three times a week');
    await user.click(screen.getAllByRole('button', { name: '+ Task' })[0]!);

    const sheet = await screen.findByRole('dialog', { name: 'New task' });
    await waitFor(() => expect(within(sheet).queryByText(/This starts a weekly goal/)).not.toBeInTheDocument());

    // The destination, before saving: the weekly goal, the week, and the month that week belongs to.
    expect(await within(sheet).findByText('WHERE THIS GOES')).toBeInTheDocument();
    const field = within(sheet).getByRole('button', { name: /^Choose a goal: Three easy runs and one long run/ });
    expect(field).toBeInTheDocument();
    expect(within(sheet).getByText('Lands in the week of 31 Aug · Aug 2026.')).toBeInTheDocument();

    // And a way to change it: the same row opens the same picker, with the one candidate selected in it.
    await user.click(field);
    const picker = await screen.findByRole('dialog', { name: 'Choose a goal' });
    expect(within(picker).getByRole('option', { name: /^Three easy runs and one long run/ })).toHaveAttribute('aria-selected', 'true');
    await user.click(within(picker).getByRole('button', { name: '‹ New task' }));

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
    // ⚠ **A9** — the same block, the same two facts, at a different candidate count. One rule, three rows.
    expect(await within(sheet).findByText('WHERE THIS GOES')).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: /^Choose a goal: Three easy runs and one long run/ })).toBeInTheDocument();
    expect(within(sheet).getByText('Lands in the week of 31 Aug · Aug 2026.')).toBeInTheDocument();
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
