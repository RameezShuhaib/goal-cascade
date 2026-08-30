import type { PlanResponse, SavePlanRequest } from '@goal-cascade/shared';
import { injectable } from 'tsyringe';
import { NotImplementedError } from '../../domain/errors';
import type { RequestContext } from '../context';

/**
 * FOUNDATION STUB — a feature agent implements these. Rules owed: R-plan-1..12, Q-3, D-2, D-9.
 *
 * The model is already fixed by the schema and must not be reinterpreted: a `weekly_focus` row exists
 * ONLY while a leaf is active in that week. A blank sentence is a DELETE, never a stored `''` — that is
 * what makes "active" and "dormant" a single fact instead of two that can disagree.
 */
@injectable()
export class PlanService {
  /**
   * R-plan-1 / D-2 — any week's focus set, including past ones: a past week renders the sentences it
   * actually had, which the mockup's mutable string could never do.
   */
  async get(_ctx: RequestContext, _week: { weekStart: string }): Promise<PlanResponse> {
    throw new NotImplementedError('GET /plan');
  }

  /**
   * R-plan-7 — the whole-week replace, in ONE transaction: named leaves with a non-empty sentence get or
   * keep a focus; EVERY other non-Life leaf's focus for that week is removed.
   *
   * Refuse the whole save (never apply it partially, Q-3) when:
   *  - `weekStart` is not the current week → `WEEK_NOT_CURRENT` (R-plan-2, S-plan-2-1);
   *  - any entry names a Life goal or a non-leaf → `NOT_A_LEAF` (R-plan-8, S-plan-8-1).
   *
   * R-plan-6 — clearing a focus must NOT touch that leaf's open tasks; they stay visible (R-task-9).
   */
  async save(_ctx: RequestContext, _input: SavePlanRequest): Promise<PlanResponse> {
    throw new NotImplementedError('PUT /plan');
  }
}
