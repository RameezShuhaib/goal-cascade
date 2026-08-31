import { eq } from 'drizzle-orm';
import type { DependencyContainer } from 'tsyringe';
import { describe, expect, it } from 'vitest';
import { IBacklogRepo, ITaskRepo } from '../../src/application/ports';
import { GuardedBatch } from '../../src/application/services';
import type { BacklogItem, Task } from '../../src/domain/entities';
import { createDb } from '../../src/infrastructure/persistence/db';
import { backlogItems, tasks as taskTable } from '../../src/infrastructure/persistence/schema';
import { createTestApp, env, ids, signedInOwner } from '../helpers/app';
import { allGoalsRaw, createGoal, makeLine, seedBacklogItem, seedTask } from '../goals/fixtures';

/**
 * REVIEW — Q-5 cascade exactness (attack 3).
 *
 * `GoalService.remove` reads the exact row set it is about to delete and gives every statement an
 * `expectedChanges`, so that a row created between the read and the batch trips a precondition and the
 * delete rolls back with a 409 rather than leaving an orphan. That is the documented guarantee
 * (`docs/work/03-goals-plan/build.md` §3.5).
 *
 * The guarantee had a hole: `removal()` only pushed a statement when the read found `rows > 0`. When the
 * read found ZERO rows of a kind, the delete carried no statement and therefore no precondition — so a
 * row created in that window survived its parent goal, silently. There is no FK on `tasks.goal_id` or
 * `backlog_items.goal_id` (see `schema.ts`: referential integrity is held by the cascade being
 * transactional, not by the database), so nothing else catches it.
 *
 * A2 (R-rm-2) - the `weekly_focus` arm is gone with the table. The two that remain are the two rows
 * that can still be orphaned, and the guarantee is unchanged for both.
 *
 * These tests model the race by decorating the repo read: it returns what the real read returned, and
 * THEN another device's row lands. That is exactly the read-then-write window, deterministically.
 */
const db = createDb(env.DB);

type ListByGoals = { listByGoals(userId: string, goalIds: readonly string[]): Promise<unknown[]> };
const TOKENS = { tasks: ITaskRepo, backlog: IBacklogRepo } as const;

/**
 * Wraps ONE read method so a concurrent write lands AFTER the service has read and BEFORE it batches.
 * `Object.create` keeps the real repo's prototype (and its `db`), so every other method is untouched —
 * this decorates the read, it does not fake the repository.
 */
function raceOn(kind: keyof typeof TOKENS, write: () => Promise<void>) {
  return (c: DependencyContainer) => {
    const token = TOKENS[kind];
    const real = c.resolve<ListByGoals>(token);
    const decorated = Object.create(real) as ListByGoals;
    decorated.listByGoals = async (userId, goalIds) => {
      const rows = await real.listByGoals(userId, goalIds);
      await write();
      return rows;
    };
    c.registerInstance(token, decorated);
  };
}

const now = '2026-08-31T10:00:00.000Z';
const WEEK = '2026-08-31';

