import {
  MAX_LINKS,
  type AddTaskLinkRequest,
  type BacklogItemView,
  type CancelTaskRequest,
  type CompleteTaskRequest,
  type CreateTaskRequest,
  type ExternalLinkView,
  type MoveTaskToBacklogRequest,
  type MoveTaskToBacklogResponse,
  type PatchTaskRequest,
  type PlanEntryView,
  type TaskDetailResponse,
  type TaskDetailView,
  type TaskResponse,
  type TasksResponse,
  type TaskView,
  type UncheckTaskRequest,
} from '@goal-cascade/shared';
import { inject, injectable } from 'tsyringe';
import type { BacklogItem, BacklogLink, Task, TaskLink, WeeklyFocus } from '../../domain/entities';
import { DomainError, notFound } from '../../domain/errors';
import { isLeaf, node } from '../../domain/goal-tree';
import { carryWeeks, offsetOf, weekStartFromOffset } from '../../domain/weeks';
import type { RequestContext } from '../context';
import {
  IBacklogLinkRepo,
  IBacklogRepo,
  IGoalRepo,
  IIdGenerator,
  ITaskLinkRepo,
  ITaskRepo,
  IWeeklyFocusRepo,
  type GuardedWrite,
} from '../ports';
import {
  COMPLETED_TEXT,
  DESCRIPTION_UPDATED_TEXT,
  UNCHECKED_TEXT,
  ActivityLog,
  canceledText,
  condEditedText,
  createdText,
  linkAddedText,
  linkRemovedText,
  movedToBacklogText,
  renamedText,
  toEventView,
} from './activity-log';
import { GuardedBatch } from './guarded-batch';

/**
 * The task lifecycle — R-task-1..32, Q-6, Q-17, D-1, D-4, D-12, D-13, D-15.
 *
 * Three decisions the foundation made, which nothing here works around:
 *
 *  1. **Carrying is derived, not written.** `ITaskRepo.listVisibleInWeek` is the whole of R-task-7/8/32:
 *     an open task is visible in every week at or after its origin, with no job, no prompt and no row
 *     change. `origin_week_start` is never rewritten — that is D-1, the single most damaging bug in the
 *     mockup, where a stored task aged one week every Monday with no write and the red carry chip fired
 *     on work nobody had neglected. The only thing produced on a carry is the cosmetic log line, lazily
 *     and idempotently (`ActivityLog.ensureCarried`).
 *  2. **Weeks are absolute Monday dates.** A request may NAME a week by offset; it is resolved against
 *     `ctx.currentWeekStart` (the owner's timezone, R-auth-5) at the edge of this service and never
 *     stored as an offset.
 *  3. **An exit keeps the row** (D-15). Move-to-Backlog and Cancel set a terminal `status`, `exitReason`
 *     and `exitedAt`; they never delete, because the `Moved to Backlog` / `Canceled` entries R-task-30
 *     requires — and the optional reason — cannot live on a deleted row. Exited tasks leave every week
 *     view (in SQL, in the repo) and every count.
 *
 * Every operation appends exactly one event per REAL change (R-task-31), in the SAME `GuardedBatch` as
 * the write, and a no-op edit writes and logs nothing (S-task-21-3, S-task-31-1).
 */
@injectable()
export class TaskService {
  constructor(
    @inject(ITaskRepo) private readonly tasks: ITaskRepo,
    @inject(ITaskLinkRepo) private readonly links: ITaskLinkRepo,
    @inject(IGoalRepo) private readonly goals: IGoalRepo,
    @inject(IWeeklyFocusRepo) private readonly focuses: IWeeklyFocusRepo,
    @inject(IBacklogRepo) private readonly backlog: IBacklogRepo,
    @inject(IBacklogLinkRepo) private readonly backlogLinks: IBacklogLinkRepo,
    @inject(IIdGenerator) private readonly ids: IIdGenerator,
    @inject(ActivityLog) private readonly activity: ActivityLog,
    @inject(GuardedBatch) private readonly batch: GuardedBatch,
  ) {}

