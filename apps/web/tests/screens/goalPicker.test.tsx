import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { GoalView, Horizon, LensResponse } from '@goal-cascade/shared';
import { AppShell } from '../../src/AppShell';
import { renderApp } from '../render';
import { bodyOf, lastRequest, server } from '../msw/handlers';
import * as F from '../msw/fixtures';

/**
 * **R-nav-31 — one goal picker.**
 *
 * The owner: *"i need a better way select goal example when i add a backlog in goal everything is
 * listed. lets say if i have many the ui is messed up. i have seen similar practices in other pages
 * too."*
 *
 * What this file holds is the whole of that answer: the four modes offer exactly what the SERVER would
 * accept and nothing else, ancestry is on every row so two same-named goals are never confusable, the
 * search is the assistant's own ranking, the keyboard reaches everything the pointer does, and the cap
 * that every picker in this app used to hit in silence now says so.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures — an account big enough to need a search field
// ─────────────────────────────────────────────────────────────────────────────

/** Override some lenses, keep the fixture account for the rest. `/goals/:id` is a different handler. */
function withLenses(over: Partial<Record<Horizon, LensResponse>>) {
  server.use(
    http.get('/api/goals', ({ request }) => {
      const q = new URL(request.url).searchParams;
      const lens = (q.get('lens') ?? 'Weekly') as Horizon;
      return HttpResponse.json(over[lens] ?? F.lensFor(lens, q.get('period') ?? undefined));
    }),
  );
}

const yearly = (id: number, title: string, over: Partial<GoalView> = {}): GoalView =>
  F.goal({ id: F.ulid(id), parentId: F.L, horizon: 'Yearly', title, why: '', periodKey: '2026', period: '2026', lifeRootId: F.L, ...over });

/**
 * Twelve legal parents for a Quarterly goal — the two fixture Life goals plus ten Yearly ones — which is
 * past the eight-option threshold, so this is the account that gets a search field and a field-shaped
 * control rather than an inline list.
 *
 * The titles are chosen to exercise **every rung of the shared ladder** against the query `gym`: an
 * exact title, a prefix, a substring, a Life-line match and a `why` match, plus filler that matches
 * nothing. And two of them are deliberately **the same title in different Life lines**, which is the
 * confusion the owner's picker could not resolve at all.
 */
const bigYearly = (): LensResponse =>
  F.lens({
    lens: 'Yearly',
    period: F.period({ horizon: 'Yearly', periodKey: '2026' }),
    items: [
      yearly(200, 'Gym'),
      yearly(201, 'Gym mastery'),
      yearly(202, 'Back to the gym'),
      yearly(203, 'Sleep better', { why: 'because the gym is useless when tired' }),
      yearly(204, 'Read twelve books'),
      yearly(205, 'Learn to sail'),
      yearly(206, 'Fix the garden'),
      yearly(207, 'Write more'),
      // The same title, twice, in two different Life lines.
      yearly(208, 'Get fit'),
      yearly(209, 'Get fit', { parentId: F.L2, lifeRootId: F.L2 }),
    ],
    groups: [F.group({ id: F.L }), F.group({ id: F.L2 })],
  });

const openCreateSheet = async (user: ReturnType<typeof renderApp>['user']) => {
  await user.click((await screen.findAllByRole('button', { name: '+ Quarterly goal' }))[0]!);
  return screen.findByRole('dialog', { name: 'New Quarterly goal' });
};

/**
 * The field a picker inside a sheet always is now (A9), and the sheet it takes over when opened.
 *
 * ⚠ The name matches `/^Choose a goal/` rather than the exact string because A9 gives the field its VALUE
 * as well as its label: `Choose a goal: Gym — Be strong at 60 · Yearly · 2026` once something is chosen.
 * The label is the stable part, which is the whole reason it is there.
 */
async function openBigPicker(user: ReturnType<typeof renderApp>['user']) {
  const sheet = await openCreateSheet(user);
  await user.click(await within(sheet).findByRole('button', { name: /^Choose a goal/ }));
  return screen.findByRole('dialog', { name: 'Choose a goal' });
}

