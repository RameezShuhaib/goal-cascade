import { eq, inArray, notInArray } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { GoalDetailResponse } from '@goal-cascade/shared';
import { createDb } from '../../src/infrastructure/persistence/db';
import {
  backlogItems,
  backlogLinks,
  goals as goalTable,
  taskEvents,
  taskLinks,
  tasks as taskTable,
  weeklyFocus,
} from '../../src/infrastructure/persistence/schema';
import { createTestApp, env, signedInOwner } from '../helpers/app';
import { createGoal, makeLine, savePlan } from '../goals/fixtures';

/**
 * REVIEW — attack 1: the seams between three services written by agents who could not see each other.
 *
 * The tasks agent's Move-to-Backlog writes a backlog item through the backlog agent's port; the backlog
 * agent's convert-to-task writes a task through the tasks agent's ports; the goals agent's cascade
 * removes both. Each was tested in isolation. These are the round trips.
 */
const db = createDb(env.DB);
const now = '2026-08-31T10:00:00.000Z';
const WEEK = '2026-08-31';

async function fixture() {
  const t = createTestApp({ now });
  const { cookie, userId } = await signedInOwner(t);
  const { life, quarterly, monthly } = await makeLine(t, cookie);
  await savePlan(t, cookie, WEEK, [{ goalId: monthly.id, sentence: 'live branch' }]);
  const post = (path: string, json: unknown) =>
    t.fetch(path, { method: 'POST', cookie, idempotencyKey: crypto.randomUUID(), json });
  const createTask = async (title: string) => {
    const res = await post('/api/tasks', {
      goalId: monthly.id,
      title,
      cond: 'when it ships',
      description: 'the notes',
      links: ['https://www.example.com/a'],
      source: 'planning',
    });
    expect(res.status).toBe(201);
    return ((await res.json()) as { task: { id: string } }).task;
  };
  return { t, cookie, userId, life, quarterly, monthly, post, createTask };
}

