import type { GoalView, Horizon, LensResponse, Pulse } from '@goal-cascade/shared';
import { sql } from 'drizzle-orm';
import { IBacklogRepo, IGoalRepo, ILearningRepo, ITaskRepo } from '../../src/application/ports';
import { DB, GuardedBatch } from '../../src/application/services';
import type { BacklogItem, Goal, Learning, Task } from '../../src/domain/entities';
import { labelOf } from '@goal-cascade/shared';
import { ids, type TestApp } from '../helpers/app';

/**
 * Fixtures for the goal and lens suites.
 *
 * Trees are built through the REAL routes wherever possible — a fixture that writes rows the API would
 * refuse proves nothing about the API. The direct-write helpers exist for states no endpoint can reach,
 * and after A2 that set is precise: a task with an origin in a past week, and a goal in a PAST period
 * (R-goal-36 refuses both through the product, which is exactly why the carried band and the migration
 * need a way to arrange them).
 */

export const codeOf = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;
export const detailsOf = async (res: Response) =>
  ((await res.json()) as { error: { details?: Record<string, unknown> } }).error.details ?? {};

export async function createGoal(
  t: TestApp,
  cookie: string,
  input: { title: string; horizon: Horizon; parentId?: string | null; periodKey?: string; why?: string; pulse?: Pulse },
): Promise<GoalView> {
  const res = await t.fetch('/api/goals', { method: 'POST', cookie, idempotencyKey: crypto.randomUUID(), json: input });
  if (res.status !== 201) throw new Error(`create goal failed ${res.status}: ${await res.text()}`);
  return ((await res.json()) as { goal: GoalView }).goal;
}

export function createGoalRaw(t: TestApp, cookie: string, input: Record<string, unknown>) {
  return t.fetch('/api/goals', { method: 'POST', cookie, idempotencyKey: crypto.randomUUID(), json: input });
}

/**
 * Life `L` › Yearly `Y` › Quarterly `Q` › Monthly `M`, plus a second Yearly `Y2` on the same Life root,
 * and — ⚠ **A2** — a **Weekly** `W` under `M` for the current week, because that is now the only kind of
 * goal that can hold a task (R-goal-39).
 */
export async function makeLine(t: TestApp, cookie: string) {
  const life = await createGoal(t, cookie, { title: 'Health', horizon: 'Life' });
  const yearly = await createGoal(t, cookie, { title: 'Strong year', horizon: 'Yearly', parentId: life.id });
  const quarterly = await createGoal(t, cookie, { title: 'Q push', horizon: 'Quarterly', parentId: yearly.id });
  const monthly = await createGoal(t, cookie, { title: 'This month', horizon: 'Monthly', parentId: quarterly.id });
  const weekly = await createGoal(t, cookie, { title: 'This week', horizon: 'Weekly', parentId: monthly.id });
  const yearly2 = await createGoal(t, cookie, { title: 'Other year', horizon: 'Yearly', parentId: life.id });
  return { life, yearly, quarterly, monthly, weekly, yearly2 };
}

/** R-lens-16 — one lens read. `period` omitted means the current period of that horizon (R-lens-14). */
export async function lens(
  t: TestApp,
  cookie: string,
  q: { lens: Horizon; period?: string; limit?: number; cursor?: string } = { lens: 'Weekly' },
): Promise<LensResponse> {
  const params = new URLSearchParams({ lens: q.lens });
  if (q.period !== undefined) params.set('period', q.period);
  if (q.limit !== undefined) params.set('limit', String(q.limit));
  if (q.cursor !== undefined) params.set('cursor', q.cursor);
  const res = await t.fetch(`/api/goals?${params.toString()}`, { cookie });
  if (res.status !== 200) throw new Error(`GET /goals failed ${res.status}: ${await res.text()}`);
  return (await res.json()) as LensResponse;
}

/** One goal as its own lens renders it. */
export async function goalInLens(t: TestApp, cookie: string, goal: GoalView): Promise<GoalView> {
  const res = await lens(t, cookie, { lens: goal.horizon, ...(goal.horizon === 'Life' ? {} : { period: goal.periodKey }) });
  const found = [...res.items, ...res.carried].find((g) => g.id === goal.id);
  if (!found) throw new Error(`goal ${goal.id} is not in the ${goal.horizon} lens for ${goal.periodKey}`);
  return found;
}

