import { eq } from 'drizzle-orm';
import type { DependencyContainer } from 'tsyringe';
import { describe, expect, it } from 'vitest';
import { ILearningRepo, ITaskEventRepo, IWeeklyFocusRepo } from '../../src/application/ports';
import { GuardedBatch } from '../../src/application/services';
import type { TaskEvent, WeeklyFocus } from '../../src/domain/entities';
import { ConcurrencyError } from '../../src/domain/errors';
import { createDb } from '../../src/infrastructure/persistence/db';
import { taskEvents, weeklyFocus } from '../../src/infrastructure/persistence/schema';
import { createTestApp, env, ids, signedInOwner } from '../helpers/app';
import { createGoal, makeLine, planIn, savePlan, seedTask } from '../goals/fixtures';

/**
 * REVIEW — `expectedChanges` semantics (attack 2) and the plan's Q-3 guarantee.
 *
 * Two agents changed `GuardedBatch` independently and git merged them cleanly. The result was that
 * `expectedChanges: 0` meant "best-effort, assert nothing" in the post-check while `preconditionOf`
 * skipped anything below 1 — so `0` had quietly stopped meaning "must change zero rows" everywhere,
 * including in the two callers that computed it from a row count (`GoalService.remove`,
 * `PlanService.save`) and would legitimately reach 0.
 *
 * The semantics are now: a NUMBER is asserted exactly (`0` included); `'any'` is the only opt-out, and
 * the lazy carry-log insert is its only caller.
 */
const db = createDb(env.DB);
const now = '2026-08-31T10:00:00.000Z';
const WEEK = '2026-08-31';

