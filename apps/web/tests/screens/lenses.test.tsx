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
 */

const withLens = (body: LensResponse) => server.use(http.get('/api/goals', () => HttpResponse.json(body)));

describe('Lenses — a flat list, grouped by Life goal', () => {
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

  it('S-lens-4-1 / R-lens-4: the group header carries the open count, and a zero count is not rendered', async () => {
    withLens(F.lensFor('Quarterly'));
    renderApp(<AppShell />, { route: '/quarter/2026-Q3' });
    // One group, so no header at all (R-lens-19) — proven by the count being nowhere on screen.
    expect(await screen.findByText('Rebuild the gym habit')).toBeInTheDocument();
    expect(screen.queryByText(/2 open/)).not.toBeInTheDocument();

    withLens(F.lensFor('Monthly'));
    renderApp(<AppShell />, { route: '/month/2026-08' });
    expect(await screen.findByText('Be strong at 60 · 2 open')).toBeInTheDocument();
    // R-lens-4, amended — the second line has no open work, so it reads as a bare title.
    expect(screen.getByText('Ship the thing')).toBeInTheDocument();
    expect(screen.queryByText(/Ship the thing · 0 open/)).not.toBeInTheDocument();
  });

  it('R-lens-19: with exactly one group the header does not render at all', async () => {
    withLens(F.lensFor('Quarterly'));
    renderApp(<AppShell />, { route: '/quarter/2026-Q3' });
    await screen.findByText('Rebuild the gym habit');
    // A header over the only group names the card beneath it. There is nothing to disambiguate.
    expect(screen.queryByRole('button', { name: /Be strong at 60.*group/ })).not.toBeInTheDocument();
  });

  it('R-lens-19: a group with no items in this period is not rendered — a lens is not a roster', async () => {
    withLens(F.lens({ lens: 'Monthly', period: F.period({ periodKey: '2026-08' }), items: [F.monthlyGoals()[0]!], groups: [F.group({ id: F.L, openTasks: 2 }), F.group({ id: F.L2 })] }));
    renderApp(<AppShell />, { route: '/month/2026-08' });
    await screen.findByText('Lift three times a week');
    expect(screen.queryByText('Ship the thing')).not.toBeInTheDocument();
  });

  it('R-lens-19: a group collapses, and it is one row that does it', async () => {
    withLens(F.lensFor('Monthly'));
    const { user } = renderApp(<AppShell />, { route: '/month/2026-08' });
    const header = await screen.findByRole('button', { name: /^Be strong at 60, 2 open tasks this week\. Collapse group\.$/ });
    expect(header).toHaveAttribute('aria-expanded', 'true');

    await user.click(header);

    expect(screen.queryByText('Lift three times a week')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Expand group\.$/ })).toHaveAttribute('aria-expanded', 'false');
  });

  it('R-lens-20: a goal whose chain does not reach a Life goal surfaces under UNSORTED, last', async () => {
    withLens(
      F.lens({
        lens: 'Monthly',
        period: F.period({ periodKey: '2026-08' }),
        items: [F.monthlyGoals()[0]!, F.goal({ id: F.ulid(51), parentId: F.ulid(99), horizon: 'Monthly', title: 'An orphan', periodKey: '2026-08', period: 'Aug 2026', lifeRootId: null })],
        groups: [F.group({ id: F.L, openTasks: 2 }), F.group({ id: null })],
      }),
    );
    renderApp(<AppShell />, { route: '/month/2026-08' });

    expect(await screen.findByText('An orphan')).toBeInTheDocument();
    expect(screen.getByText('UNSORTED')).toBeInTheDocument();
    expect(screen.getByText("These aren't under a Life goal yet.")).toBeInTheDocument();
    // R-lens-20 — no count on the group, ever. It is a data-integrity surface, not an ordinary state.
    expect(screen.queryByText(/UNSORTED · /)).not.toBeInTheDocument();
  });
});

