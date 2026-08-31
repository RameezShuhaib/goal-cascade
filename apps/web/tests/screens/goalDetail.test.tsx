import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { AppShell } from '../../src/AppShell';
import { renderApp } from '../render';
import { bodyOf, lastRequest, server } from '../msw/handlers';
import * as F from '../msw/fixtures';

/**
 * The goal detail screen, and the two very different backlog blocks it can show (R-backlog-11/12).
 *
 * Which one appears is the SERVER's decision, carried in `backlogIsAggregate` — the client never works it
 * out from the goal's own shape.
 */

function withDetail(id: string, extra: Parameters<typeof F.detailOf>[1] = {}) {
  server.use(
    http.get('/api/goals', () => HttpResponse.json(F.treeResponse())),
    http.get('/api/goals/:id', () => HttpResponse.json(F.detailOf(id, extra))),
    http.get('/api/tasks', () => HttpResponse.json({ week: F.week(), tasks: [], plan: [F.planEntry()], serverNow: F.NOW })),
  );
}

async function open(user: ReturnType<typeof renderApp>['user'], title: string) {
  await user.click(await screen.findByRole('button', { name: 'Goals' }));
  const hits = await screen.findAllByText(title);
  await user.click(hits[hits.length - 1]!);
  return screen.findByRole('heading', { level: 1 });
}

describe('Goal detail', () => {
  it('S-backlog-11-1: a non-Life goal shows its OWN items, with the three actions and + Add', async () => {
    withDetail(F.Q, {
      backlog: [
        F.backlogItem({ id: F.ulid(41), goalId: F.Q, title: 'Find a squat rack free at 7am' }),
        F.backlogItem({ id: F.ulid(42), goalId: F.Q, title: 'Book an induction' }),
      ],
      backlogIsAggregate: false,
    });
    const { user } = renderApp(<AppShell />);
    await open(user, 'Rebuild the gym habit');

    expect(await screen.findByText('Backlog (2)')).toBeInTheDocument();
    await user.click(screen.getByText('Find a squat rack free at 7am'));
    // D-20 — the same three actions the Backlog page offers. In the mockup this screen had only two.
    expect(screen.getByRole('button', { name: 'Add to this week' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move to another goal' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '+ Add' }));
    await user.type(screen.getByLabelText('Backlog item'), 'Ask about the 7am slot{Enter}');
    await waitFor(async () => expect(await bodyOf(lastRequest('POST', '/api/backlog'))).toMatchObject({ goalId: F.Q, title: 'Ask about the 7am slot' }));
  });

  it('S-backlog-12-1: a Life goal shows a READ-ONLY roll-up, labelled by owning goal', async () => {
    withDetail(F.L, {
      backlog: [F.backlogItem({ id: F.ulid(41), goalId: F.Q, title: 'Find a squat rack free at 7am' })],
      backlogIsAggregate: true,
    });
    const { user } = renderApp(<AppShell />);
    await open(user, 'Be strong at 60');

    expect(await screen.findByText('Backlog across this line (1)')).toBeInTheDocument();
    expect(screen.getByText('Rebuild the gym habit · added Today')).toBeInTheDocument();
    await user.click(screen.getByText('Find a squat rack free at 7am'));
    // No per-item action here at all — only the way out.
    expect(screen.queryByRole('button', { name: 'Add to this week' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Backlog →' })).toBeInTheDocument();
  });

  it('S-backlog-12-2: the Life-goal empty state says the line is clear', async () => {
    withDetail(F.L, { backlog: [], backlogIsAggregate: true });
    const { user } = renderApp(<AppShell />);
    await open(user, 'Be strong at 60');
    expect(await screen.findByText('Nothing deferred anywhere on this line.')).toBeInTheDocument();
  });

  it('S-goal-10-1: a dormant leaf states its dormancy and where to change it', async () => {
    withDetail(F.D);
    const { user } = renderApp(<AppShell />);
    await open(user, 'Sleep before midnight');

    expect(await screen.findByText('DORMANT')).toBeInTheDocument();
    expect(screen.getByText('No weekly focus this week. Activate it in weekly planning.')).toBeInTheDocument();
    // R-goal-6 — and Monthly is terminal, so there is no sub-goal affordance here either.
    expect(screen.queryByRole('button', { name: '+ Add sub-goal' })).not.toBeInTheDocument();
  });

  it('S-learning-5-1: the learnings shown are the whole Life LINE’s, and the breadcrumb walks back up', async () => {
    withDetail(F.Q, { learnings: [F.learning({ goalId: F.L, applied: true })] });
    const { user } = renderApp(<AppShell />);
    await open(user, 'Rebuild the gym habit');

    expect(await screen.findByText('“Evening sessions never survive a busy week”')).toBeInTheDocument();
    expect(screen.getByText('changed the plan')).toBeInTheDocument();
    // R-goal-27 — breadcrumbs to the root.
    expect(screen.getByRole('button', { name: 'Be strong at 60' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Get back under 80kg' })).toBeInTheDocument();
  });

  it('R-goal-27: an active leaf shows its focus block and a + Task', async () => {
    withDetail(F.M);
    const { user } = renderApp(<AppShell />);
    await open(user, 'Lift three times a week');

    expect(await screen.findByText('Weekly focus')).toBeInTheDocument();
    expect(screen.getByText('Three sessions, no excuses.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Task' })).toBeInTheDocument();
  });
});
