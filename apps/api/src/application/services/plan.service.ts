import type { PlanEntryView, PlanResponse, SavePlanRequest } from '@goal-cascade/shared';
import { inject, injectable } from 'tsyringe';
import type { Goal, WeeklyFocus } from '../../domain/entities';
import { DomainError, notFound } from '../../domain/errors';
import { isLeaf, orderedTree } from '../../domain/goal-tree';
import type { RequestContext } from '../context';
import { IClock, IGoalRepo, IIdGenerator, IWeeklyFocusRepo } from '../ports';
import type { GuardedWrite } from '../ports/statement';
import { weekView } from './goal.service';
import { GuardedBatch } from './guarded-batch';

/**
 * The weekly plan.
 *
 * D-2 is the whole design: a `weekly_focus` row exists ONLY while a leaf is active in that week, keyed
 * `(userId, goalId, weekStart)`. A blank sentence is a DELETE, never a stored `''` — which is what makes
 * "active" and "dormant" a single fact that cannot disagree with itself, and what lets a PAST week
 * render the sentence it actually had (the mockup's mutable string on the goal could do neither).
 */
@injectable()
export class PlanService {
  constructor(
    @inject(IGoalRepo) private readonly goals: IGoalRepo,
    @inject(IWeeklyFocusRepo) private readonly focuses: IWeeklyFocusRepo,
    @inject(IIdGenerator) private readonly ids: IIdGenerator,
    @inject(IClock) private readonly clock: IClock,
    @inject(GuardedBatch) private readonly batch: GuardedBatch,
  ) {}

  /** R-plan-1 / D-2 — any addressable week's focus set, past weeks included. */
  async get(ctx: RequestContext, week: { weekStart: string }): Promise<PlanResponse> {
    const [goals, rows] = await Promise.all([
      this.goals.listAll(ctx.userId),
      this.focuses.listByWeek(ctx.userId, week.weekStart),
    ]);
    return {
      week: weekView(ctx, week.weekStart),
      entries: this.order(goals, rows).map(entryView),
      serverNow: ctx.now,
    };
  }

