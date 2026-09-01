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
 */

describe('Routes — a pasted link lands where it says (S-lens-14-1)', () => {
  it.each([
    ['/life', 'Life lens, Life. Change lens or period.'],
    ['/year/2026', 'Yearly lens, 2026 · Mon 5 Jan 2026 – Sun 3 Jan 2027. Change lens or period.'],
    ['/quarter/2026-Q3', 'Quarterly lens, Q3 2026 · Mon 6 Jul – Sun 4 Oct. Change lens or period.'],
    ['/month/2026-08', 'Monthly lens, Aug 2026 · Mon 3 Aug – Sun 6 Sep. Change lens or period.'],
    ['/week/2026-08-31', 'Weekly lens, Week of 31 Aug. Change lens or period.'],
  ])('%s opens its lens at its period', async (route, title) => {
    renderApp(<AppShell />, { route });
    expect(await screen.findByRole('button', { name: title })).toBeInTheDocument();
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
    expect(await screen.findByRole('button', { name: 'Monthly lens, Aug 2026 · Mon 3 Aug – Sun 6 Sep. Change lens or period.' })).toBeInTheDocument();
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
    await screen.findByRole('button', { name: /Quarterly lens/ });
    // `2026-Q9` is not a canonical key for any horizon, so it never reaches the wire.
    await waitFor(() => expect(requests('GET', '/api/goals').length).toBeGreaterThan(0));
    for (const r of requests('GET', '/api/goals')) expect(new URL(r.url).searchParams.get('period')).not.toBe('2026-Q9');
  });

  it('S-nav-24-1: an unknown path lands on the remembered lens, not a blank page', async () => {
    renderApp(<AppShell />, { route: '/nowhere-at-all' });
    // R-nav-28 — a cold start opens the Weekly lens at the week containing today.
    expect(await screen.findByRole('button', { name: 'Weekly lens, Week of 31 Aug. Change lens or period.' })).toBeInTheDocument();
  });

  it('R-nav-28: `/` opens the Weekly lens on a cold start, and the lens the tab remembers after that', async () => {
    const { user } = renderApp(<AppShell />, { route: '/' });
    expect(await screen.findByRole('button', { name: 'Weekly lens, Week of 31 Aug. Change lens or period.' })).toBeInTheDocument();

    // Visit another lens, then come back through the tab: it returns you there, at the current period.
    await user.click(await screen.findByRole('button', { name: 'Weekly lens, Week of 31 Aug. Change lens or period.' }));
    await user.click(await screen.findByRole('button', { name: /Monthly/ }));
    await screen.findByRole('button', { name: 'Monthly lens, Aug 2026 · Mon 3 Aug – Sun 6 Sep. Change lens or period.' });

    await user.click(screen.getByRole('button', { name: 'Learnings' }));
    await screen.findByRole('heading', { level: 1, name: 'Learnings' });
    await user.click(screen.getByRole('button', { name: 'Goals' }));
    expect(await screen.findByRole('button', { name: 'Monthly lens, Aug 2026 · Mon 3 Aug – Sun 6 Sep. Change lens or period.' })).toBeInTheDocument();
  });
});

describe('Routes — back and forward (S-nav-24-1)', () => {
  it('each step is undone in order', async () => {
    // A real history stack, so `back()` here is the operation the Android back button performs.
    renderApp(<AppShell />, { browserHistory: true, entries: ['/month/2026-08', '/quarter/2026-Q3', `/goal/${F.Q}`] });
    expect(await screen.findByRole('heading', { level: 1, name: 'Rebuild the gym habit' })).toBeInTheDocument();

    history.back();
    expect(await screen.findByRole('button', { name: 'Quarterly lens, Q3 2026 · Mon 6 Jul – Sun 4 Oct. Change lens or period.' })).toBeInTheDocument();
    history.back();
    expect(await screen.findByRole('button', { name: 'Monthly lens, Aug 2026 · Mon 3 Aug – Sun 6 Sep. Change lens or period.' })).toBeInTheDocument();
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
    expect(await screen.findByRole('button', { name: 'Weekly lens, Week of 24 Aug. Change lens or period.' })).toBeInTheDocument();
  });
});

describe('Routes — what is deliberately NOT addressable (R-lens-14, S-nav-24-2)', () => {
  it('an overlay does not change the URL, and a reload does not reopen it', async () => {
    const { user, unmount } = renderApp(<AppShell />, { route: '/week/2026-08-31' });
    await user.click(await screen.findByRole('button', { name: 'Add' }));
    await screen.findByRole('dialog', { name: 'Add to Backlog' });

    // The `+` drawer is a two-second interaction whose URL nobody wants.
    expect(screen.getByRole('button', { name: 'Weekly lens, Week of 31 Aug. Change lens or period.' })).toBeInTheDocument();
    unmount();

    // "Reload" — a fresh mount at the same route. The drawer is not part of the address, so it is gone.
    renderApp(<AppShell />, { route: '/week/2026-08-31' });
    await screen.findByRole('button', { name: 'Weekly lens, Week of 31 Aug. Change lens or period.' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('and the Zoom sheet is an overlay too, not a route', async () => {
    const { user } = renderApp(<AppShell />, { route: '/month/2026-08' });
    await user.click(await screen.findByRole('button', { name: 'Monthly lens, Aug 2026 · Mon 3 Aug – Sun 6 Sep. Change lens or period.' }));
    await screen.findByRole('dialog', { name: 'Change lens' });
    // Still the Monthly lens's URL behind it — the sheet chose nothing yet.
    expect(screen.getByRole('button', { name: 'Monthly lens, Aug 2026 · Mon 3 Aug – Sun 6 Sep. Change lens or period.' })).toBeInTheDocument();
  });
});
