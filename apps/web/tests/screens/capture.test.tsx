import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { LearningView } from '@goal-cascade/shared';
import { AppShell } from '../../src/AppShell';
import { renderApp } from '../render';
import { apiError, bodyOf, lastRequest, requests, server } from '../msw/handlers';
import * as F from '../msw/fixtures';

/**
 * Learnings — two-second capture, and the tap actions on what was captured.
 */

/**
 * ⚠ **A2** — the chip row's goals come from the **Life lens** now, not from a filtered whole tree: the
 * Life lens is the one unscoped read in the product (R-lens-2) and a Learning tags a Life goal or nothing
 * (R-learning-2), so it is the same list by a cheaper route.
 */
function withCapture({ learnings = [] as LearningView[] } = {}) {
  server.use(http.get('/api/learnings', () => HttpResponse.json({ learnings, nextCursor: null, serverNow: F.NOW })));
}

const go = async (user: ReturnType<typeof renderApp>['user'], tab: 'Learnings') =>
  user.click(await screen.findByRole('button', { name: tab }));

describe('Learnings', () => {
  it('R-learning-1/7: capturing a learning', async () => {
    withCapture();
    const { user } = renderApp(<AppShell />);
    await go(user, 'Learnings');

    expect(await screen.findByText('No learnings yet.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('What did you learn?'), 'Evening sessions never survive a busy week');
    await user.click(screen.getByRole('button', { name: 'Capture it' }));

    await waitFor(async () => {
      const body = await bodyOf(lastRequest('POST', '/api/learnings'));
      expect(body).toMatchObject({ text: 'Evening sessions never survive a busy week', goalId: null, applied: false });
      expect(body).not.toHaveProperty('id');
    });
  });

  it('S-learning-4-1 / D-23: the "changed the plan" badge is earnable by an explicit action', async () => {
    // Stateful, so the invalidation that follows the patch reads back what the server actually holds —
    // a badge that only survives until the next refetch would not be a badge.
    const state = { applied: false };
    withCapture({ learnings: [F.learning({ goalId: F.L })] });
    server.use(
      http.get('/api/learnings', () => HttpResponse.json({ learnings: [F.learning({ goalId: F.L, applied: state.applied })], nextCursor: null, serverNow: F.NOW })),
      http.patch('/api/learnings/:id', () => {
        state.applied = true;
        return HttpResponse.json({ learning: F.learning({ goalId: F.L, applied: true }), serverNow: F.NOW });
      }),
    );
    const { user } = renderApp(<AppShell />);
    await go(user, 'Learnings');

    await user.click(await screen.findByText('“Evening sessions never survive a busy week”'));
    await user.click(screen.getByRole('button', { name: 'Changed the plan' }));

    await waitFor(async () => expect(await bodyOf(lastRequest('PATCH', '/api/learnings/'))).toMatchObject({ applied: true }));
    expect(await screen.findByText('changed the plan')).toBeInTheDocument();
  });

  it('S-learning-3-1: re-tagging to "No goal" moves it to Unsorted', async () => {
    withCapture({ learnings: [F.learning({ goalId: F.L })] });
    const { user } = renderApp(<AppShell />);
    await go(user, 'Learnings');

    await user.click(await screen.findByText('“Evening sessions never survive a busy week”'));
    await user.click(screen.getByRole('button', { name: 'Attach to a goal' }));
    // Two `No goal` rows exist by design: the capture form's picker and this card's re-tag picker.
    // ⚠ **R-nav-31** — they are `role="option"` rows in a listbox now, not chips: the selection is
    // announced rather than merely coloured (R-lens-13's one surviving requirement).
    const rows = screen.getAllByRole('option', { name: 'No goal' });
    await user.click(rows[rows.length - 1]!);

    await waitFor(async () => expect(await bodyOf(lastRequest('POST', '/learnings/'))).toMatchObject({ goalId: null }));
  });

  it('R-learning-2: a non-Life goal is never offered as a tag', async () => {
    withCapture({ learnings: [F.learning()] });
    const { user } = renderApp(<AppShell />);
    await go(user, 'Learnings');

    await screen.findByText('“Evening sessions never survive a busy week”');
    expect(screen.queryByRole('option', { name: /^Rebuild the gym habit/ })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Be strong at 60 — Life goal' })).toBeInTheDocument();
  });

  it('R-learning-2: a refused tag is stated, not swallowed', async () => {
    withCapture();
    server.use(http.post('/api/learnings', () => apiError('NOT_A_LIFE_GOAL')));
    const { user } = renderApp(<AppShell />);
    await go(user, 'Learnings');

    await user.type(await screen.findByLabelText('What did you learn?'), 'Something');
    await user.click(screen.getByRole('button', { name: 'Capture it' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('tag a Life goal, or nothing at all');
  });
});
