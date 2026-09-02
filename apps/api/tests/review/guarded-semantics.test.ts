import { eq } from 'drizzle-orm';
import type { DependencyContainer } from 'tsyringe';
import { describe, expect, it } from 'vitest';
import { ILearningRepo, ITaskEventRepo, ITaskRepo } from '../../src/application/ports';
import { GuardedBatch } from '../../src/application/services';
import type { Task, TaskEvent } from '../../src/domain/entities';
import { ConcurrencyError } from '../../src/domain/errors';
import { createDb } from '../../src/infrastructure/persistence/db';
import { taskEvents, tasks as taskTable } from '../../src/infrastructure/persistence/schema';
import { createTestApp, env, ids, signedInOwner } from '../helpers/app';
import { makeLine, seedTask, tasksUnder } from '../goals/fixtures';

/**
 * REVIEW — `expectedChanges` semantics (attack 2) and the Q-3 "refused wholesale, never partially
 * applied" guarantee.
 *
 * Two agents changed `GuardedBatch` independently and git merged them cleanly. The result was that
 * `expectedChanges: 0` meant "best-effort, assert nothing" in the post-check while `preconditionOf`
 * skipped anything below 1 — so `0` had quietly stopped meaning "must change zero rows" everywhere,
 * including in the callers that compute it from a row count and legitimately reach 0.
 *
 * The semantics are: a NUMBER is asserted exactly (`0` included); `'any'` is the only opt-out, and the
 * lazy carry-log insert is its only caller.
 *
 * ⚠ **A2** — the statements below used to be `weekly_focus` deletes, because `PlanService.save`'s
 * whole-week replace was the sharpest caller of a computed `0`. That table and that service are gone
 * (R-rm-2, R-rm-3). **The semantics they proved are unchanged and now carried by the delete cascade**,
 * which states an exact count for every table it touches — `0` included — so a row created between the
 * read and the batch rolls the whole delete back rather than outliving its goal.
 */
const db = createDb(env.DB);
const now = '2026-08-31T10:00:00.000Z';
const WEEK = '2026-08-31';

describe('REVIEW / attack 2 — `expectedChanges` means what the port says again', () => {
  it('a numeric 0 is an ASSERTION: a DELETE that would remove a row when 0 was expected is a 409', async () => {
    const t = createTestApp({ now });
    const { cookie, userId } = await signedInOwner(t);
    const { weekly } = await makeLine(t, cookie);
    await seedTask(t, userId, weekly.id, WEEK);

    const c = t.container();
    const repo = c.resolve<ITaskRepo>(ITaskRepo);
    // "I read zero tasks under this goal" — but there is one. That must not commit silently, because
    // the row would outlive the goal: there is no FK on `tasks.goal_id` (see `schema.ts`).
    await expect(
      c.resolve(GuardedBatch).run([
        { label: 'task.deleteByGoals', stmt: repo.deleteByGoalsStmt(userId, [weekly.id]), expectedChanges: 0 },
      ]),
    ).rejects.toBeInstanceOf(ConcurrencyError);

    expect(await tasksUnder(t, userId, [weekly.id])).toHaveLength(1); // rolled back
  });

  it('NEGATIVE CONTROL — the same statement with 0 expected and 0 rows present commits', async () => {
    const t = createTestApp({ now });
    const { cookie, userId } = await signedInOwner(t);
    const { weekly } = await makeLine(t, cookie);
    const c = t.container();
    await expect(
      c.resolve(GuardedBatch).run([
        {
          label: 'task.deleteByGoals',
          stmt: c.resolve<ITaskRepo>(ITaskRepo).deleteByGoalsStmt(userId, [weekly.id]),
          expectedChanges: 0,
        },
      ]),
    ).resolves.toBeDefined();
  });

  it("`'any'` is the opt-out, and it tolerates BOTH halves of the carry insert (1 row, then 0)", async () => {
    const t = createTestApp({ now });
    const { cookie, userId } = await signedInOwner(t);
    const { weekly } = await makeLine(t, cookie);
    const task = await seedTask(t, userId, weekly.id, '2026-08-24');

    const c = t.container();
    const events = c.resolve<ITaskEventRepo>(ITaskEventRepo);
    const carried: TaskEvent & { weekStart: string } = {
      id: ids.ulid(),
      userId,
      taskId: task.id,
      kind: 'carried',
      text: 'Carried to week of Mon 31 Aug',
      glyph: '↻',
      detail: null,
      weekStart: WEEK,
      at: `${WEEK}T00:00:00.000Z`,
    };
    // First insert really writes a row; the re-read writes none. Both are correct, both must pass.
    await c.resolve(GuardedBatch).run([{ label: 'e', stmt: events.insertCarriedIgnoreStmt(carried), expectedChanges: 'any' }]);
    await c.resolve(GuardedBatch).run([
      { label: 'e', stmt: events.insertCarriedIgnoreStmt({ ...carried, id: ids.ulid() }), expectedChanges: 'any' },
    ]);

    const rows = await db.select().from(taskEvents).where(eq(taskEvents.taskId, task.id)).all();
    expect(rows.filter((r) => r.kind === 'carried')).toHaveLength(1);
  });

  it('REGRESSION — the carry log still works end to end through a real read (R-task-29 / Q-17)', async () => {
    const t = createTestApp({ now });
    const { cookie, userId } = await signedInOwner(t);
    const { life } = await makeLine(t, cookie);
    const { seedGoal } = await import('../goals/fixtures');
    const past = await seedGoal(t, userId, { parentId: life.id, horizon: 'Weekly', title: 'two weeks ago', periodKey: '2026-08-17' });
    const task = await seedTask(t, userId, past.id, '2026-08-17');

    // Two reads of the same week: the producer must be idempotent, and neither read may 409.
    expect((await t.fetch('/api/tasks', { cookie })).status).toBe(200);
    expect((await t.fetch('/api/tasks', { cookie })).status).toBe(200);

    const rows = await db.select().from(taskEvents).where(eq(taskEvents.taskId, task.id)).all();
    expect(rows.filter((r) => r.kind === 'carried').map((r) => r.weekStart).sort()).toEqual(['2026-08-24', '2026-08-31']);
  });

  it('the empty-id-list statement still passes (its WHERE matches nothing, and 0 is what it expects)', async () => {
    const t = createTestApp({ now });
    const { userId } = await signedInOwner(t);
    const c = t.container();
    await expect(
      c.resolve(GuardedBatch).run([
        { label: 'learning.untag', stmt: c.resolve<ILearningRepo>(ILearningRepo).untagByGoalsStmt(userId, []), expectedChanges: 0 },
      ]),
    ).resolves.toBeDefined();
  });
});

