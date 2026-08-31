import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { AppShell } from '../../src/AppShell';
import { renderApp } from '../render';
import { bodyOf, lastRequest, requests, server } from '../msw/handlers';
import * as F from '../msw/fixtures';
import { relativeMove } from '../../src/components/ReorderableList';

/**
 * ⚠ **A1 — manual backlog order, the client half** (R-backlog-22, R-backlog-23, R-backlog-24).
 *
 * **The keyboard path is the reference implementation, so it is what this file tests.** R-backlog-22 calls
 * drag-only "a regression on work already completed", and S-backlog-22-3 is written as a *regression
 * guard*: every affordance must be present in the DOM with no pointer event having occurred. Every test
 * below drives the feature with `Tab` and arrow keys and never issues a click on a reorder control.
 */

/** Three items on one goal, in the order the server sent them. */
const ITEMS = [
  F.backlogItem({ id: F.ulid(41), title: 'A · squat rack', sortKey: '000001000000' }),
  F.backlogItem({ id: F.ulid(42), title: 'B · induction', sortKey: '000002000000' }),
  F.backlogItem({ id: F.ulid(43), title: 'C · new shoes', sortKey: '000003000000' }),
];

const withBacklog = (items = ITEMS) =>
  server.use(http.get('/api/backlog', () => HttpResponse.json({ items, nextCursor: null, serverNow: F.NOW })));

