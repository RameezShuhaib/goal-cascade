import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { AppShell } from '../../src/AppShell';
import { renderApp } from '../render';
import { bodyOf, lastRequest, server } from '../msw/handlers';
import * as F from '../msw/fixtures';

/**
 * ⚠ **A8 (R-task-56, R-task-59) — `WHERE THIS GOES` on the task page: Park in a week, and back again.**
 *
 * Park is **not a fourth exit** (R-task-13 is unchanged at exactly three), and the layout says so with a
 * label and a gap rather than a coloured well. The task stays open, keeps its title, its condition, its
 * description, its links, its whole timeline and **every reading** (R-measure-5); only the goal, the scope
 * and the period move, in one logged, reversible write.
 */

const TASK = F.ulid(20);

const openTask = async (over: Parameters<typeof F.taskDetail>[0]) => {
  server.use(http.get('/api/tasks/:id', () => HttpResponse.json(F.taskResponse({ id: TASK, ...over }))));
  const r = renderApp(<AppShell />, { route: `/task/${TASK}` });
  await screen.findByRole('heading', { level: 1 });
  return r;
};

const monthTask = (over: Parameters<typeof F.taskDetail>[0] = {}) =>
  ({ goalId: F.M, title: 'Book the gym induction', scope: 'Monthly' as const, originPeriodKey: '2026-09', carryUnit: 'months' as const, ...over });