function rawTask(userId: string, goalId: string): Task {
  return {
    id: ids.ulid(),
    userId,
    goalId,
    title: 'written by the other device',
    cond: '',
    description: '',
    status: 'open',
    originWeekStart: WEEK,
    doneWeekStart: null,
    doneAt: null,
    exitReason: null,
    exitedAt: null,
    movedToBacklogItemId: null,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
}

function rawItem(userId: string, goalId: string): BacklogItem {
  return {
    id: ids.ulid(),
    userId,
    goalId,
    title: 'written by the other device',
    description: '',
    capturedAt: now,
    fromWeekStart: null,
    sortKey: '000001000000',
    status: 'open',
    convertedToTaskId: null,
    convertedAt: null,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
}

describe('REVIEW / attack 3 — the cascade delete must never orphan a row it did not read', () => {
  it('a TASK created between the read and the batch is a 409, not an orphan (the read found ZERO)', async () => {
    // The window is opened by the decorated read, so the fixture is built on a plain app first.
    const seed = createTestApp({ now });
    const { cookie, userId } = await signedInOwner(seed);
    const { weekly } = await makeLine(seed, cookie);
    const late = rawTask(userId, weekly.id);

    const t = createTestApp({
      now,
      overrides: raceOn('tasks', async () => {
        await db.insert(taskTable).values(late);
      }),
    });
    const res = await t.fetch(`/api/goals/${weekly.id}`, { method: 'DELETE', cookie });

    // Stated as one object so a failure PRINTS the orphan rather than just a status code.
    expect({
      status: res.status,
      taskRowSurvives: !!(await db.select().from(taskTable).where(eq(taskTable.id, late.id)).get()),
      itsGoalSurvives: (await allGoalsRaw(t, userId)).some((g) => g.id === weekly.id),
    }).toEqual({ status: 409, taskRowSurvives: true, itsGoalSurvives: true });
  });

  it('NEGATIVE CONTROL — the same race when the read found ONE row was already a 409', async () => {
    const seed = createTestApp({ now });
    const { cookie, userId } = await signedInOwner(seed);
    const { weekly } = await makeLine(seed, cookie);
    await seedTask(seed, userId, weekly.id, WEEK);
    const late = rawTask(userId, weekly.id);

    const t = createTestApp({
      now,
      overrides: raceOn('tasks', async () => {
        await db.insert(taskTable).values(late);
      }),
    });
    const res = await t.fetch(`/api/goals/${weekly.id}?cascade=true`, { method: 'DELETE', cookie });
    expect(res.status).toBe(409);
  });

  it('a BACKLOG ITEM created between the read and the batch is a 409, not an orphan', async () => {
    const seed = createTestApp({ now });
    const { cookie, userId } = await signedInOwner(seed);
    const { monthly } = await makeLine(seed, cookie);
    const late = rawItem(userId, monthly.id);

    const t = createTestApp({
      now,
      overrides: raceOn('backlog', async () => {
        await db.insert(backlogItems).values(late);
      }),
    });
    const res = await t.fetch(`/api/goals/${monthly.id}`, { method: 'DELETE', cookie });

    expect({
      status: res.status,
      itemRowSurvives: !!(await db.select().from(backlogItems).where(eq(backlogItems.id, late.id)).get()),
      itsGoalSurvives: (await allGoalsRaw(t, userId)).some((g) => g.id === monthly.id),
    }).toEqual({ status: 409, itemRowSurvives: true, itsGoalSurvives: true });
  });

  it('NEGATIVE CONTROL — the same race when the read found ONE item was already a 409', async () => {
    const seed = createTestApp({ now });
    const { cookie, userId } = await signedInOwner(seed);
    const { monthly } = await makeLine(seed, cookie);
    await seedBacklogItem(seed, userId, monthly.id);
    const late = rawItem(userId, monthly.id);

    const t = createTestApp({
      now,
      overrides: raceOn('backlog', async () => {
        await db.insert(backlogItems).values(late);
      }),
    });
    expect((await t.fetch(`/api/goals/${monthly.id}?cascade=true`, { method: 'DELETE', cookie })).status).toBe(409);
  });

  /*
   * RETIRED - "a WEEKLY FOCUS created between the read and the batch is a 409, not an orphan". The
   * `weekly_focus` table is deleted (R-rm-2), so the row it raced on cannot exist. The two arms above
   * carry the identical guarantee for the two tables that remain, and the cascade still states an exact
   * count - `0` included - for every one of them.
   */
  it('the ordinary cascade still succeeds and still reports its counts (no false 409)', async () => {
    const t = createTestApp({ now });
    const { cookie, userId } = await signedInOwner(t);
    const { life, weekly, quarterly } = await makeLine(t, cookie);
    await seedTask(t, userId, weekly.id, WEEK);
    await seedBacklogItem(t, userId, quarterly.id);

    const res = await t.fetch(`/api/goals/${life.id}?cascade=true`, { method: 'DELETE', cookie });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { removed: Record<string, number> };
    expect(body.removed).toMatchObject({ goals: 6, weeklyGoals: 1, tasks: 1, backlogItems: 1 });
  });

  it('a childless goal with nothing under it still deletes cleanly (the all-zero case)', async () => {
    const t = createTestApp({ now });
    const { cookie } = await signedInOwner(t);
    const life = await createGoal(t, cookie, { title: 'Solo', horizon: 'Life' });
    const res = await t.fetch(`/api/goals/${life.id}`, { method: 'DELETE', cookie });
    expect(res.status).toBe(200);
    expect((await res.json()) as unknown).toMatchObject({
      deleted: true,
      removed: { goals: 1, weeklyGoals: 0, tasks: 0, backlogItems: 0, taskEvents: 0 },
    });
  });
});
