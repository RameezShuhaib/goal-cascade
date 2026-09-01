import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { AppShell } from '../../src/AppShell';
import { renderApp } from '../render';
import { apiError, bodyOf, lastRequest, requests, server } from '../msw/handlers';
import * as F from '../msw/fixtures';

/**
 * The backlog: the page, the `+` drawer, and the ONE way an item becomes work.
 *
 * ⚠ **A2 (R-backlog-26)** — a conversion targets the **Weekly goal at or under the item's goal for the
 * target week**, not an "active leaf". The three cases are the server's to decide (one → used silently,
 * two or more → the owner chooses, **none** → the inline create), and the last of them is what retires the
 * `This branch isn't active this week` dead end entirely.
 */

const withBacklog = (items = [F.backlogItem()]) => server.use(http.get('/api/backlog', () => HttpResponse.json({ items, nextCursor: null, serverNow: F.NOW })));

describe('The Backlog page (R-backlog-13)', () => {
  it('lists items under their owning goal, with the from-week note the exit left behind', async () => {
    withBacklog([F.backlogItem({ goalId: F.M, fromWeekStart: F.LAST_MONDAY })]);
    renderApp(<AppShell />, { route: '/backlog' });

    expect(await screen.findByText('Find a squat rack that is free at 7am')).toBeInTheDocument();
    // ⚠ **A2** — the branch path is the SERVER's now (`goalTitle` + `lifeGoalTitle`), so it is exact for
    // every item rather than resolved from whichever lens pages the client happened to be holding.
    expect(await screen.findByText('Be strong at 60 › Lift three times a week')).toBeInTheDocument();
    // D-12 — the week the task was LIVE in, an absolute Monday, not "this week".
    // R-nav-24 — one spelling of a week, and it is the server's.
    expect(screen.getByText('from week of 24 Aug')).toBeInTheDocument();
  });

  it('S-backlog-13-1 (retired D-27 `Elsewhere`): an item on a goal in ANY period gets its own exact header', async () => {
    /**
     * ⚠ **RETIRED — "an item whose goal is not in any page the client holds falls under `Elsewhere`".**
     *
     * **Verdict: R-backlog-13.** The bucket was never a product rule. It was the honest rendering of a
     * WIRE gap: `BacklogItemView` carried a `goalId` and no title, so the page guessed the branch path
     * from the current period's four lens reads and surfaced the misses rather than dropping them (D-27's
     * position, which is about not dropping rows and is untouched). `goalTitle` and `lifeGoalTitle` are on
     * the wire now, resolved server-side from the interior tree, so there is no miss left to bucket.
     *
     * The assertion is INVERTED rather than deleted, so the bucket cannot come back unnoticed: an item on
     * a goal that appears in NO lens page this client holds — last quarter's goal — must still be headed
     * by its own branch path, and the word `Elsewhere` must appear nowhere.
     */
    withBacklog([
      F.backlogItem({
        goalId: F.ulid(98),
        goalTitle: 'Something from last quarter',
        lifeGoalTitle: 'Be strong at 60',
      }),
    ]);
    renderApp(<AppShell />, { route: '/backlog' });

    expect(await screen.findByText('Be strong at 60 › Something from last quarter')).toBeInTheDocument();
    expect(screen.getByText('Find a squat rack that is free at 7am')).toBeInTheDocument();
    expect(screen.queryByText('Elsewhere')).not.toBeInTheDocument();
  });

  it('R-lens-20: an item whose chain reaches no Life goal is named by its own goal, never bucketed', async () => {
    // The one case that has no `<Life goal> ›` prefix to render. It is a data-integrity surface, so the
    // row still appears and still says which goal it is on — surfacing beats inventing a heading.
    withBacklog([F.backlogItem({ goalId: F.ulid(97), goalTitle: 'An orphaned goal', lifeGoalTitle: null })]);
    renderApp(<AppShell />, { route: '/backlog' });
    expect(await screen.findByText('An orphaned goal')).toBeInTheDocument();
    expect(screen.queryByText('Elsewhere')).not.toBeInTheDocument();
  });

  it('R-backlog-13: the empty state', async () => {
    withBacklog([]);
    renderApp(<AppShell />, { route: '/backlog' });
    expect(await screen.findByText('Nothing in the backlog.')).toBeInTheDocument();
  });

  it('S-backlog-10-1: a move names the new goal in the toast, and never offers a Life or Weekly one', async () => {
    withBacklog([F.backlogItem({ goalId: F.M })]);
    const { user } = renderApp(<AppShell />, { route: '/backlog' });
    await user.click(await screen.findByText('Find a squat rack that is free at 7am'));
    await user.click(screen.getByRole('button', { name: 'Move to another goal' }));

    // R-backlog-2 — never a Life goal, and now never a Weekly one either: the point of a backlog item is
    // that it has no week, and a Weekly goal would give it one.
    // ⚠ **R-nav-31** — the inline `chipBtn` row with no selected state at all is now the one picker.
    expect(await screen.findByRole('option', { name: 'Write the changelog — Ship the thing · Monthly · Aug 2026' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /^Be strong at 60/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /^Three easy runs and one long run/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('option', { name: /^Write the changelog/ }));
    await waitFor(async () => expect(await bodyOf(lastRequest('POST', '/move'))).toMatchObject({ goalId: F.M2 }));
    expect(await screen.findByRole('status')).toHaveTextContent('Moved to Write the changelog');
  });
});

describe('Backlog → work: the one conversion (R-backlog-26, D-19)', () => {
  it('S-backlog-26-1: `Add to this week` opens the create sheet bound to the item, and converts once', async () => {
    withBacklog([F.backlogItem({ goalId: F.M })]);
    const { user } = renderApp(<AppShell />, { route: '/backlog' });
    await user.click(await screen.findByText('Find a squat rack that is free at 7am'));
    await user.click(screen.getByRole('button', { name: 'Add to this week' }));

    const sheet = await screen.findByRole('dialog', { name: 'New task' });
    expect(within(sheet).getByLabelText('What needs doing?')).toHaveValue('Find a squat rack that is free at 7am');
    await user.click(within(sheet).getByRole('button', { name: 'Save task' }));

    await waitFor(async () => {
      const body = await bodyOf(lastRequest('POST', '/convert-to-task'));
      // R-backlog-26 — the conversion names a target week and may not be in the past (R-goal-36).
      expect(body).toMatchObject({ week: 0, title: 'Find a squat rack that is free at 7am' });
    });
    // D-19 — CONVERTED, never duplicated: the item is not deleted and no second task is made.
    expect(requests('POST', '/api/tasks')).toHaveLength(0);
    expect(requests('DELETE', '/api/backlog')).toHaveLength(0);
  });

  it('S-backlog-26-3 / D-18: an ambiguous refusal re-renders the picker from the SERVER’s candidate list', async () => {
    withBacklog([F.backlogItem({ goalId: F.M })]);
    server.use(
      http.post('/api/backlog/:id/convert-to-task', () =>
        apiError('AMBIGUOUS_CONVERSION_TARGET', 'pick one', {
          candidates: [
            { id: F.W, title: 'Three easy runs and one long run' },
            { id: F.ulid(56), title: 'Two gym sessions' },
          ],
        }),
      ),
    );
    const { user } = renderApp(<AppShell />, { route: '/backlog' });
    await user.click(await screen.findByText('Find a squat rack that is free at 7am'));
    await user.click(screen.getByRole('button', { name: 'Add to this week' }));
    const sheet = await screen.findByRole('dialog', { name: 'New task' });
    await user.click(within(sheet).getByRole('button', { name: 'Save task' }));

    // The server refuses to pick, because that id decides which week the task belongs to for the rest of
    // its life and array order is not a decision.
    expect(await within(sheet).findByText('More than one weekly goal could take this. Which one?')).toBeInTheDocument();
    // ⚠ **R-nav-31** — the same one picker, in `weeklyTarget` mode, rendering the SERVER's list rather
    // than the client's filter: only the server knows the subtree at or under the item's goal.
    // ⚠ **A9** — and the sheet names the destination it is offering before the picker is opened at all.
    expect(within(sheet).getByText('WHERE THIS GOES')).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: /^Choose a goal: Three easy runs and one long run/ }));
    const picker = await screen.findByRole('dialog', { name: 'Choose a goal' });
    expect(within(picker).getByRole('option', { name: /^Two gym sessions/ })).toBeInTheDocument();
  });

  it('S-backlog-26-2 (retired S-backlog-8-1/8-2/8-3): NO_WEEKLY_GOAL is not a dead end any more', async () => {
    /**
     * ⚠ **RETIRED — the `This branch isn't active this week` sheet and its three scenarios.**
     *
     * **Verdict: R-backlog-26 / R-task-49.** `BRANCH_NOT_ACTIVE` is deleted from the error table and
     * `NO_WEEKLY_GOAL` replaces it, and the client's answer is no longer a sheet that sends the owner to a
     * planning screen that no longer exists — it is R-task-48's inline create, in the same sheet, in one
     * transaction. `InactiveBranchSheet` is deleted (R-rm-5). The assertion is INVERTED so the dead end
     * cannot come back.
     */
    withBacklog([F.backlogItem({ goalId: F.M })]);
    server.use(http.post('/api/backlog/:id/convert-to-task', () => apiError('NO_WEEKLY_GOAL')));
    const { user } = renderApp(<AppShell />, { route: '/backlog' });
    await user.click(await screen.findByText('Find a squat rack that is free at 7am'));
    await user.click(screen.getByRole('button', { name: 'Add to this week' }));
    const sheet = await screen.findByRole('dialog', { name: 'New task' });
    await user.click(within(sheet).getByRole('button', { name: 'Save task' }));

    await waitFor(() => expect(requests('POST', '/convert-to-task').length).toBeGreaterThan(0));
    expect(screen.queryByText(/isn't active this week/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Set a weekly focus' })).not.toBeInTheDocument();
    // The item is untouched and the sheet is still open, ready to save again with the goal it will create.
    expect(screen.getByRole('dialog', { name: 'New task' })).toBeInTheDocument();
  });

  it('S-backlog-26-2: a second conversion is refused, and no second task appears', async () => {
    withBacklog([F.backlogItem({ goalId: F.M })]);
    server.use(http.post('/api/backlog/:id/convert-to-task', () => apiError('ALREADY_CONVERTED')));
    const { user } = renderApp(<AppShell />, { route: '/backlog' });
    await user.click(await screen.findByText('Find a squat rack that is free at 7am'));
    await user.click(screen.getByRole('button', { name: 'Add to this week' }));
    const sheet = await screen.findByRole('dialog', { name: 'New task' });
    await user.click(within(sheet).getByRole('button', { name: 'Save task' }));

    expect(await within(sheet).findByText('That one is already this week — nothing new was created.')).toBeInTheDocument();
  });
});

