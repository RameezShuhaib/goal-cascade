import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { IGoalRepo, ILearningRepo } from '../src/application/ports';
import { GuardedBatch } from '../src/application/services';
import type { Goal, Learning } from '../src/domain/entities';
import { ConcurrencyError } from '../src/domain/errors';
import { createDb } from '../src/infrastructure/persistence/db';
import { goals, learnings } from '../src/infrastructure/persistence/schema';
import { createTestApp, env, ids, signedInOwner } from './helpers/app';

/**
 * D1 has no interactive transactions, and a zero-row UPDATE is NOT a SQL error — so a failed
 * optimistic-concurrency guard would, on its own, let the unconditional INSERTs of the same batch
 * commit. That is exactly the shape of this product's writes: "insert the activity event AND update the
 * task", "insert the task AND mark the backlog item converted".
 *
 * `GuardedBatch` closes that by prepending a precondition statement that trips `_guard`'s `CHECK (0)`
 * and rolls the whole batch back. These tests prove the ROLLBACK, not just the error — a version that
 * threw after committing the insert would pass a weaker assertion.
 */
const t = createTestApp({ now: '2026-08-31T10:00:00.000Z' });
const db = createDb(env.DB);

const makeGoal = (userId: string): Goal => ({
  id: ids.ulid(),
  userId,
  parentId: null,
  horizon: 'Life',
  title: 'Financial freedom',
  why: '',
  pulse: 'On track',
  period: '',
  createdAt: t.clock.nowIso(),
  updatedAt: t.clock.nowIso(),
  version: 1,
});

const makeLearning = (userId: string): Learning => ({
  id: ids.ulid(),
  userId,
  goalId: null,
  text: 'mornings are the only hours that hold',
  applied: false,
  capturedAt: t.clock.nowIso(),
  createdAt: t.clock.nowIso(),
  updatedAt: t.clock.nowIso(),
  version: 1,
});