describe('R-task-56 — Park a month task into a week', () => {
  it('a month task’s page names its month and offers Park in a week, never an exit', async () => {
    await openTask(monthTask());
    expect(screen.getByText('WHERE THIS GOES')).toBeInTheDocument();
    expect(screen.getByText('In Sep 2026 — the whole month, no particular week.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Park in a week' })).toBeInTheDocument();
    // R-task-13 — still exactly three exits, and Park is not one of them.
    expect(screen.getByRole('button', { name: 'Move to Backlog' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel task' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Move to Sep/ })).not.toBeInTheDocument();
  });

  /**
   * ⚠ **The retarget sheet renders the SAME `When this lands` control the create sheet does**
   * (`32-week-selection` §5.4, addressed to this build agent by name) — the same option list, the same
   * bound, the same goal resolution beneath it. **The month is not an option**: the task is already in it,
   * and retargeting to the period it is already in is a no-op.
   */
  it('the sheet offers the month’s own weeks — and no month option — and parks into the one chosen', async () => {
    // Nothing under the Monthly goal in the chosen week: R-task-48's inline create, one of the three
    // flows that still names a WEEK, and the reason the rule survives A8.
    server.use(
      http.get('/api/goals', ({ request }) => {
        const q = new URL(request.url).searchParams;
        const lens = (q.get('lens') ?? 'Weekly') as Parameters<typeof F.lensFor>[0];
        if (lens !== 'Weekly') return HttpResponse.json(F.lensFor(lens, q.get('period') ?? undefined));
        return HttpResponse.json(F.lens({ lens: 'Weekly', period: F.period({ horizon: 'Weekly', periodKey: '2026-09-14' }), items: [] }));
      }),
    );
    const { user } = await openTask(monthTask());
    await user.click(screen.getByRole('button', { name: 'Park in a week' }));

    const sheet = await screen.findByRole('dialog', { name: 'Park in a week' });
    const chips = within(sheet).getByRole('radiogroup', { name: 'When this lands' });
    expect(within(chips).getAllByRole('radio').map((c) => c.getAttribute('aria-label'))).toEqual([
      'Week of 7 Sep',
      'Week of 14 Sep',
      'Week of 21 Sep',
      'Week of 28 Sep',
    ]);
    expect(within(chips).queryByRole('radio', { name: /whole month/ })).not.toBeInTheDocument();

    await user.click(within(chips).getByRole('radio', { name: 'Week of 14 Sep' }));
    expect(
      await within(sheet).findByText('This starts a weekly goal "Book the gym induction" for the week of 14 Sep. You can rename it after.'),
    ).toBeInTheDocument();
    expect(within(sheet).getByText('Lands in the week of 14 Sep · Sep 2026.')).toBeInTheDocument();

    await user.click(within(sheet).getByRole('button', { name: 'Park it' }));
    await waitFor(async () => {
      const body = await bodyOf(lastRequest('POST', '/retarget'));
      expect(body).toMatchObject({ period: '2026-09-14', newWeeklyGoal: { parentId: F.M } });
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Parked in the week of 14 Sep');
  });
});

describe('R-task-56 — un-park a week task back to its month', () => {
  /**
   * ⚠ **One tap, no sheet, no confirm** — there is nothing to choose on the way back, and the write is
   * logged, named and reversible with every reading intact. The asymmetry with Park is inherent to the
   * operation. Its **visible** label names the destination, because no sheet is there to state it.
   */
  it('names its destination on the button, and moves the task with one tap', async () => {
    const { user } = await openTask({ goalId: F.W, title: 'Tuesday easy 6k' });

    expect(screen.getByText('In the week of 31 Aug.')).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: 'Move to Aug 2026 — the whole month, no particular week.' });
    expect(btn).toHaveTextContent('Move to Aug 2026');

    await user.click(btn);
    await waitFor(async () => expect(await bodyOf(lastRequest('POST', '/retarget'))).toMatchObject({ period: '2026-08' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Moved to Aug 2026');
  });

  /**
   * D-5 — **withdrawn, not disabled, and with nothing to apologise for.** A Weekly goal whose only
   * ancestor is a Life goal has no Monthly target (`HORIZON_CONFLICT`, which R-goal-32 permits), so the
   * control does not render and no sentence explains an option that was never real.
   */
  it('renders no control and no explanation when the goal has no Monthly ancestor', async () => {
    server.use(
      http.get('/api/goals/:id', () => HttpResponse.json({ ...F.detailOf(F.W), ancestors: [F.goal({ id: F.L, title: 'Be strong at 60' })] })),
    );
    await openTask({ goalId: F.W, title: 'Tuesday easy 6k' });

    expect(screen.getByText('In the week of 31 Aug.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Move to [A-Z][a-z]{2} \d{4}/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/no monthly goal|can't be moved|not available/i)).not.toBeInTheDocument();
  });

  /** R-task-17 — a task that has left a period cannot be moved between periods. Both directions go. */
  it('both directions are withdrawn once the task is not open', async () => {
    await openTask(monthTask({ status: 'done', done: true, doneAt: F.NOW, donePeriodKey: '2026-09' }));
    expect(screen.getByText('In Sep 2026 — the whole month, no particular week.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Park in a week' })).not.toBeInTheDocument();
  });
});

describe('R-task-59 — a month task’s Move to Backlog lands on the goal it is already on', () => {
  /**
   * ⚠ **R-backlog-29's ancestor walk terminates immediately for a month task.** The nearest goal that can
   * hold a backlog item is the Monthly goal the task is already on — so the walk would name a
   * **grandparent** (the Quarterly goal) while the server wrote to the parent, which is the sheet saying
   * one thing and the write doing another. **Not one string changes**; only which goal it names.
   */
  it('the sheet names the task’s OWN Monthly goal, not its Quarterly grandparent', async () => {
    const { user } = await openTask(monthTask());
    await user.click(screen.getByRole('button', { name: 'Move to Backlog' }));

    const sheet = await screen.findByRole('dialog', { name: 'Move to Backlog' });
    expect(await within(sheet).findByText('“Book the gym induction” → Lift three times a week’s backlog')).toBeInTheDocument();
    // The Quarterly goal is what the pre-A8 walk would have named, and it must not appear.
    expect(within(sheet).queryByText(/Rebuild the gym habit/)).not.toBeInTheDocument();
    // Not one string changes: the optional reason and its reassurance are untouched.
    expect(within(sheet).getByText('No mandatory fields. Fast and guilt-free.')).toBeInTheDocument();
  });
});