describe('REVIEW / attack 1 — task → backlog → task, across two agents’ services', () => {
  it('the full round trip leaves exactly one exited task, one converted item, and one live task', async () => {
    const f = await fixture();
    const task = await f.createTask('Draft the thing');

    const moved = await f.post(`/api/tasks/${task.id}/move-to-backlog`, { week: 0, reason: 'not this week' });
    expect(moved.status).toBe(200);
    const item = ((await moved.json()) as { item: { id: string; fromWeekStart: string; goalId: string } }).item;
    expect(item).toMatchObject({ goalId: f.monthly.id, fromWeekStart: WEEK });

    const back = await f.post(`/api/backlog/${item.id}/convert-to-task`, {});
    expect(back.status).toBe(201);
    const revived = ((await back.json()) as { task: { id: string; events: { text: string }[]; links: unknown[] } }).task;

    // D-15 — the exit KEPT the original row, its reason and its final event.
    const original = await db.select().from(taskTable).where(eq(taskTable.id, task.id)).get();
    expect(original).toMatchObject({ status: 'movedToBacklog', exitReason: 'not this week', movedToBacklogItemId: item.id });
    const originalEvents = await db.select().from(taskEvents).where(eq(taskEvents.taskId, task.id)).all();
    expect(originalEvents.map((e) => e.text)).toContain('Moved to Backlog — not this week');

    // D-19 — the item is MARKED, never deleted, and it points at the task it became.
    const itemRow = await db.select().from(backlogItems).where(eq(backlogItems.id, item.id)).get();
    expect(itemRow).toMatchObject({ status: 'converted', convertedToTaskId: revived.id, fromWeekStart: WEEK });

    // R-task-30 — the new task is a NEW task with the right provenance, carrying the links across.
    expect(revived.id).not.toBe(task.id);
    expect(revived.events.map((e) => e.text)).toEqual(['Created — pulled from Backlog']);
    expect(revived.links).toHaveLength(1);

    // The week shows exactly one of them, and the backlog shows neither.
    const week = (await (await f.t.fetch('/api/tasks', { cookie: f.cookie })).json()) as { tasks: { id: string }[] };
    expect(week.tasks.map((x) => x.id)).toEqual([revived.id]);
    const backlog = (await (await f.t.fetch('/api/backlog', { cookie: f.cookie })).json()) as { items: unknown[] };
    expect(backlog.items).toEqual([]);
  });

  it('a second conversion of the round-tripped item is still refused (the exit did not reset it)', async () => {
    const f = await fixture();
    const task = await f.createTask('Draft the thing');
    const item = ((await (await f.post(`/api/tasks/${task.id}/move-to-backlog`, { week: 0 })).json()) as {
      item: { id: string };
    }).item;

    expect((await f.post(`/api/backlog/${item.id}/convert-to-task`, {})).status).toBe(201);
    const again = await f.post(`/api/backlog/${item.id}/convert-to-task`, {});
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: { code: string } }).error.code).toBe('ALREADY_CONVERTED');
    expect(await db.select().from(taskTable).where(eq(taskTable.goalId, f.monthly.id)).all()).toHaveLength(2);
  });

  it('a task cannot exit twice, and a done task cannot exit at all (R-task-17)', async () => {
    const f = await fixture();
    const task = await f.createTask('Draft the thing');
    expect((await f.post(`/api/tasks/${task.id}/move-to-backlog`, { week: 0 })).status).toBe(200);

    const twice = await f.post(`/api/tasks/${task.id}/move-to-backlog`, { week: 0 });
    expect(twice.status).toBe(409);
    expect(((await twice.json()) as { error: { code: string } }).error.code).toBe('TASK_ALREADY_EXITED');
    // …and only ONE backlog item was ever produced by that task.
    expect(await db.select().from(backlogItems).where(eq(backlogItems.goalId, f.monthly.id)).all()).toHaveLength(1);
  });

  it('the cascade removes BOTH sides of a round trip and leaves nothing pointing at a dead goal', async () => {
    const f = await fixture();
    const task = await f.createTask('Draft the thing');
    const item = ((await (await f.post(`/api/tasks/${task.id}/move-to-backlog`, { week: 0 })).json()) as {
      item: { id: string };
    }).item;
    expect((await f.post(`/api/backlog/${item.id}/convert-to-task`, {})).status).toBe(201);

    const res = await f.t.fetch(`/api/goals/${f.life.id}?cascade=true`, { method: 'DELETE', cookie: f.cookie });
    expect(res.status).toBe(200);
    expect((await res.json()) as unknown).toMatchObject({
      removed: { goals: 5, tasks: 2, backlogItems: 1 },
    });

    // The real assertion: NO row anywhere still names a goal that no longer exists.
    const live = (await db.select({ id: goalTable.id }).from(goalTable).all()).map((g) => g.id);
    const orphanFilter = live.length > 0 ? notInArray : undefined;
    const orphans = {
      tasks: await db.select().from(taskTable).where(orphanFilter ? orphanFilter(taskTable.goalId, live) : undefined).all(),
      items: await db
        .select()
        .from(backlogItems)
        .where(orphanFilter ? orphanFilter(backlogItems.goalId, live) : undefined)
        .all(),
      focuses: await db
        .select()
        .from(weeklyFocus)
        .where(orphanFilter ? orphanFilter(weeklyFocus.goalId, live) : undefined)
        .all(),
    };
    expect(orphans).toEqual({ tasks: [], items: [], focuses: [] });

    // …and the child rows keyed by the deleted tasks and items went with them.
    expect(await db.select().from(taskEvents).where(inArray(taskEvents.taskId, [task.id])).all()).toEqual([]);
    expect(await db.select().from(taskLinks).where(inArray(taskLinks.taskId, [task.id])).all()).toEqual([]);
    expect(await db.select().from(backlogLinks).where(inArray(backlogLinks.itemId, [item.id])).all()).toEqual([]);
  });

  it('deleting the goal a task is exiting from loses cleanly: the exit 409s and writes nothing', async () => {
    const f = await fixture();
    const task = await f.createTask('Draft the thing');

    // The goal (and with it the task) is deleted first; the exit arrives afterwards.
    expect((await f.t.fetch(`/api/goals/${f.monthly.id}`, { method: 'DELETE', cookie: f.cookie })).status).toBe(200);

    const exit = await f.post(`/api/tasks/${task.id}/move-to-backlog`, { week: 0 });
    expect(exit.status).toBe(404); // R-auth-3 — a vanished task is indistinguishable from one that never was
    // No backlog item was minted on the dead goal.
    expect(await db.select().from(backlogItems).where(eq(backlogItems.goalId, f.monthly.id)).all()).toEqual([]);
  });
});

