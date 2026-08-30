import type {
  BacklogItemResponse,
  BacklogResponse,
  ConvertBacklogItemRequest,
  ConvertBacklogItemResponse,
  CreateBacklogItemRequest,
  DeleteResponse,
  MoveBacklogItemRequest,
  PatchBacklogItemRequest,
} from '@goal-cascade/shared';
import { injectable } from 'tsyringe';
import { NotImplementedError } from '../../domain/errors';
import type { RequestContext } from '../context';

/**
 * FOUNDATION STUB — a feature agent implements these. Rules owed: R-backlog-1..16, Q-4, D-18, D-19, D-20.
 *
 * The hard part here is `convert`, and the schema already does most of the work: the item is MARKED
 * converted, not deleted, `converted_to_task_id` is unique, and `markConvertedGuardedStmt` pins
 * `status = 'open'` inside the guarded batch. Put the task insert and that update in ONE
 * `GuardedBatch.run` and a second conversion cannot create a second task — the guard fails and takes the
 * insert down with it. That is S-backlog-6-2, enforced rather than hoped for.
 */
@injectable()
export class BacklogService {
  /** R-backlog-13 / Q-7 — open items only, newest first. Grouping by branch path is the client's job. */
  async list(_ctx: RequestContext, _query: { goalId?: string }): Promise<BacklogResponse> {
    throw new NotImplementedError('GET /backlog');
  }

  /** R-backlog-2 — a Life goal is refused (`LIFE_GOAL_NO_BACKLOG`), on create and on move. */
  async create(_ctx: RequestContext, _input: CreateBacklogItemRequest): Promise<BacklogItemResponse> {
    throw new NotImplementedError('POST /backlog');
  }

  async patch(_ctx: RequestContext, _id: string, _input: PatchBacklogItemRequest): Promise<BacklogItemResponse> {
    throw new NotImplementedError('PATCH /backlog/:id');
  }

  /** R-backlog-10 / S-backlog-10-1 — `capturedAt` and `fromWeekStart` are UNCHANGED by a move. */
  async move(_ctx: RequestContext, _id: string, _input: MoveBacklogItemRequest): Promise<BacklogItemResponse> {
    throw new NotImplementedError('POST /backlog/:id/move');
  }

  /** R-backlog-10 — the explicit Delete action, and the only thing that removes an item outright. */
  async remove(_ctx: RequestContext, _id: string): Promise<DeleteResponse> {
    throw new NotImplementedError('DELETE /backlog/:id');
  }

  /**
   * R-backlog-6/7/8/9 — the ONE path from backlog to work, in one atomic operation.
   *
   *  - target = an ACTIVE leaf at or under the item's goal (`goalTree.activeLeavesUnder`). Exactly one
   *    candidate → use it; two or more → require `goalId` and refuse to pick (D-18, S-backlog-7-2);
   *    none → `BRANCH_NOT_ACTIVE` (S-backlog-8-3 — the client-side prompt is not the only guard).
   *  - the task inherits the item's title, description and links and logs `Created — pulled from Backlog`.
   *  - a second conversion → `ALREADY_CONVERTED`, and NO second task (S-backlog-6-2).
   */
  async convert(_ctx: RequestContext, _id: string, _input: ConvertBacklogItemRequest): Promise<ConvertBacklogItemResponse> {
    throw new NotImplementedError('POST /backlog/:id/convert-to-task');
  }
}