describe('REVIEW / attack 2 — `expectedChanges` means what the port says again', () => {
  it('a numeric 0 is an ASSERTION: a DELETE that would remove a row when 0 was expected is a 409', async () => {
    const t = createTestApp({ now });
    const { cookie, userId } = await signedInOwner(t);
    const { monthly } = await makeLine(t, cookie);
    await savePlan(t, cookie, WEEK, [{ goalId: monthly.id, sentence: 'live' }]);

    const c = t.container();
    const focuses = c.resolve<IWeeklyFocusRepo>(IWeeklyFocusRepo);
    // "I read zero rows for this week" — but there is one. That must not commit silently.
    await expect(
      c.resolve(GuardedBatch).run([
        { label: 'focus.deleteWeek', stmt: focuses.deleteByWeekStmt(userId, WEEK), expectedChanges: 0 },
      ]),
    ).rejects.toBeInstanceOf(ConcurrencyError);

    expect((await planIn(t, cookie)).entries).toHaveLength(1); // rolled back
  });

  it('NEGATIVE CONTROL — the same statement with 0 expected and 0 rows present commits', async () => {
    const t = createTestApp({ now });
    const { cookie, userId } = await signedInOwner(t);
    await makeLine(t, cookie);
    const c = t.container();
    await expect(
      c.resolve(GuardedBatch).run([
        {
          label: 'focus.deleteWeek',
          stmt: c.resolve<IWeeklyFocusRepo>(IWeeklyFocusRepo).deleteByWeekStmt(userId, WEEK),
          expectedChanges: 0,
        },
      ]),
    ).resolves.toBeDefined();
  });

  it("`'any'` is the opt-out, and it tolerates BOTH halves of the carry insert (1 row, then 0)", async () => {
    const t = createTestApp({ now });
    const { cookie, userId } = await signedInOwner(t);
    const { monthly } = await makeLine(t, cookie);
    await savePlan(t, cookie, WEEK, [{ goalId: monthly.id, sentence: 'live' }]);
    const task = await seedTask(t, userId, monthly.id, '2026-08-24');

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
    const { monthly } = await makeLine(t, cookie);
    await savePlan(t, cookie, WEEK, [{ goalId: monthly.id, sentence: 'live' }]);
    const task = await seedTask(t, userId, monthly.id, '2026-08-17');

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
 * Q-3 — "the save carries the weekStart plus a plan version; a stale version is refused WHOLESALE, never
 * partially applied". `docs/work/03-goals-plan/build.md` §3.4 claims the exact-row-count precondition
 * delivers that. It did not, in two ways:
 *
 *  - the delete targeted only the goal ids the save had READ, so a row another device added for a goal
 *    absent from that list survived the replace and the stored plan became a MERGE of two plans;
 *  - when the week was empty the statement was skipped entirely, so a concurrent first save of a fresh
 *    week was clobbered with no precondition at all.
 */
function raceOnPlanRead(write: () => Promise<void>) {
  return (c: DependencyContainer) => {
    const real = c.resolve<IWeeklyFocusRepo>(IWeeklyFocusRepo);
    const decorated = Object.create(real) as IWeeklyFocusRepo;
    decorated.listByWeek = async (userId, weekStart) => {
      const rows = await real.listByWeek(userId, weekStart);
      await write();
      return rows;
    };
    c.registerInstance(IWeeklyFocusRepo, decorated);
  };
}

const focusRow = (userId: string, goalId: string): WeeklyFocus => ({
  id: ids.ulid(),
  userId,
  goalId,
  weekStart: WEEK,
  sentence: 'the other device’s plan',
  createdAt: now,
  updatedAt: now,
});

describe('REVIEW / Q-3 — a concurrent plan save loses cleanly instead of merging', () => {
  it('the week was EMPTY when this save read it, and another device planned a leaf meanwhile → 409', async () => {
    const seed = createTestApp({ now });
    const { cookie, userId } = await signedInOwner(seed);
    const { quarterly, monthly } = await makeLine(seed, cookie);
    const other = await createGoal(seed, cookie, { title: 'Other leaf', horizon: 'Monthly', parentId: quarterly.id });

    const t = createTestApp({
      now,
      overrides: raceOnPlanRead(async () => {
        await db.insert(weeklyFocus).values(focusRow(userId, other.id));
      }),
    });
    const res = await savePlan(t, cookie, WEEK, [{ goalId: monthly.id, sentence: 'mine' }]);

    expect(res.status).toBe(409);
    // The other device's plan stands, whole; this save wrote nothing.
    expect((await planIn(seed, cookie)).entries.map((e) => e.goalId)).toEqual([other.id]);
  });

  it('the week held one row and another device added a SECOND for a goal this save never read → 409', async () => {
    const seed = createTestApp({ now });
    const { cookie, userId } = await signedInOwner(seed);
    const { quarterly, monthly } = await makeLine(seed, cookie);
    const other = await createGoal(seed, cookie, { title: 'Other leaf', horizon: 'Monthly', parentId: quarterly.id });
    await savePlan(seed, cookie, WEEK, [{ goalId: monthly.id, sentence: 'mine' }]);

    const t = createTestApp({
      now,
      overrides: raceOnPlanRead(async () => {
        await db.insert(weeklyFocus).values(focusRow(userId, other.id));
      }),
    });
    // This save intends {monthly} only — i.e. it believes `other` is dormant. Applying it as written
    // would leave `other` active: a plan neither device asked for.
    const res = await savePlan(t, cookie, WEEK, [{ goalId: monthly.id, sentence: 'mine, again' }]);

    expect(res.status).toBe(409);
    const after = (await planIn(seed, cookie)).entries;
    expect(after.map((e) => e.sentence).sort()).toEqual(['mine', 'the other device’s plan']);
  });

  it('NEGATIVE CONTROL — an uncontended save of the same shape still succeeds', async () => {
    const t = createTestApp({ now });
    const { cookie } = await signedInOwner(t);
    const { quarterly, monthly } = await makeLine(t, cookie);
    const other = await createGoal(t, cookie, { title: 'Other leaf', horizon: 'Monthly', parentId: quarterly.id });

    expect((await savePlan(t, cookie, WEEK, [{ goalId: other.id, sentence: 'first' }])).status).toBe(200);
    expect((await savePlan(t, cookie, WEEK, [{ goalId: monthly.id, sentence: 'second' }])).status).toBe(200);
    expect((await planIn(t, cookie)).entries.map((e) => e.goalId)).toEqual([monthly.id]);
  });
});
