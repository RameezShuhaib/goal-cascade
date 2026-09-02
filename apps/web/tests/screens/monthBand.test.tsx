import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { GoalView, LensResponse } from '@goal-cascade/shared';
import { AppShell } from '../../src/AppShell';
import { renderApp } from '../render';
import { atInstant, bodyOf, cmd, lastRequest, requests, server } from '../msw/handlers';
import * as F from '../msw/fixtures';

/**
 * ⚠ **A8 (R-lens-31, R-lens-32) — month tasks: the Weekly lens's month band, and the Monthly lens's own
 * nested lists.**
 *
 * The owner's sentence, which every assertion here is a consequence of:
 *
 * > *"in my weekly task i can see my months task so if i dont do it this week its ok as the deadline is
 * > end for the current month"*
 *
 * **The seam is the real case, not an edge case.** The owner's own clock, the day this was built, is
 * **Wed 2 Sep 2026**: the week of Mon 31 Aug belongs to **August** by R-goal-33's Monday rule, so the band
 * on that screen holds August's work while the calendar month is September. Every test that says
 * `2026-09-02` below is that day, and the trap it closes is a real one.
 */

const SEAM = '2026-09-02T09:00:00.000Z';
const OFF_SEAM = '2026-09-16T09:00:00.000Z';

/** One handler that dispatches on `?lens=`, exactly as the server does — the band reads TWO lenses. */
function withLenses(by: Partial<Record<string, LensResponse>>) {
  server.use(
    http.get('/api/goals', ({ request }) => {
      const q = new URL(request.url).searchParams;
      const lens = (q.get('lens') ?? 'Weekly') as Parameters<typeof F.lensFor>[0];
      return HttpResponse.json(by[lens] ?? F.lensFor(lens, q.get('period') ?? undefined));
    }),
  );
}

const monthGoal = (over: Partial<GoalView> = {}): GoalView =>
  F.goal({
    id: F.M,
    parentId: F.Q,
    horizon: 'Monthly',
    title: 'Lift three times a week',
    why: '',
    periodKey: '2026-08',
    period: 'Aug 2026',
    lifeRootId: F.L,
    weeklyBreakdown: { weeklyGoals: 3, thisWeek: 1 },
    ...over,
  });

/** A month task: `scope: 'Monthly'`, an origin at MONTH scope, and a carry age counted in months. */
const monthTask = (over: Parameters<typeof F.task>[0] = {}) =>
  F.task({
    id: F.ulid(80),
    goalId: F.M,
    title: 'Book the gym induction',
    cond: 'card in my wallet',
    scope: 'Monthly',
    originPeriodKey: '2026-08',
    carryUnit: 'months',
    carryAge: 0,
    ...over,
  });

const weeklyBand = (over: Partial<LensResponse> = {}): LensResponse =>
  F.lens({
    lens: 'Weekly',
    period: F.period({ horizon: 'Weekly', periodKey: F.THIS_MONDAY }),
    items: [F.weeklyGoal()],
    groups: [F.group({ id: F.L })],
    tasks: [F.task({ id: F.ulid(20), goalId: F.W, title: 'Tuesday easy 6k' })],
    monthTasks: [monthTask()],
    monthPeriodKey: '2026-08',
    ...over,
  });

const monthlyPage = (key: string, goals: GoalView[] = [monthGoal()]): LensResponse =>
  F.lens({ lens: 'Monthly', period: F.period({ horizon: 'Monthly', periodKey: key }), items: goals, groups: [F.group({ id: F.L })] });

