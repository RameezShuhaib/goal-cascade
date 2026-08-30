import type { Horizon } from '../src/domain/enums';
import { describe, expect, it } from 'vitest';
import { IGoalRepo, ITaskRepo } from '../src/application/ports';
import { GuardedBatch } from '../src/application/services';
import type { Goal, Task } from '../src/domain/entities';
import { createTestApp, ids, signedInOwner } from './helpers/app';

/**
 * SPEC D-5 — the tree invariants must hold against a request submitted DIRECTLY, not just against a
 * disabled button. `GoalTreeGuard` runs in the route before the (not-yet-implemented) `GoalService`, so
 * these tests prove the guard is genuinely in the request path today: a violation answers 409, while a
 * legal request falls through to the stub's 501.
 *
 * That 501-vs-409 distinction is the whole point. When a feature agent implements `GoalService`, these
 * tests keep passing unchanged — and if anyone removes the guard from the route, the 409s become 501s
 * and this file fails.
 */
const t = createTestApp({ now: '2026-08-31T10:00:00.000Z' });

const codeOf = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

async function makeGoal(userId: string, horizon: Horizon, parentId: string | null): Promise<Goal> {
  const now = t.clock.nowIso();
  const goal: Goal = {
    id: ids.ulid(),
    userId,
    parentId,
    horizon,
    title: `${horizon} goal`,
    why: '',
    pulse: 'On track',
    period: '',
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
  const c = t.container();
  await c.resolve(GuardedBatch).run([{ label: 'goal.insert', stmt: c.resolve<IGoalRepo>(IGoalRepo).insertStmt(goal) }]);
  return goal;
}

async function makeOpenTask(userId: string, goalId: string): Promise<Task> {
  const now = t.clock.nowIso();
  const task: Task = {
    id: ids.ulid(),
    userId,
    goalId,
    title: 'carrying work',
    cond: '',
    description: '',
    status: 'open',
    originWeekStart: '2026-08-31',
    doneWeekStart: null,
    doneAt: null,
    exitReason: null,
    exitedAt: null,
    movedToBacklogItemId: null,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
  const c = t.container();
  await c.resolve(GuardedBatch).run([{ label: 'task.insert', stmt: c.resolve<ITaskRepo>(ITaskRepo).insertStmt(task) }]);
  return task;
}

/** A Life › Yearly › Quarterly › Monthly line, plus a second Yearly sibling. */
async function makeLine(userId: string) {
  const life = await makeGoal(userId, 'Life', null);
  const yearly = await makeGoal(userId, 'Yearly', life.id);
  const quarterly = await makeGoal(userId, 'Quarterly', yearly.id);
  const monthly = await makeGoal(userId, 'Monthly', quarterly.id);
  const yearly2 = await makeGoal(userId, 'Yearly', life.id);
  return { life, yearly, quarterly, monthly, yearly2 };
}

const create = (cookie: string, body: unknown) =>
  t.fetch('/api/goals', { method: 'POST', cookie, idempotencyKey: crypto.randomUUID(), json: body });
const move = (cookie: string, id: string, parentId: string) =>
  t.fetch(`/api/goals/${id}/move`, { method: 'POST', cookie, idempotencyKey: crypto.randomUUID(), json: { parentId } });

describe('R-goal-5/6 — create is guarded on the server, before any write', () => {
  it('S-goal-5-2 — equal rank (Yearly under Yearly) → 409 HORIZON_CONFLICT', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const { yearly } = await makeLine(userId);
    const res = await create(cookie, { title: 'Nope', horizon: 'Yearly', parentId: yearly.id });
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe('HORIZON_CONFLICT');
  });

  it('S-goal-5-3 — inverted rank (Quarterly under Monthly) → 409 HORIZON_CONFLICT', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const { monthly } = await makeLine(userId);
    expect(await codeOf(await create(cookie, { title: 'Nope', horizon: 'Quarterly', parentId: monthly.id }))).toBe(
      'HORIZON_CONFLICT',
    );
  });

  it('S-goal-6-1 / D-6 — NO horizon may be created under a Monthly goal', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const { monthly } = await makeLine(userId);
    for (const horizon of ['Yearly', 'Quarterly', 'Monthly'] as const) {
      const res = await create(cookie, { title: 'Nope', horizon, parentId: monthly.id });
      expect(res.status, horizon).toBe(409);
      expect(await codeOf(res), horizon).toBe('HORIZON_CONFLICT');
    }
  });

  it('S-goal-4-1 — a non-Life goal with no parent is refused', async () => {
    const { cookie } = await signedInOwner(t);
    const res = await create(cookie, { title: 'Orphan', horizon: 'Yearly' });
    expect(res.status).toBe(422);
    expect(await codeOf(res)).toBe('VALIDATION_FAILED');
  });

  it('S-goal-3-1 — a Life goal with a parent is refused; without one it passes the guard', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const { life } = await makeLine(userId);
    expect((await create(cookie, { title: 'Second life', horizon: 'Life', parentId: life.id })).status).toBe(422);
    // legal → falls through to the unimplemented service
    expect((await create(cookie, { title: 'Second life', horizon: 'Life' })).status).toBe(501);
  });

  it('S-goal-5-1 — a legal create passes the guard and reaches the (stubbed) service', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const { quarterly } = await makeLine(userId);
    expect((await create(cookie, { title: 'Legal', horizon: 'Monthly', parentId: quarterly.id })).status).toBe(501);
  });

  it('R-auth-3 — a parent belonging to ANOTHER owner is a plain 404, indistinguishable from a missing one', async () => {
    const a = await signedInOwner(t);
    const b = await signedInOwner(t);
    const theirs = await makeLine(b.userId);
    const res = await create(a.cookie, { title: 'Steal', horizon: 'Yearly', parentId: theirs.life.id });
    expect(res.status).toBe(404);
    expect(await codeOf(res)).toBe('NOT_FOUND');
    // ...the same answer as a parent that does not exist at all
    expect((await create(a.cookie, { title: 'Ghost', horizon: 'Yearly', parentId: ids.ulid() })).status).toBe(404);
  });
});

