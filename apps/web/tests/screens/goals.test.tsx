import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { AppShell } from '../../src/AppShell';
import { renderApp } from '../render';
import { apiError, bodyOf, lastRequest, server } from '../msw/handlers';
import * as F from '../msw/fixtures';

/**
 * The goal tree, through the UI. Every assertion is about what the person sees and what leaves the client
 * — never about a hook's internals — because the whole point of `ApiContext` is that the seam is the
 * socket, so the screens can be exercised exactly as they ship.
 */

const withTree = (over: Record<string, Partial<ReturnType<typeof F.goal>>> = {}) =>
  server.use(http.get('/api/goals', () => HttpResponse.json(F.treeResponse(over))));

async function openGoals(user: ReturnType<typeof renderApp>['user']) {
  await user.click(await screen.findByRole('button', { name: 'Goals' }));
  // The Life title appears twice by design: once on the summary chip, once as the section heading.
  return screen.findAllByText('Be strong at 60');
}

describe('Goals — create', () => {
  it('S-goal-3-1: a Life goal is created with no parent and no target period', async () => {
    withTree();
    const { user } = renderApp(<AppShell />);
    await openGoals(user);

    await user.click(screen.getByRole('button', { name: '+ New goal' }));
    // R-goal-3 — the period field is not offered at all for a Life goal.
    expect(screen.queryByLabelText('Target period')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Goal title'), 'Stay curious');
    await user.click(screen.getByRole('button', { name: 'Create goal' }));

    await waitFor(async () => {
      const body = await bodyOf(lastRequest('POST', '/api/goals'));
      expect(body).toMatchObject({ title: 'Stay curious', horizon: 'Life', parentId: null, period: '' });
    });
  });

  it('S-goal-5-1 / S-goal-13-1: a sub-goal under a Quarterly goal offers only Monthly and pre-fills the current month', async () => {
    withTree();
    const { user } = renderApp(<AppShell />);
    await openGoals(user);

    await user.click(screen.getByRole('button', { name: 'Actions for Rebuild the gym habit' }));
    await user.click(screen.getByRole('button', { name: '+ Sub-goal' }));

    // R-goal-5 — only ranks strictly below the parent's are selectable.
    expect(screen.getByRole('button', { name: 'Life' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Yearly' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Quarterly' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Monthly' })).toBeEnabled();
    // R-goal-13 / D-3 — derived from the server's clock (2026-08-31), never a frozen 2026 literal.
    expect(screen.getByLabelText('Target period')).toHaveValue('Aug 2026');

    await user.type(screen.getByLabelText('Goal title'), 'Deadlift twice a week');
    await user.click(screen.getByRole('button', { name: 'Create goal' }));

    await waitFor(async () => {
      const body = await bodyOf(lastRequest('POST', '/api/goals'));
      expect(body).toMatchObject({ horizon: 'Monthly', parentId: F.Q, period: 'Aug 2026' });
    });
  });

  it('S-goal-13-1: a Quarterly sub-goal pre-fills the quarter containing today', async () => {
    withTree();
    const { user } = renderApp(<AppShell />);
    await openGoals(user);

    await user.click(screen.getByRole('button', { name: 'Actions for Get back under 80kg' }));
    await user.click(screen.getByRole('button', { name: '+ Sub-goal' }));
    expect(screen.getByLabelText('Target period')).toHaveValue('Q3 2026');
  });

  it('S-goal-6-1: a Monthly goal offers no + Sub-goal affordance at all', async () => {
    withTree();
    const { user } = renderApp(<AppShell />);
    await openGoals(user);

    await user.click(screen.getByRole('button', { name: 'Actions for Lift three times a week' }));
    expect(screen.queryByRole('button', { name: '+ Sub-goal' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
  });

  it('S-goal-29-1: a refused create is stated at the form, not swallowed', async () => {
    // The mockup's `saveGoal` began `if (!gmTitle.trim()) return` — the sheet simply did nothing. Every
    // one of those silent returns is a typed refusal now (Q-10), and it has to reach the person.
    withTree();
    server.use(http.post('/api/goals', () => apiError('HORIZON_CONFLICT')));
    const { user } = renderApp(<AppShell />);
    await openGoals(user);

    await user.click(screen.getByRole('button', { name: '+ New goal' }));
    await user.type(screen.getByLabelText('Goal title'), 'Something');
    await user.click(screen.getByRole('button', { name: 'Create goal' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('shorter horizon than its parent');
  });
});

describe('Goals — move', () => {
  it('S-goal-18-1 / S-goal-18-2 / S-goal-19-1: both disabled reasons, with the descendant check winning', async () => {
    withTree();
    const { user } = renderApp(<AppShell />);
    await openGoals(user);

    await user.click(screen.getByRole('button', { name: 'Actions for Rebuild the gym habit' }));
    await user.click(screen.getByRole('button', { name: 'Move…' }));

    const dialog = screen.getByRole('dialog', { name: 'Move goal' });
    const row = (name: string) => within(dialog).getByRole('button', { name: new RegExp(name) });

    // D-7 — the goal itself is shown DISABLED with a reason, not filtered out of its own list.
    expect(row('Rebuild the gym habit')).toBeDisabled();
    expect(row('Rebuild the gym habit')).toHaveTextContent('its own descendant');
    // S-goal-19-1 — a Monthly CHILD is a descendant first; the horizon reason never appears on it.
    expect(row('Lift three times a week')).toHaveTextContent('its own descendant');
    expect(row('Lift three times a week')).not.toHaveTextContent('horizon conflict');
    // S-goal-18-2 — an unrelated Monthly goal is a horizon conflict, and only that.
    expect(row('Write the changelog')).toBeDisabled();
    expect(row('Write the changelog')).toHaveTextContent('horizon conflict');
    expect(row('Write the changelog')).not.toHaveTextContent('its own descendant');
    // A longer horizon in another line is a valid target.
    expect(row('Launch v1')).toBeEnabled();
  });

  it('S-goal-20-1: confirm is disabled until a target is picked, then previews the new path', async () => {
    withTree();
    const { user } = renderApp(<AppShell />);
    await openGoals(user);

    await user.click(screen.getByRole('button', { name: 'Actions for Rebuild the gym habit' }));
    await user.click(screen.getByRole('button', { name: 'Move…' }));
    const dialog = screen.getByRole('dialog', { name: 'Move goal' });
    expect(within(dialog).getByRole('button', { name: 'Move it' })).toBeDisabled();

    await user.click(within(dialog).getByRole('button', { name: /Launch v1/ }));
    expect(within(dialog).getByText('Rebuild the gym habit will move under Ship the thing › Launch v1')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Move it' }));

    await waitFor(async () => {
      const body = await bodyOf(lastRequest('POST', '/move'));
      expect(body).toMatchObject({ parentId: F.Y2 });
    });
  });

  it('S-goal-18-1: a refused move renders the server’s reason, never a guess', async () => {
    withTree();
    server.use(http.post('/api/goals/:id/move', () => apiError('WOULD_CREATE_CYCLE')));
    const { user } = renderApp(<AppShell />);
    await openGoals(user);

    await user.click(screen.getByRole('button', { name: 'Actions for Rebuild the gym habit' }));
    await user.click(screen.getByRole('button', { name: 'Move…' }));
    const dialog = screen.getByRole('dialog', { name: 'Move goal' });
    await user.click(within(dialog).getByRole('button', { name: /Launch v1/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Move it' }));

    expect(await screen.findByRole('alert')).toHaveTextContent("can't move under itself");
  });
});

describe('Goals — dormancy and the quiet signals', () => {
  it('S-goal-10-1: a leaf with no focus this week reads as dormant, not broken', async () => {
    withTree();
    const { user } = renderApp(<AppShell />);
    await openGoals(user);

    expect(screen.getByText('Sleep before midnight')).toBeInTheDocument();
    expect(screen.getAllByText('DORMANT — no focus this week').length).toBeGreaterThan(0);
    // R-goal-9 — and the active leaf shows the sentence the server holds for this week.
    expect(screen.getByText('Three sessions, no excuses.')).toBeInTheDocument();
  });

  it('S-goal-24-1: the life-goal card carries the quiet signal, and nothing else', async () => {
    withTree({ [F.L]: { carrying: { openTasks: 2, oldestWeeks: 3 } } });
    const { user } = renderApp(<AppShell />);
    await openGoals(user);

    expect(await screen.findByText('2 tasks carrying · oldest 3 weeks')).toBeInTheDocument();
    // R-nav-14 — there is no audit page behind it, and no way to ask for one.
    expect(screen.queryByRole('button', { name: /report|audit|review/i })).not.toBeInTheDocument();
  });

  it('S-goal-24-3: one task, one week — singular both times', async () => {
    withTree({ [F.L]: { carrying: { openTasks: 1, oldestWeeks: 1 } } });
    const { user } = renderApp(<AppShell />);
    await openGoals(user);
    expect(await screen.findByText('1 task carrying · oldest 1 week')).toBeInTheDocument();
  });

  it('S-goal-24-2: no carrying line when nothing is carrying', async () => {
    withTree();
    const { user } = renderApp(<AppShell />);
    await openGoals(user);
    expect(screen.queryByText(/carrying · oldest/)).not.toBeInTheDocument();
  });

  it('R-goal-26 / D-16: a line with no leaves reads "0 of 0 branches", never "0 of 1"', async () => {
    withTree({ [F.L2]: { branches: { active: 0, total: 0 } } });
    const { user } = renderApp(<AppShell />);
    await openGoals(user);
    expect(await screen.findByText('0 of 0 branches active')).toBeInTheDocument();
  });
});

/**
 * Q-5 — "Deletion requires an explicit confirmation naming the counts (`N sub-goals, M tasks, K backlog
 * items`)". EVERY deletion that would destroy something, not only the ones the API happens to refuse.
 *
 * The design review's finding, and the reason this describe was rewritten: `GOAL_HAS_CHILDREN` fires only
 * on descendant GOALS. A Monthly leaf is childless by that test, and a Monthly leaf is exactly where the
 * work lives — so the goal holding forty open tasks, their activity history and its backlog was the one
 * goal that deleted on the first tap with nothing said. `?dryRun=true` is asked first, for every goal, and
 * the button is not offered until the answer lands.
 */
describe('Goals — delete (Q-5)', () => {
  /**
   * The dry run answers with the SAME `DeleteGoalResponse` the live delete does, `deleted: false` and
   * nothing written — one handler, one shape (`goals.routes.ts`, `commands.ts#DeleteGoalResponse`).
   * `removed.goals` counts the goal itself, which is why the sub-goal count the sheet renders is one less.
   */
  const withDeletePreview = (counts: { subGoals: number; tasks: number; backlogItems: number }) => {
    const seen: { deleted: string | null; cascade: string | null } = { deleted: null, cascade: null };
    const removed = {
      goals: counts.subGoals + 1,
      weeklyFocuses: 1,
      tasks: counts.tasks,
      taskEvents: 0,
      backlogItems: counts.backlogItems,
    };
    server.use(
      http.delete('/api/goals/:id', ({ request }) => {
        const url = new URL(request.url);
        const dryRun = url.searchParams.get('dryRun') === 'true';
        if (!dryRun) {
          seen.deleted = url.pathname;
          seen.cascade = url.searchParams.get('cascade');
        }
        return HttpResponse.json({ deleted: !dryRun, removed, untagged: { ideas: 0, learnings: 0 }, serverNow: F.NOW });
      }),
    );
    return seen;
  };

  const openDelete = async (user: ReturnType<typeof renderApp>['user'], goalTitle: string) => {
    await user.click(screen.getByRole('button', { name: `Actions for ${goalTitle}` }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
  };

  it('THE BUG: a leaf goal with no sub-goals still names the tasks and backlog items it would destroy', async () => {
    withTree();
    const seen = withDeletePreview({ subGoals: 0, tasks: 40, backlogItems: 6 });
    const { user } = renderApp(<AppShell />);
    await openGoals(user);

    await openDelete(user, 'Lift three times a week');

    // `GOAL_HAS_CHILDREN` would never have fired here: this goal has no descendant goals at all.
    expect(await screen.findByText(/0 sub-goals, 40 tasks and 6 backlog items/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delete everything' }));
    await waitFor(() => expect(seen.deleted).toContain(F.M));
    expect(seen.cascade).toBe('true');
  });

  it('the counts are the SERVER’s, and the button is not offered until they land', async () => {
    withTree();
    let release: (() => void) | null = null;
    const held = new Promise<void>((r) => {
      release = r;
    });
    server.use(
      http.delete('/api/goals/:id', async ({ request }) => {
        if (new URL(request.url).searchParams.get('dryRun') !== 'true') return apiError('INTERNAL', 'should not delete');
        await held;
        return HttpResponse.json({
          deleted: false,
          removed: { goals: 3, weeklyFocuses: 1, tasks: 3, taskEvents: 0, backlogItems: 1 },
          untagged: { ideas: 0, learnings: 0 },
          serverNow: F.NOW,
        });
      }),
    );
    const { user } = renderApp(<AppShell />);
    await openGoals(user);

    await openDelete(user, 'Rebuild the gym habit');

    // The whole fix, in one assertion: nothing is destroyable while the warning is still unknown.
    expect(await screen.findByText('Checking what this would remove…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();

    release!();
    expect(await screen.findByText(/2 sub-goals, 3 tasks and 1 backlog item/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete everything' })).toBeEnabled();
  });

  it('a goal that would destroy nothing is not made to sound like one that would', async () => {
    withTree();
    const seen = withDeletePreview({ subGoals: 0, tasks: 0, backlogItems: 0 });
    const { user } = renderApp(<AppShell />);
    await openGoals(user);

    await openDelete(user, 'Lift three times a week');

    expect(await screen.findByText('This goal holds nothing else. There is no trash and no undo.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(seen.deleted).toContain(F.M));
    // Nothing was acknowledged away, so nothing was cascaded.
    expect(seen.cascade).toBeNull();
  });

  it('and when the dry run is not there, the GOAL_HAS_CHILDREN refusal still is', async () => {
    withTree();
    let cascaded: string | null = null;
    server.use(
      http.delete('/api/goals/:id', ({ request }) => {
        const url = new URL(request.url);
        // The preview fails — any reason at all: a 5xx, a network blip, a body that does not parse.
        if (url.searchParams.get('dryRun') === 'true') return apiError('INTERNAL', 'preview unavailable');
        if (url.searchParams.get('cascade') !== 'true') {
          return apiError('GOAL_HAS_CHILDREN', 'has children', { goalId: F.Q, subGoals: 2, tasks: 3, backlogItems: 1 });
        }
        cascaded = url.pathname;
        return HttpResponse.json({
          deleted: true,
          removed: { goals: 3, weeklyFocuses: 1, tasks: 3, taskEvents: 9, backlogItems: 1 },
          untagged: { ideas: 0, learnings: 1 },
          serverNow: F.NOW,
        });
      }),
    );
    const { user } = renderApp(<AppShell />);
    await openGoals(user);

    await openDelete(user, 'Rebuild the gym habit');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(await screen.findByText(/2 sub-goals, 3 tasks and 1 backlog item/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delete everything' }));
    await waitFor(() => expect(cascaded).toContain(F.Q));
  });

  it('the counts are announced, not shouted: one polite status line, no alert and no name to type', async () => {
    withTree();
    withDeletePreview({ subGoals: 2, tasks: 3, backlogItems: 1 });
    const { user } = renderApp(<AppShell />);
    await openGoals(user);

    await openDelete(user, 'Rebuild the gym habit');
    const line = await screen.findByText(/2 sub-goals, 3 tasks and 1 backlog item/);

    expect(line).toHaveAttribute('role', 'status');
    const dialog = screen.getByRole('dialog', { name: /Delete/ });
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
    // R-nav-14's spirit: the way out is a plain button, and confirming is not a typing exercise.
    expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Keep it' })).toBeEnabled();
  });
});

describe('Goals — re-plan (R-goal-23 / D-3)', () => {
  it('the period chips are the SERVER’s `replanOptions`, not a list the client re-derives', async () => {
    withTree();
    // Deliberately NOT what a client-side derivation from `serverNow` (2026-08-31) would produce for a
    // goal already in Q3 2026 — if a chip reads one of these, it came off the wire.
    server.use(http.get('/api/goals/:id', () => HttpResponse.json({ ...F.detailOf(F.Q), replanOptions: ['Q2 2027', 'Q3 2027'] })));
    const { user } = renderApp(<AppShell />);
    await openGoals(user);

    await user.click(screen.getByRole('button', { name: 'Actions for Rebuild the gym habit' }));
    await user.click(screen.getByRole('button', { name: 'Re-plan…' }));

    const sheet = await screen.findByRole('dialog', { name: 'Re-plan goal' });
    expect(await within(sheet).findByRole('button', { name: 'Q2 2027' })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Q3 2027' })).toBeInTheDocument();

    await user.click(within(sheet).getByRole('button', { name: 'Q3 2027' }));
    await user.click(within(sheet).getByRole('button', { name: 'Re-plan it' }));
    await waitFor(async () => expect(await bodyOf(lastRequest('POST', '/replan'))).toMatchObject({ period: 'Q3 2027' }));
  });

  it('R-goal-21: a Life goal is not re-plannable, so the action is not offered at all', async () => {
    withTree();
    const { user } = renderApp(<AppShell />);
    await openGoals(user);

    await user.click(screen.getByRole('button', { name: 'Actions for Be strong at 60' }));
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Re-plan…' })).not.toBeInTheDocument();
  });
});
