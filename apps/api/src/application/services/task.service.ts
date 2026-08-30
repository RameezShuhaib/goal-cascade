import type {
  AddTaskLinkRequest,
  CancelTaskRequest,
  CompleteTaskRequest,
  CreateTaskRequest,
  MoveTaskToBacklogRequest,
  MoveTaskToBacklogResponse,
  PatchTaskRequest,
  TaskDetailResponse,
  TaskResponse,
  TasksResponse,
  UncheckTaskRequest,
} from '@goal-cascade/shared';
import { injectable } from 'tsyringe';
import { NotImplementedError } from '../../domain/errors';
import type { RequestContext } from '../context';

/**
 * FOUNDATION STUB — a feature agent implements these. Rules owed: R-task-1..32, Q-6, Q-17, D-4, D-12, D-15.
 *
 * Three things the foundation has already decided, which an implementation must not work around:
 *
 *  1. **Carrying is derived, not written.** `ITaskRepo.listVisibleInWeek` is the whole of R-task-7/8/32.
 *     There is no carry job, no rewriting of `origin_week_start`, and no cron in this product.
 *  2. **Weeks are absolute Monday dates** (D-1). A request may name a week by offset; resolve it with
 *     `domain/weeks.weekStartFromOffset(ctx.currentWeekStart, offset)` at the edge and never store one.
 *  3. **An exit keeps the row** (D-15). Move-to-Backlog and Cancel set `status`, `exitReason` and
 *     `exitedAt`; they never delete, because the `Moved to Backlog` / `Canceled` timeline entries the
 *     ruleset requires cannot live on a deleted row.
 *
 * Every one of these operations appends exactly one activity event per real change (R-task-30/31), in
 * the SAME guarded batch as the write — an event that can be committed without its cause, or vice versa,
 * is a lie in the timeline.
 */
@injectable()
export class TaskService {
  /**
   * R-nav-8 — the tasks visible in one week, plus that week's plan.
   *
   * R-task-29 / Q-17 — this read is also where the cosmetic `Carried to week of …` entries are produced,
   * lazily and idempotently, via `ITaskEventRepo.insertCarriedIgnoreStmt` (unique on
   * `(user, task, week_start)` for `kind='carried'`). A re-read, a refresh, or two devices opening the
   * same new week at once must add nothing the second time.
   */
  async list(_ctx: RequestContext, _query: { weekStart: string; goalId?: string }): Promise<TasksResponse> {
    throw new NotImplementedError('GET /tasks');
  }

  /** R-task-22 — the detail sheet: the task plus its full, newest-first activity log. */
  async get(_ctx: RequestContext, _id: string, _week: { weekStart: string }): Promise<TaskDetailResponse> {
    throw new NotImplementedError('GET /tasks/:id');
  }

  /**
   * R-task-4/5/6 — `originWeekStart` is ALWAYS the current week regardless of the week being viewed, and
   * the target must be an ACTIVE non-Life leaf: `NOT_A_LEAF` or `BRANCH_NOT_ACTIVE`, never a fallback
   * goal (D-10). `source` decides which `Created — …` line is logged (R-task-30).
   */
  async create(_ctx: RequestContext, _input: CreateTaskRequest): Promise<TaskResponse> {
    throw new NotImplementedError('POST /tasks');
  }

  /** R-task-23/27 — one event per changed field (Renamed / Done-condition edited / Description updated), values truncated. */
  async patch(_ctx: RequestContext, _id: string, _input: PatchTaskRequest): Promise<TaskResponse> {
    throw new NotImplementedError('PATCH /tasks/:id');
  }

  /**
   * R-task-14 — completable in ANY viewed week, including past ones. Sets `doneWeekStart` to the named
   * week and `doneAt` to now (D-4: never "today" stamped into a week that ended a fortnight ago).
   * A week before `originWeekStart`, or a future week, is `WEEK_OUT_OF_RANGE` (S-task-14-2).
   */
  async complete(_ctx: RequestContext, _id: string, _input: CompleteTaskRequest): Promise<TaskResponse> {
    throw new NotImplementedError('POST /tasks/:id/complete');
  }

  /**
   * R-task-19/20/21 — clears `doneWeekStart` and `doneAt`, KEEPS `originWeekStart` (so the task carries
   * back with the carry label its real age earns), does not re-parent, and does not require the leaf to
   * be active. An unchanged or blank `cond` writes nothing and logs nothing (S-task-21-3).
   */
  async uncheck(_ctx: RequestContext, _id: string, _input: UncheckTaskRequest): Promise<TaskResponse> {
    throw new NotImplementedError('POST /tasks/:id/uncheck');
  }

  /**
   * R-task-15/17 — open tasks only (`TASK_ALREADY_EXITED` otherwise). One transaction: the task gets its
   * terminal status and reason, and a backlog item appears on the task's OWN goal carrying title,
   * description and links, with `fromWeekStart` = the week the task was live in (D-12).
   */
  async moveToBacklog(_ctx: RequestContext, _id: string, _input: MoveTaskToBacklogRequest): Promise<MoveTaskToBacklogResponse> {
    throw new NotImplementedError('POST /tasks/:id/move-to-backlog');
  }

  /** R-task-16/17 — open tasks only. The optional reason is RETAINED on the record (D-15), not dropped. */
  async cancel(_ctx: RequestContext, _id: string, _input: CancelTaskRequest): Promise<TaskResponse> {
    throw new NotImplementedError('POST /tasks/:id/cancel');
  }

  /** R-task-24 — logs `Link added: <host>` (hostname minus a leading `www.`, unparseable → 28 chars + `…`). */
  async addLink(_ctx: RequestContext, _id: string, _input: AddTaskLinkRequest): Promise<TaskResponse> {
    throw new NotImplementedError('POST /tasks/:id/links');
  }

  /** R-task-25 / D-13 — removal is logged too; a timeline that records additions only misrepresents history. */
  async removeLink(_ctx: RequestContext, _id: string, _linkId: string): Promise<TaskResponse> {
    throw new NotImplementedError('DELETE /tasks/:id/links/:linkId');
  }
}