  /**
   * R-nav-8 / R-task-7/8/9 — the tasks visible in one week, plus that week's plan.
   *
   * Visibility is entirely the repo's `listVisibleInWeek`, so nothing here can disagree with it, and
   * dormancy is NOT part of it: a dormant leaf's open tasks stay visible and interactive (R-task-9,
   * D-11). `goalId` is the filter pill (R-nav-7) and narrows the response only — the carry log is
   * produced for the whole week, because the week was read regardless of which pill is selected.
   */
  async list(ctx: RequestContext, query: { weekStart: string; goalId?: string }): Promise<TasksResponse> {
    const visible = await this.tasks.listVisibleInWeek(ctx.userId, query.weekStart);
    await this.activity.ensureCarried(ctx, visible, query.weekStart);

    const tasks = query.goalId ? visible.filter((t) => t.goalId === query.goalId) : visible;
    const links = await this.links.listByTasks(ctx.userId, tasks.map((t) => t.id));
    const plan = await this.focuses.listByWeek(ctx.userId, query.weekStart);

    return {
      week: {
        weekStart: query.weekStart,
        offset: offsetOf(query.weekStart, ctx.currentWeekStart),
        isCurrent: query.weekStart === ctx.currentWeekStart,
      },
      tasks: tasks.map((t) => toTaskView(t, links, query.weekStart)),
      plan: plan.map(toPlanEntryView),
      serverNow: ctx.now,
    };
  }

  /** R-task-22/30 — the detail sheet: the task plus its full, newest-first activity log. */
  async get(ctx: RequestContext, id: string, week: { weekStart: string }): Promise<TaskDetailResponse> {
    const task = await this.load(ctx, id);
    // The detail sheet is where the timeline is READ, so the lazy producer runs here too (idempotent).
    await this.activity.ensureCarried(ctx, [task], week.weekStart);
    return { task: await this.detail(ctx, task, week.weekStart), serverNow: ctx.now };
  }