describe('Lenses — the chrome budget (R-nav-27)', () => {
  it('the current period draws exactly two rows above the first item: the cluster and the lens row', async () => {
    withLens(F.lensFor('Monthly'));
    renderApp(<AppShell />, { route: '/month/2026-08' });
    await screen.findByText('Lift three times a week');

    // Row 1 — the cluster. Row 2 — `‹ Aug 2026 ▾ ›`. And that is all that is unconditional.
    expect(screen.getByRole('button', { name: 'Monthly lens, Aug 2026 · Mon 3 Aug – Sun 6 Sep. Change lens or period.' })).toBeInTheDocument();
    // The cluster's create button and the per-group one are the same label by design (§6.7): one asks
    // "add to this period", the other "add to this line in this period", and both are the same act.
    expect(screen.getAllByRole('button', { name: '+ Monthly goal' }).length).toBeGreaterThan(0);
    // The off-now row is conditional and this period is now, so it is absent entirely.
    expect(screen.queryByRole('button', { name: 'Now ›' })).not.toBeInTheDocument();
    expect(screen.queryByText(/still editable|planning ahead/)).not.toBeInTheDocument();
    // R-rm-5 / R-nav-27 — the four rows the Tasks screen carried are gone with the screen.
    expect(screen.queryByRole('button', { name: 'Edit plan' })).not.toBeInTheDocument();
    expect(screen.queryByText('Tasks')).not.toBeInTheDocument();
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
    expect(await screen.findByRole('button', { name: 'Monthly lens, Sep 2026 · Mon 7 Sep – Sun 4 Oct. Change lens or period.' })).toBeInTheDocument();
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
    expect(screen.queryByRole('button', { name: '+ Monthly goal' })).not.toBeInTheDocument();
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
    const create = screen.getByRole('button', { name: '+ Monthly goal' });
    await user.click(create);

    // The sheet opened on August, not on `''`. Its own read-only period chip is what names the period the
    // goal would be created into (UX §6.7), so this is the assertion that the key was right.
    expect(await screen.findByText('Aug 2026')).toBeInTheDocument();
  });

  it('R-lens-2: the Life lens still offers create once its read lands, though it has no period', async () => {
    // The other half of the guard above: `period` is legitimately `null` on Life *after* the read, and
    // `''` is the correct key there. Guarding on `view` instead of `data` would have hidden this button.
    withLens(F.lens({ lens: 'Life', items: F.lifeGoals() }));
    renderApp(<AppShell />, { route: '/life' });

    // A populated lens, so the empty state's own CTA is not on screen to be confused with this one.
    expect(await screen.findByRole('button', { name: '+ Life goal' })).toBeInTheDocument();
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
    expect(screen.getByRole('button', { name: 'Life lens, Life. Change lens or period.' })).toBeEnabled();
  });
});

describe('Lenses — the Life lens (R-lens-2, §6.1)', () => {
  it('has no group headers, and the count and backlog line move onto the card', async () => {
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
    // Each Life goal IS a group of one, so a header would name the card beneath it.
    expect(screen.queryByRole('button', { name: /Collapse group/ })).not.toBeInTheDocument();
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

    expect(await screen.findByRole('button', { name: 'Monthly lens, Jul 2026 · Mon 6 Jul – Sun 2 Aug. Change lens or period.' })).toBeInTheDocument();
  });

  it('Shift+↓ zooms in one altitude, and Shift+↑ zooms back out', async () => {
    withLens(F.lensFor('Quarterly'));
    const { user } = renderApp(<AppShell />, { route: '/quarter/2026-Q3' });
    await screen.findByText('Rebuild the gym habit');

    withLens(F.lensFor('Monthly'));
    await user.type(screen.getByTestId('lens-body'), '{Shift>}{ArrowDown}{/Shift}');
    expect(await screen.findByRole('button', { name: 'Monthly lens, Aug 2026 · Mon 3 Aug – Sun 6 Sep. Change lens or period.' })).toBeInTheDocument();
  });

  it('and a shortcut never fires while a field has focus — the arrows belong to the caret there', async () => {
    withLens(F.lensFor('Monthly'));
    const { user } = renderApp(<AppShell />, { route: '/month/2026-08' });
    await user.click(await screen.findByRole('button', { name: 'Add' }));
    const sheet = await screen.findByRole('dialog', { name: 'Add to Backlog' });

    const field = within(sheet).getByLabelText('What needs doing, someday?');
    await user.type(field, 'abc{ArrowLeft}{ArrowLeft}');
    expect(screen.getByRole('button', { name: 'Monthly lens, Aug 2026 · Mon 3 Aug – Sun 6 Sep. Change lens or period.' })).toBeInTheDocument();
  });

  it('R-lens-25: the Life lens has no periods, so it has no gesture and no arrow shortcut either', async () => {
    withLens(F.lensFor('Life'));
    const { user } = renderApp(<AppShell />, { route: '/life' });
    await screen.findByText('Be strong at 60');
    await user.type(screen.getByTestId('lens-body'), '{ArrowLeft}{ArrowRight}');
    expect(screen.getByRole('button', { name: 'Life lens, Life. Change lens or period.' })).toBeInTheDocument();
  });
});