describe('R-lens-31 — the month band, at the seam (Wed 2 Sep 2026)', () => {
  it('sits LAST, names its own month in the heading, and states the deadline in one sentence', async () => {
    atInstant(SEAM);
    withLenses({ Weekly: weeklyBand(), Monthly: monthlyPage('2026-08') });
    renderApp(<AppShell />, { route: '/week/2026-08-31' });

    const band = await screen.findByTestId('month-band');
    /**
     * ⚠ **The heading names its month, always** (`33-measurables-ux` §7.1, amending R-lens-31's own
     * `THIS MONTH`). On this screen the band holds AUGUST while the calendar month is September; a
     * heading that will not say so makes the Monday rule unreportable — an owner cannot tell a bug from
     * the rule. `S.sectionLabel` uppercases it, so the eye reads `THIS MONTH · AUG 2026`.
     */
    expect(within(band).getByText('This month · Aug 2026')).toBeInTheDocument();
    expect(
      within(band).getByRole('button', { name: 'This month, Aug 2026 — 1 task whose deadline is the end of the month. Collapse band.' }),
    ).toBeInTheDocument();
    expect(within(band).getByText('Due by the end of Aug 2026, not by the end of this week.')).toBeInTheDocument();
    expect(within(band).getByText('Book the gym induction')).toBeInTheDocument();

    // LAST: below this week's plan AND below the carried band. The week's own plan is what the week is for.
    const plan = screen.getByText('Three easy runs and one long run');
    expect(plan.compareDocumentPosition(band) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  /**
   * ⚠ **S-lens-31-2 — a month task wears NO carry label of any kind inside a week.**
   *
   * Not a chip, not a grey `since …`, not a badge, and not a visually-hidden "not late" either. The wire
   * carries the honest month-scale age (this task is three months old and would earn the red chip in the
   * Monthly lens); **the band suppresses it at the call site**, which is what makes this assertable by
   * rendering the band rather than by reading `CarryLabel`.
   */
  it('S-lens-31-2: a month task in a week shows no carry label of any kind, at any age', async () => {
    atInstant(SEAM);
    withLenses({
      Weekly: weeklyBand({ monthTasks: [monthTask({ carryAge: 3, originPeriodKey: '2026-06' })] }),
      Monthly: monthlyPage('2026-08'),
    });
    renderApp(<AppShell />, { route: '/week/2026-08-31' });

    const band = await screen.findByTestId('month-band');
    expect(within(band).getByText('Book the gym induction')).toBeInTheDocument();
    expect(within(band).queryByText(/months/)).not.toBeInTheDocument();
    expect(within(band).queryByText(/^since /)).not.toBeInTheDocument();
    expect(within(band).queryByText(/·\s*since/)).not.toBeInTheDocument();
  });

  /**
   * ⚠ **THE AUGUST TRAP, closed by omission.** On 2 Sep the band is August's, August is past for planning
   * (R-goal-36, R-task-41, R-task-57), so **there is no control in the band that can be tapped to create
   * anything** and `PERIOD_IN_PAST` is unreachable rather than handled. In its place the foot takes
   * R-lens-29's shape one lens over.
   */
  it('renders NO create control when its month is past, and names where new work goes instead', async () => {
    atInstant(SEAM);
    withLenses({ Weekly: weeklyBand(), Monthly: monthlyPage('2026-08') });
    const { user } = renderApp(<AppShell />, { route: '/week/2026-08-31' });

    const band = await screen.findByTestId('month-band');
    expect(within(band).queryByRole('button', { name: '+ Task' })).not.toBeInTheDocument();
    // And no pull either — a pull is a planning decision, and the band is a week's VIEW of a month.
    expect(within(band).queryByRole('button', { name: 'Pull from backlog' })).not.toBeInTheDocument();

    expect(within(band).getByText('Aug 2026 has ended. New work for the month goes in Sep 2026.')).toBeInTheDocument();
    // The destination spelled out in the accessible name — R-lens-29's own rule for the same idiom.
    const go = within(band).getByRole('button', { name: 'Go to Sep 2026 on the Monthly lens' });
    expect(go).toHaveTextContent('Go to Sep 2026');

    await user.click(go);
    expect(await screen.findByRole('tab', { name: 'Monthly', selected: true })).toBeInTheDocument();
    expect(screen.getByTestId('lens-period')).toHaveTextContent('Sep 2026');
  });

  /**
   * ⚠ **R-task-55's seam case.** The band completes into **its own month**, `2026-08` — the task's origin
   * month, and `originPeriodKey <= P <= currentPeriod` holds. Sending the current month would move the row
   * off the screen it was ticked on; sending the viewed Monday would be refused with `WEEK_OUT_OF_RANGE`.
   */
  it('R-task-55: completing in the band names the BAND’S month, never the week and never today’s month', async () => {
    atInstant(SEAM);
    withLenses({ Weekly: weeklyBand(), Monthly: monthlyPage('2026-08') });
    const { user } = renderApp(<AppShell />, { route: '/week/2026-08-31' });

    const band = await screen.findByTestId('month-band');
    await user.click(within(band).getByRole('button', { name: 'Complete Book the gym induction' }));

    await waitFor(async () => {
      const body = await bodyOf(lastRequest('POST', '/complete'));
      expect(body).toMatchObject({ period: '2026-08' });
    });
  });

  it('the band collapses to its heading alone, and the sentence and the cards both go', async () => {
    atInstant(SEAM);
    withLenses({ Weekly: weeklyBand(), Monthly: monthlyPage('2026-08') });
    const { user } = renderApp(<AppShell />, { route: '/week/2026-08-31' });

    const band = await screen.findByTestId('month-band');
    await user.click(within(band).getByRole('button', { name: /^This month, Aug 2026/ }));

    expect(within(band).getByText('This month · Aug 2026')).toBeInTheDocument();
    expect(within(band).queryByText('Due by the end of Aug 2026, not by the end of this week.')).not.toBeInTheDocument();
    expect(within(band).queryByText('Book the gym induction')).not.toBeInTheDocument();
  });

  it('does not render at all when the month holds nothing — no band, no heading, no note', async () => {
    atInstant(SEAM);
    withLenses({ Weekly: weeklyBand({ monthTasks: [] }), Monthly: monthlyPage('2026-08') });
    renderApp(<AppShell />, { route: '/week/2026-08-31' });

    await screen.findByText('Three easy runs and one long run');
    expect(screen.queryByTestId('month-band')).not.toBeInTheDocument();
    expect(screen.queryByText(/has ended\. New work for the month/)).not.toBeInTheDocument();
  });
});

describe('R-lens-31 — the band off the seam (Wed 16 Sep 2026)', () => {
  const sept = (): LensResponse =>
    F.lens({
      lens: 'Weekly',
      period: F.period({ horizon: 'Weekly', periodKey: '2026-09-14' }),
      items: [F.weeklyGoal({ periodKey: '2026-09-14', period: 'Week of 14 Sep' })],
      groups: [F.group({ id: F.L })],
      tasks: [],
      monthTasks: [monthTask({ originPeriodKey: '2026-09' })],
      monthPeriodKey: '2026-09',
    });

  /**
   * ⚠ **The invariant, asserted rather than commented: the band passes its OWN `monthPeriodKey`.**
   *
   * Never `currentPeriodKey('Monthly', today)`, never a clamp, never a fallback. The two are equal
   * wherever the control renders — which is the point — so the way to prove there is no clamp is to prove
   * the create goes to the band's month and to the card's own goal, with `newWeeklyGoal` nowhere near it.
   */
  it('renders + Task on each CARD’s foot, and it creates into the band’s own month on that card’s goal', async () => {
    atInstant(OFF_SEAM);
    withLenses({ Weekly: sept(), Monthly: monthlyPage('2026-09', [monthGoal({ periodKey: '2026-09', period: 'Sep 2026' })]) });
    const { user } = renderApp(<AppShell />, { route: '/week/2026-09-14' });

    const band = await screen.findByTestId('month-band');
    expect(within(band).getByText('This month · Sep 2026')).toBeInTheDocument();
    // No past-month foot: the month is current, so there is nothing to say about it having ended.
    expect(within(band).queryByText(/has ended/)).not.toBeInTheDocument();
    // On the CARD, not at the band's foot — the card is the goal, so nothing is chosen and nothing inferred.
    const card = within(band).getByText('Lift three times a week').closest('[data-testid="lens-card"]') as HTMLElement;
    await user.click(within(card).getByRole('button', { name: '+ Task' }));

    const sheet = await screen.findByRole('dialog', { name: 'New task' });
    expect(within(sheet).getByRole('radio', { name: 'Sep 2026 — the whole month, no particular week' })).toBeChecked();

    server.use(http.post('/api/tasks', cmd(() => HttpResponse.json(F.createTaskResponse({ title: 'Deload week' }), { status: 201 }))));
    await user.type(within(sheet).getByLabelText('What needs doing?'), 'Deload week');
    await user.click(within(sheet).getByRole('button', { name: 'Save task' }));

    await waitFor(async () => {
      const body = await bodyOf(lastRequest('POST', '/api/tasks'));
      expect(body).toMatchObject({ goalId: F.M, period: '2026-09', title: 'Deload week' });
      expect(body).not.toHaveProperty('newWeeklyGoal');
    });
    // R-task-57 — the lens does not move: the row lands in the band that made it.
    expect(screen.getByRole('tab', { name: 'Weekly', selected: true })).toBeInTheDocument();
  });

  /** Q-G — a DONE month task shows, struck through, for the whole month it was completed in. */
  it('shows a completed month task struck through, for the month it was completed in', async () => {
    atInstant(OFF_SEAM);
    withLenses({
      Weekly: sept(),
      Monthly: monthlyPage('2026-09', [monthGoal({ periodKey: '2026-09', period: 'Sep 2026' })]),
    });
    server.use(
      http.get('/api/goals', ({ request }) => {
        const q = new URL(request.url).searchParams;
        if ((q.get('lens') ?? 'Weekly') === 'Monthly') return HttpResponse.json(monthlyPage('2026-09', [monthGoal({ periodKey: '2026-09' })]));
        return HttpResponse.json({
          ...sept(),
          monthTasks: [monthTask({ originPeriodKey: '2026-09', status: 'done', done: true, donePeriodKey: '2026-09', doneAt: F.NOW })],
        });
      }),
    );
    renderApp(<AppShell />, { route: '/week/2026-09-14' });

    const band = await screen.findByTestId('month-band');
    expect(within(band).getByText('Book the gym induction')).toHaveStyle({ textDecoration: 'line-through' });
  });
});

describe('R-lens-32 — the Monthly lens shows a goal’s own month tasks', () => {
  it('nests the month’s tasks in the card, with the carry chip counted in MONTHS', async () => {
    withLenses({
      Monthly: F.lens({
        lens: 'Monthly',
        period: F.period({ horizon: 'Monthly', periodKey: '2026-08' }),
        items: [monthGoal()],
        groups: [F.group({ id: F.L })],
        tasks: [monthTask({ carryAge: 3, originPeriodKey: '2026-06' })],
      }),
    });
    renderApp(<AppShell />, { route: '/month/2026-08' });

    const card = (await screen.findByText('Lift three times a week')).closest('[data-testid="lens-card"]') as HTMLElement;
    expect(within(card).getByText('Book the gym induction')).toBeInTheDocument();
    /**
     * ⚠ **The chip renders HERE and only here** for a month task (R-task-54): the Monthly lens is where
     * the unit means something, and it is the mechanism that stops a month task becoming a silent second
     * backlog (R-backlog-30). Counted in months, `since <Mon>` with no year — the chip would wrap.
     */
    expect(within(card).getByText('3 months · since Jun')).toBeInTheDocument();
    // R-goal-47 is unchanged in what it counts, and still renders.
    expect(within(card).getByText('3 weekly goals · 1 this week')).toBeInTheDocument();
  });

  /**
   * ⚠ **R-goal-47, amended by A8 — one new case, because the screen contradicts the old string.**
   * `Nothing planned yet` above visible month tasks is a claim those tasks disprove.
   */
  it('R-goal-47: `No weeks yet` with tasks and no weeks, and `Nothing planned yet` with neither', async () => {
    withLenses({
      Monthly: F.lens({
        lens: 'Monthly',
        period: F.period({ horizon: 'Monthly', periodKey: '2026-08' }),
        items: [
          monthGoal({ id: F.M2, title: 'Ship the pricing page', weeklyBreakdown: { weeklyGoals: 0, thisWeek: 0 } }),
          monthGoal({ id: F.ulid(90), title: 'Write the changelog', weeklyBreakdown: { weeklyGoals: 0, thisWeek: 0 } }),
        ],
        groups: [F.group({ id: F.L })],
        tasks: [monthTask({ goalId: F.M2, title: 'Draft the copy' })],
      }),
    });
    renderApp(<AppShell />, { route: '/month/2026-08' });

    const withTasks = (await screen.findByText('Ship the pricing page')).closest('[data-testid="lens-card"]') as HTMLElement;
    expect(within(withTasks).getByText('No weeks yet')).toBeInTheDocument();
    expect(within(withTasks).queryByText('Nothing planned yet')).not.toBeInTheDocument();

    const empty = screen.getByText('Write the changelog').closest('[data-testid="lens-card"]') as HTMLElement;
    expect(within(empty).getByText('Nothing planned yet')).toBeInTheDocument();
    /** R-lens-32 — and NOT `Nothing on this yet.`, which a Monthly goal's page would print twice. */
    expect(within(empty).getByText('Nothing on this month yet.')).toBeInTheDocument();
  });

  /**
   * ⚠ **R-rm-6** — the card computes NO target week any more. `+ Task` opens on the month, and the sheet
   * seeds `When this lands` from the card's own `periodKey`. A9's clamp is gone rather than moved, so
   * there is no second place for it to go stale.
   */
  it('R-task-57: + Task on a Monthly card opens the sheet on that card’s month, with no week resolved', async () => {
    withLenses({ Monthly: monthlyPage('2026-08') });
    const { user } = renderApp(<AppShell />, { route: '/month/2026-08' });

    await screen.findByText('Lift three times a week');
    await user.click(screen.getAllByRole('button', { name: '+ Task' })[0]!);
    const sheet = await screen.findByRole('dialog', { name: 'New task' });

    expect(within(sheet).getByRole('radio', { name: 'Aug 2026 — the whole month, no particular week' })).toBeChecked();
    expect(within(sheet).getByText('Lands in Aug 2026 — no particular week.')).toBeInTheDocument();
    // No week was resolved on the way in: nothing asked for the week's Weekly goals at all.
    expect(requests().filter((r) => r.url.includes('lens=Weekly')).length).toBe(0);
  });
});
