import {
  MAX_LINKS,
  MAX_PAGE,
  MAX_WEEKLY_GOALS_PER_WEEK,
  type AddTaskLinkRequest,
  type BacklogItemView,
  type CancelTaskRequest,
  type CompleteTaskRequest,
  type CreateTaskRequest,
  type CreateTaskResponse,
  type ExternalLinkView,
  type GoalView,
  type MoveTaskToBacklogRequest,
  type MoveTaskToBacklogResponse,
  type NewWeeklyGoalInput,
  type PatchTaskRequest,
  type TaskDetailResponse,
  type TaskDetailView,
  type TaskResponse,
  type TasksResponse,
  type TaskView,
} from '@goal-cascade/shared';
import { inject, injectable } from 'tsyringe';
import type { BacklogItem, BacklogLink, Goal, Task, TaskLink } from '../../domain/entities';
import { DomainError, notFound } from '../../domain/errors';
import { indexTree, isLifeHorizon, lifeRootIn, type TreeIndex } from '../../domain/goal-tree';
import { FIRST_SORT_KEY, topKey } from '../../domain/sort-keys';

import { dateInTimezone, isPastPeriod, labelOf, periodKeyOf } from '@goal-cascade/shared';
import { carryAge } from '../../domain/weeks';
import type { RequestContext } from '../context';
import {
  IBacklogLinkRepo,
  IBacklogRepo,
  IClock,
  IGoalRepo,
  IIdGenerator,
  ITaskLinkRepo,
  ITaskRepo,
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
import { backlogLabelsOf, toBacklogItemView, toTaskView, weekView } from './views';

/**
 * The task lifecycle — R-task-3..50, Q-6, Q-17, D-1, D-4, D-12, D-13, D-15.
 *
 * Three decisions the foundation made, which nothing here works around:
 *
 *  1. **Carrying is derived, not written.** `ITaskRepo.listVisibleInWeek` is the whole of R-task-7/8/42:
 *     an open task is visible in every week at or after its origin, with no job, no prompt and no row
 *     change. `origin_week_start` is never rewritten — that is D-1, the single most damaging bug in the
 *     mockup, where a stored task aged one week every Monday with no write and the red carry chip fired
 *     on work nobody had neglected. The only thing produced on a carry is the cosmetic log line, lazily
 *     and idempotently (`ActivityLog.ensureCarried`).
 *  2. **Weeks are absolute Monday dates.** A request may NAME a week by offset; it is resolved against
 *     `ctx.currentWeekStart` (the owner's timezone, R-auth-5) at the edge of this service.
 *  3. **An exit keeps the row** (D-15). Move-to-Backlog and Cancel set a terminal `status`, `exitReason`
 *     and `exitedAt`; they never delete, because the `Moved to Backlog` / `Canceled` entries R-task-30
 *     requires — and the optional reason — cannot live on a deleted row.
 *
 * ── ⚠ **A2 — what changed, and the trap in the middle of it** ─────────────────────────────────────
 *
 *  - **A task hangs off a `horizon = 'Weekly'` goal, and off nothing else** (R-goal-39, R-task-39).
 *    `assertActiveLeaf` — which read the WHOLE goal list and then checked leaf-ness plus a focus row — is
 *    now `assertWeeklyGoal`, which reads **ONE ROW** and compares one field.
 *  - **The condition is the horizon, never leaf-ness** (R-goal-37). Because Weekly is terminal, every
 *    Weekly goal is childless, so "Weekly" implies "no children"; **the converse is false and is the
 *    trap** — a Monthly goal with no Weekly children is a leaf by the structural definition and must
 *    never hold a task (S-goal-37-1).
 *  - **There is no week parameter.** `originPeriodKey` is seeded once from the Weekly parent's
 *    `periodKey` (R-task-40) and is immutable. `.strict()` refuses every spelling of `week`.
 *  - **`carryAge` is signed** (R-task-43), and `complete` keeps its `<= currentWeek` bound explicitly
 *    (R-task-44) — the guard it used to inherit from `WeekOffset.max(0)`.
 */
@injectable()
export class TaskService {
  constructor(
    @inject(ITaskRepo) private readonly tasks: ITaskRepo,
    @inject(ITaskLinkRepo) private readonly links: ITaskLinkRepo,
    @inject(IGoalRepo) private readonly goals: IGoalRepo,
    @inject(IBacklogRepo) private readonly backlog: IBacklogRepo,
    @inject(IBacklogLinkRepo) private readonly backlogLinks: IBacklogLinkRepo,
    @inject(IIdGenerator) private readonly ids: IIdGenerator,
    @inject(IClock) private readonly clock: IClock,
    @inject(ActivityLog) private readonly activity: ActivityLog,
    @inject(GuardedBatch) private readonly batch: GuardedBatch,
  ) {}

  /**
   * R-lens-12 / R-task-7/8 — the tasks visible in one week: the Weekly lens's data source.
   *
   * ⚠ **A2 (R-rm-5, R-rm-2, R-rm-4)** — the Tasks SCREEN is gone and this read is not. What went with it:
   * the plan (there are no focus sentences) and the `goalId` filter (there are no filter pills, and no
   * lens accepts a goal filter of any kind — R-lens-15).
   *
   * Visibility is entirely the repo's `listVisibleInWeek`, so nothing here can disagree with it, and the
   * goal's own period is NOT part of it (R-task-42): that is what makes the carried band possible.
   */
  async list(ctx: RequestContext, query: { weekStart: string; limit?: number }): Promise<TasksResponse> {
    const limit = Math.min(query.limit ?? MAX_PAGE, MAX_PAGE);
    const visible = await this.tasks.listVisibleInWeek(ctx.userId, query.weekStart, limit + 1);
    const tasks = visible.slice(0, limit);
    await this.activity.ensureCarried(ctx, tasks, query.weekStart);
    const links = await this.links.listByTasks(ctx.userId, tasks.map((t) => t.id));

    return {
      week: weekView(ctx, query.weekStart),
      tasks: tasks.map((t) => toTaskView(t, links, query.weekStart, ctx.currentWeekStart)),
      // Q-12 / R-lens-16 — `MAX_PAGE`, finally wired. The Weekly lens's payload grows with OPEN WORK,
      // which is owner-controlled and correct — but owner-controlled is not the same as bounded.
      nextCursor: visible.length > limit ? (tasks[tasks.length - 1]?.id ?? null) : null,
      serverNow: ctx.now,
    };
  }

  /** R-task-45 — the task PAGE: the task plus its full, newest-first activity log. */
  async get(ctx: RequestContext, id: string, week: { weekStart: string }): Promise<TaskDetailResponse> {
    const task = await this.load(ctx, id);
    // The task page is where the timeline is READ, so the lazy producer runs here too (idempotent).
    await this.activity.ensureCarried(ctx, [task], week.weekStart);
    return { task: await this.detail(ctx, task, week.weekStart), serverNow: ctx.now };
  }

  /**
   * R-task-39/40/41/48 — create a task under a **Weekly goal**.
   *
   * Exactly one of `goalId` or `newWeeklyGoal` (the schema refines it, S-task-48-3). When the second is
   * given, the Weekly goal and the task are written **in one transaction** — a failure creates neither
   * (S-task-48-2) — because creating a task presupposes a Weekly goal, and "I need to do this, this
   * week" must stay ONE interaction. The data model is not special-cased for it: there is no goal-less
   * task, no implicit inbox and no nullable `goalId`, and R-goal-39 still holds unconditionally.
   *
   * `originPeriodKey` comes from the parent's `periodKey` and from nowhere else (R-task-40). **No
   * back-dating** (R-task-41): a Weekly goal whose week is past refuses the create with `PERIOD_IN_PAST`.
   * Creating forward is unbounded — a Weekly goal three months out accepts tasks, they are invisible
   * until that week arrives (R-task-7) and are never styled as late (R-lens-11).
   */
  async create(ctx: RequestContext, input: CreateTaskRequest): Promise<CreateTaskResponse> {
    const today = this.today(ctx);
    const now = ctx.now;
    const writes: GuardedWrite[] = [];

    let goal: Goal;
    let createdGoal: Goal | null = null;
    if (input.newWeeklyGoal) {
      createdGoal = await this.mintWeeklyGoal(ctx, input.newWeeklyGoal, today);
      goal = createdGoal;
      writes.push({ label: 'goal.insertForTask', stmt: this.goals.insertStmt(createdGoal) });
    } else {
      goal = await this.assertWeeklyGoal(ctx, input.goalId!);
      // R-task-41 / R-goal-36 — no back-dating, enforced THROUGH THE PARENT. The affordance is absent on
      // a past week and in the carried band, and this is the server's half of that (S-task-41-1).
      if (isPastPeriod('Weekly', goal.periodKey, today)) {
        throw new DomainError('PERIOD_IN_PAST', 'a task cannot be added to a week that has passed', {
          goalId: goal.id,
          weekStart: goal.periodKey,
        });
      }
    }

    const task: Task = {
      id: this.ids.ulid(),
      userId: ctx.userId,
      goalId: goal.id,
      title: input.title,
      cond: input.cond,
      description: input.description,
      status: 'open',
      // R-task-40 — seeded ONCE from the Weekly parent's `periodKey`, then immutable and never re-read.
      // The Weekly goal says what the work is for; this says when it was live, and at creation they are
      // equal BY CONSTRUCTION because there is no target-week parameter to disagree with the parent.
      originPeriodKey: goal.periodKey,
      donePeriodKey: null,
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

    // ONE batch. With `newWeeklyGoal` this is R-task-48's atomicity: the goal insert and the task insert
    // commit together or not at all.
    await this.batch.run([
      ...writes,
      { label: 'task.insert', stmt: this.tasks.insertStmt(task) },
      ...links.map((l) => ({ label: 'taskLink.insert', stmt: this.links.insertStmt(l) })),
      created.write,
    ]);

    return {
      task: await this.detail(ctx, task, task.originPeriodKey),
      // R-task-49 — when a Weekly goal was created for you, the client must SAY SO: nothing may be
      // created invisibly. It is `null` on the ordinary path.
      goal: createdGoal ? await this.goalView(ctx, createdGoal) : null,
      serverNow: ctx.now,
    };
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
   * R-task-14/44 — exit 1 of 3. Completable in any week that has BEGUN, including past ones: past weeks
   * stay fully interactive, and closing them to plan closes them to nothing else (R-lens-10). `doneWeek`
   * is the week NAMED by the request and `doneAt` is the instant — never "today" stamped into a week that
   * ended a fortnight ago (D-4).
   *
   * ⚠ **A2 — the bound is `originWeek <= week <= currentWeek`, and BOTH halves are explicit here.** The
   * upper half used to come free from `WeekOffset`'s `.max(0)`; that schema is now unbounded forward
   * (R-lens-7), so `CompleteTaskRequest` carries its own `.max(0)` and this method re-states the rule
   * against the resolved week. A task under a FUTURE Weekly goal cannot be completed at all until that
   * week arrives, because no week satisfies both bounds (S-task-44-1).
   */
  async complete(ctx: RequestContext, id: string, input: CompleteTaskRequest): Promise<TaskResponse> {
    const task = await this.load(ctx, id);
    this.assertNotExited(task, 'complete');
    if (task.status === 'done') {
      throw new DomainError('TASK_ALREADY_EXITED', 'task is already completed', { donePeriodKey: task.donePeriodKey });
    }
    const weekStart = this.assertPeriodFor(ctx, task, input.period, { allowFuture: false });

    const event = this.activity.append(ctx, id, 'completed', COMPLETED_TEXT, { weekStart });
    const next = await this.write(
      ctx,
      task,
      { status: 'done', donePeriodKey: weekStart, doneAt: ctx.now },
      input.version,
      [event.write],
    );
    return { task: await this.detail(ctx, next, weekStart), serverNow: ctx.now };
  }

  /**
   * R-task-19/20/21 — NOT an exit. Clears `donePeriodKey` and `doneAt`, KEEPS `originPeriodKey` (so the
   * task carries back into the current week under its ORIGINAL origin, with the carry label its real age
   * earns — S-task-19-1), and does not re-parent it or touch its goal.
   *
   * R-lens-12 is what makes this coherent under A2: the unchecked task's Weekly goal reappears in the
   * current week's CARRIED BAND alongside it, rather than the task floating without one.
   *
   * `cond` is the skippable inline "Update the done-condition?" follow-up (R-task-21). Omitted, blank or
   * unchanged, it writes nothing and logs nothing (S-task-21-1, S-task-21-3).
   */
  async uncheck(ctx: RequestContext, id: string, input: { cond?: string; version?: number }): Promise<TaskResponse> {
    const task = await this.load(ctx, id);
    this.assertNotExited(task, 'uncheck');
    if (task.status !== 'done') throw new DomainError('VALIDATION_FAILED', 'task is not completed');

    const events = [this.activity.append(ctx, id, 'unchecked', UNCHECKED_TEXT, { donePeriodKey: task.donePeriodKey }).write];
    const patch: Partial<Task> = { status: 'open', donePeriodKey: null, doneAt: null };
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
   * R-task-15/17/36 / **R-backlog-29** — exit 2 of 3, on OPEN tasks only. ONE batch: the task takes its
   * terminal status and reason, and a backlog item appears carrying title, description and links, with
   * `fromPeriodKey` = the week the task was LIVE in (D-12 — not "this week", and not a display string).
   *
   * ⚠ **A2 — the item does NOT land on the task's own goal any more, and missing this writes an illegal
   * row silently.** The owning goal is now a **Weekly** goal, which may hold no backlog items
   * (R-backlog-2), so the item lands on the **nearest non-Weekly ancestor** — normally the Monthly
   * parent. That is the semantically right target as well as the only legal one: "move to backlog" means
   * *not this week*, so the item must leave the week, and a Weekly goal **is** a week. Landing it on the
   * week it is escaping would be a no-op wearing an exit's clothes.
   *
   * A Weekly goal whose only ancestor is a Life goal has **no legal target** (a Life goal holds no
   * backlog) and the exit is refused with `LIFE_GOAL_NO_BACKLOG`; Cancel and Complete remain available
   * (S-backlog-29-2). This is the one cost of R-goal-32's level-skipping, it is rare, and refusing beats
   * inventing a home.
   */
  async moveToBacklog(ctx: RequestContext, id: string, input: MoveTaskToBacklogRequest): Promise<MoveTaskToBacklogResponse> {
    const task = await this.load(ctx, id);
    this.assertOpenForExit(task);
    // R-task-36 — the week may be a future one: changing your mind about next week is not a fourth exit.
    const fromPeriodKey = this.assertPeriodFor(ctx, task, input.period, { allowFuture: true });
    const { host, interior } = await this.nearestBacklogHost(ctx, task.goalId);
    const taskLinks = await this.links.listByTasks(ctx.userId, [task.id]);
    // ⚠ **A1 (R-backlog-18)** — an item arriving by the Move-to-Backlog exit lands at the TOP of its host
    // goal's list, exactly like any other capture. There is one rule about where a new item goes and this
    // is not an exception to it.
    const top = topKey(await this.backlog.topSortKey(ctx.userId, host.id));

    const now = ctx.now;
    const item: BacklogItem = {
      id: this.ids.ulid(),
      userId: ctx.userId,
      goalId: host.id,
      title: task.title,
      description: task.description,
      capturedAt: now,
      fromPeriodKey,
      sortKey: top ?? FIRST_SORT_KEY,
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
      fromPeriodKey,
      goalId: host.id,
    });

    const next = await this.write(
      ctx,
      task,
      { status: 'movedToBacklog', exitReason: input.reason ?? null, exitedAt: now, movedToBacklogItemId: item.id },
      input.version,
      [
        { label: 'backlogItem.insert', stmt: this.backlog.insertStmt(item) },
        ...itemLinks.map((l) => ({ label: 'backlogLink.insert', stmt: this.backlogLinks.insertStmt(l) })),
        event.write,
      ],
    );

    return {
      task: await this.detail(ctx, next, fromPeriodKey),
      item: toBacklogItemView(item, itemLinks, backlogLabelsOf(interior, host.id)),
      serverNow: ctx.now,
    };
  }

  /**
   * R-task-16/17/18/36 — exit 3 of 3, on OPEN tasks only. The reason is optional and, when given, is
   * RETAINED on the record (D-15). It works on future-dated work too.
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

  private today(ctx: RequestContext): string {
    return dateInTimezone(ctx.now, ctx.tz);
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
   * ⚠ **A2 (R-goal-39, R-goal-37) — THE task-ownership rule, and it reads ONE ROW.**
   *
   * `assertActiveLeaf` used to load the owner's entire goal list, derive leaf-ness with an O(n) scan and
   * then look up a focus row. This compares one field.
   *
   * **The condition is `horizon = 'Weekly'`, and it is never leaf-ness.** Because Weekly is terminal
   * (R-goal-31) every Weekly goal is childless, so "Weekly" implies "no children" — but **the converse is
   * false, and that is the trap this rule exists to close**: a Monthly goal with no Weekly children is a
   * leaf by the structural definition and is precisely the goal that must never hold a task
   * (S-goal-37-1). A build that admitted it would have keyed task ownership on leaf-ness, and nothing in
   * the type system or in a test would have caught it — it would simply be wrong, on the first empty
   * Monthly goal anyone creates.
   */
  private async assertWeeklyGoal(ctx: RequestContext, goalId: string): Promise<Goal> {
    const goal = await this.goals.findById(ctx.userId, goalId);
    if (!goal) throw notFound('goal');
    if (goal.horizon !== 'Weekly') {
      throw new DomainError('NOT_A_WEEKLY_GOAL', 'a task lives under a weekly goal', {
        goalId,
        horizon: goal.horizon,
      });
    }
    return goal;
  }

  /**
   * R-task-48/49 — build the Weekly goal for an inline create.
   *
   * The parent is validated exactly as `POST /goals` would validate it: a Weekly goal may hang off a
   * Monthly, Quarterly, Yearly or Life goal (R-goal-32), never off another Weekly one (R-goal-31), and
   * never into a past week (R-goal-36). The per-week cap applies here too (Q-12) — this path may not be
   * a way around a rule the ordinary create enforces.
   *
   * The target week is the parent's own week when the parent IS a Weekly goal (impossible), and otherwise
   * the current week: the inline create exists for "I need to do this, this week". A different week is a
   * deliberate act and belongs to the Weekly lens at that week.
   */
  private async mintWeeklyGoal(ctx: RequestContext, input: NewWeeklyGoalInput, today: string): Promise<Goal> {
    const parent = await this.goals.findById(ctx.userId, input.parentId);
    if (!parent) throw notFound('goal');
    if (parent.horizon === 'Weekly') {
      throw new DomainError('HORIZON_CONFLICT', 'a weekly goal cannot sit under a weekly goal', {
        parentHorizon: parent.horizon,
        childHorizon: 'Weekly',
      });
    }
    const weekStart = ctx.currentWeekStart;
    if (isPastPeriod('Weekly', weekStart, today)) {
      throw new DomainError('PERIOD_IN_PAST', 'a weekly goal cannot be created into a week that has passed', { weekStart });
    }
    const existing = await this.goals.countWeeklyInWeek(ctx.userId, weekStart);
    if (existing >= MAX_WEEKLY_GOALS_PER_WEEK) {
      throw new DomainError('VALIDATION_FAILED', `a week holds at most ${MAX_WEEKLY_GOALS_PER_WEEK} weekly goals`, {
        weekStart,
        existing,
        max: MAX_WEEKLY_GOALS_PER_WEEK,
      });
    }

    const now = this.clock.nowIso();
    return {
      id: this.ids.ulid(),
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

  /**
   * R-backlog-29 — the nearest **non-Weekly** ancestor of a Weekly goal: where Move-to-Backlog lands.
   *
   * The walk is over the interior tree, which is exactly the set that can hold a backlog item, so it is
   * one read and O(d) hops. A **Life** root is not a legal host (R-backlog-2), so a Weekly goal hung
   * directly off a Life goal is refused rather than given an invented home.
   */
  private async nearestBacklogHost(ctx: RequestContext, weeklyGoalId: string): Promise<{ host: Goal; interior: TreeIndex<Goal> }> {
    const goal = await this.goals.findById(ctx.userId, weeklyGoalId);
    if (!goal) throw notFound('goal');
    // The index is returned alongside the host because the caller needs it again immediately, for
    // R-backlog-13's branch-path labels on the item it is about to create. One read, two uses.
    const interior = indexTree(await this.goals.listInterior(ctx.userId));
    if (goal.horizon !== 'Weekly') return { host: goal, interior };
    if (goal.parentId === null) {
      throw new DomainError('LIFE_GOAL_NO_BACKLOG', 'this weekly goal has no goal above it that can hold a backlog item', {
        goalId: goal.id,
      });
    }
    const parent = interior.byId.get(goal.parentId);
    if (!parent || isLifeHorizon(parent.horizon)) {
      throw new DomainError('LIFE_GOAL_NO_BACKLOG', 'a life goal holds no backlog items; this task has nowhere above its week to go', {
        goalId: goal.id,
        parentId: goal.parentId,
        lifeRootId: parent ? lifeRootIn(interior, parent.id)?.id ?? null : null,
      });
    }
    return { host: parent, interior };
  }

  /**
   * R-task-55 — the period bounds for THIS operation, checked against the key the CLIENT named.
   *
   * ⚠ **A8** — the wire no longer carries an offset. The client sends the canonical period it is standing
   * in, because an offset cannot say which scope it means once a task may be scoped to a month
   * (S-task-55-2). The two bounds are unchanged:
   *
   * `origin <= period` always: a task did not exist in a period before its own origin (S-task-14-2).
   * `period <= currentPeriod` for **complete** only (R-task-44) — you cannot finish work in a period that
   * has not happened — while the other two exits work on future-dated work (R-task-36).
   */
  private assertPeriodFor(ctx: RequestContext, task: Task, weekStart: string, opts: { allowFuture: boolean }): string {
    if (weekStart < task.originPeriodKey) {
      throw new DomainError('WEEK_OUT_OF_RANGE', 'the task did not exist in that week', {
        weekStart,
        originPeriodKey: task.originPeriodKey,
      });
    }
    if (!opts.allowFuture && weekStart > ctx.currentWeekStart) {
      throw new DomainError('WEEK_OUT_OF_RANGE', 'a task cannot be completed in a week that has not happened', {
        weekStart,
        currentWeekStart: ctx.currentWeekStart,
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
    return {
      ...toTaskView(task, links, viewedWeekStart, ctx.currentWeekStart),
      events: events.map(toEventView),
    };
  }

  /** R-task-49 — the Weekly goal a create minted, shaped for the toast and the live region. */
  private async goalView(ctx: RequestContext, goal: Goal): Promise<GoalView> {
    const interior = indexTree(await this.goals.listInterior(ctx.userId));
    const parent = goal.parentId ? interior.byId.get(goal.parentId) : undefined;
    const lifeRootId = parent ? (isLifeHorizon(parent.horizon) ? parent.id : (lifeRootIn(interior, parent.id)?.id ?? null)) : null;
    return {
      id: goal.id,
      parentId: goal.parentId,
      horizon: goal.horizon,
      title: goal.title,
      why: goal.why,
      pulse: goal.pulse,
      periodKey: goal.periodKey,
      period: goal.period,
      lifeRootId,
      backlogCount: 0,
      carrying: null,
      // It was created for this week, so it is not stale (R-goal-43), and it is not Monthly (R-goal-47).
      plannedAgeWeeks: goal.periodKey <= ctx.currentWeekStart ? 0 : null,
      weeklyBreakdown: null,
      createdAt: goal.createdAt,
      updatedAt: goal.updatedAt,
      version: goal.version,
    };
  }
}

