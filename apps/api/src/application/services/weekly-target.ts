import { MAX_WEEKLY_GOALS_PER_WEEK, dateInTimezone, isPastPeriod, labelOf } from '@goal-cascade/shared';
import type { Goal } from '../../domain/entities';
import { DomainError, notFound } from '../../domain/errors';
import type { RequestContext } from '../context';
import type { IGoalRepo, IIdGenerator } from '../ports';

/**
 * **R-backlog-26 / R-task-48 — "which Weekly goal receives this work, for this week", in ONE place.**
 *
 * ⚠ **A8 (R-rm-6) — this module exists because A8 gives the rule a THIRD caller.** Before A8 it was one
 * private method on `BacklogService` (a backlog conversion targeting a week). A8 adds Park (R-task-56)
 * and A11 adds `+ Task` on a Monthly goal with a week chosen (R-task-57, `32-week-selection` §8.3), and
 * three copies of a resolution whose refusals are `AMBIGUOUS_CONVERSION_TARGET` and `NO_WEEKLY_GOAL` is
 * three chances for one of them to pick silently. R-rm-6's whole complaint about the flow it deletes is
 * that a silent pick lost the owner three tasks; the answer is one resolver, not three careful ones.
 *
 * The rule, unchanged from A2 in every particular:
 *
 *  - **exactly one candidate** → used silently.
 *  - **two or more** → `AMBIGUOUS_CONVERSION_TARGET` with `details.candidates`, and the owner chooses.
 *    D-18 is untouched: the mockup took whichever came first in array order, and that id decides which
 *    week the work belongs to for the rest of its life. **Array order is not a decision.**
 *  - **none** → `NO_WEEKLY_GOAL`, unless the caller supplied `inline`, in which case one is created in
 *    the SAME transaction (R-task-48). The caller commits it; nothing here writes.
 *
 * ⚠ **The refusal is the SERVER's**, so a request submitted directly is refused too — the client prompt
 * is never the only guard (S-backlog-26-2, S-task-56-3).
 */

export type WeeklyTargetDeps = { goals: IGoalRepo; ids: IIdGenerator; now: () => string };

export type WeeklyTarget = {
  /** The Weekly goal the work lands on. */
  goal: Goal;
  /** The same row when it was MINTED here, `null` on the ordinary path. Minted once, returned twice. */
  created: Goal | null;
};

/**
 * Resolve the Weekly goal at or under `underGoalId` whose `periodKey` is `weekStart`.
 *
 * `subject` is only used to word the `NO_WEEKLY_GOAL` message — the title of the backlog item or the task
 * being placed — so a refusal names what the owner was trying to place rather than an id.
 */
export async function resolveWeeklyTarget(
  ctx: RequestContext,
  deps: WeeklyTargetDeps,
  args: {
    underGoalId: string;
    weekStart: string;
    subject: string;
    requested?: string | undefined;
    inline?: { parentId: string; title: string } | undefined;
    details?: Record<string, unknown>;
  },
): Promise<WeeklyTarget> {
  const { underGoalId, weekStart, subject, requested, inline } = args;
  const extra = args.details ?? {};
  const candidates = await deps.goals.weeklyUnderForWeek(ctx.userId, underGoalId, weekStart);

  if (requested !== undefined) {
    const chosen = candidates.find((g) => g.id === requested);
    if (chosen) return { goal: chosen, created: null };
    // R-auth-3 — a goal that is not the caller's is indistinguishable from one that does not exist.
    const goal = await deps.goals.findById(ctx.userId, requested);
    if (!goal) throw notFound('goal');
    throw new DomainError('NO_WEEKLY_GOAL', 'that goal is not a weekly goal at or under this one for that week', {
      ...extra,
      goalId: requested,
      weekStart,
      candidates: candidates.map((g) => ({ id: g.id, title: g.title })),
    });
  }

  if (candidates.length === 1) return { goal: candidates[0]!, created: null };
  if (candidates.length > 1) {
    // Not a validation failure: the input was fine, the product has no single answer. Its own code so the
    // client can branch on `error.code` and render a chooser rather than a field error.
    throw new DomainError('AMBIGUOUS_CONVERSION_TARGET', 'more than one weekly goal can receive this — choose one', {
      ...extra,
      weekStart,
      candidates: candidates.map((g) => ({ id: g.id, title: g.title })),
    });
  }

  if (!inline) {
    throw new DomainError('NO_WEEKLY_GOAL', `"${subject}" lands under a weekly goal, and there is none for that week`, {
      ...extra,
      goalId: underGoalId,
      weekStart,
    });
  }
  // Minted ONCE: `goal` and `created` are the same row. It is returned twice so the caller can both hang
  // the work off it and tell the owner it was created — nothing may be created invisibly — without
  // minting a second id.
  const created = await mintWeeklyGoal(ctx, deps, inline, weekStart);
  return { goal: created, created };
}

/**
 * R-task-48 — the inline `New weekly goal` the refusal offers instead of sending the owner away.
 *
 * The parent must be able to hold a Weekly child (R-goal-31/32) and the week must not be past
 * (R-goal-36): this path may not be a way around a rule the ordinary create enforces.
 *
 * ⚠ **A11 / owner ruling — this NEVER fires as a side effect of accepting a default.** `+ Task` on a
 * Monthly goal defaults to the MONTH (R-task-57), so the only way here from a create is that the owner
 * deliberately chose a week that has no Weekly goal under that parent and the client then re-sent with
 * `newWeeklyGoal`. The row it returns is unwritten; the caller commits it in the same batch as the work,
 * so a failure creates neither (S-task-48-2).
 *
 * ⚠ **Q-12's per-week cap is checked HERE, not by the caller.** It used to live on `TaskService`'s own
 * copy of this function, so the backlog conversion had always bypassed it and Park inherited that bypass
 * the moment the rule was extracted — an inline create is the one path that can add a Weekly goal without
 * going through `POST /goals`, and there are now three of them. A rule enforced by whichever caller
 * remembered is a rule with a hole in it.
 */
export async function mintWeeklyGoal(
  ctx: RequestContext,
  deps: WeeklyTargetDeps,
  input: { parentId: string; title: string },
  weekStart: string,
): Promise<Goal> {
  const parent = await deps.goals.findById(ctx.userId, input.parentId);
  if (!parent) throw notFound('goal');
  if (parent.horizon === 'Weekly') {
    throw new DomainError('HORIZON_CONFLICT', 'a weekly goal cannot sit under a weekly goal', {
      parentHorizon: parent.horizon,
      childHorizon: 'Weekly',
    });
  }
  if (isPastPeriod('Weekly', weekStart, dateInTimezone(ctx.now, ctx.tz))) {
    throw new DomainError('PERIOD_IN_PAST', 'a weekly goal cannot be created into a week that has passed', { weekStart });
  }
  const existing = await deps.goals.countWeeklyInWeek(ctx.userId, weekStart);
  if (existing >= MAX_WEEKLY_GOALS_PER_WEEK) {
    throw new DomainError('VALIDATION_FAILED', `a week holds at most ${MAX_WEEKLY_GOALS_PER_WEEK} weekly goals`, {
      weekStart,
      existing,
      max: MAX_WEEKLY_GOALS_PER_WEEK,
    });
  }
  const now = deps.now();
  return {
    id: deps.ids.ulid(),
    userId: ctx.userId,
    parentId: parent.id,
    horizon: 'Weekly',
    title: input.title,
    why: '',
    pulse: 'On track',
    periodKey: weekStart,
    period: labelOf('Weekly', weekStart),
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
}
