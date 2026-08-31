import { inject, injectable } from 'tsyringe';
import type { Goal } from '../../domain/entities';
import { DomainError, notFound } from '../../domain/errors';
import { checkCreate, checkMove, type TreeViolation } from '../../domain/goal-tree';
import { IGoalRepo } from '../ports';
import type { RequestContext } from '../context';

/**
 * The tree invariants, enforced.
 *
 * SPEC D-5: in the mockup, every constraint in §2 was enforced only by disabling a button — `moveGoal`
 * wrote `parentId` with no descendant or horizon check, `saveGoal` did no rank check — so the store
 * could be driven into an illegal tree (a cycle, Monthly-under-Monthly) with two lines in the console.
 * The "submitted directly" halves of S-goal-5-2, S-goal-5-3, S-goal-31-1 and S-goal-18-1 exist precisely
 * to catch that.
 *
 * The goal create/move routes call it BEFORE the service, so a feature agent cannot ship a create or a
 * move that skips the check. It is the only place a `TreeViolation` becomes an HTTP error code.
 *
 * ── ⚠ **A2 (R-lens-27) — what each guard now READS** ──────────────────────────────────────────────
 *
 * Both used to call `IGoalRepo.listAll` — the whole goal table — and `POST /goals` ran that read THREE
 * times per request (guard, service, response snapshot). They now read exactly what they compare:
 *
 *  - **create → ONE ROW.** `checkCreate` compares two ranks and needs nothing else. `findById(parentId)`.
 *  - **move → ONE SUBTREE**, as a recursive CTE, to prove the target is not inside it. It returns just
 *    the root when the moved goal is **Weekly**, which is terminal (R-goal-31) and can have no
 *    descendants at all — so the commonest move in the redesigned product costs one row.
 *
 * ⚠ **A2 (R-goal-42) — the `GOAL_HAS_OPEN_TASKS` guard is DELETED, and the defect class with it.**
 *
 * `assertLeafCanGainAChild` refused to turn a leaf carrying open tasks into a parent, because those tasks
 * would otherwise be silently re-homed (R-goal-28, D-8). That transition is now **unreachable**: only
 * Weekly goals hold tasks (R-goal-39), and a Weekly goal can never gain a child (R-goal-31). Adding a
 * child to a goal, or moving a goal under it, moves nothing, deletes nothing and refuses nothing
 * (S-goal-42-1). This is the one place the redesign removes a class of defect outright rather than
 * relocating it — so the guard is deleted rather than left in place doing nothing.
 */
@injectable()
export class GoalTreeGuard {
  constructor(@inject(IGoalRepo) private readonly goals: IGoalRepo) {}

  /** R-auth-2/3 — another owner's goal is refused identically to a non-existent one. */
  async requireGoal(ctx: RequestContext, id: string): Promise<Goal> {
    const goal = await this.goals.findById(ctx.userId, id);
    if (!goal) throw notFound('goal');
    return goal;
  }

  /**
   * R-goal-3/4/5/31/32 — validate a create before anything is written. **One row read.**
   *
   * Returns the parent (or null for a Life goal) so the caller does not re-read it.
   */
  async assertCanCreate(ctx: RequestContext, input: { horizon: Goal['horizon']; parentId: string | null }): Promise<Goal | null> {
    const parent = input.parentId === null ? null : await this.goals.findById(ctx.userId, input.parentId);
    this.raise(checkCreate(input, parent));
    return parent;
  }

  /**
   * R-goal-16/17/18/21 — validate a move before anything is written. The descendant check runs first
   * (R-goal-19), which is what makes a Monthly child of the moved Quarterly goal read "its own
   * descendant" rather than "horizon conflict".
   *
   * ⚠ **A2** — Move remains available on a **Weekly** goal (R-goal-40, SPEC Q-24): forbidding it would
   * make Weekly the only horizon in the product that cannot be corrected after the fact, and R-task-49's
   * inference makes a wrong parent MORE likely, not less, because it picks the parent for you. What Move
   * may never change is the goal's WEEK — that guard is in `GoalService.move`, where the write is.
   */
  async assertCanMove(ctx: RequestContext, goalId: string, targetId: string): Promise<{ goal: Goal; target: Goal }> {
    const goal = await this.goals.findById(ctx.userId, goalId);
    if (!goal) throw notFound('goal');
    const target = await this.goals.findById(ctx.userId, targetId);
    // Zero rows below the root when the moved goal is Weekly: it is terminal, so it has no subtree.
    const descendants = new Set((await this.goals.subtreeIds(ctx.userId, goalId)).filter((id) => id !== goalId));
    this.raise(checkMove(goal, target, descendants, goalId, targetId));
    return { goal, target: target! };
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
