import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { AppShell } from '../../src/AppShell';
import { renderApp } from '../render';
import { bodyOf, lastRequest, server } from '../msw/handlers';
import * as F from '../msw/fixtures';

/**
 * The goal detail page (R-goal-41), and the two very different backlog blocks it can show
 * (R-backlog-11/12). Which one appears is the SERVER's decision, carried in `backlogIsAggregate`.
 *
 * ⚠ **A2** — the page is **not week-scoped** any more (`GET /goals/:id` takes no `?week=`), there is no
 * weekly-focus block and no dormant block, and a **Weekly** goal gains its task list and its backlog pull
 * list (R-backlog-28) while holding no backlog of its own (R-backlog-2).
 */

const withDetail = (id: string, extra: Parameters<typeof F.detailOf>[1] = {}) =>
  server.use(http.get('/api/goals/:id', () => HttpResponse.json(F.detailOf(id, extra))));

describe('Goal detail', () => {
  it('S-backlog-11-1: a non-Life goal shows its OWN items, with the three actions and + Add', async () => {
    withDetail(F.Q, {
      backlog: [F.backlogItem({ id: F.ulid(41), goalId: F.Q, title: 'Find a squat rack free at 7am' }), F.backlogItem({ id: F.ulid(42), goalId: F.Q, title: 'Book an induction' })],
      backlogIsAggregate: false,
    });
    const { user } = renderApp(<AppShell />, { route: `/goal/${F.Q}` });

    expect(await screen.findByText('Backlog (2)')).toBeInTheDocument();
    await user.click(screen.getByText('Find a squat rack free at 7am'));
    // D-20 — the same three actions the Backlog page offers, wherever you found the item.
    expect(screen.getByRole('button', { name: 'Add to this week' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move to another goal' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '+ Add' }));
    await user.type(screen.getByLabelText('Backlog item'), 'Ask about the 7am slot{Enter}');
    await waitFor(async () => expect(await bodyOf(lastRequest('POST', '/api/backlog'))).toMatchObject({ goalId: F.Q, title: 'Ask about the 7am slot' }));
  });

  it('S-backlog-12-1: a Life goal shows a READ-ONLY roll-up, and the only way out is the Backlog page', async () => {
    withDetail(F.L, { backlog: [F.backlogItem({ id: F.ulid(41), goalId: F.Q, title: 'Find a squat rack free at 7am' })], backlogIsAggregate: true });
    const { user } = renderApp(<AppShell />, { route: `/goal/${F.L}` });

    expect(await screen.findByText('Backlog across this line (1)')).toBeInTheDocument();
    await user.click(screen.getByText('Find a squat rack free at 7am'));
    expect(screen.queryByRole('button', { name: 'Add to this week' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Backlog →' })).toBeInTheDocument();
  });

  it('S-backlog-12-2: the Life-goal empty state says the line is clear', async () => {
    withDetail(F.L, { backlog: [], backlogIsAggregate: true });
    renderApp(<AppShell />, { route: `/goal/${F.L}` });
    expect(await screen.findByText('Nothing deferred anywhere on this line.')).toBeInTheDocument();
  });

  it('S-learning-5-1: the learnings shown are the whole Life LINE’s, and the breadcrumb walks back up', async () => {
    withDetail(F.Q, { learnings: [F.learning({ goalId: F.L, applied: true })] });
    renderApp(<AppShell />, { route: `/goal/${F.Q}` });

    expect(await screen.findByText('“Evening sessions never survive a busy week”')).toBeInTheDocument();
    expect(screen.getByText('changed the plan')).toBeInTheDocument();
    /**
     * ⚠ **AMENDED, not weakened — R-goal-41's breadcrumb clause (A6).** This used to assert two plain
     * buttons, `Be strong at 60` and `Get back under 80kg`, which is what the wrapping trail rendered. The
     * trail is now one non-wrapping line and the Life root is an eyebrow, so **both ways up still exist and
     * this asserts strictly more about each of them**: the parent crumb's accessible name now carries its
     * **period** (the clause R-goal-41 has always required and the screen never rendered — asserted here
     * for the first time), and the eyebrow names itself as a way there. Neither route was removed; both are
     * now checked by name rather than by presence. The full ancestry with every period is asserted in
     * `breadcrumbs.test.tsx`.
     */
    expect(screen.getByRole('button', { name: 'Get back under 80kg, 2026' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Be strong at 60. Open goal.' })).toBeInTheDocument();
  });

  /**
   * ⚠ **RETIRED — S-goal-10-1 (`a dormant leaf states its dormancy and where to change it`).**
   *
   * **Verdict: R-goal-38 / R-rm-2.** `weekly_focus` is deleted, so "active" and "dormant" have no referent
   * on a goal any more, and `GoalView.dormant` left the wire. R-goal-38 is explicit that dormancy has
   * **exactly one surface and it is not styling**: no goal is muted, greyed or labelled `DORMANT`
   * anywhere. Its successor is R-goal-47's planned-ness line, one horizon up (asserted in
   * `lenses.test.tsx`). The assertion is INVERTED here rather than deleted, so the label cannot return.
   */
  it('R-goal-38 (retired S-goal-10-1): nothing is labelled DORMANT anywhere on a goal page', async () => {
    withDetail(F.M);
    renderApp(<AppShell />, { route: `/goal/${F.M}` });
    await screen.findByRole('heading', { level: 1, name: 'Lift three times a week' });

    expect(screen.queryByText('DORMANT')).not.toBeInTheDocument();
    expect(screen.queryByText(/No weekly focus this week/)).not.toBeInTheDocument();
    expect(screen.queryByText('Weekly focus')).not.toBeInTheDocument();
    // R-goal-47 — the honest successor, in plain words, at the horizon where it is actionable.
    expect(screen.getByText('3 weekly goals · 1 this week')).toBeInTheDocument();
  });

  /**
   * ⚠ **RETIRED — `R-nav-25 / Q-20: a Monthly goal keeps + Weekly goal on its DETAIL page`.**
   *
   * **Verdict: R-nav-29 (A3).** R-goal-48 puts an inline `+ Sub-goal` in the `Sub-goals` section on every
   * horizon that can hold children, so the top action became a second route to the same write, on one
   * horizon of four, a screen-inch away. The assertion is INVERTED rather than deleted, so the duplicate
   * cannot quietly return.
   */
  it('S-nav-29-1 (retired R-nav-25 / Q-20): a Monthly goal offers exactly ONE way to add a week — the section, not the header', async () => {
    withDetail(F.M);
    const { user } = renderApp(<AppShell />, { route: `/goal/${F.M}` });
    await screen.findByRole('heading', { level: 1, name: 'Lift three times a week' });

    // R-nav-29 is about there being ONE route to this write, not about the wording. The control is
    // named for its horizon (`+ Weekly goal`) because a Monthly goal can hold nothing else and the
    // owner's model is "weekly goals" — so asserting the STRING is absent would test the label and
    // miss the rule. Assert the rule: exactly one such control, and it is the section's inline
    // capture (it opens in place) rather than a second entry point in TopActions.
    const adds = screen.getAllByRole('button', { name: /Weekly goal/ });
    expect(adds).toHaveLength(1);

    await user.click(adds[0]!);
    expect(screen.getByLabelText('Sub-goal title')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Weekly goal/ })).not.toBeInTheDocument();
  });

  it('S-goal-48-1: a Yearly goal with no children still gets the section, and the first sub-goal goes in from it', async () => {
    server.use(http.get('/api/goals/:id', () => HttpResponse.json({ ...F.detailOf(F.Y), children: [] })));
    const { user } = renderApp(<AppShell />, { route: `/goal/${F.Y}` });

    // R-goal-48 — the empty section IS the case it exists for.
    expect(await screen.findByText('Sub-goals')).toBeInTheDocument();
    expect(screen.getByText('Nothing under this goal yet.')).toBeInTheDocument();

    const add = screen.getByRole('button', { name: '+ Sub-goal' });
    await user.click(add);
    await user.type(screen.getByLabelText('Sub-goal title'), 'Rebuild the gym habit{Enter}');

    // The parent is this goal, the horizon is the next shorter one, the period is the current quarter.
    await waitFor(async () =>
      expect(await bodyOf(lastRequest('POST', '/api/goals'))).toMatchObject({
        parentId: F.Y,
        horizon: 'Quarterly',
        periodKey: '2026-Q3',
        title: 'Rebuild the gym habit',
      }),
    );
    // Focus returns to the control that opened it, and the field closes.
    await waitFor(() => expect(screen.queryByLabelText('Sub-goal title')).not.toBeInTheDocument());
    expect(add).toHaveFocus();
  });

  it('S-goal-48-2: one legal horizon is not a question — a Monthly goal is never asked, and gets the week', async () => {
    withDetail(F.M);
    const { user } = renderApp(<AppShell />, { route: `/goal/${F.M}` });
    // Monthly can hold only weeks, so the control names the horizon (see S-nav-29-1).
    await user.click(await screen.findByRole('button', { name: '+ Weekly goal' }));

    expect(screen.queryByRole('group', { name: 'Sub-goal horizon' })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Sub-goal title'), 'Three easy runs{Enter}');
    // The server's Monday (D-1), which is the key `+ Weekly goal` used before R-nav-29 removed it.
    await waitFor(async () =>
      expect(await bodyOf(lastRequest('POST', '/api/goals'))).toMatchObject({ parentId: F.M, horizon: 'Weekly', periodKey: F.THIS_MONDAY }),
    );
  });

  it('S-goal-48-3: several legal horizons default to the next shorter one, and never offer their own', async () => {
    withDetail(F.L, { backlogIsAggregate: true });
    const { user } = renderApp(<AppShell />, { route: `/goal/${F.L}` });
    await user.click(await screen.findByRole('button', { name: '+ Sub-goal' }));

    const picker = screen.getByRole('group', { name: 'Sub-goal horizon' });
    expect(within(picker).getAllByRole('button').map((b) => b.textContent)).toEqual(['Yearly', 'Quarterly', 'Monthly', 'Weekly']);
    // R-goal-5 — a child of equal or longer horizon is not offered at all.
    expect(within(picker).queryByRole('button', { name: 'Life' })).not.toBeInTheDocument();
    expect(within(picker).getByRole('button', { name: 'Yearly' })).toHaveAttribute('aria-pressed', 'true');

    // …and it is changeable: the picker is an offer, not a fixed answer.
    await user.click(within(picker).getByRole('button', { name: 'Monthly' }));
    await user.type(screen.getByLabelText('Sub-goal title'), 'Write the changelog{Enter}');
    await waitFor(async () =>
      expect(await bodyOf(lastRequest('POST', '/api/goals'))).toMatchObject({ parentId: F.L, horizon: 'Monthly', periodKey: '2026-08' }),
    );
  });

  it('S-goal-48-4: a parent whose period starts later takes the parent’s first period, never a past one', async () => {
    const base = F.detailOf(F.Y);
    server.use(http.get('/api/goals/:id', () => HttpResponse.json({ ...base, goal: { ...base.goal, periodKey: '2027', period: '2027' }, children: [] })));
    const { user } = renderApp(<AppShell />, { route: `/goal/${F.Y}` });

    await user.click(await screen.findByRole('button', { name: '+ Sub-goal' }));
    await user.type(screen.getByLabelText('Sub-goal title'), 'Rebuild the gym habit{Enter}');
    await waitFor(async () => expect(await bodyOf(lastRequest('POST', '/api/goals'))).toMatchObject({ periodKey: '2027-Q1' }));
  });

  it('S-goal-48-5: a Weekly goal is terminal — no Sub-goals section and no affordance anywhere on it', async () => {
    withDetail(F.W);
    renderApp(<AppShell />, { route: `/goal/${F.W}` });
    await screen.findByRole('heading', { level: 1, name: 'Three easy runs and one long run' });

    expect(screen.queryByText('Sub-goals')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Sub-goal' })).not.toBeInTheDocument();
    // R-nav-29 — its one primary action is unchanged.
    expect(screen.getByRole('button', { name: '+ Task' })).toBeInTheDocument();
  });

  it('S-goal-48-7: the server’s refusal renders under the field, and what was typed survives it', async () => {
    withDetail(F.Q);
    server.use(http.post('/api/goals', () => HttpResponse.json({ error: { code: 'PERIOD_IN_PAST', message: 'that month has already passed' } }, { status: 409 })));
    const { user } = renderApp(<AppShell />, { route: `/goal/${F.Q}` });

    await user.click(await screen.findByRole('button', { name: '+ Sub-goal' }));
    await user.type(screen.getByLabelText('Sub-goal title'), 'Lift three times a week{Enter}');

    // D-5 — the picker is a hint; the refusal is the rule, rendered from the CODE (Q-10) and never guessed.
    // The same copy also reaches the toast, as it does from the create sheet; the inline `alert` is the one
    // being asserted, because it is what keeps the message next to the field that caused it.
    const shown = await screen.findAllByText(/That period has already passed/);
    expect(shown.some((el) => el.getAttribute('role') === 'alert')).toBe(true);
    expect(screen.getByLabelText('Sub-goal title')).toHaveValue('Lift three times a week');
  });

  it('S-goal-48-6: `More…` opens the full form carrying the title, the horizon, the period and the parent', async () => {
    withDetail(F.Q);
    const { user } = renderApp(<AppShell />, { route: `/goal/${F.Q}` });
    await user.click(await screen.findByRole('button', { name: '+ Sub-goal' }));
    await user.type(screen.getByLabelText('Sub-goal title'), 'Lift three times a week');
    await user.click(screen.getByRole('button', { name: 'More…' }));

    const sheet = await screen.findByRole('dialog', { name: 'New Monthly goal' });
    expect(within(sheet).getByLabelText('Goal title')).toHaveValue('Lift three times a week');
    await user.click(within(sheet).getByRole('button', { name: 'Save goal' }));
    await waitFor(async () =>
      expect(await bodyOf(lastRequest('POST', '/api/goals'))).toMatchObject({ parentId: F.Q, horizon: 'Monthly', periodKey: '2026-08' }),
    );
  });

  it('R-goal-41 / R-backlog-28: a Weekly goal shows its tasks and its pull list, and no backlog of its own', async () => {
    withDetail(F.W, {
      tasks: [F.task({ goalId: F.W, title: 'Tuesday easy 6k' })],
      pullList: [F.backlogItem({ id: F.ulid(43), goalId: F.M, title: 'Find a squat rack free at 7am' })],
    });
    renderApp(<AppShell />, { route: `/goal/${F.W}` });

    expect(await screen.findByText('Tuesday easy 6k')).toBeInTheDocument();
    expect(screen.getByText('From the backlog')).toBeInTheDocument();
    // R-backlog-2 — a Weekly goal may hold no backlog items at all, so that block is not rendered.
    expect(screen.queryByText(/^Backlog \(/)).not.toBeInTheDocument();
    // R-nav-25 — its one primary action is `+ Task`.
    expect(screen.getByRole('button', { name: '+ Task' })).toBeInTheDocument();
  });

  it('R-goal-40: a Weekly goal is not re-plannable, and says why rather than offering an empty picker', async () => {
    withDetail(F.W);
    const { user } = renderApp(<AppShell />, { route: `/goal/${F.W}` });
    await screen.findByRole('heading', { level: 1, name: 'Three easy runs and one long run' });
    // Not offered at all — the same exemption R-goal-21 gives a Life goal, for the opposite reason.
    expect(screen.queryByRole('button', { name: 'Re-plan…' })).not.toBeInTheDocument();
    // …and Move IS still offered: re-parenting changes no week and rewrites no history (Q-24).
    expect(screen.getByRole('button', { name: 'Move…' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Move…' }));
    expect(await screen.findByRole('dialog', { name: 'Move goal' })).toBeInTheDocument();
  });

  it('R-goal-40 / D-3: the re-plan chips are the SERVER’s `PeriodView`s — the label shows, the key is written', async () => {
    withDetail(F.Q);
    const { user } = renderApp(<AppShell />, { route: `/goal/${F.Q}` });
    await user.click(await screen.findByRole('button', { name: 'Re-plan…' }));

    const sheet = await screen.findByRole('dialog', { name: 'Re-plan goal' });
    await user.click(await within(sheet).findByRole('button', { name: 'Q1 2027' }));
    await user.click(within(sheet).getByRole('button', { name: 'Re-plan it' }));

    // ⚠ **A2** — `periodKey`, not the label. The URL and the wire carry the key; the screen shows the label.
    await waitFor(async () => expect(await bodyOf(lastRequest('POST', '/replan'))).toMatchObject({ periodKey: '2027-Q1' }));
  });
});