describe('R-goal-17/18/21 — move is guarded on the server', () => {
  it('S-goal-18-1 — a move under itself or a descendant → 409 WOULD_CREATE_CYCLE', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const { yearly, quarterly, monthly } = await makeLine(userId);
    for (const target of [yearly.id, quarterly.id, monthly.id]) {
      const res = await move(cookie, yearly.id, target);
      expect(res.status, target).toBe(409);
      expect(await codeOf(res), target).toBe('WOULD_CREATE_CYCLE');
    }
  });

  it('S-goal-18-2 — a move under an equal-or-shorter horizon → 409 HORIZON_CONFLICT', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const line = await makeLine(userId);
    const other = await makeLine(userId); // an unrelated line, so it is not a descendant
    const res = await move(cookie, line.quarterly.id, other.monthly.id);
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe('HORIZON_CONFLICT');
  });

  it('S-goal-21-1 — a Life goal cannot be moved → 409 LIFE_GOAL_IMMUTABLE', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const a = await makeLine(userId);
    const b = await makeLine(userId);
    const res = await move(cookie, a.life.id, b.life.id);
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe('LIFE_GOAL_IMMUTABLE');
  });

  it('S-goal-17-1 — a legal move passes the guard and reaches the (stubbed) service', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const { quarterly, yearly2 } = await makeLine(userId);
    expect((await move(cookie, quarterly.id, yearly2.id)).status).toBe(501);
  });
});

describe('R-goal-28 / D-8 — a leaf carrying open tasks cannot silently become a parent', () => {
  it('creating a sub-goal under it → 409 GOAL_HAS_OPEN_TASKS, with the count in details', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const { quarterly } = await makeLine(userId);
    const leaf = await makeGoal(userId, 'Monthly', quarterly.id);
    await makeOpenTask(userId, leaf.id);

    // Monthly is terminal, so use a Quarterly leaf for the create case.
    const q2 = await makeGoal(userId, 'Quarterly', (await makeGoal(userId, 'Yearly', (await makeGoal(userId, 'Life', null)).id)).id);
    await makeOpenTask(userId, q2.id);

    const res = await create(cookie, { title: 'child', horizon: 'Monthly', parentId: q2.id });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string; details?: { openTasks?: number } } };
    expect(body.error.code).toBe('GOAL_HAS_OPEN_TASKS');
    expect(body.error.details?.openTasks).toBe(1);
  });

  it('moving a goal under it is refused the same way', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const life = await makeGoal(userId, 'Life', null);
    const targetLeaf = await makeGoal(userId, 'Yearly', life.id);
    await makeOpenTask(userId, targetLeaf.id);
    const other = await makeLine(userId);

    const res = await move(cookie, other.quarterly.id, targetLeaf.id);
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe('GOAL_HAS_OPEN_TASKS');
  });

  it('a goal that ALREADY has children is unaffected — the rule is about the leaf → non-leaf transition', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const { quarterly, monthly } = await makeLine(userId);
    await makeOpenTask(userId, monthly.id); // the task is on the leaf, not on the parent
    expect((await create(cookie, { title: 'sibling', horizon: 'Monthly', parentId: quarterly.id })).status).toBe(501);
  });
});