/**
 * SUPERSEDED — the block below used to race `PlanService.save`'s whole-week replace: a concurrent device
 * planning a leaf this save never read had to lose with a 409 rather than the two plans MERGING. That
 * service and that table are deleted (R-rm-2, R-rm-3), so the race is gone with them.
 *
 * **Q-3's guarantee is not gone**, and it moved to the operation that now legitimately reads a set and
 * then deletes it: the goal cascade. The failure mode is the same shape and worse in consequence — a
 * task created under a subtree between the read and the batch would OUTLIVE its goal, because there is
 * no FK on `tasks.goal_id`. The precondition is what turns that into a clean 409.
 */
function raceOnSubtreeRead(write: () => Promise<void>) {
  return (c: DependencyContainer) => {
    const real = c.resolve<ITaskRepo>(ITaskRepo);
    const decorated = Object.create(real) as ITaskRepo;
    // The write lands AFTER the cascade has counted the tasks under the subtree and BEFORE the batch —
    // the exact window `expectedChanges` exists to close.
    decorated.listByGoals = async (userId, goalIds) => {
      const rows = await real.listByGoals(userId, goalIds);
      await write();
      return rows;
    };
    c.registerInstance(ITaskRepo, decorated);
  };
}

const lateTask = (userId: string, goalId: string): Task => ({
  id: ids.ulid(),
  userId,
  goalId,
  title: 'the other device’s task',
  cond: '',
  description: '',
  status: 'open',
  originPeriodKey: WEEK,
  donePeriodKey: null,
  doneAt: null,
  exitReason: null,
  exitedAt: null,
  movedToBacklogItemId: null,
  createdAt: now,
  updatedAt: now,
  version: 1,
});

describe('REVIEW / Q-3 — a concurrent write loses cleanly instead of leaving an orphan', () => {
  it('a task created AFTER the delete read its subtree rolls the whole cascade back with a 409', async () => {
    const seed = createTestApp({ now });
    const { cookie, userId } = await signedInOwner(seed);
    const { life, weekly } = await makeLine(seed, cookie);

    const t = createTestApp({
      now,
      overrides: raceOnSubtreeRead(async () => {
        await db.insert(taskTable).values(lateTask(userId, weekly.id));
      }),
    });
    const res = await t.fetch(`/api/goals/${life.id}?cascade=true`, { method: 'DELETE', cookie });

    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('CONCURRENT_UPDATE');
    // Nothing was half-applied: the line is intact and the late task is not orphaned.
    const { allGoalsRaw } = await import('../goals/fixtures');
    expect(await allGoalsRaw(seed, userId)).toHaveLength(6);
    expect(await tasksUnder(seed, userId, [weekly.id])).toHaveLength(1);
  });

  it('NEGATIVE CONTROL — an uncontended cascade of the same shape still succeeds', async () => {
    const t = createTestApp({ now });
    const { cookie, userId } = await signedInOwner(t);
    const { life, weekly } = await makeLine(t, cookie);
    await seedTask(t, userId, weekly.id, WEEK);

    const res = await t.fetch(`/api/goals/${life.id}?cascade=true`, { method: 'DELETE', cookie });
    expect(res.status).toBe(200);
    const { allGoalsRaw } = await import('../goals/fixtures');
    expect(await allGoalsRaw(t, userId)).toHaveLength(0);
    expect(await tasksUnder(t, userId, [weekly.id])).toHaveLength(0);
  });
});
