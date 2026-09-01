import type { Horizon } from '@goal-cascade/shared';
import { GuardedBatch } from '../../src/application/services';
import { IBacklogRepo, IGoalRepo, ILearningRepo, ITaskRepo } from '../../src/application/ports';
import type { Goal } from '../../src/domain/entities';
import { labelOf } from '@goal-cascade/shared';
import { ids, type TestApp } from '../helpers/app';

/**
 * Direct-repo fixtures for the backlog / capture / bootstrap suites.
 *
 * They write through the SAME ports and the SAME `GuardedBatch` the services use, so nothing here
 * depends on a private table shape. What they buy that HTTP cannot is a goal in a PAST period, which
 * R-goal-36 refuses through the product deliberately and permanently.
 *
 * ⚠ **A2 (R-rm-2)** — `seedFocus` is gone with `weekly_focus`. A week's intention is a `seedGoal` with
 * `horizon: 'Weekly'` and the week's Monday as its `periodKey`, and several under one parent is how a
 * week holds several intentions (R-goal-31).
 */

export type Fixture = { t: TestApp; userId: string; cookie: string };

export async function seedGoal(
  f: Fixture,
  input: { parentId: string | null; horizon: Horizon; title: string; periodKey?: string; why?: string },
): Promise<Goal> {
  const c = f.t.container();
  const periodKey = input.periodKey ?? '';
  const goal: Goal = {
    id: ids.ulid(),
    userId: f.userId,
    parentId: input.parentId,
    horizon: input.horizon,
    title: input.title,
    why: input.why ?? '',
    pulse: 'On track',
    periodKey,
    period: labelOf(input.horizon, periodKey),
    createdAt: f.t.clock.nowIso(),
    updatedAt: f.t.clock.nowIso(),
    version: 1,
  };
  await c.resolve(GuardedBatch).run([{ label: 'seed.goal', stmt: c.resolve<IGoalRepo>(IGoalRepo).insertStmt(goal) }]);
  return goal;
}

/** Q-5 — the goals agent's cascade nulls Learning tags rather than deleting them. */
export async function deleteGoalAndUntag(f: Fixture, goalId: string): Promise<void> {
  const c = f.t.container();
  const learnings = c.resolve<ILearningRepo>(ILearningRepo);
  const taggedLearnings = (await learnings.listAll(f.userId)).filter((l) => l.goalId === goalId).length;

  await c.resolve(GuardedBatch).run([
    ...(taggedLearnings > 0
      ? [
          {
            label: 'seed.untagLearnings',
            stmt: learnings.untagByGoalsStmt(f.userId, [goalId]),
            expectedChanges: taggedLearnings,
          },
        ]
      : []),
    { label: 'seed.deleteGoal', stmt: c.resolve<IGoalRepo>(IGoalRepo).deleteManyStmt(f.userId, [goalId]), expectedChanges: 1 },
  ]);
}

/** Every open task under `goalIds` — the "exactly one task exists" assertion of S-backlog-6-2. */
export async function openTasksUnder(f: Fixture, goalIds: string[]) {
  return f.t.container().resolve<ITaskRepo>(ITaskRepo).listOpenByGoals(f.userId, goalIds);
}

/** Every backlog row, converted ones included — a list endpoint deliberately hides those (R-backlog-6). */
export async function backlogRow(f: Fixture, id: string) {
  return f.t.container().resolve<IBacklogRepo>(IBacklogRepo).findById(f.userId, id);
}

/**
 * ⚠ **A2 (R-goal-31)** — a **weekly goal** for `weekStart` under `parentId`: the thing that replaced a
 * focus row. Several under one parent in one week is normal — that is how a week holds more than one
 * intention — and it is the only kind of goal a task may hang off (R-goal-39).
 */
export function seedWeeklyGoal(f: Fixture, parentId: string, weekStart: string, title = 'Ship the thing'): Promise<Goal> {
  return seedGoal(f, { parentId, horizon: 'Weekly', title, periodKey: weekStart });
}
