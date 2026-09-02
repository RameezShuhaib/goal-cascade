import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { LensResponse } from '@goal-cascade/shared';
import { AppShell } from '../../src/AppShell';
import { renderApp } from '../render';
import { apiError, bodyOf, lastRequest, requests, server } from '../msw/handlers';
import * as F from '../msw/fixtures';

/**
 * The Weekly lens — the densest screen in the product, and now its home. It absorbed the entire Tasks
 * screen and the entire plan screen (CR-3, R-rm-5).
 *
 * Everything the Tasks screen did happens here: completing, unchecking, the three exits, the carry labels,
 * the backlog pull. What it no longer does is filter, plan as a mode, or clamp the future.
 */

const withLens = (body: LensResponse) => server.use(http.get('/api/goals', () => HttpResponse.json(body)));

describe('Weekly lens — this week, and what carried into it (R-lens-12)', () => {
  it('S-lens-12-1 / S-lens-12-2: the week has its own goals, and the carried band sits BELOW them', async () => {
    withLens(F.weeklyLens());
    renderApp(<AppShell />, { route: '/week/2026-08-31' });

    expect(await screen.findByText('Three easy runs and one long run')).toBeInTheDocument();
    const band = screen.getByTestId('carried-band');
    // The two cases are never mixed: a carried goal is in the band and nowhere else.
    expect(within(band).getByText('Sort out the long-run route')).toBeInTheDocument();
    // R-nav-24 — the server's shape (`Week of 10 Aug`), lowercased into the sentence. No weekday.
    expect(within(band).getByText('from week of 10 Aug')).toBeInTheDocument();
    expect(within(band).getByText('Carried')).toBeInTheDocument();

    // The band is below the week's own goals — the whole point of the label is that they are not confused.
    const plan = screen.getByText('Three easy runs and one long run');
    expect(plan.compareDocumentPosition(band) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('R-lens-12 / R-task-41: a carried goal offers no + Task and no Pull from backlog, ever', async () => {
    withLens(F.weeklyLens());
    renderApp(<AppShell />, { route: '/week/2026-08-31' });
    const band = await screen.findByTestId('carried-band');

    // Adding new work to a past week's goal would be back-dating. Carried work is finished, moved or
    // cancelled where it stands.
    expect(within(band).queryByRole('button', { name: '+ Task' })).not.toBeInTheDocument();
    expect(within(band).queryByRole('button', { name: 'Pull from backlog' })).not.toBeInTheDocument();
    // …while the week's own goal has both.
    expect(screen.getByRole('button', { name: '+ Task' })).toBeInTheDocument();
  });

  it('S-lens-12-3: the band is oldest first, so the longest-outstanding work is always at the top', async () => {
    withLens(
      F.lens({
        lens: 'Weekly',
        period: F.period({ periodKey: F.THIS_MONDAY }),
        items: [F.weeklyGoal()],
        groups: [F.group({ id: F.L, openTasks: 3 })],
        // The SERVER orders the band by `periodKey` asc; the client never re-sorts (Q-7).
        carried: [
          F.carriedGoal({ id: F.ulid(11), title: 'Four weeks back', periodKey: '2026-08-03', period: 'Week of 3 Aug' }),
          F.carriedGoal({ id: F.ulid(12), title: 'Three weeks back', periodKey: F.THREE_WEEKS_AGO }),
          F.carriedGoal({ id: F.ulid(13), title: 'One week back', periodKey: F.LAST_MONDAY, period: 'Week of 24 Aug' }),
        ],
      }),
    );
    renderApp(<AppShell />, { route: '/week/2026-08-31' });

    const band = await screen.findByTestId('carried-band');
    const titles = within(band)
      .getAllByText(/weeks? back$/)
      .map((el) => el.textContent);
    expect(titles).toEqual(['Four weeks back', 'Three weeks back', 'One week back']);
  });

  it('§7.2: a week with nothing planned but work still carrying says so, rather than looking broken', async () => {
    withLens(F.lens({ lens: 'Weekly', period: F.period({ periodKey: F.THIS_MONDAY }), items: [], carried: [F.carriedGoal()], groups: [F.group({ id: F.L, openTasks: 1 })], tasks: [F.task({ goalId: F.WC, carryWeeks: 3, originWeekStart: F.THREE_WEEKS_AGO })] }));
    renderApp(<AppShell />, { route: '/week/2026-08-31' });

    expect(await screen.findByText('Nothing planned for this week — the work below is still carrying.')).toBeInTheDocument();
    expect(screen.getByTestId('carried-band')).toBeInTheDocument();
    // Not the "nothing happened" empty state: the band is real content and the screen must not deny it.
    expect(screen.queryByText('A new week, still unplanned.')).not.toBeInTheDocument();
  });
});

/**
 * The carry labels, and **the amendment's first silent break**.
 *
 * `TaskView.carryWeeks` is signed now (R-task-43) and still parses, so nothing about the type would catch
 * a client that treated it as a magnitude. The red chip is the only escalation in this product; firing it
 * at a plan would destroy the one signal that means anything (R-lens-11).
 */
describe('Weekly lens — the carry label, now that the age is signed (R-task-43)', () => {
  const withTask = (over: Parameters<typeof F.task>[0]) =>
    withLens(
      F.lens({
        lens: 'Weekly',
        period: F.period({ periodKey: F.THIS_MONDAY }),
        items: [F.weeklyGoal()],
        groups: [F.group({ id: F.L, openTasks: 1 })],
        tasks: [F.task({ goalId: F.W, title: 'Tuesday easy 6k', ...over })],
      }),
    );

  it('S-task-12-1: age 0 carries no label', async () => {
    withTask({ carryWeeks: 0 });
    renderApp(<AppShell />, { route: '/week/2026-08-31' });
    await screen.findByText('Tuesday easy 6k');
    expect(screen.queryByText(/since /)).not.toBeInTheDocument();
  });

  it('S-task-10-1: age 1 is the gray "since <Monday>"', async () => {
    withTask({ carryWeeks: 1, originWeekStart: F.LAST_MONDAY });
    renderApp(<AppShell />, { route: '/week/2026-08-31' });
    expect(await screen.findByText('since Mon 24 Aug')).toBeInTheDocument();
    expect(screen.queryByText(/weeks · since/)).not.toBeInTheDocument();
  });

  it('S-task-11-1: age 2+ is the red chip — and no popup, modal or nag anywhere', async () => {
    withTask({ carryWeeks: 3, originWeekStart: F.THREE_WEEKS_AGO });
    renderApp(<AppShell />, { route: '/week/2026-08-31' });
    expect(await screen.findByText('3 weeks · since 10 Aug')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  /**
   * ⚠ **THE SILENT BREAK.** A NEGATIVE age is work planned for a week that has not arrived. Nothing that
   * renders changed when the schema widened — which is exactly why this needs an assertion of its own.
   */
  it('S-task-43-1 / S-lens-11-2: a negative age renders NOTHING — no chip, no label, no "-1 weeks"', async () => {
    withLens(
      F.lens({
        lens: 'Weekly',
        period: F.period({ periodKey: F.NEXT_MONDAY, label: 'Week of 7 Sep', isCurrent: false }),
        items: [F.weeklyGoal({ periodKey: F.NEXT_MONDAY, period: 'Week of 7 Sep' })],
        groups: [F.group({ id: F.L })],
        tasks: [F.task({ goalId: F.W, title: 'Next week already', carryWeeks: -1, originWeekStart: F.NEXT_MONDAY, completable: false })],
      }),
    );
    renderApp(<AppShell />, { route: '/week/2026-09-07' });

    expect(await screen.findByText('Next week already')).toBeInTheDocument();
    expect(screen.queryByText(/since /)).not.toBeInTheDocument();
    expect(screen.queryByText(/weeks ·/)).not.toBeInTheDocument();
    // The one thing a magnitude-shaped bug would produce.
    expect(screen.queryByText(/-1|−1/)).not.toBeInTheDocument();
    // R-lens-11 — and the whole screen is badged as a plan, not as an overdue week.
    expect(screen.getByText('Future week — planning ahead')).toBeInTheDocument();
    expect(screen.queryByText(/still editable/)).not.toBeInTheDocument();
  });

  it('S-task-44-1: a task whose week has not arrived renders no completion checkbox', async () => {
    withLens(
      F.lens({
        lens: 'Weekly',
        period: F.period({ periodKey: F.NEXT_MONDAY, label: 'Week of 7 Sep', isCurrent: false }),
        items: [F.weeklyGoal({ periodKey: F.NEXT_MONDAY, period: 'Week of 7 Sep' })],
        groups: [F.group({ id: F.L })],
        tasks: [F.task({ goalId: F.W, title: 'Next week already', carryWeeks: -1, completable: false })],
      }),
    );
    renderApp(<AppShell />, { route: '/week/2026-09-07' });

    await screen.findByText('Next week already');
    // `completable` is on the wire so the client does not re-derive R-task-44's date rule (R-task-35).
    expect(screen.queryByRole('button', { name: /^Complete /})).not.toBeInTheDocument();
  });

  it('S-task-43-2: an already-late task stays late when a future week is viewed', async () => {
    withLens(
      F.lens({
        lens: 'Weekly',
        period: F.period({ periodKey: F.NEXT_MONDAY, label: 'Week of 7 Sep', isCurrent: false }),
        items: [],
        carried: [F.carriedGoal()],
        groups: [F.group({ id: F.L, openTasks: 1 })],
        tasks: [F.task({ goalId: F.WC, title: 'Sort out the long-run route', carryWeeks: 3, originWeekStart: F.THREE_WEEKS_AGO })],
      }),
    );
    renderApp(<AppShell />, { route: '/week/2026-09-07' });
    // It is late today and it is still open then, so the chip is correct there. The age is measured
    // against the CURRENT week, not the viewed one.
    expect(await screen.findByText('3 weeks · since 10 Aug')).toBeInTheDocument();
  });
});

describe('Weekly lens — the three exits, and nothing else (R-task-13)', () => {
  it('S-task-14-1: complete names the week being VIEWED, not "now"', async () => {
    withLens(F.weeklyLens(F.LAST_MONDAY));
    const { user } = renderApp(<AppShell />, { route: '/week/2026-08-24' });
    await user.click(await screen.findByRole('button', { name: 'Complete Tuesday easy 6k' }));

    await waitFor(async () => {
      // The offset is computed from two absolute Mondays the server sent — never from a device clock.
      expect(await bodyOf(lastRequest('POST', '/complete'))).toMatchObject({ week: -1 });
    });
  });

  it('S-task-14-2: a refused complete is stated, not swallowed', async () => {
    withLens(F.weeklyLens());
    server.use(http.post('/api/tasks/:id/complete', () => apiError('WEEK_OUT_OF_RANGE')));
    const { user } = renderApp(<AppShell />, { route: '/week/2026-08-31' });
    await user.click(await screen.findByRole('button', { name: 'Complete Tuesday easy 6k' }));
    expect(await screen.findByRole('status')).toHaveTextContent("can't finish work in a week that hasn't happened");
  });

  it('S-task-19-1 / S-task-21-1: unchecking opens the skippable prompt, and Skip writes nothing', async () => {
    withLens(
      F.lens({
        lens: 'Weekly',
        period: F.period({ periodKey: F.THIS_MONDAY }),
        items: [F.weeklyGoal()],
        groups: [F.group({ id: F.L })],
        tasks: [F.task({ goalId: F.W, title: 'Tuesday easy 6k', status: 'done', done: true, doneWeekStart: F.THIS_MONDAY, doneAt: F.NOW })],
      }),
    );
    const { user } = renderApp(<AppShell />, { route: '/week/2026-08-31' });
    await user.click(await screen.findByRole('button', { name: 'Uncheck Tuesday easy 6k' }));

    expect(await screen.findByText('Update the done-condition?')).toBeInTheDocument();
    expect(screen.getByLabelText('Done-condition')).toHaveValue('confirmation in the calendar');
    await user.click(screen.getByRole('button', { name: 'Skip' }));

    expect(screen.queryByText('Update the done-condition?')).not.toBeInTheDocument();
    expect(requests('PATCH', '/api/tasks/')).toHaveLength(0);
  });

  it('R-nav-22 / R-task-41: a past week renders no create affordance, and stays fully interactive', async () => {
    withLens(
      F.lens({
        lens: 'Weekly',
        period: F.period({ periodKey: F.LAST_MONDAY, label: 'Week of 24 Aug', isCurrent: false, isPast: true }),
        items: [F.weeklyGoal({ periodKey: F.LAST_MONDAY, period: 'Week of 24 Aug' })],
        groups: [F.group({ id: F.L, openTasks: 1 })],
        tasks: [F.task({ goalId: F.W, title: 'Tuesday easy 6k', carryWeeks: 1, originWeekStart: F.LAST_MONDAY })],
      }),
    );
    renderApp(<AppShell />, { route: '/week/2026-08-24' });

    expect(await screen.findByText('Past week — still editable')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Task' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Goal' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Repeat last week' })).not.toBeInTheDocument();
    // History is readable and truthful, and completing something you actually did is not rewriting it.
    expect(screen.getByRole('button', { name: 'Complete Tuesday easy 6k' })).toBeEnabled();
  });
});

/**
 * ⚠ **REWRITTEN — was `Weekly lens — the group foot (R-goal-46)`.**
 *
 * **Verdict: superseded by the owner's own reversal, recorded against `R-goal-46` (amended) and
 * `R-lens-3` (deleted).** `Repeat last week` lived *"at the group foot in the Weekly lens, and nowhere
 * else"*, and there are no group feet. It becomes **one link at the foot of the Weekly list**, copying
 * the previous week across every line — `repeatWeek`'s `lifeGoalId` is optional now, and absent means
 * all of them.
 *
 * Everything else about it is R-goal-46 verbatim and still asserted: ordinary new goals, current week or
 * later only, and the no-op toast.
 */
describe('Weekly lens — `Repeat last week` at the list foot (R-goal-46, amended)', () => {
  it('renders once, sends NO lifeGoalId, and says so when last week held nothing', async () => {
    withLens(F.weeklyLens());
    const { user } = renderApp(<AppShell />, { route: '/week/2026-08-31' });
    await screen.findByText('Three easy runs and one long run');

    // Once. Not once per line — a per-line row is a group header by another name.
    const all = screen.getAllByRole('button', { name: 'Repeat last week' });
    expect(all).toHaveLength(1);
    await user.click(all[0]!);
    await waitFor(async () => {
      const body = await bodyOf(lastRequest('POST', '/repeat-week'));
      expect(body).toMatchObject({ weekStart: F.THIS_MONDAY });
      // Absent means every Life line. The parameter is not sent as `null` or `''` — it is not sent.
      expect(body).not.toHaveProperty('lifeGoalId');
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Last week held nothing');
  });

  it('and nowhere else — the Monthly lens has no repeat at all', async () => {
    withLens(F.lensFor('Monthly'));
    renderApp(<AppShell />, { route: '/month/2026-08' });
    await screen.findByText('Lift three times a week');
    expect(screen.queryByRole('button', { name: 'Repeat last week' })).not.toBeInTheDocument();
  });
});