// ─────────────────────────────────────────────────────────────────────────────
// The four modes
// ─────────────────────────────────────────────────────────────────────────────

describe('R-nav-31 — each mode offers exactly the legal goals', () => {
  it('`parent`: strictly longer horizons only, at the enclosing period (R-goal-5, R-goal-32)', async () => {
    const { user } = renderApp(<AppShell />, { route: '/quarter/2026-Q3' });
    const picker = await openBigPicker(user);

    // Legal: the Life goals and the Yearly goals of the enclosing year. A9 scopes them, so the Yearly ones
    // are on screen and the Life ones are one chip away — both are still exactly what the server accepts.
    expect(await within(picker).findByRole('option', { name: /^Get back under 80kg/ })).toBeInTheDocument();
    expect(within(picker).getByRole('option', { name: /^Launch v1/ })).toBeInTheDocument();
    await user.click(within(picker).getByRole('radio', { name: /^Life/ }));
    expect(within(picker).getByRole('option', { name: /^Be strong at 60/ })).toBeInTheDocument();

    // Illegal: equal or shorter horizons. A Monthly goal cannot parent a Quarterly one — and A9 must not
    // let one in through a chip, so the chips are asserted as well as the rows.
    expect(within(picker).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Life', 'Yearly']);
    for (const chip of within(picker).getAllByRole('radio')) {
      await user.click(chip);
      expect(within(picker).queryByRole('option', { name: /^Lift three times a week/ })).not.toBeInTheDocument();
      expect(within(picker).queryByRole('option', { name: /^Rebuild the gym habit/ })).not.toBeInTheDocument();
      expect(within(picker).queryByRole('option', { name: /^Three easy runs/ })).not.toBeInTheDocument();
    }
  });

  /**
   * ⚠ **A9 — defect 1, and the shape of the fix.** The owner's `New Monthly goal` sheet rendered its three
   * legal parents inline, which ate the sheet and pushed `Save goal` below the fold. A threshold cannot
   * tell a form sheet from a picker-shaped one; the SURFACE can.
   */
  it('A9: inside a form sheet the picker is a compact row at EVERY option count', async () => {
    const { user } = renderApp(<AppShell />, { route: '/quarter/2026-Q3' });
    const sheet = await openCreateSheet(user);

    // Four legal parents here — comfortably under the old eight-option threshold, which would have made
    // this an inline list. It is a row, and the form's own fields are what fill the sheet.
    expect(await within(sheet).findByRole('button', { name: /^Choose a goal/ })).toBeInTheDocument();
    expect(within(sheet).queryByRole('listbox')).not.toBeInTheDocument();
    expect(within(sheet).queryByRole('option')).not.toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Save goal' })).toBeInTheDocument();
  });

  /**
   * The other half of the same rule: where the picker IS the whole surface it stays an inline list, because
   * there is nothing for it to crowd out. `Move goal` is that surface, and so is a backlog row's move.
   */
  it('A9: where the picker is the whole surface it is still the inline list', async () => {
    const { user } = renderApp(<AppShell />, { route: `/goal/${F.Q}` });
    await screen.findByRole('heading', { level: 1, name: 'Rebuild the gym habit' });
    await user.click(screen.getByRole('button', { name: 'Move…' }));
    const sheet = await screen.findByRole('dialog', { name: 'Move goal' });

    expect(await within(sheet).findByRole('listbox')).toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: /^Choose a goal/ })).not.toBeInTheDocument();
    // …with the horizon selector, because the mode's rule is the mode's rule on either surface.
    expect(within(sheet).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Life', 'Yearly']);
  });

  it('`parent` on a move: never the goal itself, and never one of its own descendants (R-goal-18)', async () => {
    const { user } = renderApp(<AppShell />, { route: `/goal/${F.Q}` });
    await screen.findByRole('heading', { level: 1, name: 'Rebuild the gym habit' });
    await user.click(screen.getByRole('button', { name: 'Move…' }));
    const sheet = await screen.findByRole('dialog', { name: 'Move goal' });

    expect(await within(sheet).findByRole('option', { name: /^Get back under 80kg/ })).toBeInTheDocument();
    // Itself, and its child. The horizon rule already makes a descendant unlistable — a descendant is
    // strictly SHORTER-horizon and every option is strictly longer — and `exclude` says so out loud.
    expect(within(sheet).queryByRole('option', { name: /^Rebuild the gym habit/ })).not.toBeInTheDocument();
    expect(within(sheet).queryByRole('option', { name: /^Lift three times a week/ })).not.toBeInTheDocument();
  });

  it('`backlogHost`: Yearly, Quarterly and Monthly — never Life, never Weekly (R-backlog-2, R-backlog-26)', async () => {
    const { user } = renderApp(<AppShell />, { route: '/week/2026-08-31' });
    await user.click(await screen.findByRole('button', { name: 'Add' }));
    const sheet = await screen.findByRole('dialog', { name: 'Add to Backlog' });
    await user.click(await within(sheet).findByRole('button', { name: /^Choose a goal/ }));
    const picker = await screen.findByRole('dialog', { name: 'Choose a goal' });

    // A9 — R-backlog-2's three horizons, and exactly those three, opening on the most specific.
    expect(within(picker).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Yearly', 'Quarterly', 'Monthly']);
    expect(within(picker).getByRole('radio', { name: /^Monthly/ })).toHaveAttribute('aria-checked', 'true');
    expect(await within(picker).findByRole('option', { name: /^Lift three times a week/ })).toBeInTheDocument();
    await user.click(within(picker).getByRole('radio', { name: /^Quarterly/ }));
    expect(within(picker).getByRole('option', { name: /^Rebuild the gym habit/ })).toBeInTheDocument();
    await user.click(within(picker).getByRole('radio', { name: /^Yearly/ }));
    expect(within(picker).getByRole('option', { name: /^Get back under 80kg/ })).toBeInTheDocument();

    // A Life goal holds a read-only roll-up; a Weekly goal would give the item a week, which is the one
    // thing a backlog item does not have. Neither has a chip, so neither is reachable at all.
    expect(within(picker).queryByRole('radio', { name: /^Life/ })).not.toBeInTheDocument();
    expect(within(picker).queryByRole('radio', { name: /^Weekly/ })).not.toBeInTheDocument();
    expect(within(picker).queryByRole('option', { name: /^Be strong at 60/ })).not.toBeInTheDocument();
    expect(within(picker).queryByRole('option', { name: /^Three easy runs/ })).not.toBeInTheDocument();
  });

  it('`backlogHost` on a move: the item’s current goal is not offered as somewhere to move it', async () => {
    server.use(http.get('/api/backlog', () => HttpResponse.json({ items: [F.backlogItem({ goalId: F.M })], nextCursor: null, serverNow: F.NOW })));
    const { user } = renderApp(<AppShell />, { route: '/backlog' });
    await user.click(await screen.findByText('Find a squat rack that is free at 7am'));
    await user.click(screen.getByRole('button', { name: 'Move to another goal' }));

    expect(await screen.findByRole('option', { name: /^Write the changelog/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /^Lift three times a week/ })).not.toBeInTheDocument();
  });

  it('`weeklyTarget`: Weekly goals in the target week, under the chosen parent (R-task-41, R-task-49)', async () => {
    withLenses({
      Weekly: F.lens({
        lens: 'Weekly',
        period: F.period({ periodKey: F.THIS_MONDAY }),
        items: [
          F.weeklyGoal(),
          F.weeklyGoal({ id: F.ulid(56), title: 'Two gym sessions' }),
          // Another line's week: legal Weekly goal, wrong parent.
          F.weeklyGoal({ id: F.ulid(57), title: 'Draft the release notes', parentId: F.M2, lifeRootId: F.L2 }),
        ],
        groups: [F.group({ id: F.L }), F.group({ id: F.L2 })],
      }),
    });
    const { user } = renderApp(<AppShell />, { route: '/month/2026-08' });
    await screen.findByText('Lift three times a week');
    await user.click(screen.getAllByRole('button', { name: '+ Task' })[0]!);
    const sheet = await screen.findByRole('dialog', { name: 'New task' });

    // ⚠ **A9** — the sheet names the destination rather than listing the candidates, and the row is the
    // way to change it.
    expect(await within(sheet).findByText('WHERE THIS GOES')).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: /^Choose a goal: Three easy runs and one long run/ }));
    const picker = await screen.findByRole('dialog', { name: 'Choose a goal' });

    expect(within(picker).getByRole('option', { name: /^Three easy runs and one long run/ })).toBeInTheDocument();
    expect(within(picker).getByRole('option', { name: /^Two gym sessions/ })).toBeInTheDocument();
    expect(within(picker).queryByRole('option', { name: /^Draft the release notes/ })).not.toBeInTheDocument();
    // R-task-49 — the first is preselected, and the selection is ANNOUNCED rather than merely coloured.
    expect(within(picker).getByRole('option', { name: /^Three easy runs and one long run/ })).toHaveAttribute('aria-selected', 'true');
    // One legal horizon, so no selector at all: `weeklyTarget` is byte-identical to what shipped (A9).
    expect(within(picker).queryByRole('radio')).not.toBeInTheDocument();
  });

  it('`lifeLine`: Life goals and the `No goal` row, and nothing else can be a tag (R-learning-2)', async () => {
    const { user } = renderApp(<AppShell />, { route: '/learnings' });
    await screen.findByLabelText('What did you learn?');

    expect(screen.getAllByRole('option', { name: 'No goal' }).length).toBeGreaterThan(0);
    expect(await screen.findByRole('option', { name: 'Be strong at 60 — Life goal' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Ship the thing — Life goal' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /^Get back under 80kg/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /^Lift three times a week/ })).not.toBeInTheDocument();

    // And it writes the tag the server accepts.
    await user.click(screen.getByRole('option', { name: 'Be strong at 60 — Life goal' }));
    await user.type(screen.getByLabelText('What did you learn?'), 'Mornings work');
    await user.click(screen.getByRole('button', { name: 'Capture it' }));
    await waitFor(async () => expect(await bodyOf(lastRequest('POST', '/api/learnings'))).toMatchObject({ goalId: F.L }));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Ancestry — the owner's actual confusion
// ─────────────────────────────────────────────────────────────────────────────

describe('R-nav-31 — two goals with the same title are never confusable', () => {
  it('every row carries its Life line and its period, in the name as well as on screen', async () => {
    withLenses({ Yearly: bigYearly() });
    const { user } = renderApp(<AppShell />, { route: '/quarter/2026-Q3' });
    const picker = await openBigPicker(user);

    // Two `Get fit` goals, one per line, told apart by the line each belongs to.
    expect(await within(picker).findByRole('option', { name: 'Get fit — Be strong at 60 · Yearly · 2026' })).toBeInTheDocument();
    expect(within(picker).getByRole('option', { name: 'Get fit — Ship the thing · Yearly · 2026' })).toBeInTheDocument();

    // Grouped by Life goal, with the line as the group's accessible name and the period on the row.
    const group = within(picker).getByRole('group', { name: 'Be strong at 60' });
    // Inside a group the line is the header, so each row says its horizon and its period instead.
    expect(within(group).getAllByText('YEARLY · 2026')).toHaveLength(within(group).getAllByRole('option').length);
    expect(within(picker).getByRole('group', { name: 'Ship the thing' })).toBeInTheDocument();

    // ⚠ **A9** — the Life goals are a chip away, in their own flat list, still carrying `— Life goal`.
    await user.click(within(picker).getByRole('radio', { name: /^Life/ }));
    expect(within(picker).getByRole('option', { name: 'Be strong at 60 — Life goal' })).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Search
// ─────────────────────────────────────────────────────────────────────────────

describe('R-nav-31 — search is the assistant’s own ranking (§7.5)', () => {
  it('filters, and ranks exact title over prefix over substring over line over `why`', async () => {
    withLenses({ Yearly: bigYearly() });
    const { user } = renderApp(<AppShell />, { route: '/quarter/2026-Q3' });
    const picker = await openBigPicker(user);

    await user.type(within(picker).getByLabelText('Search goals'), 'gym');

    await waitFor(() => expect(within(picker).getAllByRole('option')).toHaveLength(4));
    const order = within(picker)
      .getAllByRole('option')
      .map((el) => el.getAttribute('aria-label'));
    expect(order).toEqual([
      'Gym — Be strong at 60 · Yearly · 2026',
      'Gym mastery — Be strong at 60 · Yearly · 2026',
      'Back to the gym — Be strong at 60 · Yearly · 2026',
      'Sleep better — Be strong at 60 · Yearly · 2026',
    ]);
    // Ranked means FLAT: a ranked list re-sorted into groups is not ranked.
    expect(within(picker).queryByRole('group')).not.toBeInTheDocument();
    // §8.2 — the count is announced as it filters.
    expect(await within(picker).findByText('4 goals')).toBeInTheDocument();
  });

  it('the Life line is searchable too, which is what the picker adds to the ladder', async () => {
    withLenses({ Yearly: bigYearly() });
    const { user } = renderApp(<AppShell />, { route: '/quarter/2026-Q3' });
    const picker = await openBigPicker(user);

    await user.type(within(picker).getByLabelText('Search goals'), 'ship the thing');
    await waitFor(() => expect(within(picker).getAllByRole('option')).toHaveLength(2));
    // The Life goal itself matches on its own title (1.0); the goal in its line matches on the LINE
    // (0.5), which is the rung the picker adds — below a title, above a `why`.
    expect(
      within(picker)
        .getAllByRole('option')
        .map((el) => el.getAttribute('aria-label')),
    ).toEqual(['Ship the thing — Life goal', 'Get fit — Ship the thing · Yearly · 2026']);
  });

  it('the empty result says so, in the words that were typed', async () => {
    withLenses({ Yearly: bigYearly() });
    const { user } = renderApp(<AppShell />, { route: '/quarter/2026-Q3' });
    const picker = await openBigPicker(user);

    await user.type(within(picker).getByLabelText('Search goals'), 'fintech');
    expect(await within(picker).findByText('No goals match “fintech”.')).toBeInTheDocument();
    expect(within(picker).queryByRole('listbox')).not.toBeInTheDocument();
    expect(await within(picker).findByText('No goals match “fintech”')).toBeInTheDocument();
  });

  /**
   * ⚠ **A9 — the threshold's remaining job, and its retired one.**
   *
   * It used to decide the shape as well, so a four-option account got an inline list inside its form
   * sheet. It now decides one thing: whether the opened picker carries a search field. Below eight,
   * searching a list you can see whole is chrome, and this is where the promise not to tax an account
   * with ten goals is kept.
   */
  it('§7.5 — the field is chrome below the threshold, so a small account never sees one', async () => {
    const { user } = renderApp(<AppShell />, { route: '/quarter/2026-Q3' });
    const picker = await openBigPicker(user);
    await within(picker).findByRole('option', { name: /^Get back under 80kg/ });

    // Four legal parents across two horizons: no search field. The picker itself is still there.
    expect(within(picker).queryByLabelText('Search goals')).not.toBeInTheDocument();
    expect(within(picker).getByRole('listbox')).toBeInTheDocument();
  });

  /**
   * ⚠ **A9 — the count that decides is the TOTAL, not the scoped one.** Search is the one thing that
   * reaches across horizons, so a field that vanished when the list was narrowed would remove the only
   * escape from the narrowing.
   */
  it('A9: the search field counts every horizon, not the one on screen', async () => {
    withLenses({ Yearly: bigYearly() });
    const { user } = renderApp(<AppShell />, { route: '/quarter/2026-Q3' });
    const picker = await openBigPicker(user);

    // Two Life goals on screen would be under the threshold; twelve options in total are over it.
    await user.click(within(picker).getByRole('radio', { name: /^Life/ }));
    expect(within(picker).getAllByRole('option')).toHaveLength(2);
    expect(within(picker).getByLabelText('Search goals')).toBeInTheDocument();
  });

  it('A9: search crosses every horizon, even though the list is scoped to one', async () => {
    withLenses({ Yearly: bigYearly() });
    const { user } = renderApp(<AppShell />, { route: '/quarter/2026-Q3' });
    const picker = await openBigPicker(user);

    // Opened on Yearly, so the Life goal is not on screen…
    expect(within(picker).getByRole('radio', { name: /^Yearly/ })).toHaveAttribute('aria-checked', 'true');
    expect(within(picker).queryByRole('option', { name: 'Be strong at 60 — Life goal' })).not.toBeInTheDocument();
    // …and one query later it is, ranked among the Yearly goals of every line. Scoping is a default view,
    // not a cage (R-lens-15's distinction, one layer down).
    await user.type(within(picker).getByLabelText('Search goals'), 'ship the thing');
    await waitFor(() => expect(within(picker).getAllByRole('option')).toHaveLength(2));
    expect(within(picker).getByRole('option', { name: 'Ship the thing — Life goal' })).toBeInTheDocument();
  });

  /**
   * ⚠ **A9 — the horizon selector is a radiogroup with a roving tabindex, which is R-lens-13's surviving
   * requirement applied to the second control this picker has.** One tab stop, arrows along the axis, the
   * selection announced rather than merely coloured — and never a second focus trap.
   */
  it('A9: the horizon selector is one tab stop, and arrows move AND select', async () => {
    withLenses({ Yearly: bigYearly() });
    const { user } = renderApp(<AppShell />, { route: '/quarter/2026-Q3' });
    const picker = await openBigPicker(user);

    const chips = within(picker).getAllByRole('radio');
    expect(chips.map((c) => c.getAttribute('tabindex'))).toEqual(['-1', '0']);
    chips[1]!.focus();
    await user.keyboard('{ArrowLeft}');
    expect(within(picker).getByRole('radio', { name: /^Life/ })).toHaveAttribute('aria-checked', 'true');
    expect(within(picker).getByRole('radio', { name: /^Life/ })).toHaveFocus();
    expect(within(picker).getByRole('option', { name: 'Be strong at 60 — Life goal' })).toBeInTheDocument();

    await user.keyboard('{End}');
    expect(within(picker).getByRole('radio', { name: /^Yearly/ })).toHaveAttribute('aria-checked', 'true');
    // Still one dialog — the second control adds a tab stop, never a trap.
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  /**
   * The third empty state A9 introduces: the account HAS legal goals, just none at the horizon on screen.
   * `empty`'s sentence ("nothing to file this under yet") would be a flat lie there.
   */
  it('A9: an empty horizon says so, and names the way out', async () => {
    withLenses({ Yearly: F.lens({ lens: 'Yearly', period: F.period({ horizon: 'Yearly', periodKey: '2026' }), items: [] }) });
    const { user } = renderApp(<AppShell />, { route: '/quarter/2026-Q3' });
    const picker = await openBigPicker(user);

    // It opens on Life, because that is the most specific horizon that HAS anything.
    expect(within(picker).getByRole('radio', { name: /^Life/ })).toHaveAttribute('aria-checked', 'true');
    await user.click(within(picker).getByRole('radio', { name: /^Yearly/ }));
    expect(within(picker).getByText('No yearly goal to choose here. Pick another horizon above.')).toBeInTheDocument();
    expect(within(picker).queryByRole('listbox')).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Keyboard
// ─────────────────────────────────────────────────────────────────────────────

describe('R-nav-31 — the keyboard reaches everything the pointer does (§8.3)', () => {
  it('open, arrow, choose — and the choice comes back to the field it was opened from', async () => {
    withLenses({ Yearly: bigYearly() });
    const { user } = renderApp(<AppShell />, { route: '/quarter/2026-Q3' });
    const sheet = await openCreateSheet(user);

    const field = await within(sheet).findByRole('button', { name: /^Choose a goal/ });
    field.focus();
    await user.keyboard('{Enter}');

    const picker = await screen.findByRole('dialog', { name: 'Choose a goal' });
    const list = within(picker).getByRole('listbox');
    // A single tab stop, holding the active option rather than moving focus row by row.
    await waitFor(() => expect(list).toHaveFocus());
    expect(list).toHaveAttribute('aria-activedescendant', within(picker).getAllByRole('option')[0]!.id);

    await user.keyboard('{ArrowDown}{ArrowDown}');
    const active = within(picker).getAllByRole('option')[2]!;
    expect(list).toHaveAttribute('aria-activedescendant', active.id);
    const chosen = active.getAttribute('aria-label')!;

    await user.keyboard('{Enter}');
    // Back to the form, with the choice applied and focus on the control that opened the picker.
    const back = await screen.findByRole('dialog', { name: 'New Quarterly goal' });
    expect(within(back).getByRole('button', { name: new RegExp(chosen.split(' — ')[0]!) })).toHaveFocus();
  });

  it('`Home` and `End` reach the ends, and typing from the list goes to the search field (§8.3)', async () => {
    withLenses({ Yearly: bigYearly() });
    const { user } = renderApp(<AppShell />, { route: '/quarter/2026-Q3' });
    const picker = await openBigPicker(user);
    const list = within(picker).getByRole('listbox');
    await waitFor(() => expect(list).toHaveFocus());

    await user.keyboard('{End}');
    const all = within(picker).getAllByRole('option');
    expect(list).toHaveAttribute('aria-activedescendant', all[all.length - 1]!.id);
    await user.keyboard('{Home}');
    expect(list).toHaveAttribute('aria-activedescendant', all[0]!.id);

    // One search mechanism, not a separate first-letter jump: the character moves to the field.
    await user.keyboard('gym');
    const search = within(picker).getByLabelText('Search goals');
    expect(search).toHaveFocus();
    expect(search).toHaveValue('gym');
  });

  it('Escape clears a non-empty search, then closes the sheet — and never selects anything', async () => {
    withLenses({ Yearly: bigYearly() });
    const { user } = renderApp(<AppShell />, { route: '/quarter/2026-Q3' });
    const picker = await openBigPicker(user);

    await user.type(within(picker).getByLabelText('Search goals'), 'gym');
    await waitFor(() => expect(within(picker).getAllByRole('option')).toHaveLength(4));

    await user.keyboard('{Escape}');
    expect(within(picker).getByLabelText('Search goals')).toHaveValue('');
    expect(screen.getByRole('dialog', { name: 'Choose a goal' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    // Nothing was written, and nothing was chosen on the way out.
    expect(lastRequest('POST', '/api/goals')).toBeUndefined();
  });

  it('the takeover keeps the sheet it was opened from — one dialog, one focus trap, work preserved', async () => {
    withLenses({ Yearly: bigYearly() });
    const { user } = renderApp(<AppShell />, { route: '/quarter/2026-Q3' });
    const sheet = await openCreateSheet(user);
    await user.type(within(sheet).getByLabelText('Goal title'), 'Deadlift twice a week');
    await user.click(await within(sheet).findByRole('button', { name: /^Choose a goal/ }));

    // ONE dialog, never two: a second `aria-modal` sheet would be a second focus trap.
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    const picker = await screen.findByRole('dialog', { name: 'Choose a goal' });
    await user.click(within(picker).getByRole('button', { name: '‹ New Quarterly goal' }));

    // The sheet never unmounted, so the typed title is still there.
    const back = await screen.findByRole('dialog', { name: 'New Quarterly goal' });
    expect(within(back).getByLabelText('Goal title')).toHaveValue('Deadlift twice a week');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The cap
// ─────────────────────────────────────────────────────────────────────────────

describe('R-nav-31 — the 200-row cap stops being silent (§7.7)', () => {
  it('a page that came back with a cursor says so, and says what to do about it', async () => {
    withLenses({ Yearly: F.lens({ ...bigYearly(), lens: 'Yearly', nextCursor: 'opaque-cursor' }) });
    const { user } = renderApp(<AppShell />, { route: '/quarter/2026-Q3' });
    const picker = await openBigPicker(user);

    expect(await within(picker).findByText('Showing the first 200. Search to narrow it.')).toBeInTheDocument();
  });

  it('an untruncated page says nothing at all — the notice is a fact, not decoration', async () => {
    withLenses({ Yearly: bigYearly() });
    const { user } = renderApp(<AppShell />, { route: '/quarter/2026-Q3' });
    const picker = await openBigPicker(user);

    await within(picker).findByRole('listbox');
    expect(within(picker).queryByText(/Showing the first/)).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The census — every site, and none of the old ones
// ─────────────────────────────────────────────────────────────────────────────

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');

/**
 * ⚠ **The guarantee this whole item is about: there is no second goal list left.**
 *
 * A behavioural test can only show that the sites it visits use the picker; it cannot show that the
 * seventh one nobody remembered has been converted. So this is a census, in the shape of
 * `tests/screens/buttonTypes.test.tsx` and `packages/shared/tests/no-second-calendar.test.ts`: every
 * file that lets a goal be chosen imports the picker, and each of the retired renderings is named and
 * asserted gone.
 */
describe('R-nav-31 — every goal-selection site is the one picker, and the flat lists are gone', () => {
  const SITES = [
    'components/GoalModals.tsx',
    'components/BacklogSheets.tsx',
    'components/BacklogItemCard.tsx',
    'screens/CaptureScreens.tsx',
  ];

  it('every site imports the picker rather than rendering a list of its own', () => {
    for (const file of SITES) expect(read(file), `${file} must choose goals through the picker`).toMatch(/from '\.[./]*(components\/)?GoalPicker'/);
  });

  /** Each entry is a rendering this change deleted, named by the source it was written in. */
  const RETIRED: [string, RegExp, string][] = [
    ['components/GoalModals.tsx', /maxHeight: 200/, 'the create sheet’s 200px flat parent list'],
    ['components/GoalModals.tsx', /maxHeight: 230/, 'the move sheet’s 230px flat parent list'],
    ['components/GoalModals.tsx', /parents\.options\.map/, 'the create sheet’s parent rows'],
    ['components/BacklogSheets.tsx', /targets\.map/, 'the `+` drawer’s wall of goal chips'],
    ['components/BacklogSheets.tsx', /candidates\.map/, 'the drawer’s WHICH WEEKLY GOAL chip row'],
    ['components/BacklogSheets.tsx', /choices\.map/, 'the task sheet’s WHICH WEEKLY GOAL chip row'],
    ['components/BacklogSheets.tsx', /lastUsedGoalId/, 'the drawer’s private one-goal memory'],
    ['components/BacklogItemCard.tsx', /targets\.map/, 'the move-item chip row with no selected state'],
    ['screens/CaptureScreens.tsx', /LifeGoalChips/, 'the learning tag’s chip row'],
  ];

  for (const [file, pattern, what] of RETIRED) {
    it(`${file} no longer renders ${what}`, () => {
      expect(read(file)).not.toMatch(pattern);
    });
  }

  /**
   * The check on the check: a census of absences passes for free if the file moved. Each site is also
   * asserted to still exist and still be about choosing a goal.
   */
  it('the census is looking at files that are still the goal-choosing sites', () => {
    expect(read('components/GoalModals.tsx')).toMatch(/UNDER/);
    expect(read('components/BacklogSheets.tsx')).toMatch(/WHICH WEEKLY GOAL\?/);
    expect(read('components/BacklogItemCard.tsx')).toMatch(/Move to another goal/);
    expect(read('screens/CaptureScreens.tsx')).toMatch(/Attach to a goal/);
  });
});
