import type { DeleteGoalResponse } from '@goal-cascade/shared';
import { describe, expect, it } from 'vitest';
import { createTestApp, signedInOwner } from '../helpers/app';
import {
  backlogOf,
  codeOf,
  createGoal,
  detailsOf,
  focusesUnder,
  goalsIn,
  learningsOf,
  makeLine,
  savePlan,
  seedBacklogItem,
  seedLearning,
  seedTask,
  tasksUnder,
} from './fixtures';

/**
 * Q-5 — goal deletion. Nothing in the mockup defined it, so this is the whole rule in one file:
 * the subtree goes transactionally, Learning tags null out to Unsorted instead of cascading, and
 * `?cascade=true` is the explicit acknowledgement the client's confirmation sheet is built on.
 */
const t = createTestApp({ now: '2026-08-31T10:00:00.000Z' });

const del = (cookie: string, id: string, cascade = false) =>
  t.fetch(`/api/goals/${id}${cascade ? '?cascade=true' : ''}`, { method: 'DELETE', cookie });

describe('Q-5 — deleting a goal that has children', () => {
  it('S-goal-Q5-1 — WITHOUT `cascade` it is refused with GOAL_HAS_CHILDREN and the counts in `details`', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const { life, quarterly, monthly } = await makeLine(t, cookie);
    await seedTask(t, userId, monthly.id, '2026-08-31');
    await seedBacklogItem(t, userId, quarterly.id);

    const res = await del(cookie, life.id);
    expect(res.status).toBe(409);
    const body = (await res.clone().json()) as { error: { code: string } };
    expect(body.error.code).toBe('GOAL_HAS_CHILDREN');
    // exactly what the client needs to render "N sub-goals, M tasks, K backlog items"
    expect(await detailsOf(res)).toMatchObject({ subGoals: 4, tasks: 1, backlogItems: 1 });

    // …and NOTHING was written: the refusal is not a half-applied delete.
    expect((await goalsIn(t, cookie)).length).toBe(5);
    expect(await tasksUnder(t, userId, [monthly.id])).toHaveLength(1);
  });

  it('S-goal-Q5-2 — WITH `cascade=true` the whole subtree goes in one transaction, and the counts come back', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const { life, yearly, quarterly, monthly, yearly2 } = await makeLine(t, cookie);
    await savePlan(t, cookie, '2026-08-31', [{ goalId: monthly.id, sentence: 'live branch' }]);
    await seedTask(t, userId, monthly.id, '2026-08-24');
    await seedTask(t, userId, yearly2.id, '2026-08-31');
    await seedBacklogItem(t, userId, quarterly.id);
    await seedBacklogItem(t, userId, monthly.id);

    const res = await del(cookie, life.id, true);
    expect(res.status).toBe(200);
    const body = (await res.json()) as DeleteGoalResponse;
    expect(body.deleted).toBe(true);
    expect(body.removed).toMatchObject({ goals: 5, weeklyFocuses: 1, tasks: 2, backlogItems: 2 });

    expect(await goalsIn(t, cookie)).toHaveLength(0);
    expect(await tasksUnder(t, userId, [life.id, yearly.id, quarterly.id, monthly.id, yearly2.id])).toHaveLength(0);
    expect(await focusesUnder(t, userId, [monthly.id])).toHaveLength(0);
    expect(await backlogOf(t, userId)).toHaveLength(0);
  });

  it('Q-5 — Learning tags pointing INTO the deleted subtree fall back to Unsorted, not away', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const doomed = await createGoal(t, cookie, { title: 'Doomed line', horizon: 'Life' });
    const survivor = await createGoal(t, cookie, { title: 'Surviving line', horizon: 'Life' });
    await seedLearning(t, userId, doomed.id, 'learned here');
    await seedLearning(t, userId, survivor.id, 'learned elsewhere');

    const body = (await (await del(cookie, doomed.id, true)).json()) as DeleteGoalResponse;
    expect(body.untagged).toEqual({ learnings: 1 });

    const learnings = await learningsOf(t, userId);
    expect(learnings).toHaveLength(2); // neither learning was deleted
    expect(learnings.find((l) => l.text === 'learned here')!.goalId).toBeNull();
    expect(learnings.find((l) => l.text === 'learned elsewhere')!.goalId).toBe(survivor.id);
  });

  it('a childless goal needs no acknowledgement, and only its own subtree goes', async () => {
    const { cookie } = await signedInOwner(t);
    const { life, yearly, quarterly, monthly, yearly2 } = await makeLine(t, cookie);

    const res = await del(cookie, monthly.id);
    expect(res.status).toBe(200);
    expect(((await res.json()) as DeleteGoalResponse).removed.goals).toBe(1);

    const after = await goalsIn(t, cookie);
    expect(after.map((g) => g.id)).toEqual([life.id, yearly.id, quarterly.id, yearly2.id]);
    // Q is a leaf again now that its only child is gone — and therefore focusable again.
    expect(after.find((g) => g.id === quarterly.id)!.isLeaf).toBe(true);
  });

  it('R-auth-2/3 — another owner’s goal cannot be deleted, and answers like one that never existed', async () => {
    const a = await signedInOwner(t);
    const b = await signedInOwner(t);
    const theirs = await makeLine(t, b.cookie);
    const res = await del(a.cookie, theirs.life.id, true);
    expect(res.status).toBe(404);
    expect(await codeOf(res)).toBe('NOT_FOUND');
    expect(await goalsIn(t, b.cookie)).toHaveLength(5);
  });
});
