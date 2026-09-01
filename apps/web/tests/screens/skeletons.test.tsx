import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, renderHook, screen, waitFor, within } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { AppShell } from '../../src/AppShell';
import { SKELETON_GRACE_MS, SKELETON_MIN_MS, useSkeleton } from '../../src/components/Skeleton';
import { renderApp } from '../render';
import { requests, server } from '../msw/handlers';
import * as F from '../msw/fixtures';

/**
 * **R-nav-30 — loading is a skeleton, and only when the identity is cold.**
 *
 * The owner: *"for the contents inside i would want skeleton loader."*
 *
 * Two halves, tested two ways. The **timing** rules (R4's 150 ms grace, R5's 400 ms minimum, R6's errors
 * superseding) are a state machine and are tested as one, with the clock fully in hand. The **product**
 * rules (R2's cache hit, R7's refetch, what a screen reader hears, that nothing moves) are properties of
 * the screens and are tested through them, over the real network seam.
 *
 * ⚠ `tests/setup.ts` fakes **`Date` only** — timers are real, so the integration tests below must not
 * depend on a precise millisecond. The hook tests below take the timers as well, for the duration of the
 * test, and `setup.ts`'s `afterEach` restores everything.
 */

const skeleton = (kind?: string) => document.querySelector(kind ? `[data-skeleton="${kind}"]` : '[data-skeleton]');

/** A response that takes long enough to be genuinely cold — past the 150 ms grace, twice over. */
const slow = (body: object, ms = 400) =>
  http.get('/api/goals/:id', async () => {
    await delay(ms);
    return HttpResponse.json(body);
  });

describe('The skeleton state machine (R-nav-30, R4–R6)', () => {
  /** Take the timers for this test; `setup.ts` hands them back afterwards. */
  const pinned = () => vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], now: new Date(F.DEFAULT_NOW) });

  it('R4: a read that lands inside the 150 ms grace never paints anything grey', () => {
    pinned();
    const { result, rerender } = renderHook(({ p }) => useSkeleton(p), { initialProps: { p: true } });

    act(() => void vi.advanceTimersByTime(SKELETON_GRACE_MS - 60));
    expect(result.current).toBe(false);

    rerender({ p: false }); // the data landed at 90 ms
    act(() => void vi.advanceTimersByTime(5_000));
    expect(result.current).toBe(false);
  });

  it('R4: a read still in flight at 150 ms mounts the skeleton', () => {
    pinned();
    const { result } = renderHook(({ p }) => useSkeleton(p), { initialProps: { p: true } });

    expect(result.current).toBe(false);
    act(() => void vi.advanceTimersByTime(SKELETON_GRACE_MS));
    expect(result.current).toBe(true);
  });

  it('R5: once mounted it stays 400 ms — the shortest visible skeleton is a state, not a flicker', () => {
    pinned();
    const { result, rerender } = renderHook(({ p }) => useSkeleton(p), { initialProps: { p: true } });

    act(() => void vi.advanceTimersByTime(SKELETON_GRACE_MS));
    expect(result.current).toBe(true);

    // The data lands 10 ms after the skeleton appeared: 390 ms of the minimum are still owed.
    act(() => void vi.advanceTimersByTime(10));
    rerender({ p: false });

    act(() => void vi.advanceTimersByTime(SKELETON_MIN_MS - 11));
    expect(result.current).toBe(true);
    act(() => void vi.advanceTimersByTime(2));
    expect(result.current).toBe(false);
    // The worst case is 150 + 400 and not a millisecond more.
    expect(SKELETON_GRACE_MS + SKELETON_MIN_MS).toBe(550);
  });

  /**
   * ⚠ **The minimum can never delay content that is already available.** It is armed by the *mount*, not by
   * the request — so a cache hit, which never sets `pending` at all, has nothing to hold it open. Without
   * this property the 400 ms would be the very defect the owner is complaining about, one layer down.
   */
  it('R2/R5: a hook that was never pending never shows, and never waits', () => {
    pinned();
    const { result } = renderHook(() => useSkeleton(false));

    expect(result.current).toBe(false);
    act(() => void vi.advanceTimersByTime(SKELETON_GRACE_MS + SKELETON_MIN_MS + 1_000));
    expect(result.current).toBe(false);
  });

  it('R5: a slow read that finishes long after the minimum drops the skeleton in the same frame', () => {
    pinned();
    const { result, rerender } = renderHook(({ p }) => useSkeleton(p), { initialProps: { p: true } });

    act(() => void vi.advanceTimersByTime(SKELETON_GRACE_MS + 3_000));
    expect(result.current).toBe(true);
    rerender({ p: false });
    expect(result.current).toBe(false); // no timer at all — the minimum was paid long ago
  });

  it('R6: an error supersedes both windows — the minimum never delays bad news', () => {
    pinned();
    const { result, rerender } = renderHook(({ p, e }) => useSkeleton(p, e), { initialProps: { p: true, e: null as unknown } });

    act(() => void vi.advanceTimersByTime(SKELETON_GRACE_MS));
    expect(result.current).toBe(true);

    rerender({ p: false, e: new Error('boom') }); // 0 ms into a 400 ms minimum
    expect(result.current).toBe(false);
  });
});

