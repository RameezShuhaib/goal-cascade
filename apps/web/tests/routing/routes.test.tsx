import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { AppShell } from '../../src/AppShell';
import { renderApp } from '../render';
import { requests, server } from '../msw/handlers';
import * as F from '../msw/fixtures';

/**
 * R-nav-24 — **the router.**
 *
 * Before A2 the screen and the open overlay were React state with the URL mirrored one way afterwards, so
 * back, forward and a pasted link all did the wrong thing. These are the properties that decision cost and
 * this one buys back — plus the one it must NOT buy: an overlay that survives a reload (S-nav-24-2).
 *
 * ⚠ **What identifies a lens on screen changed with R-lens-17.** It used to be the title button's
 * accessible name (`Monthly lens, Aug 2026 · … . Change lens or period.`); the title is text now and the
 * lens is the **selected tab** (R-lens-33). Every assertion below names both halves — which tab is
 * selected, and which period is printed — so it is if anything stricter than the one string was.
 */

/** The lens on screen: the selected tab, and the period the row prints. */
const atLens = async (lens: string, period: string) => {
  expect(await screen.findByRole('tab', { name: lens, selected: true })).toBeInTheDocument();
  // `lens-period`, not `getByText`: `Life` is a tab label as well as a period title.
  expect(screen.getByTestId('lens-period')).toHaveTextContent(period);
};

describe('Routes — a pasted link lands where it says (S-lens-14-1)', () => {
  it.each([
    ['/life', 'Life', 'Life'],
    ['/year/2026', 'Yearly', '2026'],
    ['/quarter/2026-Q3', 'Quarterly', 'Q3 2026'],
    ['/month/2026-08', 'Monthly', 'Aug 2026'],
    ['/week/2026-08-31', 'Weekly', 'Week of 31 Aug'],
  ])('%s opens its lens at its period', async (route, lens, period) => {
    renderApp(<AppShell />, { route });
    await atLens(lens, period);
  });

  /**
   * ⚠ **VERDICT — one clause of this test encoded a rule R-lens-30 supersedes, and it is rewritten, not
   * weakened.**
   *
   * The retired clause read: *"The fallback read carries NO period: asking for one the client made up is
   * the bug this avoids"* — the client-side half of R-goal-34, which is the rule that moved. The bug it
   * avoided was a client that *made a period up* from its own device clock; a client that computes one
   * from the owner's stored timezone through the same module the Worker calls is not making anything up,
   * and the runtime echo assertion checks that on this very response.
   *
   * **Everything the test protected is still asserted, and more is.** `/month` still lands on the current
   * month, still rewrites the address bar, and now also proves the defect the change existed to remove:
   * it issues **exactly one** `GET /goals`, carrying the period, where it used to issue two — one under
   * `['goals','Monthly',null]` and a second under `['goals','Monthly','2026-08']` once the first landed,
   * with a `Loading…` on each.
   */
  it('R-lens-14 / R-lens-30: `/month` resolves the current period locally, in ONE request', async () => {
    // `browserHistory`, so the address-bar rewrite is observable — it is half of what this asserts.
    renderApp(<AppShell />, { browserHistory: true, route: '/month' });
    await atLens('Monthly', 'Aug 2026');
    await waitFor(() => expect(requests('GET', '/api/goals').length).toBeGreaterThan(0));
    // The URL is canonicalised before the read, so the address bar is absolute and the key never moves.
    await waitFor(() => expect(window.location.pathname).toBe('/month/2026-08'));

    const goals = requests('GET', '/api/goals');
    expect(goals).toHaveLength(1);
    expect(new URL(goals[0]!.url).searchParams.get('lens')).toBe('Monthly');
    expect(new URL(goals[0]!.url).searchParams.get('period')).toBe('2026-08');
  });

  it('an unparseable period is dropped rather than trusted — a URL segment is attacker-supplied', async () => {
    renderApp(<AppShell />, { route: '/quarter/2026-Q9' });
    await screen.findByRole('tab', { name: 'Quarterly', selected: true });
    // `2026-Q9` is not a canonical key for any horizon, so it never reaches the wire.
    await waitFor(() => expect(requests('GET', '/api/goals').length).toBeGreaterThan(0));
    for (const r of requests('GET', '/api/goals')) expect(new URL(r.url).searchParams.get('period')).not.toBe('2026-Q9');
  });

  it('S-nav-24-1: an unknown path lands on the remembered lens, not a blank page', async () => {
    renderApp(<AppShell />, { route: '/nowhere-at-all' });
    // R-nav-28 — a cold start opens the Weekly lens at the week containing today.
    await atLens('Weekly', 'Week of 31 Aug');
  });

  it('R-nav-28: `/` opens the Weekly lens on a cold start, and the lens the tab remembers after that', async () => {
    const { user } = renderApp(<AppShell />, { route: '/' });
    await atLens('Weekly', 'Week of 31 Aug');

    // Visit another lens, then come back through the tab bar: it returns you there, at the current period.
    // ⚠ **R-lens-33 — that is ONE tap now, not two.** It was: open the Zoom sheet from the title, then
    // choose a row. The strip is why this line got shorter.
    await user.click(screen.getByRole('tab', { name: 'Monthly' }));
    await atLens('Monthly', 'Aug 2026');

    await user.click(screen.getByRole('button', { name: 'Learnings' }));
    await screen.findByRole('heading', { level: 1, name: 'Learnings' });
    await user.click(screen.getByRole('button', { name: 'Goals' }));
    await atLens('Monthly', 'Aug 2026');
  });
});

