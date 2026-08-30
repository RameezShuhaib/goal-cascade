import type { TaskDetailResponse, TaskResponse, TasksResponse } from '@goal-cascade/shared';
import { IGoalRepo, IWeeklyFocusRepo } from '../../src/application/ports';
import { GuardedBatch } from '../../src/application/services';
import type { Goal, WeeklyFocus } from '../../src/domain/entities';
import type { Horizon } from '../../src/domain/enums';
import { ids, type TestApp } from '../helpers/app';

/**
 * Seeding for the task suite.
 *
 * Goals and weekly focuses are written through their REPOSITORY PORTS rather than through `GoalService`
 * or `PlanService`: those belong to other agents and are still stubs, and a task test that 501s because
 * a neighbouring feature is unfinished tests nothing. Tasks themselves are always driven over HTTP,
 * through the real router — the week model is only meaningful end to end.
 */

export async function makeGoal(t: TestApp, userId: string, horizon: Horizon, parentId: string | null): Promise<Goal> {
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

/** A Life › Monthly line: the shortest legal tree with one focusable leaf. */
export async function makeLine(t: TestApp, userId: string): Promise<{ life: Goal; leaf: Goal }> {
  const life = await makeGoal(t, userId, 'Life', null);
  const leaf = await makeGoal(t, userId, 'Monthly', life.id);
  return { life, leaf };
}

/**
 * D-2 — a leaf is ACTIVE in a week exactly while a `weekly_focus` row exists for it in that week. There
 * is no `active` flag to set, and a blank sentence is never stored.
 */
export async function activate(t: TestApp, userId: string, goalId: string, weekStart: string, sentence = 'Ship the thing'): Promise<WeeklyFocus> {
  const now = t.clock.nowIso();
  const focus: WeeklyFocus = { id: ids.ulid(), userId, goalId, weekStart, sentence, createdAt: now, updatedAt: now };
  const c = t.container();
  await c
    .resolve(GuardedBatch)
    .run([{ label: 'focus.insert', stmt: c.resolve<IWeeklyFocusRepo>(IWeeklyFocusRepo).insertStmt(focus) }]);
  return focus;
}

export const key = () => crypto.randomUUID().replace(/-/g, '');

export async function createTask(
  t: TestApp,
  cookie: string,
  body: Record<string, unknown>,
): Promise<{ status: number; json: TaskResponse & { error?: { code: string } } }> {
  const res = await t.fetch('/api/tasks', { method: 'POST', cookie, idempotencyKey: key(), json: body });
  return { status: res.status, json: (await res.json()) as TaskResponse & { error?: { code: string } } };
}

/** Creates a task and fails loudly if it was refused — the arrange step of most tests below. */
export async function seedTask(t: TestApp, cookie: string, body: Record<string, unknown>) {
  const { status, json } = await createTask(t, cookie, body);
  if (status !== 201) throw new Error(`task create failed ${status}: ${JSON.stringify(json)}`);
  return json.task;
}

export async function listWeek(t: TestApp, cookie: string, week?: number): Promise<TasksResponse> {
  const res = await t.fetch(`/api/tasks${week === undefined ? '' : `?week=${week}`}`, { cookie });
  if (res.status !== 200) throw new Error(`GET /tasks failed ${res.status}: ${await res.text()}`);
  return (await res.json()) as TasksResponse;
}

export async function detail(t: TestApp, cookie: string, id: string, week?: number): Promise<TaskDetailResponse> {
  const res = await t.fetch(`/api/tasks/${id}${week === undefined ? '' : `?week=${week}`}`, { cookie });
  if (res.status !== 200) throw new Error(`GET /tasks/${id} failed ${res.status}: ${await res.text()}`);
  return (await res.json()) as TaskDetailResponse;
}

export const command = (t: TestApp, cookie: string, path: string, json: unknown = {}) =>
  t.fetch(path, { method: 'POST', cookie, idempotencyKey: key(), json });

export const codeOf = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

/** The event texts of a task's timeline, newest first. */
export const texts = (d: TaskDetailResponse) => d.task.events.map((e) => e.text);
export const kinds = (d: TaskDetailResponse) => d.task.events.map((e) => e.kind);