/**
 * A goal written DIRECTLY, bypassing the routes.
 *
 * ⚠ **A2** — the one thing this exists for is a **past period**: R-goal-36 refuses that write through
 * the product, deliberately and permanently, so the carried band (R-lens-12) and the migration's own
 * fixtures cannot be arranged any other way. It writes through the same port and the same
 * `GuardedBatch` the service uses, so nothing here depends on a private table shape.
 */
export async function seedGoal(
  t: TestApp,
  userId: string,
  input: { parentId: string | null; horizon: Horizon; title: string; periodKey?: string; why?: string; createdAt?: string },
): Promise<Goal> {
  const now = t.clock.nowIso();
  const periodKey = input.periodKey ?? '';
  const goal: Goal = {
    id: ids.ulid(),
    userId,
    parentId: input.parentId,
    horizon: input.horizon,
    title: input.title,
    why: input.why ?? '',
    pulse: 'On track',
    periodKey,
    period: labelOf(input.horizon, periodKey),
    createdAt: input.createdAt ?? now,
    updatedAt: input.createdAt ?? now,
    version: 1,
  };
  const c = t.container();
  await c.resolve(GuardedBatch).run([{ label: 'seed.goal', stmt: c.resolve<IGoalRepo>(IGoalRepo).insertStmt(goal) }]);
  return goal;
}

/**
 * An open task with an explicit origin week.
 *
 * R-task-41 forbids back-dating through the API, and R-task-40 gives a task no week parameter at all, so
 * a task that originated in a past week can only be arranged this way.
 */
export async function seedTask(t: TestApp, userId: string, goalId: string, originPeriodKey: string, title = 'work') {
  const now = t.clock.nowIso();
  const task: Task = {
    id: ids.ulid(),
    userId,
    goalId,
    title,
    cond: '',
    description: '',
    status: 'open',
    originPeriodKey,
    donePeriodKey: null,
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

/** Backlog items and learnings for the Q-5 cascade tests. */
export async function seedBacklogItem(t: TestApp, userId: string, goalId: string, title = 'someday') {
  const now = t.clock.nowIso();
  const item: BacklogItem = {
    id: ids.ulid(),
    userId,
    goalId,
    title,
    description: '',
    capturedAt: now,
    fromPeriodKey: null,
    sortKey: '000001000000',
    status: 'open',
    convertedToTaskId: null,
    convertedAt: null,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
  const c = t.container();
  await c
    .resolve(GuardedBatch)
    .run([{ label: 'backlog.insert', stmt: c.resolve<IBacklogRepo>(IBacklogRepo).insertStmt(item) }]);
  return item;
}

export async function seedLearning(t: TestApp, userId: string, goalId: string | null, text = 'an insight') {
  const now = t.clock.nowIso();
  const learning: Learning = {
    id: ids.ulid(),
    userId,
    goalId,
    text,
    applied: false,
    capturedAt: now,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
  const c = t.container();
  await c
    .resolve(GuardedBatch)
    .run([{ label: 'learning.insert', stmt: c.resolve<ILearningRepo>(ILearningRepo).insertStmt(learning) }]);
  return learning;
}

export function learningsOf(t: TestApp, userId: string): Promise<Learning[]> {
  return t.container().resolve<ILearningRepo>(ILearningRepo).listAll(userId);
}

export function backlogOf(t: TestApp, userId: string): Promise<BacklogItem[]> {
  return t.container().resolve<IBacklogRepo>(IBacklogRepo).listOpen(userId);
}

export async function tasksUnder(t: TestApp, userId: string, goalIds: string[]): Promise<Task[]> {
  return t.container().resolve<ITaskRepo>(ITaskRepo).listByGoals(userId, goalIds);
}

/**
 * Every goal in the account, straight from D1.
 *
 * ⚠ **A2 (R-lens-27)** — this is deliberately **raw SQL in a test helper and not a repository method**.
 * `IGoalRepo.listAll` was deleted precisely so no production path can read every goal, and adding it
 * back "just for tests" is one refactor away from a caller. A test that needs the whole table — the
 * migration audit, and the `UNSORTED` fixture — reaches past the port on purpose, and the fact that it
 * has to is the assertion.
 */
export async function allGoalsRaw(t: TestApp, userId: string): Promise<Goal[]> {
  const db = t.container().resolve<{ all: (q: unknown) => Promise<unknown[]> }>(DB);
  const rows = await db.all(sql`SELECT * FROM goals WHERE user_id = ${userId} ORDER BY created_at, id`);
  return rows as Goal[];
}