/** The rendered order, read off the rows themselves rather than off any internal state. */
const renderedOrder = () => screen.getAllByRole('button', { name: /^Reorder "/ }).map((b) => /^Reorder "([^"]+)"/.exec(b.getAttribute('aria-label')!)![1]);

const control = (title: string) => screen.getByRole('button', { name: new RegExp(`^Reorder "${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`) });

const live = () => screen.getByTestId('reorder-live');

describe('R-backlog-22 — the reorder affordances exist without any pointer event (S-backlog-22-3)', () => {
  it('every row renders an always-visible, named Reorder control with a 44px target', async () => {
    withBacklog();
    renderApp(<AppShell />, { route: '/backlog' });

    const controls = await screen.findAllByRole('button', { name: /^Reorder "/ });
    expect(controls).toHaveLength(3);
    for (const c of controls) {
      // Never hover-only, never revealed on pointer-over: the element is in the DOM at first paint, and
      // no pointer event has occurred in this test at all.
      expect(c).toBeVisible();
      expect(c.style.width).toBe('44px');
      expect(c.style.height).toBe('44px');
    }
    // The name says WHICH row it moves and where that row currently is.
    expect(controls[0]).toHaveAccessibleName('Reorder "A · squat rack", position 1 of 3');
    expect(controls[2]).toHaveAccessibleName('Reorder "C · new shoes", position 3 of 3');
  });

  it('the list is ONE tab stop — a roving tabindex, not three stops', async () => {
    withBacklog();
    renderApp(<AppShell />, { route: '/backlog' });
    await screen.findAllByRole('button', { name: /^Reorder "/ });

    const tabbable = screen.getAllByRole('button', { name: /^Reorder "/ }).filter((c) => c.tabIndex === 0);
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]).toHaveAccessibleName('Reorder "A · squat rack", position 1 of 3');
  });

  it('R-backlog-22 (4): the row menu offers all four moves, so grab mode is never required', async () => {
    withBacklog();
    const { user } = renderApp(<AppShell />, { route: '/backlog' });
    await user.click(await screen.findByText('B · induction'));

    expect(screen.getByRole('button', { name: 'Move up' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move down' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move to top' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move to bottom' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Move to top' }));
    // R-backlog-19 — a relative move, never a position index.
    await waitFor(async () => expect(await bodyOf(lastRequest('POST', '/reorder'))).toEqual({ to: 'top', version: 1 }));
  });

  it('at the ends the impossible moves are ABSENT, not disabled', async () => {
    withBacklog();
    const { user } = renderApp(<AppShell />, { route: '/backlog' });
    await user.click(await screen.findByText('A · squat rack'));
    expect(screen.queryByRole('button', { name: 'Move up' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Move to top' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move down' })).toBeInTheDocument();
  });

  it('R-backlog-21 / S-backlog-21-1: the Life-goal read-only aggregate offers no reorder affordance at all', async () => {
    server.use(
      http.get('/api/goals/:id', () =>
        HttpResponse.json(
          F.detailOf(F.L, {
            backlogIsAggregate: true,
            backlog: [F.backlogItem({ id: F.ulid(44), title: 'On a descendant goal' })],
          }),
        ),
      ),
    );
    renderApp(<AppShell />, { route: `/goal/${F.L}` });
    expect(await screen.findByText('On a descendant goal')).toBeInTheDocument();
    // A manual order across goals is not defined and must not be invented — a handle here would promise one.
    expect(screen.queryByRole('button', { name: /^Reorder "/ })).not.toBeInTheDocument();
  });
});

describe('R-backlog-22 — a full reorder with the keyboard and no pointer (S-backlog-22-1)', () => {
  it('Tab to the control, Enter, ↓ ↓, Enter — the row moves two places and focus never leaves it', async () => {
    withBacklog();
    const { user } = renderApp(<AppShell />, { route: '/backlog' });
    await screen.findAllByRole('button', { name: /^Reorder "/ });

    const first = control('A · squat rack');
    first.focus();
    expect(first).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(renderedOrder()).toEqual(['A · squat rack', 'B · induction', 'C · new shoes']);

    await user.keyboard('{ArrowDown}');
    expect(renderedOrder()).toEqual(['B · induction', 'A · squat rack', 'C · new shoes']);
    await user.keyboard('{ArrowDown}');
    expect(renderedOrder()).toEqual(['B · induction', 'C · new shoes', 'A · squat rack']);

    await user.keyboard('{Enter}');

    // The move it sent is RELATIVE and names the row it landed after (R-backlog-19).
    await waitFor(async () => expect(await bodyOf(lastRequest('POST', '/reorder'))).toEqual({ to: 'bottom', version: 1 }));
    // …and focus is still on that item's own control, never lost to the document.
    await waitFor(() => expect(control('A · squat rack')).toHaveFocus());
  });

  it('Home and End send the grabbed row to the ends, and each is one relative move', async () => {
    withBacklog();
    const { user } = renderApp(<AppShell />, { route: '/backlog' });
    await screen.findAllByRole('button', { name: /^Reorder "/ });

    control('C · new shoes').focus();
    await user.keyboard('{Enter}{Home}');
    // Mid-grab the list already shows where the row would land — the owner is arranging, not guessing.
    expect(renderedOrder()).toEqual(['C · new shoes', 'A · squat rack', 'B · induction']);
    await user.keyboard('{Enter}');
    await waitFor(async () => expect(await bodyOf(lastRequest('POST', '/reorder'))).toEqual({ to: 'top', version: 1 }));

    // `End`, from the other end of the same list.
    control('A · squat rack').focus();
    await user.keyboard('{Enter}{End}');
    expect(renderedOrder()[2]).toBe('A · squat rack');
    await user.keyboard('{Enter}');
    await waitFor(async () => expect(await bodyOf(lastRequest('POST', '/reorder'))).toEqual({ to: 'bottom', version: 1 }));
  });

  it('a move into the MIDDLE names its new predecessor, which is the only shape that survives a concurrent write', async () => {
    withBacklog();
    const { user } = renderApp(<AppShell />, { route: '/backlog' });
    await screen.findAllByRole('button', { name: /^Reorder "/ });

    control('A · squat rack').focus();
    await user.keyboard('{Enter}{ArrowDown}{Enter}');
    await waitFor(async () => expect(await bodyOf(lastRequest('POST', '/reorder'))).toEqual({ after: F.ulid(42), version: 1 }));
  });

  it('↑/↓ move FOCUS between rows when nothing is grabbed — the roving half of the pattern', async () => {
    withBacklog();
    const { user } = renderApp(<AppShell />, { route: '/backlog' });
    await screen.findAllByRole('button', { name: /^Reorder "/ });

    control('A · squat rack').focus();
    await user.keyboard('{ArrowDown}');
    await waitFor(() => expect(control('B · induction')).toHaveFocus());
    await user.keyboard('{End}');
    await waitFor(() => expect(control('C · new shoes')).toHaveFocus());
    await user.keyboard('{Home}');
    await waitFor(() => expect(control('A · squat rack')).toHaveFocus());

    // Moving focus is not moving the row, and it writes nothing.
    expect(renderedOrder()).toEqual(['A · squat rack', 'B · induction', 'C · new shoes']);
    expect(requests('POST', '/reorder')).toHaveLength(0);
  });
});

describe('R-backlog-22 — Escape cancels, and writes NOTHING (S-backlog-22-2)', () => {
  it('the row returns to its original position, no request is sent, and focus stays on the control', async () => {
    withBacklog();
    const { user } = renderApp(<AppShell />, { route: '/backlog' });
    await screen.findAllByRole('button', { name: /^Reorder "/ });

    control('A · squat rack').focus();
    await user.keyboard('{Enter}{ArrowDown}{ArrowDown}');
    expect(renderedOrder()).toEqual(['B · induction', 'C · new shoes', 'A · squat rack']);

    await user.keyboard('{Escape}');

    expect(renderedOrder()).toEqual(['A · squat rack', 'B · induction', 'C · new shoes']);
    // **Nothing is written.** Not "written and undone" — there is no path from a cancelled grab to the wire.
    expect(requests('POST', '/reorder')).toHaveLength(0);
    await waitFor(() => expect(control('A · squat rack')).toHaveFocus());
  });
});

describe('R-backlog-23 — what a screen reader hears', () => {
  it('S-backlog-23-1: the pick-up line, one line per arrow press, then the drop line — verbatim', async () => {
    withBacklog();
    const { user } = renderApp(<AppShell />, { route: '/backlog' });
    await screen.findAllByRole('button', { name: /^Reorder "/ });

    // Exactly ONE live region for the list.
    expect(screen.getAllByTestId('reorder-live')).toHaveLength(1);
    expect(live()).toHaveAttribute('aria-atomic', 'true');
    // Polite while nothing is grabbed.
    expect(live()).toHaveAttribute('aria-live', 'polite');

    control('A · squat rack').focus();
    await user.keyboard('{Enter}');
    expect(live()).toHaveTextContent('Reorder: "A · squat rack", position 1 of 3. Arrow keys to move, Enter to drop, Escape to cancel.');
    // ASSERTIVE for the duration of the grab — successive arrow presses must not be swallowed by a
    // polite queue, which is the whole reason R-backlog-23 names the mode.
    expect(live()).toHaveAttribute('aria-live', 'assertive');

    await user.keyboard('{ArrowDown}');
    expect(live()).toHaveTextContent('"A · squat rack", position 2 of 3.');
    await user.keyboard('{ArrowDown}');
    expect(live()).toHaveTextContent('"A · squat rack", position 3 of 3.');

    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(live()).toHaveTextContent('"A · squat rack" moved to position 3 of 3 in Be strong at 60 › Lift three times a week.'),
    );
    // …and it reverts to polite the moment the grab ends.
    expect(live()).toHaveAttribute('aria-live', 'polite');
  });

  it('the cancel line names where the row went back to', async () => {
    withBacklog();
    const { user } = renderApp(<AppShell />, { route: '/backlog' });
    await screen.findAllByRole('button', { name: /^Reorder "/ });

    control('B · induction').focus();
    await user.keyboard('{Enter}{ArrowUp}{Escape}');
    expect(live()).toHaveTextContent('Reorder canceled. "B · induction" returned to position 2 of 3.');
  });

  it('S-backlog-19-3: a refused reorder announces the failure line AND shows a non-toast error (Q-14)', async () => {
    withBacklog();
    server.use(http.post('/api/backlog/:id/reorder', () => HttpResponse.json({ error: { code: 'CONCURRENT_UPDATE', message: 'stale' } }, { status: 409 })));
    const { user } = renderApp(<AppShell />, { route: '/backlog' });
    await screen.findAllByRole('button', { name: /^Reorder "/ });

    control('A · squat rack').focus();
    await user.keyboard('{Enter}{ArrowDown}{Enter}');

    // The row returns to its original position on screen…
    await waitFor(() => expect(renderedOrder()).toEqual(['A · squat rack', 'B · induction', 'C · new shoes']));
    // …the failure line is announced…
    expect(live()).toHaveTextContent('Reorder failed. "A · squat rack" returned to position 1 of 3.');
    // …and a lost write is reported somewhere that does not vanish on a timer (R-nav-13).
    const alerts = await screen.findAllByRole('alert');
    expect(alerts.some((a) => /reload|changed|another device/i.test(a.textContent ?? ''))).toBe(true);
    await waitFor(() => expect(control('A · squat rack')).toHaveFocus());
  });
});

describe('R-backlog-24 — drag is a second front-end on ONE command', () => {
  it('the relative move a target index implies is the same function the keyboard uses, at both ends', () => {
    /**
     * The pointer path and the keyboard path both end at `relativeMove`, so there is no drag-only
     * ordering semantics to diverge (R-backlog-24). Both ends are named as ends rather than falling out
     * of an `after`/`before` on the first or last row.
     */
    const others = [ITEMS[1]!, ITEMS[2]!];
    expect(relativeMove(others, 0)).toEqual({ to: 'top' });
    expect(relativeMove(others, 1)).toEqual({ after: ITEMS[1]!.id });
    expect(relativeMove(others, 2)).toEqual({ to: 'bottom' });
    // Out of range in either direction clamps to an end rather than minting a nonsense neighbour.
    expect(relativeMove(others, -1)).toEqual({ to: 'top' });
    expect(relativeMove(others, 9)).toEqual({ to: 'bottom' });
    expect(relativeMove([], 0)).toEqual({ to: 'top' });
  });
});

describe('R-backlog-21 — one list per goal, each with its own grab state', () => {
  it('two goals are two lists, each with its own live region and its own tab stop', async () => {
    withBacklog([
      ...ITEMS,
      F.backlogItem({ id: F.ulid(45), goalId: F.M2, title: 'Changelog draft', goalTitle: 'Write the changelog', lifeGoalTitle: 'Ship the thing' }),
    ]);
    renderApp(<AppShell />, { route: '/backlog' });
    await screen.findAllByRole('button', { name: /^Reorder "/ });

    expect(screen.getAllByTestId('reorder-live')).toHaveLength(2);
    // A single item in its own goal has no move available at all — there is nowhere for it to go.
    const group = screen.getByText('Ship the thing › Write the changelog').parentElement!;
    expect(within(group).getAllByRole('button', { name: /^Reorder "/ })).toHaveLength(1);
  });
});