describe('REVIEW — the two contract gaps closed', () => {
  it('GoalDetailResponse carries `replanOptions`, derived server-side and strictly forward (R-goal-23 / D-3)', async () => {
    const t = createTestApp({ now }); // 2026-08-31 → Q3 2026, Aug 2026
    const { cookie } = await signedInOwner(t);
    const { life, yearly, quarterly, monthly } = await makeLine(t, cookie);

    const detail = async (id: string) =>
      (await (await t.fetch(`/api/goals/${id}`, { cookie })).json()) as GoalDetailResponse;

    expect((await detail(monthly.id)).replanOptions).toEqual(['Sep 2026', 'Oct 2026']);
    expect((await detail(quarterly.id)).replanOptions).toEqual(['Q4 2026', 'Q1 2027']);
    expect((await detail(yearly.id)).replanOptions).toEqual(['2027']);
    // R-goal-21 — a Life goal is not re-plannable, so it offers nothing.
    expect((await detail(life.id)).replanOptions).toEqual([]);

    // …and it is the SAME list the server refuses a no-op re-plan with, so the two cannot drift.
    const noop = await t.fetch(`/api/goals/${monthly.id}/replan`, {
      method: 'POST',
      cookie,
      idempotencyKey: crypto.randomUUID(),
      json: { period: monthly.period },
    });
    expect(noop.status).toBe(422);
    const details = ((await noop.json()) as { error: { details: { options: string[] } } }).error.details;
    expect(details.options).toEqual((await detail(monthly.id)).replanOptions);
  });

  it('`replanOptions` moves with the owner’s calendar, not with a literal', async () => {
    const t = createTestApp({ now: '2026-12-15T10:00:00.000Z' });
    const { cookie } = await signedInOwner(t);
    const { monthly, quarterly } = await makeLine(t, cookie);
    const detail = async (id: string) =>
      ((await (await t.fetch(`/api/goals/${id}`, { cookie })).json()) as GoalDetailResponse).replanOptions;

    expect(await detail(monthly.id)).toEqual(['Jan 2027', 'Feb 2027']);
    expect(await detail(quarterly.id)).toEqual(['Q1 2027', 'Q2 2027']);
  });

  it('an ambiguous conversion answers 409 AMBIGUOUS_CONVERSION_TARGET, with the candidates to choose from', async () => {
    const t = createTestApp({ now });
    const { cookie } = await signedInOwner(t);
    const { quarterly, monthly } = await makeLine(t, cookie);
    const second = await createGoal(t, cookie, { title: 'Speed work', horizon: 'Monthly', parentId: quarterly.id });
    await savePlan(t, cookie, WEEK, [
      { goalId: monthly.id, sentence: 'one' },
      { goalId: second.id, sentence: 'two' },
    ]);
    const item = ((await (
      await t.fetch('/api/backlog', {
        method: 'POST',
        cookie,
        idempotencyKey: crypto.randomUUID(),
        json: { goalId: quarterly.id, title: 'Ambiguous', description: '', links: [] },
      })
    ).json()) as { item: { id: string } }).item;

    const res = await t.fetch(`/api/backlog/${item.id}/convert-to-task`, {
      method: 'POST',
      cookie,
      idempotencyKey: crypto.randomUUID(),
      json: {},
    });
    expect(res.status).toBe(409);
    const err = (await res.json()) as { error: { code: string; details: { candidates: { id: string; title: string }[] } } };
    expect(err.error.code).toBe('AMBIGUOUS_CONVERSION_TARGET');
    expect(err.error.details.candidates.map((c) => c.id).sort()).toEqual([monthly.id, second.id].sort());
    // It is a product refusal, not a validation failure: the item is untouched and re-submitting works.
    expect((await db.select().from(backlogItems).where(eq(backlogItems.id, item.id)).get())?.status).toBe('open');
  });
});