describe('The `+` drawer (R-backlog-27, D-21)', () => {
  it('S-backlog-27-1: with a weekly goal under the chosen goal, exactly one entity exists — a task', async () => {
    const { user } = renderApp(<AppShell />, { route: '/week/2026-08-31' });
    await user.click(await screen.findByRole('button', { name: 'Add' }));
    const sheet = await screen.findByRole('dialog', { name: 'Add to Backlog' });

    // ⚠ **A9** — the drawer's goal picker is a compact row now, so the choice is made one tap in.
    await user.click(await within(sheet).findByRole('button', { name: /^Choose a goal/ }));
    const picker = await screen.findByRole('dialog', { name: 'Choose a goal' });
    await user.click(within(picker).getByRole('option', { name: /^Lift three times a week/ }));
    await user.type(within(sheet).getByLabelText('What needs doing, someday?'), 'Book an induction');
    await user.click(within(sheet).getByRole('button', { name: 'Add to this week instead' }));
    await user.click(within(sheet).getByRole('button', { name: 'Save' }));

    await waitFor(async () => expect(await bodyOf(lastRequest('POST', '/api/tasks'))).toMatchObject({ goalId: F.W, source: 'drawer' }));
    // D-21 — one entity, ever. The mockup's label promised "also", which was a data bug waiting to happen.
    expect(requests('POST', '/api/backlog')).toHaveLength(0);
    expect(await screen.findByRole('status')).toHaveTextContent('Added to this week');
  });

  it('S-backlog-27-3 (A9): with exactly ONE weekly goal the drawer still NAMES it — silence is the defect', async () => {
    const { user } = renderApp(<AppShell />, { route: '/week/2026-08-31' });
    await user.click(await screen.findByRole('button', { name: 'Add' }));
    const sheet = await screen.findByRole('dialog', { name: 'Add to Backlog' });

    await user.click(await within(sheet).findByRole('button', { name: /^Choose a goal/ }));
    const picker = await screen.findByRole('dialog', { name: 'Choose a goal' });
    await user.click(within(picker).getByRole('option', { name: /^Lift three times a week/ }));
    await user.click(within(sheet).getByRole('button', { name: 'Add to this week instead' }));

    // The regression: `candidates.length > 1` rendered NOTHING here, so a single destination was used
    // silently. The owner added three tasks this way and could not find them afterwards — the work was
    // never lost, only unnamed. One candidate is a destination, not an absence of choice.
    expect(within(sheet).getByText('WHICH WEEKLY GOAL?')).toBeInTheDocument();
    // The destination is NAMED, and so is its week — not the bare `Choose a goal` the compact row shows
    // when nothing is selected, which would have been silence wearing a label.
    expect(within(sheet).getByText('Three easy runs and one long run')).toBeInTheDocument();
    expect(within(sheet).getByText(/Week of 31 Aug/)).toBeInTheDocument();
  });

  it('S-backlog-27-1: with none, exactly one BACKLOG item is created instead, and the toast says why', async () => {
    server.use(
      http.get('/api/goals', ({ request }) => {
        const lens = new URL(request.url).searchParams.get('lens') ?? 'Weekly';
        if (lens === 'Weekly') return HttpResponse.json(F.lens({ lens: 'Weekly', period: F.period({ periodKey: F.THIS_MONDAY }), items: [] }));
        return HttpResponse.json(F.lensFor(lens as 'Monthly'));
      }),
    );
    const { user } = renderApp(<AppShell />, { route: '/week/2026-08-31' });
    await user.click(await screen.findByRole('button', { name: 'Add' }));
    const sheet = await screen.findByRole('dialog', { name: 'Add to Backlog' });

    await user.click(await within(sheet).findByRole('button', { name: /^Choose a goal/ }));
    const picker = await screen.findByRole('dialog', { name: 'Choose a goal' });
    await user.click(within(picker).getByRole('option', { name: /^Lift three times a week/ }));
    await user.type(within(sheet).getByLabelText('What needs doing, someday?'), 'Book an induction');
    await user.click(within(sheet).getByRole('button', { name: 'Add to this week instead' }));
    await user.click(within(sheet).getByRole('button', { name: 'Save' }));

    await waitFor(async () => expect(await bodyOf(lastRequest('POST', '/api/backlog'))).toMatchObject({ goalId: F.M, title: 'Book an induction' }));
    expect(requests('POST', '/api/tasks')).toHaveLength(0);
    expect(await screen.findByRole('status')).toHaveTextContent('No weekly goal this week — parked in Backlog');
  });

  it('S-backlog-2-1 / S-backlog-26-4: no goal picker in any backlog flow offers a Life or a Weekly goal', async () => {
    const { user } = renderApp(<AppShell />, { route: '/week/2026-08-31' });
    await user.click(await screen.findByRole('button', { name: 'Add' }));
    const sheet = await screen.findByRole('dialog', { name: 'Add to Backlog' });

    await user.click(await within(sheet).findByRole('button', { name: /^Choose a goal/ }));
    const picker = await screen.findByRole('dialog', { name: 'Choose a goal' });

    expect(await within(picker).findByRole('option', { name: 'Lift three times a week — Be strong at 60 · Monthly · Aug 2026' })).toBeInTheDocument();
    // ⚠ **A9** — neither horizon is offered as a chip either, so neither is reachable at all.
    for (const chip of within(picker).getAllByRole('radio')) {
      await user.click(chip);
      expect(within(picker).queryByRole('option', { name: /^Be strong at 60/ })).not.toBeInTheDocument();
      expect(within(picker).queryByRole('option', { name: /^Three easy runs and one long run/ })).not.toBeInTheDocument();
    }
    expect(within(picker).queryByRole('radio', { name: /^Life/ })).not.toBeInTheDocument();
    expect(within(picker).queryByRole('radio', { name: /^Weekly/ })).not.toBeInTheDocument();
  });

  it('R-auth-6 / D-10: a brand-new account has nothing to file under, and no fallback goal is invented', async () => {
    server.use(http.get('/api/goals', ({ request }) => HttpResponse.json(F.lens({ lens: (new URL(request.url).searchParams.get('lens') ?? 'Weekly') as 'Life', items: [] }))));
    const { user } = renderApp(<AppShell />, { route: '/week/2026-08-31' });
    await user.click(await screen.findByRole('button', { name: 'Add' }));
    const sheet = await screen.findByRole('dialog', { name: 'Add to Backlog' });
    expect(within(sheet).getByRole('button', { name: 'Save' })).toBeDisabled();
    // The empty state is the picker's own, one tap in — and it is the ORIGINAL sentence, not A9's
    // "pick another horizon", because here there is nothing at any horizon to pick.
    await user.click(await within(sheet).findByRole('button', { name: /^Choose a goal/ }));
    const picker = await screen.findByRole('dialog', { name: 'Choose a goal' });
    expect(within(picker).getByText('Nothing to file this under yet — a backlog item needs a Yearly, Quarterly or Monthly goal.')).toBeInTheDocument();
  });
});

