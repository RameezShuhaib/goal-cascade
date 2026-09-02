import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { GoalView } from '@goal-cascade/shared';
import { AppShell } from '../../src/AppShell';
import { renderApp } from '../render';
import { server } from '../msw/handlers';
import * as F from '../msw/fixtures';

/**
 * **R-goal-41, amended (A6) — the trail is one line that never wraps.**
 *
 * The owner: *"there is problem with breadcrumbs if the title of the goal is large the is looks messed up.
 * probably add elipsis in middle or pick best practices."*
 *
 * The fixture account is five levels deep, so every depth in the rule's table is reachable without
 * inventing data:
 *
 * ```
 *   L   Be strong at 60           Life                    depth 1
 *   └ Y   Get back under 80kg     Yearly     2026         depth 2
 *     └ Q   Rebuild the gym habit Quarterly  Q3 2026      depth 3
 *       └ M   Lift three times…   Monthly    Aug 2026     depth 4
 *         └ W  Three easy runs…   Weekly     Week of 31 Aug   depth 5
 * ```
 */

const trail = () => screen.getByRole('navigation', { name: 'Breadcrumb' });
const overflow = () => screen.queryByRole('button', { name: 'Show the full path' });
const eyebrow = () => document.querySelector('[data-goal-eyebrow]');
const parentCrumb = () => trail().querySelector('[data-crumb="parent"]') as HTMLElement | null;

/** Open a goal page and wait for its `<h1>`. */
async function openGoal(id: string, title: string) {
  const app = renderApp(<AppShell />, { route: `/goal/${id}` });
  await screen.findByRole('heading', { level: 1, name: title });
  return app;
}

