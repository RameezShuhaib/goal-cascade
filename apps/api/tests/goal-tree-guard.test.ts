import type { Horizon } from '../src/domain/enums';
import { describe, expect, it } from 'vitest';
import { IGoalRepo, ITaskRepo } from '../src/application/ports';
import { GuardedBatch } from '../src/application/services';
import type { Goal, Task } from '../src/domain/entities';
import { createTestApp, ids, signedInOwner } from './helpers/app';

/**
 * SPEC D-5 — the tree invariants must hold against a request submitted DIRECTLY, not just against a
 * disabled button. `GoalTreeGuard` runs in the route BEFORE `GoalService`, so these tests prove the
 * guard is genuinely in the request path: a violation answers 409 and writes nothing, while a legal
 * request is carried out (201 on create, 200 on move — it was the stub's 501 before 03-goals-plan).
 *
 * That refused-vs-accepted distinction is the whole point. Remove a guard call from the route and the
 * 409s turn into successes, and this file fails.
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
    periodKey: '',
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
    // legal → falls through to the service, which creates it (201)
    expect((await create(cookie, { title: 'Second life', horizon: 'Life' })).status).toBe(201);
  });

  it('S-goal-5-1 — a legal create passes the guard and reaches the service', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const { quarterly } = await makeLine(userId);
    expect((await create(cookie, { title: 'Legal', horizon: 'Monthly', parentId: quarterly.id })).status).toBe(201);
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

  it('S-goal-17-1 — a legal move passes the guard and reaches the service', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const { quarterly, yearly2 } = await makeLine(userId);
    expect((await move(cookie, quarterly.id, yearly2.id)).status).toBe(200);
  });
});

/**
 * RETIRED - "a leaf carrying open tasks cannot silently become a parent" (R-goal-28, D-8), refused with
 * `GOAL_HAS_OPEN_TASKS`.
 *
 * **R-goal-42 makes the whole transition UNREACHABLE**, so the guard is deleted rather than left in
 * place doing nothing: only WEEKLY goals hold tasks (R-goal-39), and a Weekly goal can never gain a
 * child (R-goal-31, it is terminal). Adding a child to a goal, or moving a goal under it, now moves
 * nothing, deletes nothing and refuses nothing - "the one place the redesign removes a class of defect
 * outright rather than relocating it".
 *
 * The code is gone from `ERROR_STATUS` too (S-rm-2-1), so this asserts the SUCCESS that used to be a
 * refusal - the strongest form the retirement can take.
 */
describe('S-goal-42-1 - the leaf-to-parent refusal is unreachable, and the code does not exist', () => {
  it('a goal carrying open tasks... cannot exist unless it is Weekly, and Weekly cannot gain a child', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const { monthly } = await makeLine(userId);
    const weekly = await makeGoal(userId, 'Weekly', monthly.id);
    await makeOpenTask(userId, weekly.id);

    // The only goal that can hold work is terminal, so the transition has no representable input.
    const res = await create(cookie, { title: 'child', horizon: 'Weekly', parentId: weekly.id });
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe('HORIZON_CONFLICT');
  });

  it('giving a goal its FIRST child succeeds even while work is open below it', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const { monthly, quarterly } = await makeLine(userId);
    const weekly = await makeGoal(userId, 'Weekly', monthly.id);
    await makeOpenTask(userId, weekly.id);

    // The old rule fired here. Nothing is re-homed, nothing is deleted, nothing is refused.
    expect((await create(cookie, { title: 'sibling', horizon: 'Monthly', parentId: quarterly.id })).status).toBe(201);
    const fresh = await makeGoal(userId, 'Monthly', quarterly.id);
    expect((await create(cookie, { title: 'first child', horizon: 'Weekly', parentId: fresh.id })).status).toBe(201);
  });

  it('S-rm-2-1 - and a MOVE under a goal with open work below it is not refused either', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const a = await makeLine(userId);
    const aWeekly = await makeGoal(userId, 'Weekly', a.monthly.id);
    await makeOpenTask(userId, aWeekly.id);
    const b = await makeLine(userId);

    expect((await move(cookie, b.quarterly.id, a.yearly.id)).status).toBe(200);
    const { ERROR_CODES } = await import('@goal-cascade/shared');
    expect(ERROR_CODES as readonly string[]).not.toContain('GOAL_HAS_OPEN_TASKS');
  });
});
