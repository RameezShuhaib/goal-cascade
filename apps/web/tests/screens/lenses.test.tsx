import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { LensResponse } from '@goal-cascade/shared';
import { AppShell } from '../../src/AppShell';
import { renderApp } from '../render';
import { atInstant, server } from '../msw/handlers';
import * as F from '../msw/fixtures';

/**
 * The five lenses: what each one shows, how you move between them, and the chrome budget that is the whole
 * point of the redesign.
 *
 * Every one of these renders `AppShell` at a URL, because the lens IS the URL now (R-nav-24).
 *
 * ⚠ **What identifies a lens on screen changed with R-lens-17.** The title stopped being a button, so
 * `Monthly lens, Aug 2026 · … . Change lens or period.` no longer exists anywhere. The lens is the
 * **selected tab** and the period is `lens-period`'s text — two facts where there was one string.
 */

const withLens = (body: LensResponse) => server.use(http.get('/api/goals', () => HttpResponse.json(body)));

/** The lens on screen: the selected tab, and the period the row prints. */
const atLens = async (lens: string, period: string) => {
  expect(await screen.findByRole('tab', { name: lens, selected: true })).toBeInTheDocument();
  // `lens-period`, not `getByText`: `Life` is a tab label as well as a period title.
  expect(screen.getByTestId('lens-period')).toHaveTextContent(period);
};

describe('Lenses — a flat list, at every horizon', () => {
  it('S-lens-1-1: the Quarterly lens lists every quarterly goal from every line, with no tree to walk', async () => {
    withLens(
      F.lens({
        lens: 'Quarterly',
        period: F.period({ periodKey: '2026-Q3' }),
        items: [
          ...F.quarterlyGoals(),
          F.goal({ id: F.ulid(50), parentId: F.Y2, horizon: 'Quarterly', title: 'Cut the scope', periodKey: '2026-Q3', period: 'Q3 2026', lifeRootId: F.L2 }),
        ],
        groups: [F.group({ id: F.L, openTasks: 2 }), F.group({ id: F.L2 })],
      }),
    );
    renderApp(<AppShell />, { route: '/quarter/2026-Q3' });

    expect(await screen.findByText('Rebuild the gym habit')).toBeInTheDocument();
    expect(screen.getByText('Cut the scope')).toBeInTheDocument();
    // R-lens-1 — a lens is not a tree: no expand/collapse per node, and no way into a subtree from a row.
    expect(screen.queryByRole('button', { name: /^(Expand|Collapse) / })).not.toBeInTheDocument();
    // R-lens-15 / S-lens-3-3 — and no filter of any kind: no `All` chip, no per-Life-goal pill.
    expect(screen.queryByRole('button', { name: 'All' })).not.toBeInTheDocument();
  });

  /**
   * ⚠ **REWRITTEN — was `S-lens-4-1 / R-lens-4: the group header carries the open count`.**
   *
   * **Verdict: superseded by the owner's own reversal, recorded against `R-lens-4` (rewritten) and
   * `R-lens-3` (deleted).** *"lets not categorise based on life in any horizon."* There is no group
   * header to carry a count. What the rule protects is unchanged and is asserted here instead: **the
   * count renders on the Life lens's card and nowhere else**, and a zero is still never rendered.
   */
  it('R-lens-4: the open count renders on the Life lens card, and on NO other lens', async () => {
    withLens(F.lensFor('Life'));
    const life = renderApp(<AppShell />, { route: '/life' });
    expect(await screen.findByText('2 open')).toBeInTheDocument();
    // R-lens-4 — a ZERO count is never rendered, so the second line reads as a bare title.
    expect(screen.queryByText(/0 open/)).not.toBeInTheDocument();
    life.unmount();

    for (const [lens, route] of [
      ['Quarterly', '/quarter/2026-Q3'],
      ['Monthly', '/month/2026-08'],
      ['Weekly', '/week/2026-08-31'],
    ] as const) {
      withLens(F.lensFor(lens));
      const { unmount } = renderApp(<AppShell />, { route });
      await atLens(lens, lens === 'Quarterly' ? 'Q3 2026' : lens === 'Monthly' ? 'Aug 2026' : 'Week of 31 Aug');
      // The count is a fact about a LINE. On a flat list three cards from one line would print it three
      // times, so it is stated once, on the roster, and one tap away from here.
      expect(screen.queryByText(/\d+ open\b/)).not.toBeInTheDocument();
      unmount();
    }
  });

  /**
   * ⚠ **REWRITTEN — was three tests about group rendering, collapse and suppression (`R-lens-19`).**
   *
   * **Verdict: `R-lens-19` is deleted outright by the owner's reversal.** A group that is not rendered, a
   * header that is suppressed at one group and a group that collapses are all properties of a thing that
   * no longer exists. What replaces them is the property the reversal actually asks for, asserted at
   * every horizon: **no group header renders anywhere.**
   */
  it('R-lens-3 / R-lens-19, deleted: no Life-goal group header renders at any horizon', async () => {
    for (const [lens, route] of [
      ['Yearly', '/year/2026'],
      ['Quarterly', '/quarter/2026-Q3'],
      ['Monthly', '/month/2026-08'],
      ['Weekly', '/week/2026-08-31'],
      ['Life', '/life'],
    ] as const) {
      withLens(F.lensFor(lens));
      const { unmount } = renderApp(<AppShell />, { route });
      await atLens(lens, lens === 'Yearly' ? '2026' : lens === 'Quarterly' ? 'Q3 2026' : lens === 'Monthly' ? 'Aug 2026' : lens === 'Life' ? 'Life' : 'Week of 31 Aug');
      // No header, no collapse toggle, no `· N open` eyebrow — at any horizon, at any group count.
      expect(screen.queryByRole('button', { name: /Collapse group|Expand group/ })).not.toBeInTheDocument();
      expect(screen.queryByText(/Be strong at 60 · /)).not.toBeInTheDocument();
      unmount();
    }
  });

  /**
   * R-lens-5, rewritten — **the flat list is today's grouped list with the headers removed.** The order
   * is the property the whole item turns on: cards from one line stay adjacent and the same goal is in
   * the same place before and after.
   */
  it('R-lens-5: the flat order is the previously grouped reading order, headers removed', async () => {
    withLens(F.lensFor('Monthly'));
    renderApp(<AppShell />, { route: '/month/2026-08' });
    await screen.findByText('Lift three times a week');
    // `Be strong at 60` was created first, so its line's items come first — exactly as the grouped
    // screen read top to bottom, and with `Ship the thing`'s line after it.
    const titles = screen.getAllByTestId('lens-card').map((c) => c.textContent);
    expect(titles[0]).toContain('Lift three times a week');
    expect(titles[1]).toContain('Write the changelog');
  });

  /**
   * R-lens-20, rewritten — there is no `UNSORTED` group and no group note. The state is a **line on the
   * card**, and it is the first time it has had a keyboard-reachable action at all.
   */
  it('R-lens-20: a goal with no Life ancestor says so on its own card, sorts last, and offers the fix', async () => {
    withLens(
      F.lens({
        lens: 'Monthly',
        period: F.period({ periodKey: '2026-08' }),
        items: [F.monthlyGoals()[0]!, F.goal({ id: F.ulid(51), parentId: F.ulid(99), horizon: 'Monthly', title: 'An orphan', periodKey: '2026-08', period: 'Aug 2026', lifeRootId: null })],
        groups: [F.group({ id: F.L, openTasks: 2 }), F.group({ id: null })],
      }),
    );
    const { user } = renderApp(<AppShell />, { route: '/month/2026-08' });

    expect(await screen.findByText('An orphan')).toBeInTheDocument();
    // Last, without a header to pin it there.
    const cards = screen.getAllByTestId('lens-card');
    expect(cards[cards.length - 1]!.textContent).toContain('An orphan');
    // The group header and its note are gone; the card carries the state instead.
    expect(screen.queryByText('UNSORTED')).not.toBeInTheDocument();
    expect(screen.queryByText("These aren't under a Life goal yet.")).not.toBeInTheDocument();

    const line = screen.getByRole('button', { name: 'Not under a Life goal yet. Put it under one.' });
    expect(line).toHaveTextContent('Not under a Life goal yet');
    // R-lens-20 — the Move sheet in `only: 'life'` mode, which is the caller that mode never had.
    await user.click(line);
    expect(await screen.findByRole('dialog', { name: 'Put under a Life goal' })).toBeInTheDocument();
  });
});

