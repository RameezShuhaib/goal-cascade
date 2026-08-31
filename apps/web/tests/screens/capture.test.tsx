import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { IdeaView, LearningView } from '@goal-cascade/shared';
import { AppShell } from '../../src/AppShell';
import { renderApp } from '../render';
import { apiError, bodyOf, lastRequest, requests, server } from '../msw/handlers';
import * as F from '../msw/fixtures';

/**
 * Ideas and Learnings — two-second capture, and the tap actions on what was captured.
 *
 * D-22 is the one that mattered most here: the mockup deleted an idea from the list and THEN opened the
 * create modal, so cancelling lost it permanently — in the one feature whose whole promise is "capture it
 * and get back to work". Conversion is now one command that consumes the idea only on success.
 */

function withCapture({
  ideas = [] as IdeaView[],
  learnings = [] as LearningView[],
  over = {} as Record<string, Partial<ReturnType<typeof F.goal>>>,
} = {}) {
  server.use(
    http.get('/api/goals', () => HttpResponse.json(F.treeResponse(over))),
    http.get('/api/ideas', () => HttpResponse.json({ ideas, serverNow: F.NOW })),
    http.get('/api/learnings', () => HttpResponse.json({ learnings, serverNow: F.NOW })),
  );
}

const go = async (user: ReturnType<typeof renderApp>['user'], tab: 'Ideas' | 'Learnings') =>
  user.click(await screen.findByRole('button', { name: tab }));

describe('Ideas', () => {
  it('R-idea-1/2/8: capturing an idea, tagged to a Life goal or to nothing', async () => {
    withCapture();
    const { user } = renderApp(<AppShell />);
    await go(user, 'Ideas');

    expect(await screen.findByText('Nothing parked.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Park an idea'), 'Try the 5am gym slot for a week');
    // R-idea-2 / S-idea-2-1 — the chip row is `No goal` plus Life goals. A non-Life goal is not offered,
    // and would be refused with `NOT_A_LIFE_GOAL` if it were sent.
    expect(screen.queryByRole('button', { name: 'Rebuild the gym habit' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Be strong at 60' }));
    await user.click(screen.getByRole('button', { name: 'Park it' }));

    await waitFor(async () => {
      const body = await bodyOf(lastRequest('POST', '/api/ideas'));
      expect(body).toMatchObject({ text: 'Try the 5am gym slot for a week', goalId: F.L });
      // Q-8 — no `'k' + Date.now()`.
      expect(body).not.toHaveProperty('id');
    });
  });

  it('S-idea-5-1: attaching sends it to a NON-Life goal’s backlog, in one command, and names the goal', async () => {
    withCapture({ ideas: [F.idea()] });
    const { user } = renderApp(<AppShell />);
    await go(user, 'Ideas');

    await user.click(await screen.findByText('Try the 5am gym slot for a week'));
    await user.click(screen.getByRole('button', { name: 'Attach to a goal' }));
    expect(screen.getByText("SEND TO WHICH GOAL'S BACKLOG?")).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Rebuild the gym habit' }));

    await waitFor(async () => expect(await bodyOf(lastRequest('POST', '/attach'))).toMatchObject({ goalId: F.Q }));
    expect(await screen.findByRole('status')).toHaveTextContent('Moved to Backlog under Rebuild the gym habit');
    // One transaction: the mockup created the item and then deleted the idea, and persisted neither.
    expect(requests('POST', '/api/backlog')).toHaveLength(0);
    expect(requests('DELETE', '/api/ideas')).toHaveLength(0);
  });

  it('S-idea-4-1: "Task this week" converts through the idea’s own endpoint', async () => {
    withCapture({ ideas: [F.idea()] });
    const { user } = renderApp(<AppShell />);
    await go(user, 'Ideas');

    await user.click(await screen.findByText('Try the 5am gym slot for a week'));
    await user.click(screen.getByRole('button', { name: 'Task this week' }));
    expect(await screen.findByLabelText('Task title')).toHaveValue('Try the 5am gym slot for a week');
    await user.click(screen.getByRole('button', { name: 'Save task' }));

    await waitFor(async () => {
      const req = lastRequest('POST', '/convert-to-task');
      expect(req?.url).toContain('/api/ideas/');
      expect(await bodyOf(req)).toMatchObject({ goalId: F.M, title: 'Try the 5am gym slot for a week' });
    });
  });

  it('S-idea-4-2 / D-22: dismissing the modal loses nothing — the idea is still there', async () => {
    withCapture({ ideas: [F.idea()] });
    const { user } = renderApp(<AppShell />);
    await go(user, 'Ideas');

    await user.click(await screen.findByText('Try the 5am gym slot for a week'));
    await user.click(screen.getByRole('button', { name: 'Task this week' }));
    await user.click(await screen.findByTestId('sheet-overlay'));

    expect(screen.getByText('Try the 5am gym slot for a week')).toBeInTheDocument();
    expect(requests('POST', '/convert-to-task')).toHaveLength(0);
    expect(requests('DELETE', '/api/ideas')).toHaveLength(0);
  });

  it('S-idea-4-3: with no leaf active the owner is routed to planning, never to a fallback goal', async () => {
    withCapture({ ideas: [F.idea()], over: { [F.M]: { isActive: false, focus: '', dormant: true, subtreeActive: false } } });
    const { user } = renderApp(<AppShell />);
    await go(user, 'Ideas');

    await user.click(await screen.findByText('Try the 5am gym slot for a week'));
    await user.click(screen.getByRole('button', { name: 'Task this week' }));

    expect(await screen.findByText("This branch isn't active this week")).toBeInTheDocument();
    expect(requests('POST', '/convert-to-task')).toHaveLength(0);
  });

  it('S-idea-7-1: an idea whose tagged goal is gone renders under Unsorted, not nowhere', async () => {
    withCapture({ ideas: [F.idea({ goalId: F.ulid(99) })] });
    const { user } = renderApp(<AppShell />);
    await go(user, 'Ideas');
    expect(await screen.findByText('Unsorted')).toBeInTheDocument();
    expect(screen.getByText('Try the 5am gym slot for a week')).toBeInTheDocument();
  });

  it('R-idea-6: Delete is a server call now, not an array splice a reload would undo', async () => {
    withCapture({ ideas: [F.idea()] });
    const { user } = renderApp(<AppShell />);
    await go(user, 'Ideas');

    await user.click(await screen.findByText('Try the 5am gym slot for a week'));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(lastRequest('DELETE', '/api/ideas/')?.url).toContain(F.ulid(50)));
  });
});

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
