import { inject, injectable } from 'tsyringe';
import type { Goal } from '../../domain/entities';
import { DomainError, notFound } from '../../domain/errors';
import { checkCreate, checkMove, descendantIds, isLeaf, type TreeViolation } from '../../domain/goal-tree';
import { IGoalRepo, ITaskRepo } from '../ports';
import type { RequestContext } from '../context';

/**
 * The tree invariants, enforced.
 *
 * SPEC D-5: in the mockup, every constraint in §2 was enforced only by disabling a button — `moveGoal`
 * wrote `parentId` with no descendant or horizon check, `saveGoal` did no rank check — so the store
 * could be driven into an illegal tree (a cycle, Monthly-under-Monthly) with two lines in the console.
 * The "submitted directly" halves of S-goal-5-2, S-goal-5-3, S-goal-6-1 and S-goal-18-1 exist precisely
 * to catch that.
 *
 * This service is deliberately NOT a stub. The foundation ships it, and the goal create/move routes call
 * it BEFORE the (not-yet-implemented) persistence service, so a feature agent cannot ship a create or a
 * move that skips the check — the guard is already in the request path, with tests behind it.
 *
 * It is the only place a `TreeViolation` becomes an HTTP error code, so the two never drift.
 */
@injectable()
export class GoalTreeGuard {
  constructor(
    @inject(IGoalRepo) private readonly goals: IGoalRepo,
    @inject(ITaskRepo) private readonly tasks: ITaskRepo,
  ) {}

  /** R-auth-2/3 — another owner's goal is refused identically to a non-existent one. */
  async requireGoal(ctx: RequestContext, id: string): Promise<Goal> {
    const goal = await this.goals.findById(ctx.userId, id);
    if (!goal) throw notFound('goal');
    return goal;
  }

  /**
   * R-goal-3/4/5/6 — validate a create before anything is written, and (R-goal-28 / D-8) refuse to turn a
   * leaf that still carries open tasks into a parent.
   *
   * Returns the parent (or null for a Life goal) so the caller does not re-read it.
   */
  async assertCanCreate(ctx: RequestContext, input: { horizon: Goal['horizon']; parentId: string | null }): Promise<Goal | null> {
    const all = await this.goals.listAll(ctx.userId);
    this.raise(checkCreate(all, input));
    if (input.parentId === null) return null;

    const parent = all.find((g) => g.id === input.parentId)!;
    await this.assertLeafCanGainAChild(ctx, all, parent.id);
    return parent;
  }

  /**
   * R-goal-16/17/18/21 — validate a move before anything is written. The descendant check runs first
   * (R-goal-19), and the new parent is subject to the same leaf → non-leaf rule as a create.
   */
  async assertCanMove(ctx: RequestContext, goalId: string, targetId: string): Promise<{ goal: Goal; target: Goal }> {
    const all = await this.goals.listAll(ctx.userId);
    if (!all.some((g) => g.id === goalId)) throw notFound('goal');
    this.raise(checkMove(all, goalId, targetId));

    // The subtree that is about to move must not be counted as the target's existing children.
    const moving = new Set([goalId, ...descendantIds(all, goalId)]);
    const remaining = all.filter((g) => !moving.has(g.id));
    await this.assertLeafCanGainAChild(ctx, remaining, targetId);

    return { goal: all.find((g) => g.id === goalId)!, target: all.find((g) => g.id === targetId)! };
  }

  /**
   * R-goal-28 / D-8 — a leaf that gains a child stops being a leaf, and a non-leaf can hold neither a
   * focus nor tasks (R-goal-9/12). The focus is deleted by the caller in the same transaction; open
   * tasks are REFUSED here, because silently re-homing someone's work is worse than a clear error
   * ("move or close them first"). A goal that already has children is unaffected.
   */
  private async assertLeafCanGainAChild(ctx: RequestContext, goals: readonly Goal[], parentId: string): Promise<void> {
    if (!isLeaf(goals, parentId)) return;
    const open = await this.tasks.listOpenByGoals(ctx.userId, [parentId]);
    if (open.length === 0) return;
    throw new DomainError(
      'GOAL_HAS_OPEN_TASKS',
      'this goal has open tasks; move or close them first',
      { goalId: parentId, openTasks: open.length },
    );
  }

  /** The one place a `TreeViolation` becomes an `ErrorCode`. */
  private raise(violation: TreeViolation | null): void {
    if (!violation) return;
    switch (violation.kind) {
      case 'PARENT_REQUIRED':
        throw new DomainError('VALIDATION_FAILED', 'a non-Life goal must have a parent');
      case 'LIFE_GOAL_HAS_PARENT':
        throw new DomainError('VALIDATION_FAILED', 'a Life goal cannot have a parent');
      case 'PARENT_NOT_FOUND':
        // R-auth-3 — "not yours" and "does not exist" must be indistinguishable.
        throw notFound('goal');
      case 'HORIZON_CONFLICT':
        throw new DomainError(
          'HORIZON_CONFLICT',
          `a ${violation.childHorizon} goal cannot sit under a ${violation.parentHorizon} goal`,
          { parentHorizon: violation.parentHorizon, childHorizon: violation.childHorizon },
        );
      case 'WOULD_CREATE_CYCLE':
        throw new DomainError('WOULD_CREATE_CYCLE', 'a goal cannot move under itself or one of its descendants', {
          targetId: violation.targetId,
        });
      case 'LIFE_GOAL_IMMUTABLE':
        throw new DomainError('LIFE_GOAL_IMMUTABLE', 'a Life goal cannot be moved or re-planned');
    }
  }
}
