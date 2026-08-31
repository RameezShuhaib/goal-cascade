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
    // R-goal-41 — breadcrumbs to the Life root, with each ancestor's own period label.
    expect(screen.getByRole('button', { name: 'Be strong at 60' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Get back under 80kg' })).toBeInTheDocument();
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

  it('R-nav-25 / Q-20: a Monthly goal keeps `+ Weekly goal` on its DETAIL page — a page is not a lens', async () => {
    withDetail(F.M);
    renderApp(<AppShell />, { route: `/goal/${F.M}` });
    expect(await screen.findByRole('button', { name: '+ Weekly goal' })).toBeInTheDocument();
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
