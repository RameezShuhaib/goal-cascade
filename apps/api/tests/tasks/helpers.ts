import type { CreateTaskResponse, TaskDetailResponse, TaskResponse, TasksResponse } from '@goal-cascade/shared';
import { IGoalRepo } from '../../src/application/ports';
import { GuardedBatch } from '../../src/application/services';
import type { Goal } from '../../src/domain/entities';
import type { Horizon } from '../../src/domain/enums';
import { labelOf } from '@goal-cascade/shared';
import { ids, type TestApp } from '../helpers/app';

/**
 * Seeding for the task suite.
 *
 * Goals are written through their REPOSITORY PORT rather than over HTTP so a task test can arrange a
 * PAST week, which R-goal-36 refuses through the product. Tasks themselves are always driven over HTTP,
 * through the real router — the week model is only meaningful end to end.
 *
 * ⚠ **A2** — `activate()` is gone with `weekly_focus` (R-rm-2). There is nothing to activate: a weekly
 * intent IS a goal, and a task hangs off it because of its HORIZON (R-goal-39), never because a focus
 * row exists. `makeWeek()` replaces it.
 */

export async function makeGoal(
  t: TestApp,
  userId: string,
  horizon: Horizon,
  parentId: string | null,
  periodKey = '',
): Promise<Goal> {
  const now = t.clock.nowIso();
  const goal: Goal = {
    id: ids.ulid(),
    userId,
    parentId,
    horizon,
    title: `${horizon} goal`,
    why: '',
    pulse: 'On track',
    periodKey,
    period: labelOf(horizon, periodKey),
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
  const c = t.container();
  await c.resolve(GuardedBatch).run([{ label: 'goal.insert', stmt: c.resolve<IGoalRepo>(IGoalRepo).insertStmt(goal) }]);
  return goal;
}

/**
 * A Life › Monthly › Weekly line: the shortest tree that can hold a task.
 *
 * ⚠ **A2** — the old version stopped at Monthly and called it "the shortest legal tree with one
 * focusable leaf". That leaf is now precisely the goal that must NOT hold a task (R-goal-37,
 * S-goal-37-1), so `monthly` is kept as the trap fixture and `weekly` is the target.
 */
export async function makeLine(
  t: TestApp,
  userId: string,
  weekStart: string,
): Promise<{ life: Goal; monthly: Goal; weekly: Goal }> {
  const life = await makeGoal(t, userId, 'Life', null);
  const monthly = await makeGoal(t, userId, 'Monthly', life.id, weekStart.slice(0, 7));
  const weekly = await makeGoal(t, userId, 'Weekly', monthly.id, weekStart);
  return { life, monthly, weekly };
}

/** One more Weekly goal in `weekStart` under `parentId` — how a week holds several intentions. */
export function makeWeek(t: TestApp, userId: string, parentId: string, weekStart: string): Promise<Goal> {
  return makeGoal(t, userId, 'Weekly', parentId, weekStart);
}

export const key = () => crypto.randomUUID().replace(/-/g, '');

export async function createTask(
  t: TestApp,
  cookie: string,
  body: Record<string, unknown>,
): Promise<{ status: number; json: CreateTaskResponse & { error?: { code: string } } }> {
  const res = await t.fetch('/api/tasks', { method: 'POST', cookie, idempotencyKey: key(), json: body });
  return { status: res.status, json: (await res.json()) as CreateTaskResponse & { error?: { code: string } } };
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

export type { TaskResponse };