describe('Skeletons on a cold screen (R-nav-30, R3)', () => {
  it('the goal page shows one, and `Goals` and the cluster are real underneath it (P3)', async () => {
    server.use(slow(F.detailOf(F.Q)));
    renderApp(<AppShell />, { route: `/goal/${F.Q}` });

    const bones = await waitFor(() => {
      const el = skeleton('goal');
      expect(el).not.toBeNull();
      return el!;
    });

    // P3 — everything the client already knows renders for real, from the first frame.
    expect(within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByRole('button', { name: 'Goals' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Toggle dark mode' })).toBeInTheDocument();
    // P2 — and nothing that is a CONTROL is faked. A grey lozenge shaped like a button is an affordance
    // that does nothing, and someone will tap it.
    expect(within(bones as HTMLElement).queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete this goal' })).toBeNull();

    // …and it gives way to the real page.
    await screen.findByRole('heading', { level: 1, name: 'Rebuild the gym habit' });
    expect(skeleton()).toBeNull();
  });

  it('the lens shows one in the BODY — the header was never waiting in the first place (R-lens-30)', async () => {
    server.use(
      http.get('/api/goals', async () => {
        await delay(400);
        return HttpResponse.json(F.lensFor('Monthly', '2026-08'));
      }),
    );
    renderApp(<AppShell />, { route: '/month/2026-08' });

    await waitFor(() => expect(skeleton('lens')).not.toBeNull());
    // The period's name and its span are calendar facts and are already on screen, above the grey.
    expect(screen.getByText('Aug 2026')).toBeInTheDocument();
    expect(screen.getByText('Mon 3 Aug – Sun 6 Sep')).toBeInTheDocument();
    // Three cards, always — the first card's frame is the real first card's, so the top does not jump.
    expect(document.querySelectorAll('[data-testid="lens-card-skeleton"]')).toHaveLength(3);

    await screen.findByText('Lift three times a week');
    expect(skeleton()).toBeNull();
  });

  it('the task page shows one, and the back control is REAL because it came from the lens (P3)', async () => {
    server.use(
      http.get('/api/tasks/:id', async () => {
        await delay(400);
        return HttpResponse.json(F.taskResponse());
      }),
    );
    const { user } = renderApp(<AppShell />, { route: '/week/2026-08-31' });
    await user.click(await screen.findByText('Tuesday easy 6k'));

    await waitFor(() => expect(skeleton('task')).not.toBeNull());
    // `location.state.from` needs no read, so the way back is correct before the task is known.
    expect(screen.getByRole('button', { name: '‹ Week of 31 Aug' })).toBeInTheDocument();
    // P2 — no checkbox. `task.completable` is unknown, and a checkbox that appears late beside a title is
    // the one control on this page you must not guess at.
    expect(screen.queryByRole('button', { name: /^Complete /})).toBeNull();
    expect(screen.queryByLabelText('Title')).toBeNull();

    await screen.findByRole('heading', { level: 1, name: 'Book the Tuesday slot' });
    expect(skeleton()).toBeNull();
  });

  /** R6 — the error takes the space, and the chrome around it is still real. */
  it('a failed read replaces the skeleton with the error, not after it', async () => {
    server.use(http.get('/api/goals/:id', () => HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'nope' } }, { status: 404 })));
    renderApp(<AppShell />, { route: `/goal/${F.Q}` });

    await screen.findByRole('alert');
    expect(skeleton()).toBeNull();
    expect(within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByRole('button', { name: 'Goals' })).toBeInTheDocument();
  });
});

describe('A skeleton never covers content that is already there (R-nav-30, R2/R7/R8)', () => {
  /**
   * **The owner's own example, and it must never flash.** `useNeighbourPrefetch` warms ±1 on every settle,
   * so stepping to the next month is usually a cache hit — and `isPending` is false on a cache hit even
   * while the payload is being revalidated. One repaint, and nothing else.
   */
  it('R2: stepping to a period already in cache is one repaint — no skeleton at any moment', async () => {
    const { user } = renderApp(<AppShell />, { route: '/month/2026-08' });
    await screen.findByText('Lift three times a week');
    // Let the neighbour prefetch land before stepping into it.
    await waitFor(() => expect(requests('GET', '/api/goals').map((r) => new URL(r.url).searchParams.get('period'))).toContain('2026-09'));

    await user.click(screen.getByRole('button', { name: 'Later month' }));
    await screen.findByText('Sep 2026');

    expect(skeleton()).toBeNull();
    // …and it is still absent a full grace + minimum later, which is the only way to prove it never
    // appeared rather than that it had already gone.
    await new Promise((r) => setTimeout(r, SKELETON_GRACE_MS + 80));
    expect(skeleton()).toBeNull();
  });

  it('R7: a refetch of a screen that already has data never replaces it with grey', async () => {
    const { user, queryClient } = renderApp(<AppShell />, { route: `/goal/${F.Q}` });
    await screen.findByRole('heading', { level: 1, name: 'Rebuild the gym habit' });

    server.use(slow(F.detailOf(F.Q), 300));
    await act(async () => {
      void queryClient.invalidateQueries({ queryKey: ['goal'] });
    });

    // The whole point: an invalidation is a refetch, `isPending` stays false, and the page does not blink.
    await new Promise((r) => setTimeout(r, SKELETON_GRACE_MS + 80));
    expect(skeleton()).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Rebuild the gym habit' })).toBeInTheDocument();
    expect(user).toBeTruthy();
  });

  it('R8: a period known to be empty returns its empty state, never a skeleton', async () => {
    server.use(http.get('/api/goals', () => HttpResponse.json(F.lensFor('Quarterly', '2026-Q1'))));
    const { user } = renderApp(<AppShell />, { route: '/quarter/2026-Q3' });
    await screen.findByText('Rebuild the gym habit');

    // Back to a quarter the fixture holds nothing for, then forward to it again: the second visit is
    // cached, empty, and instant.
    await user.click(screen.getByRole('button', { name: 'Earlier quarter' }));
    await screen.findByText('Q2 2026');
    await user.click(screen.getByRole('button', { name: 'Later quarter' }));
    await user.click(screen.getByRole('button', { name: 'Earlier quarter' }));

    expect(skeleton()).toBeNull();
  });
});

describe('What a skeleton says, and what it does not (R-nav-30, §8.1 B / §8.2 B)', () => {
  it('it is announced as a status and never as content — the bars are `aria-hidden` in their entirety', async () => {
    server.use(slow(F.detailOf(F.Q)));
    renderApp(<AppShell />, { route: `/goal/${F.Q}` });

    const bones = (await waitFor(() => {
      const el = skeleton('goal');
      expect(el).not.toBeNull();
      return el!;
    })) as HTMLElement;

    // The wrapper is a live region carrying the string the retired `Loading` component used, verbatim.
    expect(bones).toHaveAttribute('role', 'status');
    expect(bones).toHaveAttribute('aria-busy', 'true');
    expect(bones).toHaveTextContent('Loading this goal…');

    // Everything else in it is hidden from assistive tech, so no grey block can be read as a goal title…
    expect(bones.querySelector('[aria-hidden="true"]')).not.toBeNull();
    // …and there is nothing in it to tab to, so the tab order across load→loaded is empty, then real —
    // never fake, then real (§8.1 B).
    expect(bones.querySelectorAll('a, button, input, textarea, select, [tabindex]')).toHaveLength(0);

    // When the content arrives the busy region is gone and the real screen is what is announced.
    await screen.findByRole('heading', { level: 1, name: 'Rebuild the gym habit' });
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('the task page says its own sentence, not the goal page’s', async () => {
    server.use(
      http.get('/api/tasks/:id', async () => {
        await delay(400);
        return HttpResponse.json(F.taskResponse());
      }),
    );
    renderApp(<AppShell />, { route: `/task/${F.ulid(20)}` });

    await waitFor(() => expect(skeleton('task')).toHaveTextContent('Loading this task…'));
  });
});

describe('No motion, so `prefers-reduced-motion` has nothing to honour (§3.1 P1, §8.5)', () => {
  const src = (p: string) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../..', p), 'utf8');

  it('no rendered skeleton node declares an animation or a transition, in either motion preference', async () => {
    for (const reduce of [false, true]) {
      // The app never consults this, which is the point: there is no branch to get wrong.
      window.matchMedia = ((query: string) => ({
        matches: reduce && query.includes('prefers-reduced-motion'),
        media: query,
        onchange: null,
        addListener() {},
        removeListener() {},
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent: () => false,
      })) as unknown as typeof window.matchMedia;

      server.use(slow(F.detailOf(F.Q)));
      const view = renderApp(<AppShell />, { route: `/goal/${F.Q}` });
      const bones = (await waitFor(() => {
        const el = skeleton('goal');
        expect(el).not.toBeNull();
        return el!;
      })) as HTMLElement;

      for (const el of [bones, ...Array.from(bones.querySelectorAll<HTMLElement>('*'))]) {
        expect(el.style.animation, `reduce=${reduce}`).toBe('');
        expect(el.style.animationName).toBe('');
        expect(el.style.transition).toBe('');
      }
      view.unmount();
    }
  });

  /**
   * The census, because "we did not add an animation" is not self-maintaining. `states.tsx` argued that a
   * shimmer *"would be louder than anything else in this product"* and it was right; this is what keeps a
   * future skeleton from quietly adding one and, with it, the app's first `prefers-reduced-motion` branch.
   */
  it('the skeleton module and the app’s stylesheet contain no keyframes, animation or transition at all', () => {
    for (const path of ['src/components/Skeleton.tsx', 'index.html']) {
      const text = src(path)
        .split('\n')
        // Prose in a doc block may NAME them; only code may not use them.
        .filter((l) => !/^\s*(\*|\/\/)/.test(l))
        .join('\n');
      expect(text, path).not.toMatch(/@keyframes|animation\s*:|animationName|transition\s*:/);
    }
  });
});
