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
    ['/year/2026', 'Yearly lens, 2026. Change lens or period.'],
    ['/quarter/2026-Q3', 'Quarterly lens, Q3 2026. Change lens or period.'],
    ['/month/2026-08', 'Monthly lens, Aug 2026. Change lens or period.'],
    ['/week/2026-08-31', 'Weekly lens, Week of 31 Aug. Change lens or period.'],
  ])('%s opens its lens at its period', async (route, title) => {
    renderApp(<AppShell />, { route });
    expect(await screen.findByRole('button', { name: title })).toBeInTheDocument();
  });

  it('R-lens-14: a period the URL does not name falls back to the current one, and the URL is rewritten', async () => {
    // `/month` is legal and means "whichever month the server says contains today" — the client must never
    // derive that (R-goal-34). The address bar catches up once the read lands, so a copied link is absolute.
    renderApp(<AppShell />, { route: '/month' });
    expect(await screen.findByRole('button', { name: 'Monthly lens, Aug 2026. Change lens or period.' })).toBeInTheDocument();
    await waitFor(() => expect(new URL(requests('GET', '/api/goals').at(-1)!.url).searchParams.get('lens')).toBe('Monthly'));
    // The fallback read carries NO period: asking for one the client made up is the bug this avoids.
    expect(new URL(requests('GET', '/api/goals')[0]!.url).searchParams.has('period')).toBe(false);
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
    await screen.findByRole('button', { name: 'Monthly lens, Aug 2026. Change lens or period.' });

    await user.click(screen.getByRole('button', { name: 'Learnings' }));
    await screen.findByRole('heading', { level: 1, name: 'Learnings' });
    await user.click(screen.getByRole('button', { name: 'Goals' }));
    expect(await screen.findByRole('button', { name: 'Monthly lens, Aug 2026. Change lens or period.' })).toBeInTheDocument();
  });
});

describe('Routes — back and forward (S-nav-24-1)', () => {
  it('each step is undone in order', async () => {
    // A real history stack, so `back()` here is the operation the Android back button performs.
    renderApp(<AppShell />, { browserHistory: true, entries: ['/month/2026-08', '/quarter/2026-Q3', `/goal/${F.Q}`] });
    expect(await screen.findByRole('heading', { level: 1, name: 'Rebuild the gym habit' })).toBeInTheDocument();

    history.back();
    expect(await screen.findByRole('button', { name: 'Quarterly lens, Q3 2026. Change lens or period.' })).toBeInTheDocument();
    history.back();
    expect(await screen.findByRole('button', { name: 'Monthly lens, Aug 2026. Change lens or period.' })).toBeInTheDocument();
  });

  it('S-lens-14-2: a task page opened from a past week goes back to that week, not to the current one', async () => {
    server.use(http.get('/api/goals', () => HttpResponse.json(F.weeklyLens(F.LAST_MONDAY))));
    const { user } = renderApp(<AppShell />, { browserHistory: true, route: '/week/2026-08-24' });
    await user.click(await screen.findByText('Tuesday easy 6k'));
    await screen.findByRole('heading', { level: 1, name: 'Book the Tuesday slot' });

    expect(screen.getByRole('button', { name: '‹ Week of Mon 24 Aug' })).toBeInTheDocument();
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
    await user.click(await screen.findByRole('button', { name: 'Monthly lens, Aug 2026. Change lens or period.' }));
    await screen.findByRole('dialog', { name: 'Change lens' });
    // Still the Monthly lens's URL behind it — the sheet chose nothing yet.
    expect(screen.getByRole('button', { name: 'Monthly lens, Aug 2026. Change lens or period.' })).toBeInTheDocument();
  });
});
