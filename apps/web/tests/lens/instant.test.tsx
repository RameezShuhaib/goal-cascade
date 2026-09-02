import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, screen, waitFor } from '@testing-library/react';
import { http } from 'msw';
import { AppShell } from '../../src/AppShell';
import { renderApp } from '../render';
import { atInstant, requests, server } from '../msw/handlers';
import * as F from '../msw/fixtures';
import { assertPeriodAgrees } from '../../src/lens/assertPeriodAgrees';
import { setOwnerTimezone, useOwnerToday } from '../../src/lib/ownerClock';
import { recordServerNow } from '../../src/lib/serverClock';

/**
 * ⚠ **R-lens-30 — the owner's complaint, pinned.**
 *
 * > *"changing the horizon or the period shouldn't take time as it doesnt need backend, its the calander
 * > that can be computed in ui"* — and the literal `…` shown as a label while loading.
 *
 * Every test here is one clause of that sentence, asserted as behaviour rather than as structure.
 */

const holdOpen = () => server.use(http.get('/api/goals', () => new Promise<never>(() => {})));

describe('the header never waits, and `…` is never a label (R-lens-30)', () => {
  /**
   * **The owner's actual complaint, tested directly.** `GET /goals` is held open forever, so nothing about
   * the period can have come from the network: the title and the range are computed from the URL alone.
   */
  it('renders the title and the range with the network stubbed out entirely', async () => {
    holdOpen();
    renderApp(<AppShell />, { route: '/month/2026-09' });

    expect(await screen.findByText('Sep 2026')).toBeInTheDocument();
    expect(screen.getByText('Mon 7 Sep – Sun 4 Oct')).toBeInTheDocument();

    /**
     * **`…` IS NEVER A LABEL.** Scoped to the period title, deliberately, and it stays scoped there: the
     * body renders `LensListSkeleton` while a cold read is in flight (R-nav-30, A6), and the `…` on the
     * goal page's trail is a real control with the accessible name `Show the full path`. What this pins is
     * the owner's actual complaint — the *name of the period* was an ellipsis — and it pins it where it can
     * never be satisfied by accident.
     *
     * ⚠ **R-lens-17, rewritten — the title is TEXT, not a button**, so this reads `lens-period` rather
     * than an accessible name. The span the platform reads is the live region's, which is asserted in
     * `lenses.test.tsx` where the payload it carries is the subject.
     */
    const title = screen.getByTestId('lens-period');
    expect(title).toHaveTextContent('Sep 2026');
    expect(title.textContent).not.toContain('…');
    expect(screen.getByRole('tab', { name: 'Monthly', selected: true })).toBeInTheDocument();
  });

  it('every horizon names its own period before any response', async () => {
    holdOpen();
    for (const [route, title, range] of [
      ['/year/2026', '2026', 'Mon 5 Jan 2026 – Sun 3 Jan 2027'],
      ['/quarter/2026-Q4', 'Q4 2026', 'Mon 5 Oct 2026 – Sun 3 Jan 2027'],
      ['/month/2026-12', 'Dec 2026', 'Mon 7 Dec 2026 – Sun 3 Jan 2027'],
    ] as const) {
      const { unmount } = renderApp(<AppShell />, { route });
      expect(await screen.findByText(title)).toBeInTheDocument();
      expect(screen.getByText(range)).toBeInTheDocument();
      unmount();
    }
  });

  /**
   * A **week** names its own Monday already, so no range is printed under it (R-lens-28) — but the title
   * still has to be there before the read, and it is the case where the label is longest.
   *
   * ⚠ **REWRITTEN — was `…and the zoom marker survives the longest label there is`.**
   * **Verdict: superseded, recorded against `R-lens-17` (rewritten).** There is no marker: the title is
   * not a control and the Zoom sheet it opened is deleted. The property that is left — *the longest label
   * in the product renders before any response, clamped to one line* — is what is asserted.
   */
  it('the Weekly lens too, at the longest label there is', async () => {
    holdOpen();
    renderApp(<AppShell />, { route: '/week/2027-01-04' });

    expect(await screen.findByText('Week of 4 Jan')).toBeInTheDocument();
    expect(screen.getByTestId('lens-period')).toHaveStyle({ whiteSpace: 'nowrap', textOverflow: 'ellipsis' });
  });

  /**
   * ⚠ **RETIRED — `the zoom marker is an SVG outside the truncating span, centred, and never a text
   * glyph`.**
   *
   * **Verdict: superseded by the owner's own reversal, recorded against `R-lens-17` (rewritten).** The
   * marker existed to say *this title is a control*; the title is not a control any more, so the whole
   * subject is gone — with it the `unicode-range` lottery, the baseline misalignment and the ellipsis
   * that ate it. `UX-PLAN §5 (item F)`'s four defects are unreachable rather than fixed.
   *
   * The one clause worth keeping is kept, and strengthened to the whole document: **U+25BE appears
   * nowhere in the product.**
   */
  it('R-lens-17: the title is not a control, and the `▾` is gone from the product', async () => {
    renderApp(<AppShell />, { route: '/month/2026-08' });
    await screen.findByText('Lift three times a week');

    expect(screen.queryByTestId('lens-zoom-marker')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('▾');
    // The period title takes no tab stop and no press state — it is a `<span>`, in a `<div>`.
    const title = screen.getByTestId('lens-period');
    expect(title.tagName.toLowerCase()).toBe('span');
    expect(title.closest('button')).toBeNull();
  });
});

describe('opening a lens is ONE request (R-lens-30, §3.1)', () => {
  /**
   * The defect: `/month` fetched under `['goals','Monthly',null]`, the answer landed, an effect rewrote
   * the URL to `/month/2026-08`, the key became `['goals','Monthly','2026-08']` — a cache miss, a second
   * `GET /goals`, and `isPending` true again, so the screen showed `Loading…` twice. Every entry through
   * the tab bar, every `Jump to now` and every one-step zoom did it.
   */
  it('`/month` with no period segment issues exactly one GET /goals, carrying the period', async () => {
    renderApp(<AppShell />, { route: '/month' });
    await screen.findByText('Lift three times a week');

    const goals = requests('GET', '/api/goals');
    expect(goals).toHaveLength(1);
    expect(new URL(goals[0]!.url).searchParams.get('period')).toBe('2026-08');
  });

  it('so does the Weekly lens, which is what a cold open lands on', async () => {
    renderApp(<AppShell />, { route: '/week' });
    await screen.findByText('Three easy runs and one long run');

    const goals = requests('GET', '/api/goals');
    expect(goals).toHaveLength(1);
    expect(new URL(goals[0]!.url).searchParams.get('period')).toBe('2026-08-31');
  });

  /** Life genuinely has no period (R-lens-2), so it is the one read that still carries none. */
  it('the Life lens issues one request and carries no period at all', async () => {
    renderApp(<AppShell />, { route: '/life' });
    await screen.findByText('Be strong at 60');

    const goals = requests('GET', '/api/goals');
    expect(goals).toHaveLength(1);
    expect(new URL(goals[0]!.url).searchParams.has('period')).toBe(false);
  });
});

describe('anti-drift layer 3 — the runtime echo assertion (R-lens-30)', () => {
  const AT = F.DEFAULT_NOW; // 2026-08-31T09:00Z — Mon 31 Aug in Berlin and in UTC alike.
  const TZ = 'Europe/Berlin';
  const good = F.period({ horizon: 'Monthly', periodKey: '2026-09' });

  it('agrees silently when the server and the calendar say the same thing', () => {
    expect(() => assertPeriodAgrees('test', 'Monthly', good, AT, TZ)).not.toThrow();
  });

  /**
   * **The near-invisible failure this exists for.** A client that put the week of Mon 31 Aug in September
   * would render `Sep 2026 · Mon 31 Aug – …` over the server's September, which begins on the 7th.
   * Nothing errors; the screen is quietly wrong for the first days of seven months a year. So in dev and
   * test it throws, and the throw names the field.
   */
  it('THROWS under test when the server’s view contradicts the calendar', () => {
    expect(() => assertPeriodAgrees('test', 'Monthly', { ...good, weekRange: 'Mon 31 Aug – Sun 4 Oct' }, AT, TZ)).toThrow(/weekRange/);
    expect(() => assertPeriodAgrees('test', 'Monthly', { ...good, isPast: true }, AT, TZ)).toThrow(/isPast/);
    expect(() => assertPeriodAgrees('test', 'Monthly', { ...good, label: 'September 2026' }, AT, TZ)).toThrow(/label/);
    expect(() => assertPeriodAgrees('test', 'Monthly', { ...good, currentWeekPeriod: null }, AT, TZ)).toThrow(/currentWeekPeriod/);
  });

  /**
   * While the owner's timezone is unknown the client is deliberately on `'UTC'`, so a clock-dependent
   * disagreement there is the client not knowing yet — not the two implementations differing. Firing on
   * it would make the assertion cry wolf on every cold open. The three clock-free fields are still checked.
   */
  it('skips the clock-dependent fields until the timezone is known, and checks the rest anyway', () => {
    expect(() => assertPeriodAgrees('test', 'Monthly', { ...good, isPast: true }, AT, null)).not.toThrow();
    expect(() => assertPeriodAgrees('test', 'Monthly', { ...good, weekRange: 'wrong' }, AT, null)).toThrow(/weekRange/);
  });

  /**
   * **Staleness is not drift, and the response's own `serverNow` is what tells them apart.** A payload
   * cached across a midnight was right when it was made; the comparison is made on the day it was made,
   * so it stays silent. A payload that was wrong when it was made is wrong on its own day too.
   */
  it('is silent about a payload that was correct on the day it was computed', () => {
    // A Weekly view of Mon 31 Aug, computed on Mon 31 Aug: current. Read a week later, the client's
    // `today` says past — but the payload is not drifted, it is stale, and the refetch is what repairs it.
    const week = F.period({ horizon: 'Weekly', periodKey: '2026-08-31' });
    expect(week.isCurrent).toBe(true);
    expect(() => assertPeriodAgrees('test', 'Weekly', week, AT, TZ)).not.toThrow();
    // …and the same payload IS caught when its own instant contradicts it.
    expect(() => assertPeriodAgrees('test', 'Weekly', week, '2026-09-08T09:00:00.000Z', TZ)).toThrow(/isCurrent/);
  });

  it('says nothing about Life, which has no period to disagree about', () => {
    expect(() => assertPeriodAgrees('test', 'Life', null, AT, TZ)).not.toThrow();
  });
});

/**
 * The app is an installed PWA that can sit open for days, so "today" is not a value read once at mount.
 * `lib/ownerClock` recomputes it on five triggers and notifies only when the string actually changed.
 */
describe('the owner clock rolls over (R-lens-30, §4.4)', () => {
  it('follows a `recordServerNow` that moves the day — the near-midnight drifted-device case', () => {
    const { result } = renderHook(() => useOwnerToday());
    act(() => setOwnerTimezone('Europe/Berlin'));
    expect(result.current).toBe('2026-08-31');

    // 23:30 UTC on Sun 30 Aug is 01:30 on Mon 31 Aug in Berlin; 22:30 UTC is 00:30 on the 31st. Move the
    // server's clock back past the Berlin midnight and the owner's day must follow it.
    act(() => recordServerNow('2026-08-30T21:30:00.000Z'));
    expect(result.current).toBe('2026-08-30');
  });

  /**
   * **The PWA case, and the load-bearing trigger.** A tab backgrounded across a midnight has had its
   * timers frozen; the first thing that happens when the owner looks at it is a visibility change.
   */
  it('follows a `visibilitychange` after the tab was hidden across midnight', () => {
    const { result } = renderHook(() => useOwnerToday());
    act(() => setOwnerTimezone('Europe/Berlin'));
    expect(result.current).toBe('2026-08-31');

    // The device clock advances while nothing is listening, exactly as a frozen timer would leave it.
    vi.setSystemTime(new Date('2026-09-02T09:00:00.000Z'));
    expect(result.current).toBe('2026-08-31');

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(result.current).toBe('2026-09-02');
  });

  it('a timezone change re-dates the day without a reload, and never uses the device zone', () => {
    // 11:00 UTC: already the 1st in Kiritimati (+14), still the 31st in Berlin.
    vi.setSystemTime(new Date('2026-08-31T11:00:00.000Z'));
    const { result } = renderHook(() => useOwnerToday());

    act(() => setOwnerTimezone('Europe/Berlin'));
    expect(result.current).toBe('2026-08-31');
    act(() => setOwnerTimezone('Pacific/Kiritimati'));
    expect(result.current).toBe('2026-09-01');
    // R-auth-5 — with no stored zone the fallback is UTC, matching the server middleware. NOT the device.
    act(() => setOwnerTimezone(null));
    expect(result.current).toBe('2026-08-31');
  });

  /**
   * What the owner sees when the day rolls over with the tab open: **nothing moves under them.** The URL
   * still names a period and a period's *identity* does not change at midnight — its *status* does. The
   * week being viewed becomes the past week, so the create affordance goes and the badge arrives, which
   * is the honest outcome. Without it the client would keep offering `+ Goal` on a week that
   * became past at midnight, and the write would come back `PERIOD_IN_PAST` with no visible cause.
   */
  it('a lens on the current week becomes a past week, and its create affordance goes', async () => {
    renderApp(<AppShell />, { route: '/week/2026-08-31' });
    await screen.findByText('Three easy runs and one long run');
    expect(screen.getByRole('button', { name: '+ Goal' })).toBeInTheDocument();
    expect(screen.queryByText(/still editable/)).not.toBeInTheDocument();

    // Into the following week, both clocks together.
    act(() => {
      atInstant('2026-09-08T09:00:00.000Z');
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(await screen.findByText('Past week — still editable')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Goal' })).not.toBeInTheDocument();
  });
});

describe('neighbour prefetch is bounded (R-lens-30, §3.4)', () => {
  const periodsAsked = () => requests('GET', '/api/goals').map((r) => new URL(r.url).searchParams.get('period'));

  it('warms ±1 once the period has settled, and nothing further on a cold open', async () => {
    renderApp(<AppShell />, { route: '/month/2026-08' });
    await screen.findByText('Lift three times a week');

    await waitFor(() => expect(periodsAsked()).toContain('2026-09'));
    await waitFor(() => expect(periodsAsked()).toContain('2026-07'));
    // Depth 1. `GoalService.lens` fires six repository calls and R-lens-27 exists because this read has
    // been the performance defect before; depth 2 quintuples a step-heavy session's load.
    expect(periodsAsked()).not.toContain('2026-10');
    expect(periodsAsked()).not.toContain('2026-06');
  });

  it('adds one further step in the DIRECTION OF TRAVEL after a step, and not the other way', async () => {
    const { user } = renderApp(<AppShell />, { route: '/month/2026-08' });
    await screen.findByText('Lift three times a week');
    await waitFor(() => expect(periodsAsked()).toContain('2026-09'));

    await user.click(screen.getByRole('button', { name: 'Later month' }));
    await screen.findByText('Sep 2026');

    // Momentum: forward two from the new period. Backwards two is never asked for.
    await waitFor(() => expect(periodsAsked()).toContain('2026-11'));
    expect(periodsAsked()).not.toContain('2026-06');
  });

  it('a period already in cache is not re-requested — moving back over one is a repaint', async () => {
    const { user } = renderApp(<AppShell />, { route: '/month/2026-08' });
    await screen.findByText('Lift three times a week');
    await waitFor(() => expect(periodsAsked()).toContain('2026-09'));
    const before = periodsAsked().filter((p) => p === '2026-09').length;

    await user.click(screen.getByRole('button', { name: 'Later month' }));
    await screen.findByText('Sep 2026');

    // The prefetch already warmed `2026-09` inside its own `staleTime`, so arriving there costs nothing.
    expect(periodsAsked().filter((p) => p === '2026-09')).toHaveLength(before);
    // And the body is on screen with no loading state in between — R-nav-30's R2, from the other side:
    // this is the same assertion `skeletons.test.tsx` makes about the skeleton, made here about the
    // prefetch that is the reason there is nothing to load.
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
    expect(document.querySelector('[data-skeleton]')).toBeNull();
  });

  it('never prefetches on the Life lens, which has no periods', async () => {
    renderApp(<AppShell />, { route: '/life' });
    await screen.findByText('Be strong at 60');
    await waitFor(() => expect(requests('GET', '/api/goals').length).toBeGreaterThan(0));

    expect(requests('GET', '/api/goals')).toHaveLength(1);
  });
});
