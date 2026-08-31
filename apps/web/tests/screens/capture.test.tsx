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

function withCapture({
  learnings = [] as LearningView[],
  over = {} as Record<string, Partial<ReturnType<typeof F.goal>>>,
} = {}) {
  server.use(
    http.get('/api/goals', () => HttpResponse.json(F.treeResponse(over))),
    http.get('/api/learnings', () => HttpResponse.json({ learnings, serverNow: F.NOW })),
  );
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
      http.get('/api/learnings', () => HttpResponse.json({ learnings: [F.learning({ goalId: F.L, applied: state.applied })], serverNow: F.NOW })),
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
    // Two `No goal` chips exist by design: the capture form's tag row and this card's re-tag row.
    const chips = screen.getAllByRole('button', { name: 'No goal' });
    await user.click(chips[chips.length - 1]!);

    await waitFor(async () => expect(await bodyOf(lastRequest('POST', '/learnings/'))).toMatchObject({ goalId: null }));
  });

  it('R-learning-2: a non-Life goal is never offered as a tag', async () => {
    withCapture({ learnings: [F.learning()] });
    const { user } = renderApp(<AppShell />);
    await go(user, 'Learnings');

    await screen.findByText('“Evening sessions never survive a busy week”');
    expect(screen.queryByRole('button', { name: 'Rebuild the gym habit' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Be strong at 60' })).toBeInTheDocument();
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