describe('Breadcrumbs — one line, at most three segments (R-goal-41)', () => {
  it('depth 1, a Life goal: `Goals` alone — no overflow, no eyebrow', async () => {
    await openGoal(F.L, 'Be strong at 60');

    expect(within(trail()).getByRole('button', { name: 'Goals' })).toBeInTheDocument();
    expect(overflow()).toBeNull();
    expect(eyebrow()).toBeNull();
    expect(parentCrumb()).toBeNull();
  });

  it('depth 2, a Yearly goal: `Goals / <the Life root>` — still nothing dropped, so still no `…`', async () => {
    await openGoal(F.Y, 'Get back under 80kg');

    expect(parentCrumb()).toHaveTextContent('Be strong at 60');
    // Nothing was collapsed, so there is nothing to expand — and the Life root is ON the line, so an
    // eyebrow would print it twice.
    expect(overflow()).toBeNull();
    expect(eyebrow()).toBeNull();
  });

  it('depth 3, a Quarterly goal: `Goals / … / <parent>` with the Life root promoted to the eyebrow', async () => {
    await openGoal(F.Q, 'Rebuild the gym habit');

    expect(within(trail()).getByRole('button', { name: 'Goals' })).toBeInTheDocument();
    expect(overflow()).toBeInTheDocument();
    // §8.2 C — the visible text is ellipsised, so the accessible name is the untruncated title WITH its
    // period. That period clause is R-goal-41's, and this is the first render of the product to honour it.
    expect(within(trail()).getByRole('button', { name: 'Get back under 80kg, 2026' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Be strong at 60. Open goal.' })).toBe(eyebrow());
    // The trail never names the Life root twice.
    expect(within(trail()).queryByText('Be strong at 60')).toBeNull();
  });

  it('depth 4, a Monthly goal: the same three segments, one step further down', async () => {
    await openGoal(F.M, 'Lift three times a week');

    expect(overflow()).toBeInTheDocument();
    expect(within(trail()).getByRole('button', { name: 'Rebuild the gym habit, Q3 2026' })).toBeInTheDocument();
    expect(eyebrow()).toHaveTextContent('Be strong at 60');
    // Two ancestors are dropped now, and the count of segments has not moved.
    expect(within(trail()).getAllByRole('button')).toHaveLength(3);
  });

  it('depth 5, a Weekly goal: still `Goals`, `…` and one parent — three ancestors are behind the `…`', async () => {
    await openGoal(F.W, 'Three easy runs and one long run');

    expect(within(trail()).getAllByRole('button')).toHaveLength(3);
    expect(within(trail()).getByRole('button', { name: 'Lift three times a week, Aug 2026' })).toBeInTheDocument();
    expect(eyebrow()).toHaveTextContent('Be strong at 60');
    expect(within(trail()).queryByText('Get back under 80kg')).toBeNull();
    expect(within(trail()).queryByText('Rebuild the gym habit')).toBeNull();
  });

  /**
   * **The rule, as CSS.** The depth rule alone is not the fix — a three-segment line still wraps if the
   * middle segment is allowed to. These five properties are the fix, and each of them is load-bearing:
   * without `min-width: 0` a flex item's `min-width: auto` is its content's intrinsic width, which is
   * exactly how a 660 px title pushes a 40 px cluster off the row.
   */
  it('crumbs never wrap: the line is `nowrap`, the parent takes the slack and tail-truncates', async () => {
    await openGoal(F.W, 'Three easy runs and one long run');

    const nav = trail();
    expect(nav.style.flexWrap).toBe('nowrap');
    expect(nav.style.overflow).toBe('hidden');
    expect(nav.style.minWidth).toBe('0');
    expect(nav.style.flex).toBe('1 1 auto');

    const parent = parentCrumb()!;
    expect(parent.style.flex).toBe('1 1 auto');
    expect(parent.style.minWidth).toBe('0');
    expect(parent.style.whiteSpace).toBe('nowrap');
    expect(parent.style.overflow).toBe('hidden');
    expect(parent.style.textOverflow).toBe('ellipsis');

    // `Goals` is the escape hatch and is never truncated; nor is the `…`.
    const goals = nav.querySelector('[data-crumb="root"]') as HTMLElement;
    expect(goals.style.flex).toBe('0 0 auto');
    expect((overflow() as HTMLElement).style.flex).toBe('0 0 auto');
  });

  /**
   * §4.4 — the single title that alone exceeds the width, and the two opposite answers it gets.
   *
   * The owner's real example is 55 characters; this is 260, which is past anything a person would type and
   * therefore the case that proves the rule holds by construction rather than by luck.
   */
  it('a parent title far wider than the viewport truncates the CRUMB and never the cluster', async () => {
    const huge = 'Set up my AI consultancy and land at least one paying client '.repeat(4).trim();
    server.use(
      http.get('/api/goals/:id', () =>
        HttpResponse.json({
          ...F.detailOf(F.Q),
          ancestors: [
            F.goal({ id: F.L, title: 'Be financially independent' }),
            F.goal({ id: F.Y, parentId: F.L, horizon: 'Yearly', title: huge, periodKey: '2026', period: '2026', lifeRootId: F.L }),
          ] as GoalView[],
        }),
      ),
    );
    await openGoal(F.Q, 'Rebuild the gym habit');

    const parent = parentCrumb()!;
    expect(parent).toHaveTextContent(huge.slice(0, 20), { normalizeWhitespace: false });
    // One line, whatever the length: the properties above do not depend on the string.
    expect(parent.style.whiteSpace).toBe('nowrap');
    expect(parent.style.textOverflow).toBe('ellipsis');
    // …and the untruncated string is still what a screen reader gets, and is still one tap from the sheet.
    expect(parent.getAttribute('aria-label')).toBe(`${huge}, 2026`);

    // The cluster is `flex: 0 0 auto`, so no title of any length can push it down the page — which was the
    // whole visible defect.
    const cluster = screen.getByRole('button', { name: 'Toggle dark mode' }).parentElement!.parentElement as HTMLElement;
    expect(cluster.style.flex).toBe('0 0 auto');
  });

  /** **Crumbs never wrap. The page title always wraps.** The `<h1>` gets the opposite treatment, always. */
  it('the page title wraps to three lines and then clamps — it is never one truncated line', async () => {
    await openGoal(F.M, 'Lift three times a week');

    const h1 = screen.getByRole('heading', { level: 1, name: 'Lift three times a week' });
    expect(h1.style.whiteSpace).not.toBe('nowrap');
    expect(h1.style.getPropertyValue('-webkit-line-clamp')).toBe('3');
    expect(h1.style.overflow).toBe('hidden');
  });
});

describe('`Where this sits` — the full ancestry, with its periods (R-goal-41, R-nav-15)', () => {
  it('opens from `…`, lists every ancestor root → parent with its period, and marks where you are', async () => {
    const { user } = await openGoal(F.W, 'Three easy runs and one long run');

    await user.click(overflow()!);
    const sheet = await screen.findByRole('dialog', { name: 'Where this sits' });

    // Root → parent, untruncated, each with the period the trail has no room for.
    for (const [title, sub] of [
      ['Be strong at 60', 'LIFE'],
      ['Get back under 80kg', 'YEARLY · 2026'],
      ['Rebuild the gym habit', 'QUARTERLY · Q3 2026'],
      ['Lift three times a week', 'MONTHLY · AUG 2026'],
    ] as const) {
      expect(within(sheet).getByRole('button', { name: new RegExp(title) })).toBeInTheDocument();
      expect(within(sheet).getByText(sub)).toBeInTheDocument();
    }

    // The current goal is the last row, marked and NOT a control: a breadcrumb to where you already are is
    // a button that does nothing.
    const here = sheet.querySelector('[aria-current="true"]') as HTMLElement;
    expect(here).toHaveTextContent('Three easy runs and one long run');
    expect(here.tagName).toBe('DIV');
    expect(within(sheet).queryByRole('button', { name: /Three easy runs/ })).toBeNull();
  });

  it('traps focus, closes on Escape, and hands focus back to the `…` that opened it', async () => {
    const { user } = await openGoal(F.Q, 'Rebuild the gym habit');
    const trigger = overflow()!;

    await user.click(trigger);
    const sheet = await screen.findByRole('dialog', { name: 'Where this sits' });

    // `Sheet`'s contract, inherited unchanged — focus moves to the heading, not to a field.
    expect(document.activeElement).toBe(within(sheet).getByRole('heading', { name: 'Where this sits' }));
    for (let i = 0; i < 8; i++) {
      await user.tab();
      expect(sheet.contains(document.activeElement)).toBe(true);
    }

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(document.activeElement).toBe(trigger);
  });

  it('a row is a way there: choosing an ancestor closes the sheet and opens that goal', async () => {
    const { user } = await openGoal(F.M, 'Lift three times a week');

    await user.click(overflow()!);
    const sheet = await screen.findByRole('dialog', { name: 'Where this sits' });
    await user.click(within(sheet).getByRole('button', { name: /Get back under 80kg/ }));

    await screen.findByRole('heading', { level: 1, name: 'Get back under 80kg' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  /**
   * R-lens-20 — a dangling `parentId`. The eyebrow would otherwise print a Yearly goal in the slot that
   * means "your Life goal", which is a statement the data does not support.
   */
  it('an UNSORTED line suppresses the eyebrow and says why in the sheet', async () => {
    server.use(
      http.get('/api/goals/:id', () =>
        HttpResponse.json({
          ...F.detailOf(F.M),
          ancestors: [
            F.goal({ id: F.Y, parentId: null, horizon: 'Yearly', title: 'Get back under 80kg', periodKey: '2026', period: '2026', lifeRootId: F.Y }),
            F.goal({ id: F.Q, parentId: F.Y, horizon: 'Quarterly', title: 'Rebuild the gym habit', periodKey: '2026-Q3', period: 'Q3 2026', lifeRootId: F.Y }),
          ] as GoalView[],
        }),
      ),
    );
    const { user } = await openGoal(F.M, 'Lift three times a week');

    expect(eyebrow()).toBeNull();
    // The `…` still renders — a segment WAS dropped — so the full path is still reachable.
    await user.click(overflow()!);
    const sheet = await screen.findByRole('dialog', { name: 'Where this sits' });
    expect(within(sheet).getByText("These aren't under a Life goal yet.")).toBeInTheDocument();
  });
});

describe('The other two places a long title used to break a line (§4.5)', () => {
  it('a lens card’s `under <Life goal>` line is one line, with the full name in its accessible name', async () => {
    renderApp(<AppShell />, { route: '/month/2026-08' });
    // ⚠ **R-lens-23, rewritten** — it names the LIFE goal now, at every horizon and with no suppression,
    // so the accessible name is `under <Life goal>. Open goal.` and carries no period (a Life goal has
    // none, R-goal-3). The clamp this test exists for is unchanged.
    const line = await screen.findByRole('button', { name: 'under Be strong at 60. Open goal.' });

    expect(line.style.whiteSpace).toBe('nowrap');
    expect(line.style.textOverflow).toBe('ellipsis');
    expect(line.style.overflow).toBe('hidden');
  });

  it('the task page’s context line is one line, and BOTH segments stay tappable (R-task-45)', async () => {
    renderApp(<AppShell />, { route: `/task/${F.ulid(20)}` });
    await screen.findByRole('heading', { level: 1, name: 'Book the Tuesday slot' });

    const life = await screen.findByRole('button', { name: 'Be strong at 60' });
    const weekly = screen.getByRole('button', { name: 'Three easy runs and one long run' });
    // The Life root gives ground first: `0 1 auto` with a floor, against the weekly goal's `1 1 auto`.
    expect(life.style.flex).toBe('0 1 auto');
    expect(life.style.minWidth).toBe('96px');
    expect(weekly.style.flex).toBe('1 1 auto');
    for (const el of [life, weekly]) {
      expect(el.style.whiteSpace).toBe('nowrap');
      expect(el.style.textOverflow).toBe('ellipsis');
    }
    expect((life.parentElement as HTMLElement).style.flexWrap).toBe('nowrap');
  });
});
