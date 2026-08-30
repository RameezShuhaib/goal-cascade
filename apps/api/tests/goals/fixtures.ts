import type { GoalView, GoalsResponse, PlanResponse } from '@goal-cascade/shared';
import { IBacklogRepo, IIdeaRepo, ILearningRepo, ITaskRepo, IWeeklyFocusRepo } from '../../src/application/ports';
import { GuardedBatch } from '../../src/application/services';
import type { BacklogItem, Idea, Learning, Task, WeeklyFocus } from '../../src/domain/entities';
import type { Horizon, Pulse } from '../../src/domain/enums';
import { ids, type TestApp } from '../helpers/app';

/**
 * Fixtures for the goal-tree and weekly-plan suites.
 *
 * Trees are built through the REAL routes wherever possible — a fixture that writes rows the API would
 * refuse proves nothing about the API. The two direct-write helpers exist for states no endpoint can
 * reach: a task with an origin in a past week (R-task-5 forbids back-dating) and a focus row for a past
 * week (R-plan-2 makes planning current-week-only).
 */

export const codeOf = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;
export const detailsOf = async (res: Response) =>
  ((await res.json()) as { error: { details?: Record<string, unknown> } }).error.details ?? {};

export async function createGoal(
  t: TestApp,
  cookie: string,
  input: { title: string; horizon: Horizon; parentId?: string | null; period?: string; why?: string; pulse?: Pulse },
): Promise<GoalView> {
  const res = await t.fetch('/api/goals', { method: 'POST', cookie, idempotencyKey: crypto.randomUUID(), json: input });
  if (res.status !== 201) throw new Error(`create goal failed ${res.status}: ${await res.text()}`);
  return ((await res.json()) as { goal: GoalView }).goal;
}

/** Life `L` › Yearly `Y` › Quarterly `Q` › Monthly `M`, plus a second Yearly `Y2` on the same Life root. */
export async function makeLine(t: TestApp, cookie: string) {
  const life = await createGoal(t, cookie, { title: 'Health', horizon: 'Life' });
  const yearly = await createGoal(t, cookie, { title: 'Strong year', horizon: 'Yearly', parentId: life.id });
  const quarterly = await createGoal(t, cookie, { title: 'Q push', horizon: 'Quarterly', parentId: yearly.id });
  const monthly = await createGoal(t, cookie, { title: 'This month', horizon: 'Monthly', parentId: quarterly.id });
  const yearly2 = await createGoal(t, cookie, { title: 'Other year', horizon: 'Yearly', parentId: life.id });
  return { life, yearly, quarterly, monthly, yearly2 };
}

export async function goalsIn(t: TestApp, cookie: string, week?: number): Promise<GoalView[]> {
  const res = await t.fetch(`/api/goals${week === undefined ? '' : `?week=${week}`}`, { cookie });
  if (res.status !== 200) throw new Error(`GET /goals failed ${res.status}: ${await res.text()}`);
  return ((await res.json()) as GoalsResponse).goals;
}

export async function goalById(t: TestApp, cookie: string, id: string, week?: number): Promise<GoalView> {
  const all = await goalsIn(t, cookie, week);
  const goal = all.find((g) => g.id === id);
  if (!goal) throw new Error(`goal ${id} not in the tree`);
  return goal;
}

export function savePlan(t: TestApp, cookie: string, weekStart: string, entries: { goalId: string; sentence: string }[]) {
  return t.fetch('/api/plan', { method: 'PUT', cookie, idempotencyKey: crypto.randomUUID(), json: { weekStart, entries } });
}

export async function planIn(t: TestApp, cookie: string, week?: number): Promise<PlanResponse> {
  const res = await t.fetch(`/api/plan${week === undefined ? '' : `?week=${week}`}`, { cookie });
  if (res.status !== 200) throw new Error(`GET /plan failed ${res.status}: ${await res.text()}`);
  return (await res.json()) as PlanResponse;
}

/** A focus row for a week the plan endpoint refuses to write (R-plan-2: current week only). */
export async function seedFocus(t: TestApp, userId: string, goalId: string, weekStart: string, sentence: string) {
  const now = t.clock.nowIso();
  const focus: WeeklyFocus = { id: ids.ulid(), userId, goalId, weekStart, sentence, createdAt: now, updatedAt: now };
  const c = t.container();
  await c
    .resolve(GuardedBatch)
    .run([{ label: 'focus.insert', stmt: c.resolve<IWeeklyFocusRepo>(IWeeklyFocusRepo).insertStmt(focus) }]);
  return focus;
}

/** An open task with an explicit origin week — R-task-5 forbids back-dating through the API. */
export async function seedTask(t: TestApp, userId: string, goalId: string, originWeekStart: string, title = 'work') {
  const now = t.clock.nowIso();
  const task: Task = {
    id: ids.ulid(),
    userId,
    goalId,
    title,
    cond: '',
    description: '',
    status: 'open',
    originWeekStart,
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

/**
 * Backlog items, ideas and learnings for the Q-5 cascade tests. `BacklogService` / `IdeaService` /
 * `LearningService` are other agents' stubs today, so these rows are written straight through the repos.
 */
export async function seedBacklogItem(t: TestApp, userId: string, goalId: string, title = 'someday') {
  const now = t.clock.nowIso();
  const item: BacklogItem = {
    id: ids.ulid(),
    userId,
    goalId,
    title,
    description: '',
    capturedAt: now,
    fromWeekStart: null,
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

export async function seedIdea(t: TestApp, userId: string, goalId: string | null, text = 'a thought') {
  const now = t.clock.nowIso();
  const idea: Idea = { id: ids.ulid(), userId, goalId, text, capturedAt: now, createdAt: now };
  const c = t.container();
  await c.resolve(GuardedBatch).run([{ label: 'idea.insert', stmt: c.resolve<IIdeaRepo>(IIdeaRepo).insertStmt(idea) }]);
  return idea;
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

export function ideasOf(t: TestApp, userId: string): Promise<Idea[]> {
  return t.container().resolve<IIdeaRepo>(IIdeaRepo).listAll(userId);
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

export async function focusesUnder(t: TestApp, userId: string, goalIds: string[]): Promise<WeeklyFocus[]> {
  return t.container().resolve<IWeeklyFocusRepo>(IWeeklyFocusRepo).listByGoals(userId, goalIds);
}