  /**
   * R-task-4/5/6 — the target must be an ACTIVE non-Life leaf, and `originWeekStart` is ALWAYS the
   * current week regardless of the week being viewed (S-task-5-1): there is no back-dating and no
   * fallback goal (D-10). `source` decides which `Created — …` line is logged (R-task-2/30).
   */
  async create(ctx: RequestContext, input: CreateTaskRequest): Promise<TaskResponse> {
    await this.assertActiveLeaf(ctx, input.goalId);

    const now = ctx.now;
    const task: Task = {
      id: this.ids.ulid(),
      userId: ctx.userId,
      goalId: input.goalId,
      title: input.title,
      cond: input.cond,
      description: input.description,
      status: 'open',
      // R-task-5 / D-1 — an absolute Monday, resolved from the OWNER's timezone. Immutable hereafter.
      originWeekStart: ctx.currentWeekStart,
      doneWeekStart: null,
      doneAt: null,
      exitReason: null,
      exitedAt: null,
      movedToBacklogItemId: null,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    const links: TaskLink[] = input.links.map((url) => ({
      id: this.ids.ulid(),
      userId: ctx.userId,
      taskId: task.id,
      url,
      createdAt: now,
    }));
    const created = this.activity.append(ctx, task.id, 'created', createdText(input.source), { source: input.source });

    await this.batch.run([
      { label: 'task.insert', stmt: this.tasks.insertStmt(task) },
      ...links.map((l) => ({ label: 'taskLink.insert', stmt: this.links.insertStmt(l) })),
      created.write,
    ]);

    return { task: await this.detail(ctx, task, ctx.currentWeekStart), serverNow: ctx.now };
  }

  /**
   * R-task-23/26/27 — one event per CHANGED field (Renamed / Done-condition edited / Description
   * updated), values truncated. A patch that changes nothing writes nothing and logs nothing.
   *
   * Done tasks remain editable; only the exits are withdrawn (R-task-26). An EXITED task is a historical
   * record, not work — editing it would rewrite something that already left the board (D-15).
   */
  async patch(ctx: RequestContext, id: string, input: PatchTaskRequest): Promise<TaskResponse> {
    const task = await this.load(ctx, id);
    this.assertNotExited(task, 'edit');

    const patch: Partial<Task> = {};
    const events: GuardedWrite[] = [];
    if (input.title !== undefined && input.title !== task.title) {
      patch.title = input.title;
      events.push(this.activity.append(ctx, id, 'renamed', renamedText(task.title, input.title), {
        from: task.title,
        to: input.title,
      }).write);
    }
    if (input.cond !== undefined && input.cond !== task.cond) {
      patch.cond = input.cond;
      events.push(this.activity.append(ctx, id, 'cond_edited', condEditedText(task.cond, input.cond), {
        from: task.cond,
        to: input.cond,
      }).write);
    }
    if (input.description !== undefined && input.description !== task.description) {
      patch.description = input.description;
      // R-task-30 — old and new are deliberately NOT recorded for a description; the line is the signal.
      events.push(this.activity.append(ctx, id, 'description_updated', DESCRIPTION_UPDATED_TEXT).write);
    }
    if (events.length === 0) return { task: await this.detail(ctx, task, ctx.currentWeekStart), serverNow: ctx.now };

    const next = await this.write(ctx, task, patch, input.version, events);
    return { task: await this.detail(ctx, next, ctx.currentWeekStart), serverNow: ctx.now };
  }

  /**
   * R-task-14 — exit 1 of 3. Completable in ANY week, including past ones: past weeks stay fully
   * interactive. `doneWeekStart` is the week NAMED by the request and `doneAt` is the instant of the
   * completion — never "today" stamped into a week that ended a fortnight ago (D-4). A week before the
   * task's origin is `WEEK_OUT_OF_RANGE` (S-task-14-2); a future week the schema already refuses.
   */
  async complete(ctx: RequestContext, id: string, input: CompleteTaskRequest): Promise<TaskResponse> {
    const task = await this.load(ctx, id);
    this.assertNotExited(task, 'complete');
    if (task.status === 'done') {
      throw new DomainError('TASK_ALREADY_EXITED', 'task is already completed', { doneWeekStart: task.doneWeekStart });
    }
    const weekStart = this.resolveWeekFor(ctx, task, input.week);

    const event = this.activity.append(ctx, id, 'completed', COMPLETED_TEXT, { weekStart });
    const next = await this.write(
      ctx,
      task,
      { status: 'done', doneWeekStart: weekStart, doneAt: ctx.now },
      input.version,
      [event.write],
    );
    return { task: await this.detail(ctx, next, weekStart), serverNow: ctx.now };
  }

  /**
   * R-task-19/20/21 — NOT an exit. Clears `doneWeekStart` and `doneAt`, KEEPS `originWeekStart` (so the
   * task carries back into the current week under its ORIGINAL origin, with the carry label its real age
   * earns — S-task-19-1), does not re-parent it, and does not require the owning leaf to be active.
   *
   * `cond` is the skippable inline "Update the done-condition?" follow-up (R-task-21). Omitted, blank or
   * unchanged, it writes nothing and logs nothing (S-task-21-1, S-task-21-3).
   */
  async uncheck(ctx: RequestContext, id: string, input: UncheckTaskRequest): Promise<TaskResponse> {
    const task = await this.load(ctx, id);
    this.assertNotExited(task, 'uncheck');
    if (task.status !== 'done') throw new DomainError('VALIDATION_FAILED', 'task is not completed');

    const events = [this.activity.append(ctx, id, 'unchecked', UNCHECKED_TEXT, { doneWeekStart: task.doneWeekStart }).write];
    const patch: Partial<Task> = { status: 'open', doneWeekStart: null, doneAt: null };
    if (input.cond !== undefined && input.cond !== '' && input.cond !== task.cond) {
      patch.cond = input.cond;
      events.push(this.activity.append(ctx, id, 'cond_edited', condEditedText(task.cond, input.cond), {
        from: task.cond,
        to: input.cond,
      }).write);
    }

    const next = await this.write(ctx, task, patch, input.version, events);
    return { task: await this.detail(ctx, next, ctx.currentWeekStart), serverNow: ctx.now };
  }

  /**
   * R-task-15/17 — exit 2 of 3, on OPEN tasks only. ONE batch: the task takes its terminal status and
   * reason, and a backlog item appears on the task's OWN goal carrying title, description and links, with
   * `fromWeekStart` = the week the task was LIVE in (D-12 — not "this week", and not a display string).
   *
   * The backlog item is written through `IBacklogRepo`, the port the backlog agent's service also uses:
   * the two features meet at an interface, not inside each other's code, and the item and the exit commit
   * together or not at all.
   */
  async moveToBacklog(ctx: RequestContext, id: string, input: MoveTaskToBacklogRequest): Promise<MoveTaskToBacklogResponse> {
    const task = await this.load(ctx, id);
    this.assertOpenForExit(task);
    const fromWeekStart = this.resolveWeekFor(ctx, task, input.week);
    const taskLinks = await this.links.listByTasks(ctx.userId, [task.id]);

    const now = ctx.now;
    const item: BacklogItem = {
      id: this.ids.ulid(),
      userId: ctx.userId,
      // R-backlog-2 holds for free: a task's goal is always a non-Life leaf.
      goalId: task.goalId,
      title: task.title,
      description: task.description,
      capturedAt: now,
      fromWeekStart,
      status: 'open',
      convertedToTaskId: null,
      convertedAt: null,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    const itemLinks: BacklogLink[] = taskLinks.map((l) => ({
      id: this.ids.ulid(),
      userId: ctx.userId,
      itemId: item.id,
      url: l.url,
      createdAt: now,
    }));
    const event = this.activity.append(ctx, id, 'moved_to_backlog', movedToBacklogText(input.reason), {
      reason: input.reason ?? null,
      itemId: item.id,
      fromWeekStart,
    });

    const next = await this.write(
      ctx,
      task,
      {
        status: 'movedToBacklog',
        exitReason: input.reason ?? null,
        exitedAt: now,
        movedToBacklogItemId: item.id,
      },
      input.version,
      [
        { label: 'backlogItem.insert', stmt: this.backlog.insertStmt(item) },
        ...itemLinks.map((l) => ({ label: 'backlogLink.insert', stmt: this.backlogLinks.insertStmt(l) })),
        event.write,
      ],
    );

    return {
      task: await this.detail(ctx, next, fromWeekStart),
      item: toBacklogItemView(item, itemLinks),
      serverNow: ctx.now,
    };
  }

  /**
   * R-task-16/17/18 — exit 3 of 3, on OPEN tasks only. The reason is optional and, when given, is
   * RETAINED on the record (D-15: the mockup passed it to `persist()` and dropped it, having already
   * deleted the row the `Canceled` entry needed).
   */
  async cancel(ctx: RequestContext, id: string, input: CancelTaskRequest): Promise<TaskResponse> {
    const task = await this.load(ctx, id);
    this.assertOpenForExit(task);

    const event = this.activity.append(ctx, id, 'canceled', canceledText(input.reason), { reason: input.reason ?? null });
    const next = await this.write(
      ctx,
      task,
      { status: 'canceled', exitReason: input.reason ?? null, exitedAt: ctx.now },
      input.version,
      [event.write],
    );
    return { task: await this.detail(ctx, next, ctx.currentWeekStart), serverNow: ctx.now };
  }

  /**
   * R-task-24 — logs `Link added: <host>`. Q-12 caps a task at `MAX_LINKS`; the cap is refused here as
   * well as in the schema, because the schema only sees ONE request's array.
   *
   * Links live in their own table, so adding or removing one does not touch the task row and cannot
   * collide with a concurrent edit of the title.
   */
  async addLink(ctx: RequestContext, id: string, input: AddTaskLinkRequest): Promise<TaskResponse> {
    const task = await this.load(ctx, id);
    this.assertNotExited(task, 'edit');
    const existing = await this.links.listByTasks(ctx.userId, [task.id]);
    if (existing.length >= MAX_LINKS) {
      throw new DomainError('VALIDATION_FAILED', `a task holds at most ${MAX_LINKS} links`, { max: MAX_LINKS });
    }

    const link: TaskLink = { id: this.ids.ulid(), userId: ctx.userId, taskId: task.id, url: input.url, createdAt: ctx.now };
    const event = this.activity.append(ctx, id, 'link_added', linkAddedText(input.url), { url: input.url });
    await this.batch.run([{ label: 'taskLink.insert', stmt: this.links.insertStmt(link) }, event.write]);

    return { task: await this.detail(ctx, task, ctx.currentWeekStart), serverNow: ctx.now };
  }

  /** R-task-25 / D-13 — removal is logged too: a timeline that records additions only misrepresents history. */
  async removeLink(ctx: RequestContext, id: string, linkId: string): Promise<TaskResponse> {
    const task = await this.load(ctx, id);
    this.assertNotExited(task, 'edit');
    const link = (await this.links.listByTasks(ctx.userId, [task.id])).find((l) => l.id === linkId);
    if (!link) throw notFound('link');

    const event = this.activity.append(ctx, id, 'link_removed', linkRemovedText(link.url), { url: link.url });
    await this.batch.run([
      { label: 'taskLink.delete', stmt: this.links.deleteStmt(ctx.userId, task.id, linkId) },
      event.write,
    ]);

    return { task: await this.detail(ctx, task, ctx.currentWeekStart), serverNow: ctx.now };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Internals
  // ───────────────────────────────────────────────────────────────────────────

  /** R-auth-3 — another owner's task is refused identically to one that does not exist. */
  private async load(ctx: RequestContext, id: string): Promise<Task> {
    const task = await this.tasks.findById(ctx.userId, id);
    if (!task) throw notFound('task');
    return task;
  }

  /** R-task-17 / S-task-17-1 — Move and Cancel are offered on OPEN tasks only. */
  private assertOpenForExit(task: Task): void {
    if (task.status === 'open') return;
    throw new DomainError('TASK_ALREADY_EXITED', 'only an open task can be moved to the backlog or canceled', {
      status: task.status,
    });
  }

  private assertNotExited(task: Task, action: string): void {
    if (task.status === 'open' || task.status === 'done') return;
    throw new DomainError('TASK_ALREADY_EXITED', `this task has already left the board and cannot ${action}`, {
      status: task.status,
    });
  }

  /**
   * R-task-4 / D-10 — the target of a new task must be an ACTIVE non-Life leaf. `NOT_A_LEAF` when it is a
   * Life goal or has children, `BRANCH_NOT_ACTIVE` when it holds no focus THIS week. There is no fallback
   * goal anywhere in this product: when nothing is active, creation is blocked and the user goes to
   * planning (S-task-4-1).
   */
  private async assertActiveLeaf(ctx: RequestContext, goalId: string): Promise<void> {
    const goals = await this.goals.listAll(ctx.userId);
    const goal = node(goals, goalId);
    if (!goal) throw notFound('goal');
    if (goal.parentId === null || !isLeaf(goals, goalId)) {
      throw new DomainError('NOT_A_LEAF', 'a task lives under a non-Life leaf', { goalId, horizon: goal.horizon });
    }
    // D-2 — "active this week" is exactly "a focus row exists for this week"; there is no second
    // representation of dormancy that could disagree with the plan.
    const focus = await this.focuses.findByGoalAndWeek(ctx.userId, goalId, ctx.currentWeekStart);
    if (!focus) {
      throw new DomainError('BRANCH_NOT_ACTIVE', 'this leaf has no weekly focus this week', {
        goalId,
        weekStart: ctx.currentWeekStart,
      });
    }
  }

  /**
   * R-task-14 / S-task-14-2 — resolve a wire offset (D-1: offsets exist only on the wire) and refuse a
   * week the task did not exist in. The schema already refuses a positive offset, so the only remaining
   * failure is a week EARLIER than the origin.
   */
  private resolveWeekFor(ctx: RequestContext, task: Task, offset: number): string {
    const weekStart = weekStartFromOffset(ctx.currentWeekStart, offset);
    if (weekStart < task.originWeekStart) {
      throw new DomainError('WEEK_OUT_OF_RANGE', 'the task did not exist in that week', {
        weekStart,
        originWeekStart: task.originWeekStart,
      });
    }
    return weekStart;
  }

  /**
   * The one write path: a guarded task update in the SAME batch as its events (and, for a move, the
   * backlog item). `version` pins the row the caller read — a lost race is a clean 409 rather than a
   * half-applied write, and D1 has no interactive transaction to fall back on (Q-2).
   */
  private async write(
    ctx: RequestContext,
    task: Task,
    patch: Partial<Task>,
    expectedVersion: number | undefined,
    extra: readonly GuardedWrite[],
  ): Promise<Task> {
    const next: Task = { ...task, ...patch, updatedAt: ctx.now, version: task.version + 1 };
    await this.batch.run([
      ...extra,
      {
        label: 'task.update',
        stmt: this.tasks.updateGuardedStmt(ctx.userId, task.id, expectedVersion ?? task.version, {
          ...patch,
          updatedAt: next.updatedAt,
          version: next.version,
        }),
      },
    ]);
    return next;
  }

  private async detail(ctx: RequestContext, task: Task, viewedWeekStart: string): Promise<TaskDetailView> {
    const [links, events] = await Promise.all([
      this.links.listByTasks(ctx.userId, [task.id]),
      this.activity.list(ctx.userId, task.id),
    ]);
    return { ...toTaskView(task, links, viewedWeekStart), events: events.map(toEventView) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Views
// ─────────────────────────────────────────────────────────────────────────────

const toLinkView = (l: TaskLink | BacklogLink): ExternalLinkView => ({ id: l.id, url: l.url, createdAt: l.createdAt });

/**
 * `carryWeeks` is `viewedWeek − originWeekStart` in whole weeks, computed for the week THIS view was
 * built for and NOT against today (S-task-11-2): the same task is one week old in the week after its
 * origin and three weeks old two weeks later. It drives the gray "since Mon 24 Aug" label at age 1 and
 * the red "N weeks · since 10 Aug" chip at age >= 2 — the only escalation in the product (R-task-10/11).
 */
function toTaskView(task: Task, links: readonly TaskLink[], viewedWeekStart: string): TaskView {
  return {
    id: task.id,
    goalId: task.goalId,
    title: task.title,
    cond: task.cond,
    description: task.description,
    links: links.filter((l) => l.taskId === task.id).map(toLinkView),
    status: task.status,
    done: task.status === 'done',
    originWeekStart: task.originWeekStart,
    doneWeekStart: task.doneWeekStart,
    doneAt: task.doneAt,
    exitReason: task.exitReason,
    exitedAt: task.exitedAt,
    carryWeeks: carryWeeks(task.originWeekStart, viewedWeekStart),
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    version: task.version,
  };
}

function toPlanEntryView(focus: WeeklyFocus): PlanEntryView {
  return {
    id: focus.id,
    goalId: focus.goalId,
    weekStart: focus.weekStart,
    sentence: focus.sentence,
    createdAt: focus.createdAt,
    updatedAt: focus.updatedAt,
  };
}

function toBacklogItemView(item: BacklogItem, links: readonly BacklogLink[]): BacklogItemView {
  return {
    id: item.id,
    goalId: item.goalId,
    title: item.title,
    description: item.description,
    links: links.map(toLinkView),
    capturedAt: item.capturedAt,
    fromWeekStart: item.fromWeekStart,
    status: item.status,
    convertedToTaskId: item.convertedToTaskId,
    convertedAt: item.convertedAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    version: item.version,
  };
}