describe('GuardedBatch', () => {
  it('runs every statement atomically and reports the row counts', async () => {
    const { userId } = await signedInOwner(t);
    const c = t.container();
    const goal = makeGoal(userId);
    const learning = makeLearning(userId);

    await c.resolve(GuardedBatch).run([
      { label: 'goal.insert', stmt: c.resolve<IGoalRepo>(IGoalRepo).insertStmt(goal) },
      { label: 'learning.insert', stmt: c.resolve<ILearningRepo>(ILearningRepo).insertStmt(learning) },
    ]);

    expect(await db.select().from(goals).where(eq(goals.id, goal.id)).get()).toBeDefined();
    expect(await db.select().from(learnings).where(eq(learnings.id, learning.id)).get()).toBeDefined();
  });

  it('a guarded update whose version is stale raises CONCURRENT_UPDATE', async () => {
    const { userId } = await signedInOwner(t);
    const c = t.container();
    const goal = makeGoal(userId);
    await c.resolve(GuardedBatch).run([{ label: 'goal.insert', stmt: c.resolve<IGoalRepo>(IGoalRepo).insertStmt(goal) }]);

    const stale = c.resolve<IGoalRepo>(IGoalRepo).updateGuardedStmt(userId, goal.id, 99, {
      title: 'clobbered',
      updatedAt: t.clock.nowIso(),
      version: 100,
    });
    await expect(c.resolve(GuardedBatch).run([{ label: 'goal.update', stmt: stale }])).rejects.toBeInstanceOf(ConcurrencyError);

    const row = await db.select().from(goals).where(eq(goals.id, goal.id)).get();
    expect(row?.title).toBe('Financial freedom');
    expect(row?.version).toBe(1);
  });

  it('THE POINT: a failed guard rolls back the UNCONDITIONAL inserts in the same batch too', async () => {
    const { userId } = await signedInOwner(t);
    const c = t.container();
    const goal = makeGoal(userId);
    await c.resolve(GuardedBatch).run([{ label: 'goal.insert', stmt: c.resolve<IGoalRepo>(IGoalRepo).insertStmt(goal) }]);

    // The real shape of a command: append a log row AND update the entity, guarded on its version.
    const orphanLearning = makeLearning(userId);
    const stale = c.resolve<IGoalRepo>(IGoalRepo).updateGuardedStmt(userId, goal.id, 42, {
      title: 'renamed',
      updatedAt: t.clock.nowIso(),
      version: 43,
    });

    await expect(
      c.resolve(GuardedBatch).run([
        { label: 'learning.insert', stmt: c.resolve<ILearningRepo>(ILearningRepo).insertStmt(orphanLearning) },
        { label: 'goal.update', stmt: stale },
      ]),
    ).rejects.toBeInstanceOf(ConcurrencyError);

    // Without the precondition statement, this row would exist — an event with no cause.
    expect(await db.select().from(learnings).where(eq(learnings.id, orphanLearning.id)).get()).toBeUndefined();
    expect((await db.select().from(goals).where(eq(goals.id, goal.id)).get())?.title).toBe('Financial freedom');
  });

  it('a fresh version wins the race and both statements commit', async () => {
    const { userId } = await signedInOwner(t);
    const c = t.container();
    const goal = makeGoal(userId);
    await c.resolve(GuardedBatch).run([{ label: 'goal.insert', stmt: c.resolve<IGoalRepo>(IGoalRepo).insertStmt(goal) }]);

    const learning = makeLearning(userId);
    await c.resolve(GuardedBatch).run([
      { label: 'learning.insert', stmt: c.resolve<ILearningRepo>(ILearningRepo).insertStmt(learning) },
      {
        label: 'goal.update',
        stmt: c
          .resolve<IGoalRepo>(IGoalRepo)
          .updateGuardedStmt(userId, goal.id, 1, { title: 'renamed', updatedAt: t.clock.nowIso(), version: 2 }),
      },
    ]);

    const row = await db.select().from(goals).where(eq(goals.id, goal.id)).get();
    expect(row).toMatchObject({ title: 'renamed', version: 2 });
    expect(await db.select().from(learnings).where(eq(learnings.id, learning.id)).get()).toBeDefined();
  });

  it('R-auth-2 — a guarded update scoped to another owner changes nothing and is refused', async () => {
    const a = await signedInOwner(t);
    const b = await signedInOwner(t);
    const c = t.container();
    const goal = makeGoal(a.userId);
    await c.resolve(GuardedBatch).run([{ label: 'goal.insert', stmt: c.resolve<IGoalRepo>(IGoalRepo).insertStmt(goal) }]);

    const cross = c
      .resolve<IGoalRepo>(IGoalRepo)
      .updateGuardedStmt(b.userId, goal.id, 1, { title: 'stolen', updatedAt: t.clock.nowIso(), version: 2 });
    await expect(c.resolve(GuardedBatch).run([{ label: 'goal.update', stmt: cross }])).rejects.toBeInstanceOf(ConcurrencyError);
    expect((await db.select().from(goals).where(eq(goals.id, goal.id)).get())?.title).toBe('Financial freedom');
  });

  it('an empty batch is a no-op rather than an error', async () => {
    await expect(t.container().resolve(GuardedBatch).run([])).resolves.toEqual([]);
  });

  it('`expectedChanges: 0` allows a statement that may legitimately match nothing', async () => {
    const { userId } = await signedInOwner(t);
    const c = t.container();
    // Nothing to untag — the lazy/best-effort case (e.g. the carry-event insert on a re-read).
    await expect(
      c.resolve(GuardedBatch).run([
        { label: 'learning.untag', stmt: c.resolve<ILearningRepo>(ILearningRepo).untagByGoalsStmt(userId, []), expectedChanges: 0 },
      ]),
    ).resolves.toBeDefined();
  });
});
