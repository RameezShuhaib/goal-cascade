import type {
  CreateGoalRequest,
  DeleteGoalResponse,
  GoalDetailResponse,
  GoalResponse,
  GoalsResponse,
  MoveGoalRequest,
  PatchGoalRequest,
  ReplanGoalRequest,
} from '@goal-cascade/shared';
import { injectable } from 'tsyringe';
import { NotImplementedError } from '../../domain/errors';
import type { RequestContext } from '../context';

/**
 * FOUNDATION STUB — a feature agent implements these methods. Do not change the signatures, the route
 * shapes, or the schemas they are typed against: three agents inventing three route shapes is exactly
 * what this skeleton exists to prevent.
 *
 * What is already done for you before any of these is called:
 *  - the session exists and `ctx.userId` is the scope (R-auth-2); never take a scope from the body;
 *  - the body/query/params are validated against the shared schema, trimmed and bounded (Q-11/Q-12);
 *  - `POST /goals` and `POST /goals/:id/move` have already passed `GoalTreeGuard` (R-goal-5/6/17/18/21/28),
 *    so by the time `create`/`move` runs, the tree rules hold. Do not re-check them differently — and do
 *    not remove the guard from the route.
 *
 * Rules these owe: R-goal-1..29, Q-5 (cascade delete + counts), Q-7 (ordering), D-3 (periods from today).
 */
@injectable()
export class GoalService {
  /** R-goal-25 — the whole tree, flat, with `week`'s derived flags (`domain/goal-tree.ts`). */
  async list(_ctx: RequestContext, _week: { weekStart: string }): Promise<GoalsResponse> {
    throw new NotImplementedError('GET /goals');
  }

  /** R-goal-27 / R-backlog-11/12 / R-learning-5 — the detail screen in one request. */
  async detail(_ctx: RequestContext, _id: string, _week: { weekStart: string }): Promise<GoalDetailResponse> {
    throw new NotImplementedError('GET /goals/:id');
  }

  /** R-goal-13 / D-3 — `period` defaults from the horizon and TODAY (`goalTree.defaultPeriod`). */
  async create(_ctx: RequestContext, _input: CreateGoalRequest): Promise<GoalResponse> {
    throw new NotImplementedError('POST /goals');
  }

  /** R-goal-14 — title/why/period/pulse only; horizon and parent are immutable through edit. */
  async patch(_ctx: RequestContext, _id: string, _input: PatchGoalRequest): Promise<GoalResponse> {
    throw new NotImplementedError('PATCH /goals/:id');
  }

  /**
   * R-goal-16 — children move with the goal. R-goal-28: if the TARGET was a leaf, its current-week focus
   * must be deleted in the SAME transaction, or a focus is left on a non-leaf (D-8's silent-resurrection bug).
   */
  async move(_ctx: RequestContext, _id: string, _input: MoveGoalRequest): Promise<GoalResponse> {
    throw new NotImplementedError('POST /goals/:id/move');
  }

  /** R-goal-22/23 — a new period plus an OPTIONAL reason; refuse a Life goal (`LIFE_GOAL_IMMUTABLE`). */
  async replan(_ctx: RequestContext, _id: string, _input: ReplanGoalRequest): Promise<GoalResponse> {
    throw new NotImplementedError('POST /goals/:id/replan');
  }

  /**
   * Q-5 — the whole subtree, transactionally: goals, weekly focuses, tasks, task events, backlog items
   * and their links. Idea/Learning tags pointing into it NULL OUT to Unsorted rather than cascading
   * (S-idea-7-1). No soft-delete. Without `cascade` and with children present, refuse
   * `GOAL_HAS_CHILDREN` and put the counts in `details` so the client can render its confirmation.
   */
  async remove(_ctx: RequestContext, _id: string, _opts: { cascade: boolean }): Promise<DeleteGoalResponse> {
    throw new NotImplementedError('DELETE /goals/:id');
  }
}
