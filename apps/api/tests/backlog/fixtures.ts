import type { Horizon } from '@goal-cascade/shared';
import { GuardedBatch } from '../../src/application/services';
import {
  IBacklogRepo,
  IGoalRepo,
  IIdeaRepo,
  ILearningRepo,
  ITaskRepo,
  IWeeklyFocusRepo,
} from '../../src/application/ports';
import type { Goal, WeeklyFocus } from '../../src/domain/entities';
import { ids, type TestApp } from '../helpers/app';

/**
 * Direct-repo fixtures for the backlog / capture / bootstrap suites.
 *
 * `GoalService` and `PlanService` belong to other agents and are still stubs, so a goal tree and a
 * weekly focus cannot be built over HTTP yet. These write the same rows those services will, through
 * the SAME ports and the SAME `GuardedBatch` — so nothing here depends on a private table shape, and
 * when those services land these helpers can be swapped for `POST /goals` + `PUT /plan` one call at a
 * time without touching a single assertion.
 */

export type Fixture = { t: TestApp; userId: string; cookie: string };

export async function seedGoal(
  f: Fixture,
  input: { parentId: string | null; horizon: Horizon; title: string; period?: string; why?: string },
): Promise<Goal> {
  const c = f.t.container();
  const goal: Goal = {
    id: ids.ulid(),
    userId: f.userId,
    parentId: input.parentId,
    horizon: input.horizon,
    title: input.title,
    why: input.why ?? '',
    pulse: 'On track',
    period: input.period ?? '',
    createdAt: f.t.clock.nowIso(),
    updatedAt: f.t.clock.nowIso(),
    version: 1,
  };
  await c.resolve(GuardedBatch).run([{ label: 'seed.goal', stmt: c.resolve<IGoalRepo>(IGoalRepo).insertStmt(goal) }]);
  return goal;
}

/** D-2 — "active this week" is exactly "a `weekly_focus` row exists for this week". */
export async function seedFocus(f: Fixture, goalId: string, weekStart: string, sentence = 'Ship the thing'): Promise<WeeklyFocus> {
  const c = f.t.container();
  const focus: WeeklyFocus = {
    id: ids.ulid(),
    userId: f.userId,
    goalId,
    weekStart,
    sentence,
    createdAt: f.t.clock.nowIso(),
    updatedAt: f.t.clock.nowIso(),
  };
  await c
    .resolve(GuardedBatch)
    .run([{ label: 'seed.focus', stmt: c.resolve<IWeeklyFocusRepo>(IWeeklyFocusRepo).insertStmt(focus) }]);
  return focus;
}

/** Q-5 — the goals agent's cascade nulls Idea/Learning tags rather than deleting them (S-idea-7-1). */
export async function deleteGoalAndUntag(f: Fixture, goalId: string): Promise<void> {
  const c = f.t.container();
  const ideas = c.resolve<IIdeaRepo>(IIdeaRepo);
  const learnings = c.resolve<ILearningRepo>(ILearningRepo);
  const taggedIdeas = (await ideas.listAll(f.userId)).filter((i) => i.goalId === goalId).length;
  const taggedLearnings = (await learnings.listAll(f.userId)).filter((l) => l.goalId === goalId).length;

  await c.resolve(GuardedBatch).run([
    ...(taggedIdeas > 0
      ? [{ label: 'seed.untagIdeas', stmt: ideas.untagByGoalsStmt(f.userId, [goalId]), expectedChanges: taggedIdeas }]
      : []),
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