describe('Routes — back and forward (S-nav-24-1)', () => {
  it('each step is undone in order', async () => {
    // A real history stack, so `back()` here is the operation the Android back button performs.
    renderApp(<AppShell />, { browserHistory: true, entries: ['/month/2026-08', '/quarter/2026-Q3', `/goal/${F.Q}`] });
    expect(await screen.findByRole('heading', { level: 1, name: 'Rebuild the gym habit' })).toBeInTheDocument();

    history.back();
    await atLens('Quarterly', 'Q3 2026');
    history.back();
    await atLens('Monthly', 'Aug 2026');
  });

  it('S-lens-14-2: a task page opened from a past week goes back to that week, not to the current one', async () => {
    server.use(http.get('/api/goals', () => HttpResponse.json(F.weeklyLens(F.LAST_MONDAY))));
    const { user } = renderApp(<AppShell />, { browserHistory: true, route: '/week/2026-08-24' });
    await user.click(await screen.findByText('Tuesday easy 6k'));
    await screen.findByRole('heading', { level: 1, name: 'Book the Tuesday slot' });

    // ⚠ R-nav-24 — was `Week of Mon 24 Aug`. This file asserts the SERVER's label (`Week of 31 Aug`) 60
    // lines up, so it held both spellings of one week at once; the back button now uses the server's.
    expect(screen.getByRole('button', { name: '‹ Week of 24 Aug' })).toBeInTheDocument();
    history.back();
    await atLens('Weekly', 'Week of 24 Aug');
  });
});

describe('Routes — what is deliberately NOT addressable (R-lens-14, S-nav-24-2)', () => {
  it('an overlay does not change the URL, and a reload does not reopen it', async () => {
    const { user, unmount } = renderApp(<AppShell />, { route: '/week/2026-08-31' });
    await user.click(await screen.findByRole('button', { name: 'Add' }));
    await screen.findByRole('dialog', { name: 'Add to Backlog' });

    // The `+` drawer is a two-second interaction whose URL nobody wants.
    await atLens('Weekly', 'Week of 31 Aug');
    unmount();

    // "Reload" — a fresh mount at the same route. The drawer is not part of the address, so it is gone.
    renderApp(<AppShell />, { route: '/week/2026-08-31' });
    await atLens('Weekly', 'Week of 31 Aug');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  /**
   * ⚠ **RETIRED — `and the Zoom sheet is an overlay too, not a route`.**
   *
   * **Verdict: superseded by the owner's own reversal, recorded against `R-lens-17` (rewritten) and
   * `R-lens-22` (deleted).** *"i dont need to click on a dropdown to change the lense as it adds
   * friction."* The Zoom sheet is deleted in full, so the property this asserted — that opening it does
   * not change the URL — has no subject. What replaces it is stronger and is asserted next door: changing
   * lens **is** a route change, and it is one tap.
   *
   * The overlay-is-not-a-route rule itself is untouched and is still covered by the test above, by
   * `sheetDismissal.test.tsx` and by the create sheet's own tests.
   */
  it('R-lens-33: changing lens IS a route change, and it is one tap from every lens', async () => {
    const { user } = renderApp(<AppShell />, { browserHistory: true, route: '/month/2026-08' });
    await atLens('Monthly', 'Aug 2026');
    // No sheet is opened on the way, and none is left behind.
    await user.click(screen.getByRole('tab', { name: 'Quarterly' }));
    await atLens('Quarterly', 'Q3 2026');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(window.location.pathname).toBe('/quarter/2026-Q3'));
    // …and it is in the history, so back returns to the lens you came from (R-nav-24).
    history.back();
    await atLens('Monthly', 'Aug 2026');
  });
});