  /**
   * R-plan-7 — the whole-week replace, in ONE batch.
   *
   * Every non-Life leaf named with a non-empty sentence gets or keeps a focus; EVERY other focus for that
   * week is removed. A leaf absent from `entries` is cleared, and so is a leaf present with a blank
   * sentence (R-plan-5 / D-9: checking a box without writing a sentence does not activate a branch — the
   * response carries the resulting entries so the client can tell the user the check did not stick,
   * rather than silently discarding it as the mockup did).
   *
   * The save is refused WHOLESALE, never partially applied (Q-3):
   *  - a `weekStart` that is not the current week → `WEEK_NOT_CURRENT` (R-plan-2, S-plan-2-1);
   *  - an entry naming a Life goal or a non-leaf → `NOT_A_LEAF` (R-plan-8, S-plan-8-1);
   *  - an entry naming an unknown goal → 404, indistinguishable from another owner's (R-auth-3).
   *
   * R-plan-6 — clearing a focus does NOT touch that leaf's open tasks: they stay visible in the weeks
   * they belong to (R-task-9). Nothing in this method writes to `tasks`.
   */
  async save(ctx: RequestContext, input: SavePlanRequest): Promise<PlanResponse> {
    // R-plan-2 — planning is current-week-only. The request carries its own `weekStart` precisely so a
    // save that crossed the Monday boundary while the screen was open fails loudly instead of writing
    // into the wrong week.
    if (input.weekStart !== ctx.currentWeekStart) {
      throw new DomainError('WEEK_NOT_CURRENT', 'the plan can only be edited for the current week', {
        weekStart: input.weekStart,
        currentWeekStart: ctx.currentWeekStart,
      });
    }

    const goals = await this.goals.listAll(ctx.userId);
    const seen = new Set<string>();
    const keep = new Map<string, string>();
    for (const entry of input.entries) {
      if (seen.has(entry.goalId)) {
        throw new DomainError('VALIDATION_FAILED', 'the same goal appears twice in this plan', { goalId: entry.goalId });
      }
      seen.add(entry.goalId);

      const goal = goals.find((g) => g.id === entry.goalId);
      if (!goal) throw notFound('goal');
      // R-plan-8 / R-goal-9 — only a non-Life LEAF may hold a focus. Checked for every entry BEFORE any
      // write, so one illegal line refuses the whole save.
      if (goal.parentId === null || !isLeaf(goals, goal.id)) {
        throw new DomainError('NOT_A_LEAF', 'only a non-Life leaf goal can hold a weekly focus', {
          goalId: goal.id,
          horizon: goal.horizon,
          isLeaf: isLeaf(goals, goal.id),
        });
      }
      // R-plan-5 / D-9 — a blank sentence is not a focus. The schema has already trimmed it.
      if (entry.sentence.length > 0) keep.set(goal.id, entry.sentence);
    }

    const existing = await this.focuses.listByWeek(ctx.userId, input.weekStart);
    const now = this.clock.nowIso();
    const writes: GuardedWrite[] = [];

    // The replace is delete-then-insert rather than a per-row diff, because that is what makes it
    // atomic AND race-safe with one precondition: `GuardedBatch` asserts that the week still holds
    // exactly the rows this save read, so a concurrent save on another device loses cleanly with a 409
    // instead of interleaving two half-plans (Q-3). Ids and `createdAt` are carried over for a leaf
    // that keeps its focus, so the row keeps its identity across an edit.
    //
    // Two things this deliberately does NOT do, because either would silently drop the guarantee above:
    //  - it does not delete "the goals I read" — a row the other device added for a goal absent from
    //    that list would survive the replace, and the saved plan would be a MERGE of two plans;
    //  - it does not skip the statement when the week was empty — `expectedChanges: 0` is a real
    //    assertion ("this week still holds nothing"), and omitting it lets a concurrent first-save of a
    //    fresh week be clobbered without a word.
    writes.push({
      label: 'weeklyFocus.replaceWeek',
      stmt: this.focuses.deleteByWeekStmt(ctx.userId, input.weekStart),
      expectedChanges: existing.length,
    });

    const previous = new Map(existing.map((f) => [f.goalId, f]));
    const entries: WeeklyFocus[] = [];
    for (const [goalId, sentence] of keep) {
      const before = previous.get(goalId);
      const focus: WeeklyFocus = {
        id: before?.id ?? this.ids.ulid(),
        userId: ctx.userId,
        goalId,
        weekStart: input.weekStart,
        sentence,
        createdAt: before?.createdAt ?? now,
        updatedAt: now,
      };
      entries.push(focus);
      // The row it replaces is deleted EARLIER in this same batch, so the unique index on
      // (user, goal, week) cannot trip — statements inside a D1 batch run in order, in one transaction.
      writes.push({ label: 'weeklyFocus.insert', stmt: this.focuses.insertStmt(focus) });
    }

    await this.batch.run(writes);
    return { week: weekView(ctx, input.weekStart), entries: this.order(goals, entries).map(entryView), serverNow: ctx.now };
  }

  /** Q-7 — a total, stable order: tree order (parents before children, then `createdAt`, then `id`). */
  private order(goals: readonly Goal[], rows: readonly WeeklyFocus[]): WeeklyFocus[] {
    const rank = new Map(orderedTree(goals).map((g, i) => [g.id, i]));
    return [...rows].sort(
      (a, b) => (rank.get(a.goalId) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.goalId) ?? Number.MAX_SAFE_INTEGER),
    );
  }
}

function entryView(f: WeeklyFocus): PlanEntryView {
  return {
    id: f.id,
    goalId: f.goalId,
    weekStart: f.weekStart,
    sentence: f.sentence,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
  };
}