describe('Lenses — the chrome budget (R-nav-27, rewritten)', () => {
  it('the current period draws exactly three rows: the cluster, the tab strip and the period row', async () => {
    withLens(F.lensFor('Monthly'));
    renderApp(<AppShell />, { route: '/month/2026-08' });
    await screen.findByText('Lift three times a week');

    // Row 1 — the cluster. Row 2 — the five tabs. Row 3 — `‹ Aug 2026 ›`. And that is all.
    expect(screen.getAllByRole('tab')).toHaveLength(5);
    await atLens('Monthly', 'Aug 2026');
    // ⚠ **R-nav-25, amended — ONE create action, `+ Goal`, and exactly one of it.** The per-group
    // `+ <Horizon> goal` is the clutter the owner named, and it is gone at every horizon.
    expect(screen.getAllByRole('button', { name: '+ Goal' })).toHaveLength(1);
    for (const h of ['Life', 'Yearly', 'Quarterly', 'Monthly', 'Weekly']) {
      expect(screen.queryByRole('button', { name: `+ ${h} goal` })).not.toBeInTheDocument();
    }
    // The off-now row is conditional and this period is now, so it is absent entirely.
    expect(screen.queryByRole('button', { name: 'Now ›' })).not.toBeInTheDocument();
    expect(screen.queryByText(/still editable|planning ahead/)).not.toBeInTheDocument();
    // R-rm-5 / R-nav-27 — the four rows the Tasks screen carried are gone with the screen.
    expect(screen.queryByRole('button', { name: 'Edit plan' })).not.toBeInTheDocument();
  });

  /**
   * R-nav-32 — **no `+ <horizon> goal` control renders inside any lens list, at any horizon.** This is
   * the owner's literal complaint (*"we dont need `+ Monthly goal` everywhere as it looks too
   * clutered"*), asserted as a property rather than at one lens.
   */
  it('R-nav-32: no per-list create renders inside any lens, and the one that does is in the cluster', async () => {
    for (const [lens, route] of [
      ['Life', '/life'],
      ['Yearly', '/year/2026'],
      ['Quarterly', '/quarter/2026-Q3'],
      ['Monthly', '/month/2026-08'],
      ['Weekly', '/week/2026-08-31'],
    ] as const) {
      withLens(F.lensFor(lens));
      const { unmount } = renderApp(<AppShell />, { route });
      await screen.findByRole('tab', { name: lens, selected: true });
      expect(screen.queryAllByRole('button', { name: /^\+ (Life|Yearly|Quarterly|Monthly|Weekly) goal$/ })).toHaveLength(0);
      // The one create action is in the cluster, outside the panel the tab strip controls.
      const create = screen.getByRole('button', { name: '+ Goal' });
      expect(screen.getByTestId('lens-body').contains(create)).toBe(false);
      unmount();
    }
  });

  it('S-nav-23-1: the tab bar has exactly three items, and none of them is a horizon', async () => {
    withLens(F.lensFor('Weekly'));
    renderApp(<AppShell />, { route: '/week' });
    await screen.findByText('Three easy runs and one long run');

    expect(screen.getByRole('button', { name: 'Goals' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Learnings' })).toBeInTheDocument();
    for (const gone of ['Tasks', 'Ideas', 'Life', 'Weekly']) {
      expect(screen.queryByRole('button', { name: gone })).not.toBeInTheDocument();
    }
  });
});

describe('Lenses — the period control (R-lens-7, R-lens-17, R-lens-21)', () => {
  it('S-lens-7-3: the forward chevron is never disabled, and the future is reachable', async () => {
    withLens(F.lensFor('Monthly'));
    const { user } = renderApp(<AppShell />, { route: '/month/2026-08' });
    await screen.findByText('Lift three times a week');

    const later = screen.getByRole('button', { name: 'Later month' });
    expect(later).toBeEnabled();

    withLens(F.lens({ lens: 'Monthly', period: F.period({ periodKey: '2026-09', label: 'Sep 2026', isCurrent: false }), items: [] }));
    await user.click(later);

    // The clamp that used to pin every forward step to "now" is deleted, not relaxed.
    await atLens('Monthly', 'Sep 2026');
  });

  it('R-lens-21 / R-lens-11: a future period is badged as planning ahead, never as late, and offers Now ›', async () => {
    withLens(F.lens({ lens: 'Monthly', period: F.period({ periodKey: '2026-11', label: 'Nov 2026', isCurrent: false }), items: [] }));
    renderApp(<AppShell />, { route: '/month/2026-11' });

    expect(await screen.findByText('Future month — planning ahead')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Now ›' })).toBeInTheDocument();
    expect(screen.queryByText(/still editable/)).not.toBeInTheDocument();
    // §7.2 — the line that says both facts at once: the screen is empty, and the emptiness is the truth.
    expect(screen.getByText('Nov 2026 is empty.')).toBeInTheDocument();
    expect(screen.getByText(/that's expected/)).toBeInTheDocument();
  });

  it('R-goal-36 / R-nav-25: a past period is still editable, and offers no create affordance at all', async () => {
    withLens(F.lens({ lens: 'Monthly', period: F.period({ periodKey: '2026-05', label: 'May 2026', isCurrent: false, isPast: true }), items: [] }));
    renderApp(<AppShell />, { route: '/month/2026-05' });

    expect(await screen.findByText('Past month — still editable')).toBeInTheDocument();
    // Absent, not disabled: a disabled create button invites "why?" on every past screen.
    expect(screen.queryByRole('button', { name: '+ Goal' })).not.toBeInTheDocument();
    expect(screen.getByText('Nothing was set for May 2026.')).toBeInTheDocument();
    expect(screen.getByText('This month went unplanned. History stays as it was.')).toBeInTheDocument();
  });

  /**
   * ⚠ **VERDICT — this test encoded a rule R-lens-30 supersedes, and the defect it guarded is now
   * unreachable by construction rather than by a guard.**
   *
   * It was a regression test for `data !== undefined`: `view` was `data?.period ?? null`, so during a read
   * it was `null`, and a button rendered then would open the create sheet with `periodKey: ''` — a Life
   * goal's key (R-goal-3) on a lens that is not Life. The guard's cost was the one the owner would have
   * reported next: **the screen's only primary action disappeared and reappeared on every period step.**
   *
   * The period key no longer comes from the payload. It comes from the URL, or from the calendar when the
   * URL names none, so it is correct on the first render and there is no window in which it is `''`. The
   * assertion is therefore inverted and strengthened: with the read held open forever, the button is
   * present **and carries the right period**, which is a stronger statement than "it is absent".
   */
  it('R-nav-25 / R-lens-30: the create button does not wait for the read, and never carries an empty period key', async () => {
    server.use(http.get('/api/goals', () => new Promise<never>(() => {})));
    const { user } = renderApp(<AppShell />, { route: '/month/2026-08' });

    // The lens chrome is up — this is a real pending render, not an unmounted one.
    expect(await screen.findByRole('button', { name: /Later month/ })).toBeInTheDocument();
    const create = screen.getByRole('button', { name: '+ Goal' });
    await user.click(create);

    // The sheet opened on August, not on `''`. Its own read-only period chip is what names the period the
    // goal would be created into (R-nav-32), so this is the assertion that the key was right — read
    // inside the sheet, because the lens row behind it now prints the same string.
    const sheet = await screen.findByRole('dialog', { name: 'New goal' });
    expect(within(sheet).getByText('Aug 2026')).toBeInTheDocument();
    expect(within(sheet).getByText("Because you're looking at Aug 2026.")).toBeInTheDocument();
  });

  it('R-lens-2: the Life lens still offers create once its read lands, though it has no period', async () => {
    // The other half of the guard above: `period` is legitimately `null` on Life *after* the read, and
    // `''` is the correct key there. Guarding on `view` instead of `data` would have hidden this button.
    withLens(F.lens({ lens: 'Life', items: F.lifeGoals() }));
    renderApp(<AppShell />, { route: '/life' });

    // A populated lens, so the empty state's own CTA is not on screen to be confused with this one.
    expect(await screen.findByRole('button', { name: '+ Goal' })).toBeInTheDocument();
  });

  it('R-lens-26: the forward chevron carries a dot when a later period holds something', async () => {
    withLens({ ...F.lensFor('Monthly'), hasForwardContent: true });
    renderApp(<AppShell />, { route: '/month/2026-08' });
    await screen.findByText('Lift three times a week');
    // One dot, no number: it says *there is something ahead*, never how much.
    expect(screen.getByTestId('forward-content-dot')).toBeInTheDocument();
  });

  it('R-lens-17 / R-lens-2: the Life lens has no period, so both chevrons are disabled rather than hidden', async () => {
    withLens(F.lensFor('Life'));
    renderApp(<AppShell />, { route: '/life' });
    await screen.findByText('Be strong at 60');

    // A control that vanishes moves everything after it in the tab order; a control that greys out does not.
    expect(screen.getByRole('button', { name: 'Earlier period' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Later period' })).toBeDisabled();
    // ⚠ **R-lens-17, rewritten — the title is TEXT, not a button.** That is what pays for part of the tab
    // row: row 3 loses its only non-chevron control and one tab stop.
    expect(screen.getByTestId('lens-period')).toHaveTextContent('Life');
    expect(screen.queryByRole('button', { name: /Change lens or period/ })).not.toBeInTheDocument();
  });
});

describe('Lenses — the Life lens (R-lens-2, §6.1)', () => {
  it('is the roster: the count, the backlog line and the one surviving `why` all sit on the card', async () => {
    withLens(
      F.lens({
        lens: 'Life',
        items: [F.goal({ id: F.L, backlogCount: 2, carrying: { openTasks: 2, oldestWeeks: 3 } }), F.goal({ id: F.L2, title: 'Ship the thing', lifeRootId: F.L2 })],
        groups: [F.group({ id: F.L, openTasks: 3 }), F.group({ id: F.L2 })],
      }),
    );
    renderApp(<AppShell />, { route: '/life' });

    expect(await screen.findByText('3 open · 2 in backlog')).toBeInTheDocument();
    // C-18 / R-goal-24 — the product's one quiet signal renders on the Life lens card.
    expect(screen.getByText('2 tasks carrying · oldest 3 weeks')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Collapse group/ })).not.toBeInTheDocument();
    /*
     * §5.2 — **`why` survives here and nowhere else, clamped to one line.** There are five or six Life
     * goals, they carry no ancestry line to compete with, and *why* is the entire reason a Life goal
     * exists. Unbounded it wrapped a two-line card into four.
     */
    expect(screen.getAllByText('so the next thirty years are mine')[0]).toHaveStyle({ whiteSpace: 'nowrap', textOverflow: 'ellipsis' });
    // A Life goal is the root, so it carries no `under` line at all.
    expect(screen.queryByRole('button', { name: /^under / })).not.toBeInTheDocument();
  });

  /**
   * §5.2 — **`why` leaves the four working lenses**, which is what pays, line for line, for R-lens-23's
   * `under <Life goal>` line. A Monthly card ends up one line SHORTER than it was.
   */
  it('§5.2: `why` renders on no lens but Life', async () => {
    for (const [lens, route] of [
      ['Yearly', '/year/2026'],
      ['Quarterly', '/quarter/2026-Q3'],
      ['Monthly', '/month/2026-08'],
      ['Weekly', '/week/2026-08-31'],
    ] as const) {
      withLens(
        F.lens({
          lens,
          items: [F.goal({ id: F.ulid(70), parentId: F.L, horizon: lens, title: 'A goal with a reason', why: 'because it matters', periodKey: lens === 'Yearly' ? '2026' : lens === 'Quarterly' ? '2026-Q3' : lens === 'Monthly' ? '2026-08' : F.THIS_MONDAY, period: 'x', lifeRootId: F.L })],
          groups: [F.group({ id: F.L })],
        }),
      );
      const { unmount } = renderApp(<AppShell />, { route });
      expect(await screen.findByText('A goal with a reason')).toBeInTheDocument();
      expect(screen.queryByText('because it matters')).not.toBeInTheDocument();
      unmount();
    }
  });

  it('§7.2: the first-run state is kept verbatim — it is the best line in the app', async () => {
    withLens(F.lens({ lens: 'Life', items: [], groups: [] }));
    renderApp(<AppShell />, { route: '/life' });
    expect(await screen.findByText('Nothing planted yet.')).toBeInTheDocument();
    expect(screen.getByText('Start with a Life goal — the thing the rest of the cascade hangs off.')).toBeInTheDocument();
  });
});

describe('Lenses — the Monthly lens (R-goal-47)', () => {
  it('the planned-ness line states how the month is broken into weeks, in four states and no others', async () => {
    withLens(F.lensFor('Monthly'));
    renderApp(<AppShell />, { route: '/month/2026-08' });

    expect(await screen.findByText('3 weekly goals · 1 this week')).toBeInTheDocument();
    expect(screen.getByText('Nothing planned yet')).toBeInTheDocument();
    // Not a report, not an escalation: no bar, no percentage, no colour, no chip (R-nav-26, R-lens-11).
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it('R-goal-47: `nothing this week` is a fact in the same grey, not a failure', async () => {
    withLens(
      F.lens({
        lens: 'Monthly',
        period: F.period({ periodKey: '2026-08' }),
        items: [F.goal({ ...F.monthlyGoals()[0]!, weeklyBreakdown: { weeklyGoals: 3, thisWeek: 0 } })],
        groups: [F.group({ id: F.L })],
      }),
    );
    renderApp(<AppShell />, { route: '/month/2026-08' });
    const line = await screen.findByText('3 weekly goals · nothing this week');
    expect(line).toHaveStyle({ color: 'rgb(112, 112, 105)' }); // T.mut, the same grey as `3 weekly goals`
  });

  it('R-task-49 / Q-20: a Monthly card offers + Task and Pull from backlog, and never + Weekly goal', async () => {
    withLens(F.lensFor('Monthly'));
    renderApp(<AppShell />, { route: '/month/2026-08' });
    await screen.findByText('Lift three times a week');

    expect(screen.getAllByRole('button', { name: '+ Task' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Pull from backlog' }).length).toBeGreaterThan(0);
    // A create button for the horizon below, on every card, is a tree growing back one affordance at a time.
    expect(screen.queryByRole('button', { name: '+ Weekly goal' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Monthly goal' })).not.toBeInTheDocument();
  });
});

/**
 * R-lens-25 — one gesture, and its keyboard equal.
 *
 * The gesture is an **accelerator, never a route**: the chevrons are always present and never hidden, so
 * nothing in this product is reachable only by swiping. The shortcuts are the same bargain — every one of
 * them has a visible control one `Tab` away, so the accessibility floor never depends on them.
 */
describe('Lenses — the one gesture, and its keyboard equal (R-lens-25)', () => {
  it('← and → step the period, and the visible chevrons do the same thing', async () => {
    withLens(F.lensFor('Monthly'));
    const { user } = renderApp(<AppShell />, { route: '/month/2026-08' });
    await screen.findByText('Lift three times a week');

    withLens(F.lens({ lens: 'Monthly', period: F.period({ periodKey: '2026-07', label: 'Jul 2026', isCurrent: false, isPast: true }), items: [] }));
    screen.getByTestId('lens-body').focus();
    await user.type(screen.getByTestId('lens-body'), '{ArrowLeft}');

    await atLens('Monthly', 'Jul 2026');
  });

  it('Shift+↓ zooms in one altitude, and Shift+↑ zooms back out', async () => {
    withLens(F.lensFor('Quarterly'));
    const { user } = renderApp(<AppShell />, { route: '/quarter/2026-Q3' });
    await screen.findByText('Rebuild the gym habit');

    withLens(F.lensFor('Monthly'));
    await user.type(screen.getByTestId('lens-body'), '{Shift>}{ArrowDown}{/Shift}');
    // ⚠ It lands on `Aug 2026`, the month holding the anchor — R-lens-9's clamp, which is now the SAME
    // call the tab strip makes. It used to navigate with no period at all and quietly drop the anchor.
    await atLens('Monthly', 'Aug 2026');
  });

  it('and a shortcut never fires while a field has focus — the arrows belong to the caret there', async () => {
    withLens(F.lensFor('Monthly'));
    const { user } = renderApp(<AppShell />, { route: '/month/2026-08' });
    await user.click(await screen.findByRole('button', { name: 'Add' }));
    const sheet = await screen.findByRole('dialog', { name: 'Add to Backlog' });

    const field = within(sheet).getByLabelText('What needs doing, someday?');
    await user.type(field, 'abc{ArrowLeft}{ArrowLeft}');
    expect(screen.getByTestId('lens-period')).toHaveTextContent('Aug 2026');
  });

  it('R-lens-25: the Life lens has no periods, so it has no gesture and no arrow shortcut either', async () => {
    withLens(F.lensFor('Life'));
    const { user } = renderApp(<AppShell />, { route: '/life' });
    await screen.findByText('Be strong at 60');
    await user.type(screen.getByTestId('lens-body'), '{ArrowLeft}{ArrowRight}');
    expect(screen.getByTestId('lens-period')).toHaveTextContent('Life');
  });
});

describe('Lenses — announcements (§8.2)', () => {
  it('one polite region carries the payload focus will not say', async () => {
    withLens(F.lensFor('Weekly'));
    const { container } = renderApp(<AppShell />, { route: '/week' });
    await screen.findByText('Three easy runs and one long run');
    await waitFor(() => {
      const live = container.querySelector('[aria-live="polite"]');
      // ⚠ **`in N groups` is deleted, because there are no groups** (§7.3). The rendered-group counting
      // that existed only to stop this describing the payload instead of the screen goes with it.
      expect(live?.textContent).toBe('Week of 31 Aug. 1 goal, 1 carried.');
    });
  });
});

/**
 * ⚠ **RETIRED IN FULL — `Lenses — the Zoom sheet (R-lens-17, R-lens-22)`, three tests.**
 *
 * **Verdict: superseded by the owner's own reversal**, recorded against `R-lens-17` (rewritten) and
 * `R-lens-22` (deleted): *"i dont need to click on a dropdown to change the lense as it adds friction.
 * instead can we have a tabs in the top where i dont need double clicking to change lense."* The sheet is
 * deleted in full — the file, `useZoom`, the `▾` and the title's button — so a ladder of five, its
 * per-lens counts and its `Jump to now` footer have no subject.
 *
 * Each of the three, and where its property went:
 *
 *  - *`the title opens a ladder of five, each naming where it would land`* — **retired (R-lens-22).** The
 *    destination is now named by the period row one line below the tab, in the same frame (R-lens-30),
 *    after a tap that is free and one tap reversible. Asserted below.
 *  - *`S-lens-9-3: choosing a row navigates to that lens at the period the SERVER computed`* — **kept, at
 *    the tab.** It is the same clamp (R-lens-9) called from the strip; the scenario survives its surface.
 *  - *`R-lens-17: 'Jump to now' is offered only when the period is not the current one`* — **retired as a
 *    duplicate.** The off-now row's `Now ›` renders in exactly the same condition (R-lens-21) and is
 *    already covered by this file's own off-now test. Nothing is lost; a duplicate is removed.
 */
describe('Lenses — the tab strip (R-lens-33)', () => {
  it('S-lens-9-3: changing lens is ONE tap from every lens, and lands at R-lens-9\u2019s period', async () => {
    // The default handler answers per `?lens=`, which is what a one-tap change across two lenses needs:
    // a fixed body would answer a Monthly payload to the Quarterly key the strip is leaving.
    const { user } = renderApp(<AppShell />, { route: '/quarter/2026-Q3' });
    await atLens('Quarterly', 'Q3 2026');

    await user.click(screen.getByRole('tab', { name: 'Monthly' }));

    // `Aug 2026` — the month containing the anchor, which is today, because Q3 2026 contains today.
    await atLens('Monthly', 'Aug 2026');
    // No sheet was opened on the way and none is left behind: the strip replaced a modal, not added one.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('R-lens-33: the strip names itself, is in horizon order, and shows the current lens', async () => {
    withLens(F.lensFor('Monthly'));
    renderApp(<AppShell />, { route: '/month/2026-08' });
    await screen.findByText('Lift three times a week');

    const strip = screen.getByRole('tablist', { name: 'Lens' });
    expect(strip).toHaveAttribute('aria-orientation', 'horizontal');
    expect(within(strip).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Life', 'Yearly', 'Quarterly', 'Monthly', 'Weekly']);
    expect(within(strip).getByRole('tab', { selected: true })).toHaveTextContent('Monthly');
    // The body is the panel the strip controls, and it is named by the selected tab (§7.1).
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveAttribute('id', 'lens-panel');
    expect(panel).toHaveAttribute('aria-labelledby', 'lens-tab-Monthly');
  });

  /**
   * ⚠ **The rule the whole pattern exists to hold** (`29-ux-navigation` §2.2): *no lens label may be
   * shortened, abbreviated, truncated, ellipsised, wrapped or scaled down. The strip is as wide as its
   * content and the window scrolls over it.* At 360px the 390px track scrolls 30px and clips `Weekly`'s
   * tail **at the screen edge**; nothing is cut by a box and no glyph is lost from the DOM.
   */
  it('R-lens-33: the five labels render in full at 360px — unshortened and untruncated', async () => {
    window.innerWidth = 360;
    withLens(F.lensFor('Monthly'));
    renderApp(<AppShell />, { route: '/month/2026-08' });
    await screen.findByRole('tablist', { name: 'Lens' });

    for (const label of ['Life', 'Yearly', 'Quarterly', 'Monthly', 'Weekly']) {
      const tab = screen.getByRole('tab', { name: label });
      // The whole word, exactly — never `Qtr`, never `Quart…`.
      expect(tab.textContent).toBe(label);
      // …and nothing in its own styling can take it away: no ellipsis, no wrap, no shrink, no cap.
      expect(tab).toHaveStyle({ whiteSpace: 'nowrap', flexShrink: '0' });
      expect(tab.style.textOverflow).toBe('');
      expect(tab.style.maxWidth).toBe('');
      // 13px in both states, and 700 in both states — a weight change would reflow the whole track.
      expect(tab).toHaveStyle({ fontSize: '13px', fontWeight: '700' });
    }
    // The viewport moves, not the words: the track is an ordinary horizontal scroller.
    expect(screen.getByRole('tablist')).toHaveStyle({ overflowX: 'auto' });
  });

  /**
   * §7.1 — **manual activation, not automatic.** Arrowing from `Life` to `Weekly` under automatic
   * activation would fire three route changes, three lens reads and three history entries to reach one
   * destination.
   */
  it('R-lens-33: full keyboard operation — one stop, arrows move, Enter changes, and it is announced', async () => {
    withLens(F.lensFor('Monthly'));
    const { user, container } = renderApp(<AppShell />, { route: '/month/2026-08' });
    await screen.findByText('Lift three times a week');

    // One tab stop for the whole strip: the selected tab is `0`, the rest `-1` (roving tabindex).
    expect(screen.getAllByRole('tab').filter((t) => t.tabIndex === 0)).toHaveLength(1);

    screen.getByRole('tab', { name: 'Monthly' }).focus();
    await user.keyboard('{ArrowLeft}');
    // Focus moved; selection did NOT follow it.
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Quarterly' }));
    expect(screen.getByRole('tab', { name: 'Quarterly' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tab', { name: 'Monthly' })).toHaveAttribute('aria-selected', 'true');

    // `Home` and `End` reach the ends, and the strip does not wrap past either of them.
    await user.keyboard('{Home}');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Life' }));
    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Life' }));
    await user.keyboard('{End}');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Weekly' }));
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Weekly' }));

    // …and `Enter` is what changes the lens.
    withLens(F.lensFor('Weekly'));
    await user.keyboard('{Enter}');
    await atLens('Weekly', 'Week of 31 Aug');

    // §7.3 — the change is announced: the tab's own `selected` state, plus the live region's payload.
    await waitFor(() => {
      expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe('Week of 31 Aug. 1 goal, 1 carried.');
    });
    // ⚠ **Focus is never dropped.** The strip is mounted in the shell above the router outlet, so
    // activating a tab does not unmount the element holding focus (§2.12).
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Weekly' }));
  });

  /**
   * ⚠ **The owner's override of `29-ux-navigation` §2.7.** The plan recommended *not* sticky and warned
   * that if it were overturned the correct form is **both rows together as one block, or neither** — a
   * strip that sticks without its period row lets you change lens but not period from the same place.
   * One `position: sticky` wrapper is what makes that unbreakable.
   */
  it('R-lens-33: the tab strip and the period row are pinned as ONE block, and the strip still scrolls', async () => {
    withLens(F.lensFor('Monthly'));
    renderApp(<AppShell />, { route: '/month/2026-08' });
    await screen.findByText('Lift three times a week');

    const pinned = screen.getByTestId('lens-sticky-nav');
    expect(pinned).toHaveStyle({ position: 'sticky', top: 'var(--safe-top, 0px)' });
    // Both rows, in one element: there is no scroll position at which one is pinned and the other is not.
    expect(pinned.contains(screen.getByRole('tablist', { name: 'Lens' }))).toBe(true);
    expect(pinned.contains(screen.getByTestId('lens-period'))).toBe(true);
    expect(pinned.contains(screen.getByRole('button', { name: 'Later month' }))).toBe(true);
    // Above the cards, below the bottom tab bar (20) and far below the sheet overlay (42/43).
    expect(pinned.style.zIndex).toBe('10');
    // ⚠ The pinned container must not clip or trap the horizontal scroller. `overflow` stays visible
    // here — which is also the only way `position: sticky` works at all — and the scroller is one level
    // down, inside the strip.
    expect(pinned.style.overflow).toBe('');
    expect(screen.getByRole('tablist')).toHaveStyle({ overflowX: 'auto', overscrollBehaviorX: 'contain' });
    // The list scrolls under it: the body is a sibling of the pinned block, not inside it.
    expect(pinned.contains(screen.getByTestId('lens-body'))).toBe(false);
  });

  /** §2.11 — the strip is marked so the body's period swipe can never fire from inside it. */
  it('R-lens-25: the strip is marked `data-h-scroll` and `data-no-swipe`, under both code paths', async () => {
    withLens(F.lensFor('Monthly'));
    renderApp(<AppShell />, { route: '/month/2026-08' });
    const strip = await screen.findByRole('tablist', { name: 'Lens' });
    expect(strip).toHaveAttribute('data-h-scroll');
    expect(strip).toHaveAttribute('data-no-swipe');
  });

  /**
   * ⚠ **The Zoom sheet is gone, and this is the assertion that it cannot come back quietly.** Its module
   * is absent from the source tree, and there is no control anywhere on a lens that opens it.
   */
  it('R-lens-22, deleted: the Zoom sheet cannot be opened, and its module is absent', async () => {
    withLens(F.lensFor('Monthly'));
    const { user } = renderApp(<AppShell />, { route: '/month/2026-08' });
    await screen.findByText('Lift three times a week');

    // Nothing on the screen opens it: the title is not a button and the `▾` marker is deleted.
    expect(screen.queryByTestId('lens-zoom-marker')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Change lens/ })).not.toBeInTheDocument();
    await user.click(screen.getByTestId('lens-period'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Change lens' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Jump to now' })).not.toBeInTheDocument();

    // …and the module itself is deleted, not left dormant. `29-ux-navigation`: *"where it says a thing
    // is deleted, the file is deleted, not left dormant."* A dynamic `import()` cannot say this — Vite
    // resolves it statically and the test file would fail to load — so the filesystem is asked directly.
    // `process.cwd()` is `apps/web` under vitest; `import.meta.url` is not a `file:` URL here.
    const lensDir = resolve(process.cwd(), 'src/lens');
    expect(existsSync(resolve(lensDir, 'ZoomSheet.tsx'))).toBe(false);
    expect(readdirSync(lensDir)).not.toContain('ZoomSheet.tsx');
    expect(readdirSync(lensDir).join(' ')).not.toMatch(/Zoom/);
  });
});

/**
 * ⚠ **A2 — the two things the client could not render until the wire carried them.**
 *
 * Both were reported in `docs/work/17-lens-web/build.md` §6 as **missing fields, not client shortcuts**,
 * and both were re-checked before being built: neither could have been resolved from a lens payload,
 * because a lens is one horizon and one period and holds neither the parent nor the account's history.
 */
/**
 * ⚠ **R-lens-23 is REWRITTEN, and both halves of the old rule were broken by the reversal.**
 *
 * It named the *immediate* parent, suppressed when that parent was the group's own Life goal. Without
 * groups the suppression has no referent, and a flat Yearly list would carry **no ancestry at all**,
 * because a Yearly goal's parent is always a Life goal and was therefore always suppressed. The
 * replacement is one rule at four horizons: **the Life goal the chain reaches, with no suppression.**
 */
describe('R-lens-23 — the Life line on every card', () => {
  it('S-lens-23-1: every item outside the Life lens names its Life goal, and opens it', async () => {
    withLens(F.weeklyLens());
    const { user } = renderApp(<AppShell />, { route: '/week/2026-08-31' });

    const line = await screen.findAllByRole('button', { name: 'under Be strong at 60. Open goal.' });
    expect(line[0]).toHaveTextContent('under Be strong at 60');
    // The only way to walk UP without a tree. There is still no way to walk down.
    await user.click(line[0]!);
    expect(await screen.findByRole('heading', { level: 1, name: 'Be strong at 60' })).toBeInTheDocument();
  });

  /**
   * ⚠ **REWRITTEN — was `S-lens-23-2: nothing renders when the parent is the group's own Life goal`.**
   *
   * **Verdict: superseded, recorded against `R-lens-23` (rewritten).** The suppression it asserted is
   * deleted: with it, a flat Yearly list would carry no ancestry whatsoever. The Yearly lens **gains**
   * the line it did not have, which is the inverse of what this used to prove.
   */
  it('R-lens-23: the Yearly lens GAINS the line — no suppression, at any horizon', async () => {
    withLens(F.lensFor('Yearly'));
    renderApp(<AppShell />, { route: '/year/2026' });
    expect(await screen.findByText('Get back under 80kg')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'under Be strong at 60. Open goal.' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'under Ship the thing. Open goal.' })).toBeInTheDocument();
  });

  it('R-lens-12: the carried band’s goals carry the line too', async () => {
    withLens(F.weeklyLens());
    renderApp(<AppShell />, { route: '/week/2026-08-31' });
    const band = await screen.findByTestId('carried-band');
    expect(within(band).getByRole('button', { name: /^under Be strong at 60/ })).toBeInTheDocument();
  });
});

describe('R-lens-24 — three empty states, and they are distinguishable', () => {
  it('S-lens-24-1: a horizon never used says so, and explains what the horizon is for', async () => {
    withLens(F.lens({ lens: 'Quarterly', items: [], groups: [], period: F.period({ periodKey: '2026-Q3' }), hasAnyAtHorizon: false, hasLifeGoals: true }));
    renderApp(<AppShell />, { route: '/quarter/2026-Q3' });

    expect(await screen.findByText('Nothing quarterly yet.')).toBeInTheDocument();
    expect(screen.getByText('A quarter is long enough to change something and short enough to finish.')).toBeInTheDocument();
    // `Q3 2026 is unclaimed` would be a different claim about a different thing.
    expect(screen.queryByText('Q3 2026 is unclaimed.')).not.toBeInTheDocument();
    // §3.1 — the empty state's CTA is kept (one button on an empty screen is not clutter) and relabelled.
    expect(screen.getAllByRole('button', { name: '+ Goal' }).length).toBeGreaterThan(0);
  });

  it('S-lens-24-2: a horizon used in ANOTHER period gets the PERIOD-level state instead', async () => {
    withLens(F.lens({ lens: 'Quarterly', items: [], groups: [], period: F.period({ periodKey: '2026-Q3' }), hasAnyAtHorizon: true, hasLifeGoals: true }));
    renderApp(<AppShell />, { route: '/quarter/2026-Q3' });

    expect(await screen.findByText('Q3 2026 is unclaimed.')).toBeInTheDocument();
    // Telling someone with last year's quarterly goals "nothing quarterly yet" is a flat lie, and it is
    // the lie the field exists to prevent.
    expect(screen.queryByText('Nothing quarterly yet.')).not.toBeInTheDocument();
  });

  it('R-lens-6 / R-goal-36: a PAST period is the third distinguishable state, and offers no CTA', async () => {
    withLens(
      F.lens({
        lens: 'Quarterly',
        items: [],
        groups: [],
        period: F.period({ periodKey: '2026-Q1', isCurrent: false, isPast: true }),
        hasAnyAtHorizon: true,
        hasLifeGoals: true,
      }),
    );
    renderApp(<AppShell />, { route: '/quarter/2026-Q1' });

    // ⚠ **R-lens-30** — `Q1 2026`, not `2026-Q1`. The sentence names the period with `labelOf`, computed
    // locally; it used to take `PeriodView.label` from the payload, and this fixture's hand-written
    // `LABELS` table had no entry for `2026-Q1` and fell back to echoing the raw KEY. R-nav-24 is explicit
    // that the URL carries the key and the screen shows the label, so the old expectation was pinning a
    // leaked identifier that the real server would never have sent.
    expect(await screen.findByText('Nothing was set for Q1 2026.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Goal' })).not.toBeInTheDocument();
    expect(screen.queryByText('Nothing quarterly yet.')).not.toBeInTheDocument();
  });

  it('R-lens-24: a brand-new account gets the COLD START, not "nothing quarterly yet"', async () => {
    // With no Life goals, `+ Quarterly goal` has no legal parent to hang off. The horizon-level state
    // needs both halves of the signal, and this is the half that is easy to forget.
    withLens(F.lens({ lens: 'Quarterly', items: [], groups: [], period: F.period({ periodKey: '2026-Q3' }), hasAnyAtHorizon: false, hasLifeGoals: false }));
    renderApp(<AppShell />, { route: '/quarter/2026-Q3' });

    expect(await screen.findByText('Q3 2026 is unclaimed.')).toBeInTheDocument();
    expect(screen.queryByText('Nothing quarterly yet.')).not.toBeInTheDocument();
  });

  it('the horizon-level state exists at all four horizons, each with its own reason', async () => {
    for (const [lens, route, headline] of [
      ['Yearly', '/year/2026', 'Nothing yearly yet.'],
      ['Monthly', '/month/2026-08', 'Nothing monthly yet.'],
      ['Weekly', '/week/2026-08-31', 'Nothing weekly yet.'],
    ] as const) {
      withLens(F.lens({ lens, items: [], groups: [], hasAnyAtHorizon: false, hasLifeGoals: true }));
      const { unmount } = renderApp(<AppShell />, { route });
      expect(await screen.findByText(headline)).toBeInTheDocument();
      unmount();
    }
  });
});

/**
 * ⚠ **A4 (R-lens-28, R-lens-29)** — the label that stopped over-promising, and the flag beneath it.
 *
 * The owner opened the Monthly lens on Tue 1 Sep 2026, read `Sep 2026`, and could not find the week they
 * were living in. Both facts were true: a week belongs to its Monday's month (R-goal-33), so the week of
 * Mon 31 Aug is August's and `Sep 2026` begins on the 7th. The model is right; the label was the defect.
 */
describe('R-lens-28 — the lens title says what the period actually spans', () => {
  it('the Monthly lens prints the range beneath the month, and announces both together', async () => {
    withLens(F.lensFor('Monthly'));
    const { container } = renderApp(<AppShell />, { route: '/month/2026-08' });
    await screen.findByText('Lift three times a week');

    // Two lines, one row: the eye reads `Aug 2026` over `Mon 3 Aug – Sun 6 Sep`…
    expect(screen.getByText('Mon 3 Aug – Sun 6 Sep')).toBeInTheDocument();
    // …and the platform hears both, because the range line is `aria-hidden` and the live region carries
    // `label · range` instead (§7.3). The title is no longer a button with a name of its own.
    await waitFor(() => {
      expect(container.querySelector('[aria-live="polite"]')?.textContent).toMatch(/^Aug 2026 · Mon 3 Aug – Sun 6 Sep\./);
    });
  });

  it('today’s real case: viewing Sep 2026 shows Mon 7 Sep – Sun 4 Oct', async () => {
    withLens(
      F.lens({
        lens: 'Monthly',
        period: F.period({ periodKey: '2026-09', currentWeekPeriod: { periodKey: '2026-08', label: 'Aug 2026' } }),
        items: [],
      }),
    );
    renderApp(<AppShell />, { route: '/month/2026-09' });

    // The month named `Sep 2026` runs from the 7th to the 4th of October, and now says so.
    expect(await screen.findByText('Mon 7 Sep – Sun 4 Oct')).toBeInTheDocument();
  });

  it('the Quarterly and Yearly lenses carry it too — the seam is theirs as much as the month’s', async () => {
    withLens(F.lensFor('Quarterly'));
    const { unmount } = renderApp(<AppShell />, { route: '/quarter/2026-Q3' });
    expect(await screen.findByText('Mon 6 Jul – Sun 4 Oct')).toBeInTheDocument();
    unmount();

    withLens(F.lensFor('Yearly'));
    renderApp(<AppShell />, { route: '/year/2026' });
    // A year always spans two calendar years, so both are spelled out or the far end is unreadable.
    expect(await screen.findByText('Mon 5 Jan 2026 – Sun 3 Jan 2027')).toBeInTheDocument();
  });

  it('the Weekly and Life lenses print no range — neither label over-promises', async () => {
    withLens(F.lensFor('Weekly'));
    const { unmount } = renderApp(<AppShell />, { route: '/week/2026-08-31' });
    await screen.findByText('Three easy runs and one long run');
    // `Week of 31 Aug` already names a specific Monday, and a week is unambiguously the seven days from
    // it. A range under it would restate the title, which is chrome (R-nav-27).
    expect(screen.queryByText('Mon 31 Aug – Sun 6 Sep')).not.toBeInTheDocument();
    await atLens('Weekly', 'Week of 31 Aug');
    unmount();

    withLens(F.lens({ lens: 'Life', items: F.lifeGoals(), groups: [] }));
    renderApp(<AppShell />, { route: '/life' });
    await atLens('Life', 'Life');
  });
});

describe('R-lens-29 — the flag for "this week is somewhere else"', () => {
  /**
   * Tue 1 Sep 2026: the Monthly lens's current period is `Sep 2026` and this week is August's.
   *
   * ⚠ **R-lens-30** — the clock is genuinely moved to that Tuesday now, rather than the fixture asserting
   * `currentWeekPeriod` by hand at a clock that said Mon 31 Aug. It has to be: `currentWeekPeriod` is a
   * calendar fact the client computes, and R-lens-29's row renders only on the CURRENT period — which
   * `2026-09` is not, on 31 August. The old fixture was internally inconsistent and passed because
   * nothing checked it; the runtime echo assertion checks it now.
   *
   * `atInstant` moves the device clock and the fixtures' `serverNow` together, which is the whole reason
   * it exists.
   */
  const seam = () => {
    atInstant('2026-09-01T09:00:00.000Z');
    withLens(F.lens({ lens: 'Monthly', period: F.period({ horizon: 'Monthly', periodKey: '2026-09' }), items: [] }));
  };

  it('says where this week is, and offers one tap to it', async () => {
    seam();
    renderApp(<AppShell />, { route: '/month/2026-09' });

    expect(await screen.findByText('This week is in Aug 2026')).toBeInTheDocument();
    // The visible verb is short because the pill one gap away already names the month for the eye; the
    // accessible name spells the destination out, because a screen reader hears the button alone.
    expect(screen.getByRole('button', { name: 'Go to Aug 2026' })).toHaveTextContent('Go there ›');
    // §8.2 — and the live region carries it, because a visible row is not something to go looking for.
    expect(screen.getByText(/This week is in Aug 2026\.$/)).toBeInTheDocument();
  });

  it('the jump lands on the period that holds today’s week', async () => {
    seam();
    const { user } = renderApp(<AppShell />, { route: '/month/2026-09' });
    await screen.findByText('This week is in Aug 2026');

    withLens(F.lensFor('Monthly'));
    await user.click(screen.getByRole('button', { name: 'Go to Aug 2026' }));

    // `Aug 2026`, the month whose weeks include Mon 31 Aug — and NOT `lensPath(lens)` with no period,
    // which would ask for the current one and land straight back on September.
    await atLens('Monthly', 'Aug 2026');
    expect(screen.queryByText('This week is in Aug 2026')).not.toBeInTheDocument();
  });

  it('it does not render when the period holds this week — which is every other day of the month', async () => {
    withLens(F.lensFor('Monthly'));
    renderApp(<AppShell />, { route: '/month/2026-08' });
    await screen.findByText('Lift three times a week');

    expect(screen.queryByTestId('week-elsewhere-row')).not.toBeInTheDocument();
    expect(screen.queryByText(/^This week is in/)).not.toBeInTheDocument();
  });

  it('R-nav-27: it takes the off-now row’s place and never adds a third row of chrome', async () => {
    // A future period carries `currentWeekPeriod` too — the server states the fact on every period it
    // describes — but `Future month — planning ahead` is what belongs in that row there, and printing
    // both would be the third unconditional row R-nav-27 refuses.
    withLens(
      F.lens({
        lens: 'Monthly',
        period: F.period({
          periodKey: '2026-11',
          label: 'Nov 2026',
          isCurrent: false,
          weekRange: 'Mon 2 Nov – Sun 6 Dec',
          currentWeekPeriod: { periodKey: '2026-08', label: 'Aug 2026' },
        }),
        items: [],
      }),
    );
    renderApp(<AppShell />, { route: '/month/2026-11' });

    expect(await screen.findByText('Future month — planning ahead')).toBeInTheDocument();
    expect(screen.queryByTestId('week-elsewhere-row')).not.toBeInTheDocument();
    // …and the range is still printed, because a future period over-promises exactly as much.
    expect(screen.getByText('Mon 2 Nov – Sun 6 Dec')).toBeInTheDocument();
  });

  it('the Weekly lens can never flag: a week always holds its own week', async () => {
    withLens(F.lensFor('Weekly'));
    renderApp(<AppShell />, { route: '/week/2026-08-31' });
    await screen.findByText('Three easy runs and one long run');
    expect(screen.queryByTestId('week-elsewhere-row')).not.toBeInTheDocument();
  });
});
