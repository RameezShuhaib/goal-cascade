import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { AppShell } from '../../src/AppShell';
import { renderApp } from '../render';
import { apiError, bodyOf, lastRequest, requests, server } from '../msw/handlers';
import * as F from '../msw/fixtures';

/**
 * Weekly planning — the current week, whole, in one transaction.
 *
 * The two things worth pinning are the ones the mockup got wrong: the save names its `weekStart`
 * explicitly (R-plan-2 / Q-3, so a Monday boundary crossed mid-edit fails loudly rather than writing into
 * the wrong week), and a leaf checked with a blank sentence does not silently vanish (D-9).
 */

function withPlan(over: Record<string, Partial<ReturnType<typeof F.goal>>> = {}, items = [F.backlogItem()]) {
  server.use(
    http.get('/api/goals', () => HttpResponse.json(F.treeResponse(over))),
    http.get('/api/plan', () => HttpResponse.json(F.planResponse())),
    http.get('/api/backlog', () => HttpResponse.json({ items, serverNow: F.NOW })),
  );
}

async function openPlan(user: ReturnType<typeof renderApp>['user']) {
  await user.click(await screen.findByRole('button', { name: 'Edit plan' }));
  return screen.findByText('Weekly planning');
}

describe('Plan — activating and clearing a weekly focus', () => {
  it('S-plan-5-1: checking a dormant leaf and writing a sentence activates it', async () => {
    withPlan();
    const { user } = renderApp(<AppShell />);
    await openPlan(user);

    await user.click(screen.getByRole('button', { name: 'Activate Sleep before midnight' }));
    await user.type(screen.getByLabelText('Focus for Sleep before midnight'), 'Lights out by 23:30, five nights.');
    await user.click(screen.getByRole('button', { name: 'Save plan' }));

    await waitFor(async () => {
      const body = await bodyOf(lastRequest('PUT', '/api/plan'));
      // The absolute Monday, from the read model — not "now" (D-1, Q-3).
      expect(body).toMatchObject({ weekStart: F.THIS_MONDAY });
      expect(body?.entries).toEqual(
        expect.arrayContaining([{ goalId: F.D, sentence: 'Lights out by 23:30, five nights.' }]),
      );
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Plan saved');
  });

  it('S-plan-6-1 / S-plan-7-1: unchecking a leaf clears it — a whole-week replace, in one call', async () => {
    withPlan();
    const { user } = renderApp(<AppShell />);
    await openPlan(user);

    await user.click(screen.getByRole('button', { name: 'Deactivate Lift three times a week' }));
    await user.click(screen.getByRole('button', { name: 'Activate Sleep before midnight' }));
    await user.type(screen.getByLabelText('Focus for Sleep before midnight'), 'Lights out by 23:30.');
    await user.click(screen.getByRole('button', { name: 'Save plan' }));

    await waitFor(async () => {
      const body = await bodyOf(lastRequest('PUT', '/api/plan'));
      // R-plan-7 — a leaf absent from `entries` has its focus for the week removed. One request, one
      // transaction: the mockup mapped over a local array and called `persist` afterwards.
      expect(body?.entries).toEqual([{ goalId: F.D, sentence: 'Lights out by 23:30.' }]);
    });
    expect(requests('PUT', '/api/plan')).toHaveLength(1);
  });

  it('S-plan-5-2 / D-9: a checked branch with no sentence is flagged, not silently dropped', async () => {
    withPlan();
    const { user } = renderApp(<AppShell />);
    await openPlan(user);

    await user.click(screen.getByRole('button', { name: 'Activate Sleep before midnight' }));
    await user.click(screen.getByRole('button', { name: 'Save plan' }));

    expect(await screen.findByText('A checked branch needs a focus sentence to stick.')).toBeInTheDocument();
    // Nothing was written, and no "Plan saved" was claimed.
    expect(requests('PUT', '/api/plan')).toHaveLength(0);
    expect(screen.queryByText('Plan saved')).not.toBeInTheDocument();
  });

  it('S-plan-2-1: a save that crossed a Monday boundary fails loudly', async () => {
    withPlan();
    server.use(http.put('/api/plan', () => apiError('WEEK_NOT_CURRENT')));
    const { user } = renderApp(<AppShell />);
    await openPlan(user);

    await user.click(screen.getByRole('button', { name: 'Save plan' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The week rolled over while you were planning');
    expect(screen.queryByText('Plan saved')).not.toBeInTheDocument();
  });
});

describe('Plan — pull-based planning', () => {
  const onQ = F.backlogItem({ id: F.ulid(41), goalId: F.Q, title: 'Find a squat rack free at 7am' });
  const onM = F.backlogItem({ id: F.ulid(42), goalId: F.M, title: 'Buy lifting shoes' });
  const elsewhere = F.backlogItem({ id: F.ulid(43), goalId: F.Y2, title: 'Draft the release notes' });

  it('S-plan-9-1: the pull list is the leaf and its ancestors, and nothing from another line', async () => {
    withPlan({}, [onQ, onM, elsewhere]);
    const { user } = renderApp(<AppShell />);
    await openPlan(user);

    expect(await screen.findByRole('button', { name: '+ Find a squat rack free at 7am' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Buy lifting shoes' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Draft the release notes' })).not.toBeInTheDocument();
  });

  it('S-plan-9-2: tapping one opens the create sheet pre-filled and bound to that leaf', async () => {
    withPlan({}, [onQ]);
    const { user } = renderApp(<AppShell />);
    await openPlan(user);

    await user.click(await screen.findByRole('button', { name: '+ Find a squat rack free at 7am' }));
    expect(await screen.findByRole('dialog', { name: 'New task' })).toBeInTheDocument();
    expect(screen.getByLabelText('Task title')).toHaveValue('Find a squat rack free at 7am');
    // R-backlog-7 — bound to the leaf whose card it was tapped under, so there is nothing to resolve.
    expect(screen.getByLabelText('Weekly focus')).toHaveValue(F.M);
  });

  it('R-plan-10: the pull list is hidden for an unchecked leaf', async () => {
    withPlan({}, [onM]);
    const { user } = renderApp(<AppShell />);
    await openPlan(user);

    expect(await screen.findByRole('button', { name: '+ Buy lifting shoes' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Deactivate Lift three times a week' }));
    expect(screen.queryByRole('button', { name: '+ Buy lifting shoes' })).not.toBeInTheDocument();
  });
});
