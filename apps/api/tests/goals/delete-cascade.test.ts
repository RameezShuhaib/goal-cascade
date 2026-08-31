import type { DeleteGoalResponse } from '@goal-cascade/shared';
import { describe, expect, it } from 'vitest';
import { createTestApp, signedInOwner } from '../helpers/app';
import {
  allGoalsRaw,
  backlogOf,
  codeOf,
  createGoal,
  detailsOf,
  learningsOf,
  lens,
  makeLine,
  seedBacklogItem,
  seedLearning,
  seedTask,
  tasksUnder,
} from './fixtures';

/**
 * Q-5 / R-task-47 — goal deletion. Nothing in the mockup defined it, so this is the whole rule in one
 * file: the subtree goes transactionally, Learning tags null out to Unsorted instead of cascading, and
 * `?cascade=true` is the explicit acknowledgement the client's confirmation sheet is built on.
 *
 * ⚠ **A2** — the cascade needed no change to cover the new level, because it is defined over the SUBTREE
 * and not over a fixed depth (R-task-47). What changed is what it reads and what it reports: the subtree
 * comes from one recursive CTE rather than a whole-table walk (R-lens-27), `weeklyFocuses` is gone with
 * the entity (R-rm-2), and `weeklyGoals` replaces it — deleting a Monthly goal takes its Weekly children
 * and all of their tasks, so that is the number that can be large.
 */
const t = createTestApp({ now: '2026-08-31T10:00:00.000Z' });

const del = (cookie: string, id: string, cascade = false) =>
  t.fetch(`/api/goals/${id}${cascade ? '?cascade=true' : ''}`, { method: 'DELETE', cookie });

describe('Q-5 — deleting a goal that has children', () => {
  it('S-goal-Q5-1 — WITHOUT `cascade` it is refused with GOAL_HAS_CHILDREN and the counts in `details`', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const { life, quarterly, weekly } = await makeLine(t, cookie);
    await seedTask(t, userId, weekly.id, '2026-08-31');
    await seedBacklogItem(t, userId, quarterly.id);

    const res = await del(cookie, life.id);
    expect(res.status).toBe(409);
    const body = (await res.clone().json()) as { error: { code: string } };
    expect(body.error.code).toBe('GOAL_HAS_CHILDREN');
    // exactly what the client needs to render "N sub-goals, M tasks, K backlog items" — and, ⚠ A2, how
    // many of those sub-goals are WEEKS of intention (R-task-47).
    expect(await detailsOf(res)).toMatchObject({ subGoals: 5, weeklyGoals: 1, tasks: 1, backlogItems: 1 });

    // …and NOTHING was written: the refusal is not a half-applied delete.
    expect((await allGoalsRaw(t, userId)).length).toBe(6);
    expect(await tasksUnder(t, userId, [weekly.id])).toHaveLength(1);
  });

  it('S-goal-Q5-2 — WITH `cascade=true` the whole subtree goes in one transaction, and the counts come back', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const { life, yearly, quarterly, monthly, weekly, yearly2 } = await makeLine(t, cookie);
    const second = await createGoal(t, cookie, { title: 'another week', horizon: 'Weekly', parentId: monthly.id });
    await seedTask(t, userId, weekly.id, '2026-08-24');
    await seedTask(t, userId, second.id, '2026-08-31');
    await seedBacklogItem(t, userId, quarterly.id);
    await seedBacklogItem(t, userId, monthly.id);

    const res = await del(cookie, life.id, true);
    expect(res.status).toBe(200);
    const body = (await res.json()) as DeleteGoalResponse;
    expect(body.deleted).toBe(true);
    // S-task-47-1 — the cascade covers the NEW level without a rule of its own.
    expect(body.removed).toMatchObject({ goals: 7, weeklyGoals: 2, tasks: 2, backlogItems: 2 });

    expect(await allGoalsRaw(t, userId)).toHaveLength(0);
    expect(await tasksUnder(t, userId, [life.id, yearly.id, quarterly.id, monthly.id, weekly.id, second.id, yearly2.id])).toHaveLength(0);
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
    const { cookie, userId } = await signedInOwner(t);
    const { life, yearly, quarterly, monthly, weekly, yearly2 } = await makeLine(t, cookie);

    const res = await del(cookie, weekly.id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as DeleteGoalResponse;
    expect(body.removed).toMatchObject({ goals: 1, weeklyGoals: 1 });

    const after = await allGoalsRaw(t, userId);
    expect(after.map((g) => g.id).sort()).toEqual([life.id, yearly.id, quarterly.id, monthly.id, yearly2.id].sort());
    /**
     * RETIRED — the old last line asserted "Q is a leaf again now that its only child is gone — and
     * therefore focusable again". Both halves are gone: `isLeaf` left the wire (R-goal-37) and there is
     * nothing to focus (R-rm-2). What replaces it is the structural fact, read from `children`, which is
     * the ONLY source of it now — and it grants no permission whatsoever (R-goal-39).
     */
    const detail = (await (await t.fetch(`/api/goals/${monthly.id}`, { cookie })).json()) as { children: unknown[] };
    expect(detail.children).toHaveLength(0);
  });

  it('R-task-47 — `?dryRun=true` answers for a CHILDLESS goal too, which is the dangerous case', async () => {
    // A Weekly goal carrying open work deletes silently with no warning from the API itself: the live
    // `GOAL_HAS_CHILDREN` guard only fires when there are descendants, so the preview is the only place
    // those counts can come from.
    const { cookie, userId } = await signedInOwner(t);
    const { weekly } = await makeLine(t, cookie);
    await seedTask(t, userId, weekly.id, '2026-08-31');
    await seedTask(t, userId, weekly.id, '2026-08-24');

    const res = await t.fetch(`/api/goals/${weekly.id}?dryRun=true`, { method: 'DELETE', cookie });
    expect(res.status).toBe(200);
    const body = (await res.json()) as DeleteGoalResponse;
    expect(body.deleted).toBe(false);
    expect(body.removed).toMatchObject({ goals: 1, weeklyGoals: 1, tasks: 2 });
    // …and it wrote nothing.
    expect(await tasksUnder(t, userId, [weekly.id])).toHaveLength(2);
  });

  it('R-auth-2/3 — another owner’s goal cannot be deleted, and answers like one that never existed', async () => {
    const a = await signedInOwner(t);
    const b = await signedInOwner(t);
    const theirs = await makeLine(t, b.cookie);
    const res = await del(a.cookie, theirs.life.id, true);
    expect(res.status).toBe(404);
    expect(await codeOf(res)).toBe('NOT_FOUND');
    expect(await allGoalsRaw(t, b.userId)).toHaveLength(6);
  });
});