describe('Lenses — announcements (§8.2)', () => {
  it('one polite region carries the payload focus will not say', async () => {
    withLens(F.lensFor('Weekly'));
    const { container } = renderApp(<AppShell />, { route: '/week' });
    await screen.findByText('Three easy runs and one long run');
    await waitFor(() => {
      const live = container.querySelector('[aria-live="polite"]');
      expect(live?.textContent).toBe('Week of 31 Aug. 1 goal in 1 group, 1 carried.');
    });
  });
});

describe('Lenses — the Zoom sheet (R-lens-17, R-lens-22)', () => {
  it('the title opens a ladder of five, each naming where it would land, with zero counts omitted', async () => {
    withLens(F.lensFor('Quarterly'));
    const { user } = renderApp(<AppShell />, { route: '/quarter/2026-Q3' });
    await user.click(await screen.findByRole('button', { name: 'Quarterly lens, Q3 2026 · Mon 6 Jul – Sun 4 Oct. Change lens or period.' }));

    const sheet = await screen.findByRole('dialog', { name: 'Change lens' });
    expect(within(sheet).getByText('everything')).toBeInTheDocument();
    expect(within(sheet).getByText('Q3 2026')).toBeInTheDocument();
    expect(within(sheet).getByText('Week of 31 Aug')).toBeInTheDocument();
    // R-lens-13's one surviving requirement: the selection is announced, never merely coloured.
    expect(within(sheet).getByRole('button', { name: /Quarterly/ })).toHaveAttribute('aria-current', 'true');
    // R-lens-7 / §10 — no period picker anywhere in the sheet. One control per dimension.
    expect(within(sheet).queryByRole('button', { name: /Earlier|Later/ })).not.toBeInTheDocument();
  });

  it('S-lens-9-3: choosing a row navigates to that lens at the period the SERVER computed', async () => {
    withLens(F.lensFor('Quarterly'));
    const { user } = renderApp(<AppShell />, { route: '/quarter/2026-Q3' });
    await user.click(await screen.findByRole('button', { name: 'Quarterly lens, Q3 2026 · Mon 6 Jul – Sun 4 Oct. Change lens or period.' }));

    withLens(F.lensFor('Monthly'));
    await user.click(within(await screen.findByRole('dialog', { name: 'Change lens' })).getByRole('button', { name: /Monthly/ }));

    expect(await screen.findByRole('button', { name: 'Monthly lens, Aug 2026 · Mon 3 Aug – Sun 6 Sep. Change lens or period.' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('R-lens-17: `Jump to now` is offered only when the period is not the current one', async () => {
    withLens(F.lensFor('Monthly'));
    const { user } = renderApp(<AppShell />, { route: '/month/2026-08' });
    await user.click(await screen.findByRole('button', { name: 'Monthly lens, Aug 2026 · Mon 3 Aug – Sun 6 Sep. Change lens or period.' }));
    expect(within(await screen.findByRole('dialog', { name: 'Change lens' })).queryByRole('button', { name: 'Jump to now' })).not.toBeInTheDocument();
  });
});

/**
 * ⚠ **A2 — the two things the client could not render until the wire carried them.**
 *
 * Both were reported in `docs/work/17-lens-web/build.md` §6 as **missing fields, not client shortcuts**,
 * and both were re-checked before being built: neither could have been resolved from a lens payload,
 * because a lens is one horizon and one period and holds neither the parent nor the account's history.
 */
describe('R-lens-23 — the parent line', () => {
  it('S-lens-23-1: renders for an item whose parent is OUTSIDE the period, and opens that parent', async () => {
    // The Weekly lens is one week. `Lift three times a week` is a MONTHLY goal — it is not in `items`,
    // not in `carried` and not in `groups`, so before `LensResponse.parents` there was nothing on the
    // wire to render this line from, and the client may not go and fetch one (R-lens-16).
    withLens(F.weeklyLens());
    const { user } = renderApp(<AppShell />, { route: '/week/2026-08-31' });

    const line = await screen.findAllByRole('button', { name: 'under Lift three times a week, Aug 2026. Open goal.' });
    expect(line[0]).toHaveTextContent('under Lift three times a week');
    // R-lens-23 — the only way to walk UP one step without a tree. There is still no way to walk down.
    await user.click(line[0]!);
    expect(await screen.findByRole('heading', { level: 1, name: 'Lift three times a week' })).toBeInTheDocument();
  });

  it('S-lens-23-2: nothing renders when the parent is the group’s own Life goal', async () => {
    // The Yearly lens: every item's parent is a Life goal, so the server sends no parents at all and the
    // client implements the suppression by rendering every hit it finds.
    withLens(F.lensFor('Yearly'));
    renderApp(<AppShell />, { route: '/year/2026' });
    expect(await screen.findByText('Get back under 80kg')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^under / })).not.toBeInTheDocument();
  });

  it('R-lens-12: the carried band’s goals carry the line too', async () => {
    withLens(F.weeklyLens());
    renderApp(<AppShell />, { route: '/week/2026-08-31' });
    const band = await screen.findByTestId('carried-band');
    expect(within(band).getByRole('button', { name: /^under Lift three times a week/ })).toBeInTheDocument();
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
    expect(screen.getAllByRole('button', { name: '+ Quarterly goal' }).length).toBeGreaterThan(0);
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
    expect(screen.queryByRole('button', { name: '+ Quarterly goal' })).not.toBeInTheDocument();
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
  it('the Monthly lens prints the range beneath the month, and names both in one accessible name', async () => {
    withLens(F.lensFor('Monthly'));
    renderApp(<AppShell />, { route: '/month/2026-08' });
    await screen.findByText('Lift three times a week');

    // Two lines, one control: the eye reads `Aug 2026` over `Mon 3 Aug – Sun 6 Sep`…
    expect(screen.getByText('Mon 3 Aug – Sun 6 Sep')).toBeInTheDocument();
    // …and the platform reads both, because the range line itself is `aria-hidden` (hearing it twice is
    // worse than not hearing it). The `·` is what a line break cannot carry.
    expect(screen.getByRole('button', { name: 'Monthly lens, Aug 2026 · Mon 3 Aug – Sun 6 Sep. Change lens or period.' })).toBeInTheDocument();
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
    expect(screen.getByRole('button', { name: 'Weekly lens, Week of 31 Aug. Change lens or period.' })).toBeInTheDocument();
    unmount();

    withLens(F.lens({ lens: 'Life', items: F.lifeGoals(), groups: [] }));
    renderApp(<AppShell />, { route: '/life' });
    expect(await screen.findByRole('button', { name: 'Life lens, Life. Change lens or period.' })).toBeInTheDocument();
  });

  it('R-lens-22: the Zoom sheet shows every row’s span, so the destination is the whole destination', async () => {
    withLens(F.lensFor('Quarterly'));
    const { user } = renderApp(<AppShell />, { route: '/quarter/2026-Q3' });
    await user.click(await screen.findByRole('button', { name: /^Quarterly lens, Q3 2026/ }));

    const sheet = await screen.findByRole('dialog', { name: 'Change lens' });
    expect(within(sheet).getByText('Mon 5 Jan 2026 – Sun 3 Jan 2027')).toBeInTheDocument();
    expect(within(sheet).getByText('Mon 6 Jul – Sun 4 Oct')).toBeInTheDocument();
    expect(within(sheet).getByText('Mon 3 Aug – Sun 6 Sep')).toBeInTheDocument();
    expect(within(sheet).getByText('Mon 31 Aug – Sun 6 Sep')).toBeInTheDocument();
    // The Life row spans everything, and `everything` has no dates to print.
    expect(within(sheet).getByText('everything')).toBeInTheDocument();
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
    expect(await screen.findByRole('button', { name: /^Monthly lens, Aug 2026 · Mon 3 Aug – Sun 6 Sep\./ })).toBeInTheDocument();
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