describe('R-backlog-28: `Pull from the backlog`', () => {
  it('is offered on a weekly-goal card, and pulls from the goal’s ancestors', async () => {
    server.use(
      http.get('/api/goals/:id', ({ params }) =>
        HttpResponse.json(F.detailOf(String(params.id), { pullList: [F.backlogItem({ id: F.ulid(43), goalId: F.M, title: 'Find a squat rack free at 7am' })] })),
      ),
    );
    const { user } = renderApp(<AppShell />, { route: '/week/2026-08-31' });
    await user.click(await screen.findByRole('button', { name: 'Pull from backlog' }));

    const sheet = await screen.findByRole('dialog', { name: 'Pull from the backlog' });
    await user.click(await within(sheet).findByRole('button', { name: /Find a squat rack free at 7am/ }));

    // R-backlog-8, moved out of the dead plan screen unchanged: it converts, never duplicates.
    const create = await screen.findByRole('dialog', { name: 'New task' });
    expect(within(create).getByLabelText('What needs doing?')).toHaveValue('Find a squat rack free at 7am');
  });

  it('§7.2: with nothing eligible it says so, in the words that name what would land there', async () => {
    const { user } = renderApp(<AppShell />, { route: '/week/2026-08-31' });
    await user.click(await screen.findByRole('button', { name: 'Pull from backlog' }));
    const sheet = await screen.findByRole('dialog', { name: 'Pull from the backlog' });
    expect(await within(sheet).findByText('Nothing in the backlog for this line yet.')).toBeInTheDocument();
    expect(within(sheet).getByText('Items you defer from a week land here.')).toBeInTheDocument();
  });
});
