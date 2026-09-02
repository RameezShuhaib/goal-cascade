import {
  MAX_LINKS,
  MAX_PAGE,
  MAX_READINGS,
  MEASURE_MAX_ABS,
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
  type MeasureInput,
  type PatchTaskRequest,
  type RecordReadingRequest,
  type RetargetTaskRequest,
  type RetargetTaskResponse,
  type SetMeasureRequest,
  type TaskDetailResponse,
  type TaskDetailView,
  type TaskResponse,
  type TasksResponse,
  type TaskView,
} from '@goal-cascade/shared';
import { inject, injectable } from 'tsyringe';
import type { BacklogItem, BacklogLink, Goal, Reading, Task, TaskLink } from '../../domain/entities';
import { DomainError, notFound } from '../../domain/errors';
import { indexTree, isLifeHorizon, lifeRootIn, type TreeIndex } from '../../domain/goal-tree';
import { FIRST_SORT_KEY, topKey } from '../../domain/sort-keys';

import { dateInTimezone, isPastPeriod, isPeriodKeyFor, labelOf, periodKeyOf } from '@goal-cascade/shared';
import { NO_MEASURE } from '../../domain/measures';
import type { RequestContext } from '../context';
import {
  IBacklogLinkRepo,
  IBacklogRepo,
  IClock,
  IGoalRepo,
  IIdGenerator,
  IReadingRepo,
  ITaskLinkRepo,
  ITaskRepo,
  type GuardedWrite,
} from '../ports';
import {
  COMPLETED_TEXT,
  DESCRIPTION_UPDATED_TEXT,
  MEASURE_REMOVED_TEXT,
  UNCHECKED_TEXT,
  ActivityLog,
  canceledText,
  condEditedText,
  createdText,
  linkAddedText,
  linkRemovedText,
  measureAddedText,
  measureEditedText,
  movedToBacklogText,
  parkedText,
  renamedText,
  toEventView,
  unparkedText,
} from './activity-log';
import { GuardedBatch } from './guarded-batch';
import { backlogLabelsOf, currentPeriodOf, periodForScope, toBacklogItemView, toReadingView, toTaskView, weekView } from './views';
import { mintWeeklyGoal, resolveWeeklyTarget } from './weekly-target';

/**
 * ⚠ **A8 (R-measure-3) — `current` is the LATEST SURVIVING reading, or `start` when there are none, and
 * it is DERIVED here rather than incremented anywhere.**
 *
 * "Latest" is `(at desc, id desc)`, which matters for two real cases: a back-dated reading (`at` in the
 * past) must NOT become the current value, and two readings landing in the same millisecond must still
 * order — the `id` is a monotonic ULID, so insertion order breaks the tie.
 *
 * This one function is why deletion needs one rule instead of two: deleting the latest falls back to the
 * one before it, deleting a middle one changes nothing, and deleting the only one returns `current` to
 * `start`, all by re-running the same reduction over the survivors (S-measure-3-1, S-measure-3-2).
 */
function currentFrom(readings: readonly Reading[], start: number): number {
  let latest: Reading | undefined;
  for (const r of readings) {
    if (!latest || r.at > latest.at || (r.at === latest.at && r.id > latest.id)) latest = r;
  }
  return latest?.value ?? start;
}

/** R-task-58 — a measure field's old/new value, as the timeline renders it. `null` is `no target`. */
const labelOfValue = (v: string | number | null): string => (v === null ? 'no target' : String(v));

/**
 * R-measure-1 — the five columns, all-or-nothing. Given no input it is `NO_MEASURE`: the five nulls,
 * which is how "this task is an ordinary checkbox" is written and the only way to write it.
 */
function measureColumns(m: MeasureInput | undefined) {
  if (m === undefined) return NO_MEASURE;
  return {
    measureKind: m.kind,
    measureStart: m.start,
    // No readings exist yet, so `current` IS `start` (R-measure-3). It is never client-supplied.
    measureCurrent: m.start,
    measureTarget: m.target,
    measureUnit: m.unit,
  };
}

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
    @inject(IReadingRepo) private readonly readings: IReadingRepo,
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
    // ⚠ **A8** — `GET /tasks?week=` is the WEEK read and stays one: it answers "what is on me this week",
    // and a month task is precisely the work A8 says is not (R-lens-31). The month band is a lens field.
    const visible = await this.tasks.listVisibleInPeriod(ctx.userId, 'Weekly', query.weekStart, limit + 1);
    const tasks = visible.slice(0, limit);
    await this.activity.ensureCarried(ctx, 'Weekly', tasks, query.weekStart);
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
    /**
     * The task page is where the timeline is READ, so the lazy producer runs here too (idempotent).
     *
     * ⚠ **A8** — the page is addressed by a WEEK (`?week=`), and a month task's viewed period is the
     * month that week belongs to (R-lens-31's Monday rule). `periodForScope` is that conversion, and it
     * is done HERE, at the caller that has a week, rather than inside the producer — which is what lets
     * the Monthly lens pass the month it was actually asked for.
     */
    const viewed = periodForScope(task.scope, week.weekStart);
    await this.activity.ensureCarried(ctx, task.scope, [task], viewed);
    return { task: await this.detail(ctx, task, viewed), serverNow: ctx.now };
  }

  /**
   * R-task-51/52/57 / R-task-41/48 — create a task under a **Monthly or a Weekly goal**.
   *
   * ⚠ **A8 + A11 — `period` names the destination, one field at two scopes, the key's format the
   * discriminator** (`32-week-selection` §8.3). `resolveTarget` below is the whole table; the short
   * version:
   *
   *  - **A Monthly goal with no `period`** → a **month task on that goal**. One row, no inference, no
   *    picker, no implicitly created Weekly goal and no navigation. ⚠ **This is the DEFAULT and the
   *    owner's own ruling** (UX-PLAN §9.2): the zero-decision path must be the zero-inference one, which
   *    is the only reading under which R-task-57's "nothing is inferred" and A11's week control are the
   *    same design.
   *  - **A Monthly goal with a Monday** → R-backlog-31's `Add to this week` path for a fresh task: the
   *    Weekly goal at or under it for that week, resolved by the one resolver (`weekly-target.ts`),
   *    ambiguity refused, none taking R-task-48's inline create. **A control the owner drives is not an
   *    inference.**
   *  - **A Weekly goal** → unchanged in every particular.
   *
   * ⚠ **`newWeeklyGoal` never fires as a side effect of accepting a default.** It is reachable only when
   * the request carries it, which the client sends only after the owner named a week and the server
   * refused with `NO_WEEKLY_GOAL`. That is the defect R-rm-6 deletes: a silent implicit create lost the
   * owner three tasks. When it is given, the goal and the task are written **in one transaction** — a
   * failure creates neither (S-task-48-2).
   *
   * `scope` and `originPeriodKey` come from the resolved goal's horizon and `periodKey` and from nowhere
   * else (R-task-52). **No back-dating at either scope** (R-task-41, R-task-57): a goal whose period is
   * past refuses the create with `PERIOD_IN_PAST`. Creating forward is unbounded at both — a Monthly goal
   * six months out accepts month tasks, invisible until that month arrives and never styled as late
   * (R-lens-11, S-task-57-2).
   */
  async create(ctx: RequestContext, input: CreateTaskRequest): Promise<CreateTaskResponse> {
    const today = this.today(ctx);
    const now = ctx.now;
    const writes: GuardedWrite[] = [];

    if (input.measure !== undefined) this.assertMeasure(input.measure);
    const { goal, createdGoal } = await this.resolveTarget(ctx, input, today);
    if (createdGoal) writes.push({ label: 'goal.insertForTask', stmt: this.goals.insertStmt(createdGoal) });
    const scope = goal.horizon === 'Monthly' ? 'Monthly' : 'Weekly';
    const measure = measureColumns(input.measure);

    const task: Task = {
      id: this.ids.ulid(),
      userId: ctx.userId,
      goalId: goal.id,
      scope,
      title: input.title,
      cond: input.cond,
      description: input.description,
      status: 'open',
      // R-task-40 / R-task-52 — seeded ONCE from the RESOLVED parent's `periodKey`, then immutable and
      // never re-read. The goal says what the work is for; this says when it was live, and at creation
      // they are equal BY CONSTRUCTION because the request names a period only to CHOOSE the goal, never
      // to disagree with the one it chose.
      originPeriodKey: goal.periodKey,
      donePeriodKey: null,
      ...measure,
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
    /**
     * ⚠ **A8 (R-task-58)** — a measure attached at create logs `Measure added`, exactly as attaching one
     * later does. The task's shape changed; the timeline says so once, in the same batch, and the
     * `created` line above stays the line about where the work came from (Q-E).
     */
    const measureEvent =
      input.measure === undefined
        ? null
        : this.activity.append(
            ctx,
            task.id,
            'measure_added',
            measureAddedText(input.measure.kind, input.measure.start, input.measure.target, input.measure.unit),
            { kind: input.measure.kind, start: input.measure.start, target: input.measure.target, unit: input.measure.unit },
          );

    // ONE batch. With `newWeeklyGoal` this is R-task-48's atomicity: the goal insert and the task insert
    // commit together or not at all.
    await this.batch.run([
      ...writes,
      { label: 'task.insert', stmt: this.tasks.insertStmt(task) },
      ...links.map((l) => ({ label: 'taskLink.insert', stmt: this.links.insertStmt(l) })),
      created.write,
      ...(measureEvent ? [measureEvent.write] : []),
    ]);

    return {
      task: await this.detail(ctx, task, task.originPeriodKey),
      // R-task-48 — when a Weekly goal was created for you, the client must SAY SO: nothing may be
      // created invisibly. It is `null` on the ordinary path, and on EVERY month-scope create.
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
    if (events.length === 0) return { task: await this.detail(ctx, task, this.nowPeriod(ctx, task)), serverNow: ctx.now };

    const next = await this.write(ctx, task, patch, input.version, events);
    return { task: await this.detail(ctx, next, this.nowPeriod(ctx, next)), serverNow: ctx.now };
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
    const period = this.assertPeriodFor(ctx, task, input.period, { allowFuture: false });

    const event = this.activity.append(ctx, id, 'completed', COMPLETED_TEXT, { periodKey: period });
    const next = await this.write(
      ctx,
      task,
      { status: 'done', donePeriodKey: period, doneAt: ctx.now },
      input.version,
      [event.write],
    );
    return { task: await this.detail(ctx, next, period), serverNow: ctx.now };
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
    return { task: await this.detail(ctx, next, this.nowPeriod(ctx, next)), serverNow: ctx.now };
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
    const { host, interior } = await this.nearestBacklogHost(ctx, task);
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
    return { task: await this.detail(ctx, next, this.nowPeriod(ctx, next)), serverNow: ctx.now };
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

    return { task: await this.detail(ctx, task, this.nowPeriod(ctx, task)), serverNow: ctx.now };
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

    return { task: await this.detail(ctx, task, this.nowPeriod(ctx, task)), serverNow: ctx.now };
  }

  /**
   * ⚠ **A8, new (R-task-56) — Park in a week / Move to the month.**
   *
   * **The one operation that rewrites a task's scope, and it is NOT a fourth exit** (R-task-13,
   * unchanged, still exactly three). An exit takes work *out* of a period; this moves it between two it
   * was already committed to, and the task is still open, still visible and still yours to finish
   * (S-task-56-4).
   *
   * **It sets `goalId`, `originPeriodKey` and `scope` together** — a task's period is always its goal's
   * period at creation, and this is a re-creation of that fact by an explicit write. **Nothing else
   * changes**: title, done-condition, description, links, the timeline and **every reading** are
   * untouched, because a reading is keyed by `taskId` and by nothing else (R-measure-5, S-task-56-1).
   *
   * The direction comes from the task's own scope and the key's format, which is the same discriminator
   * everything else in A8 uses:
   *
   *  - **month task + a Monday** → park. The Weekly goal is resolved under the task's own Monthly goal by
   *    the one resolver: one candidate used silently, two or more `AMBIGUOUS_CONVERSION_TARGET`, none
   *    `NO_WEEKLY_GOAL` unless `newWeeklyGoal` is supplied, in ONE transaction (S-task-56-3). That is why
   *    R-task-48 survives A8.
   *  - **week task + a month key** → un-park, onto the Weekly goal's **nearest Monthly ancestor**. A
   *    Weekly goal with no Monthly ancestor (R-goal-32 permits it) has no target and is refused with
   *    `HORIZON_CONFLICT`; the action is not rendered either. It is the exact shape of R-backlog-29's
   *    refusal and is rare for the same reason.
   *  - **the period it is already in** → an idempotent **no-op that writes no event**.
   *  - **anything else** → refused. A week task moved to a different week is the reschedule this product
   *    does not have; a month task moved to a different month is the same thing one scale up.
   *
   * **Bounds.** The target may not be past (`PERIOD_IN_PAST`) — parking is planning. A **done** or
   * **exited** task is refused (`TASK_ALREADY_EXITED`).
   *
   * `originPeriodKey` is therefore immutable against everything except this one named operation, which is
   * the narrowest possible weakening of R-task-40: D-1's failure mode is a period that changes *without a
   * write*, and this is a write — confirmed, logged and reversible.
   */
  async retarget(ctx: RequestContext, id: string, input: RetargetTaskRequest): Promise<RetargetTaskResponse> {
    const task = await this.load(ctx, id);
    if (task.status !== 'open') {
      throw new DomainError('TASK_ALREADY_EXITED', 'only an open task can be parked or moved to its month', {
        status: task.status,
      });
    }
    const today = this.today(ctx);

    // R-task-56 — retargeting to the period the task is already in writes nothing at all, not even an
    // event: it is a mis-tap or a double-submit, and a timeline that recorded it would be noise.
    if (input.period === task.originPeriodKey) {
      return { task: await this.detail(ctx, task, task.originPeriodKey), goal: null, serverNow: ctx.now };
    }

    const toWeek = isPeriodKeyFor('Weekly', input.period);
    const toMonth = isPeriodKeyFor('Monthly', input.period);
    if (!toWeek && !toMonth) {
      throw new DomainError('VALIDATION_FAILED', 'a task is parked into a week or moved to a month, and to nothing else', {
        period: input.period,
      });
    }
    if (task.scope === 'Weekly' && toWeek) {
      // S-task-56-4 — this is `reschedule`, and the product does not have one. Refusing it here is what
      // stops Park from becoming a fourth exit by accident.
      throw new DomainError('VALIDATION_FAILED', 'a week task moves to its month; it is not rescheduled into another week', {
        period: input.period,
        originPeriodKey: task.originPeriodKey,
      });
    }
    if (task.scope === 'Monthly' && toMonth) {
      throw new DomainError('VALIDATION_FAILED', 'a month task is parked into a week; it is not moved to another month', {
        period: input.period,
        originPeriodKey: task.originPeriodKey,
      });
    }
    this.assertNotPast(ctx, toWeek ? 'Weekly' : 'Monthly', input.period, today);

    if (toWeek) return this.park(ctx, task, input);
    return this.unpark(ctx, task, input);
  }

  /**
   * ⚠ **A8, new (R-measure-1)** — attach a measure to a task, or replace the one that is there.
   *
   * Its own command rather than a field on `PATCH /tasks/:id`, so its events are unambiguous: a measure's
   * SHAPE is timeline material and a title edit is not the place to decide which change happened.
   *
   * **The checkbox is still rendered** (R-measure-6, S-measure-1-2): a measurable task completes exactly
   * like any other, in both directions, and attaching a number changes nothing about that.
   *
   * Editing **never touches the readings** — they are the history of the number, not of its shape — so
   * `current` is recomputed from the surviving readings rather than reset to the new `start`. A `start`
   * edit with readings present is the one case where the two could disagree, and the readings win,
   * because they are what actually happened (R-measure-3).
   */
  async setMeasure(ctx: RequestContext, id: string, input: SetMeasureRequest): Promise<TaskResponse> {
    const task = await this.load(ctx, id);
    this.assertNotExited(task, 'carry a measure');
    const m = this.assertMeasure(input.measure);

    /**
     * ⚠ **R-measure-3 — `currentFrom`, not `readings.at(-1)`.**
     *
     * "The latest surviving reading" is `(at desc, id desc)`, and there is one spelling of that rule.
     * `.at(-1)` was a second one that agrees with it only by coincidence of `listByTask`'s `ORDER BY`;
     * a **back-dated** reading is where they come apart, and an edit that touched nothing but the unit
     * would then silently adopt it as the current value.
     */
    const readings = await this.readings.listByTask(ctx.userId, task.id);
    const patch: Partial<Task> = {
      measureKind: m.kind,
      measureStart: m.start,
      measureCurrent: currentFrom(readings, m.start),
      measureTarget: m.target,
      measureUnit: m.unit,
    };

    const events =
      task.measureKind === null
        ? [this.activity.append(ctx, id, 'measure_added', measureAddedText(m.kind, m.start, m.target, m.unit), {
            kind: m.kind,
            start: m.start,
            target: m.target,
            unit: m.unit,
          }).write]
        : // R-task-58 — one line per CHANGED field, exactly as a patch logs one per changed text field.
          // An edit that changes nothing writes nothing and logs nothing.
          ([
            ['kind', task.measureKind, m.kind],
            ['start', task.measureStart, m.start],
            ['target', task.measureTarget, m.target],
            ['unit', task.measureUnit ?? '', m.unit],
          ] as const)
            .filter(([, from, to]) => from !== to)
            .map(
              ([field, from, to]) =>
                this.activity.append(ctx, id, 'measure_edited', measureEditedText(field, labelOfValue(from), labelOfValue(to)), {
                  field,
                  from,
                  to,
                }).write,
            );

    if (events.length === 0) return { task: await this.detail(ctx, task, this.nowPeriod(ctx, task)), serverNow: ctx.now };
    const next = await this.write(ctx, task, patch, input.version, events);
    return { task: await this.detail(ctx, next, this.nowPeriod(ctx, next)), serverNow: ctx.now };
  }

  /**
   * ⚠ **A8, new (R-measure-1)** — remove the measure **and every one of its readings**, in one
   * transaction.
   *
   * It is therefore a confirmed destructive act, and the client names the count before asking
   * (`This deletes 14 recorded values.`) — the same discipline Q-5 applies to a subtree delete. The task
   * becomes an ordinary checkbox again, byte-identical to one that never had a measure.
   */
  async clearMeasure(ctx: RequestContext, id: string, version?: number): Promise<TaskResponse> {
    const task = await this.load(ctx, id);
    this.assertNotExited(task, 'carry a measure');
    if (task.measureKind === null) {
      throw new DomainError('NO_MEASURE', 'this task carries no measure', { taskId: task.id });
    }
    const count = await this.readings.countByTask(ctx.userId, task.id);
    const event = this.activity.append(ctx, id, 'measure_removed', MEASURE_REMOVED_TEXT, { readingsDeleted: count });
    const next = await this.write(ctx, task, { ...NO_MEASURE }, version, [
      { label: 'reading.deleteByTask', stmt: this.readings.deleteByTaskStmt(ctx.userId, task.id), expectedChanges: count },
      event.write,
    ]);
    return { task: await this.detail(ctx, next, this.nowPeriod(ctx, next)), serverNow: ctx.now };
  }

  /**
   * ⚠ **A8, new (R-measure-3)** — record one reading, and maintain `measure_current` in the SAME
   * transaction.
   *
   * **What is stored is always the ABSOLUTE value of the measure after this reading.** A counter's `+3` is
   * resolved against `current` here, before the write, which is what makes deletion correct with one rule
   * instead of two: had a counter stored deltas and a gauge absolutes, `current` would be computed two
   * ways, the sparkline drawn two ways, and the owner's own mistyped-240 example would resolve differently
   * depending on which kind it was typed into.
   *
   * The input asymmetry is deliberate (S-measure-3-3): a `delta` against a **gauge** is refused
   * (`MEASURE_KIND_MISMATCH`), because a gauge is set; an absolute `value` against a **counter** is
   * accepted, because correcting a counter to where it actually is ("I'm at 12") is legitimate and a
   * counter is a gauge you usually bump.
   *
   * **No timeline entry is written, in either direction** (R-measure-7). A counter bumped daily for a
   * quarter would put ninety rows into a log whose job is to answer "what happened to this task", and
   * those ninety rows are already on the page, above it, in the right shape.
   *
   * ⚠ **`current` is recomputed from the readings, never incremented in place.** A back-dated reading
   * (`at` in the past) does not become the latest, and the value the task carries must be the latest
   * SURVIVING reading by `(at desc, id desc)` — which is a property of the set, not of this write.
   */
  async recordReading(ctx: RequestContext, id: string, input: RecordReadingRequest): Promise<TaskResponse> {
    const task = await this.load(ctx, id);
    this.assertNotExited(task, 'record a value');
    const measure = this.requireMeasure(task);

    if (input.delta !== undefined && measure.kind === 'gauge') {
      throw new DomainError('MEASURE_KIND_MISMATCH', 'a gauge is set to a value, not added to — send `value`', {
        taskId: task.id,
        kind: measure.kind,
      });
    }
    const existing = await this.readings.listByTask(ctx.userId, task.id);
    if (existing.length >= MAX_READINGS) {
      throw new DomainError('VALIDATION_FAILED', `a task holds at most ${MAX_READINGS} readings`, {
        taskId: task.id,
        max: MAX_READINGS,
      });
    }

    const value = input.value ?? measure.current + input.delta!;
    if (!Number.isFinite(value) || Math.abs(value) > MEASURE_MAX_ABS) {
      throw new DomainError('VALIDATION_FAILED', `a recorded value must be finite and within ±${MEASURE_MAX_ABS}`, {
        taskId: task.id,
        value,
      });
    }
    const reading: Reading = {
      id: this.ids.ulid(),
      userId: ctx.userId,
      taskId: task.id,
      value,
      at: input.at ?? ctx.now,
      createdAt: ctx.now,
    };

    const next = await this.write(ctx, task, { measureCurrent: currentFrom([...existing, reading], measure.start) }, input.version, [
      { label: 'reading.insert', stmt: this.readings.insertStmt(reading) },
    ]);
    return { task: await this.detail(ctx, next, this.nowPeriod(ctx, next)), serverNow: ctx.now };
  }

  /**
   * ⚠ **A8, new (R-measure-3, R-measure-5)** — delete one reading, and fall `current` back.
   *
   * Deleting the latest falls back to the one before it; deleting a middle one changes nothing; deleting
   * the only one returns `current` to `start` — **one rule, because every reading is an absolute**
   * (S-measure-3-1, S-measure-3-2).
   *
   * **A deleted reading leaves no trace anywhere, deliberately** (R-measure-7): an audit trail of a typo
   * defeats the reason deletion exists. There is no event, no tombstone and no soft-delete.
   */
  async deleteReading(ctx: RequestContext, id: string, readingId: string, version?: number): Promise<TaskResponse> {
    const task = await this.load(ctx, id);
    // D-15 — an EXITED task is a historical record, not work. Every other write on a task refuses one;
    // without this, a cancelled task's readings were the one thing in the product still mutable after
    // the exit, and a deletion leaves no trace to notice it by (R-measure-7).
    this.assertNotExited(task, 'delete a recorded value');
    const measure = this.requireMeasure(task);
    const existing = await this.readings.listByTask(ctx.userId, task.id);
    if (!existing.some((r) => r.id === readingId)) throw notFound('reading');

    const survivors = existing.filter((r) => r.id !== readingId);
    const next = await this.write(ctx, task, { measureCurrent: currentFrom(survivors, measure.start) }, version, [
      { label: 'reading.delete', stmt: this.readings.deleteStmt(ctx.userId, task.id, readingId) },
    ]);
    return { task: await this.detail(ctx, next, this.nowPeriod(ctx, next)), serverNow: ctx.now };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Internals
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * R-task-56 — month → week. The Weekly goal is resolved by the ONE resolver, under the Monthly goal the
   * task is on, so this refusal and a backlog conversion's are the same refusal (`weekly-target.ts`).
   */
  private async park(ctx: RequestContext, task: Task, input: RetargetTaskRequest): Promise<RetargetTaskResponse> {
    const target = await resolveWeeklyTarget(ctx, this.weeklyDeps(), {
      underGoalId: task.goalId,
      weekStart: input.period,
      subject: task.title,
      requested: input.goalId,
      inline: input.newWeeklyGoal,
      details: { taskId: task.id },
    });
    const event = this.activity.append(ctx, task.id, 'parked', parkedText(input.period), {
      from: task.originPeriodKey,
      to: input.period,
      goalId: target.goal.id,
    });
    const next = await this.write(
      ctx,
      task,
      { goalId: target.goal.id, scope: 'Weekly', originPeriodKey: input.period },
      input.version,
      [
        ...(target.created ? [{ label: 'goal.insertForPark', stmt: this.goals.insertStmt(target.created) }] : []),
        event.write,
      ],
    );
    return {
      task: await this.detail(ctx, next, input.period),
      goal: target.created ? await this.goalView(ctx, target.created) : null,
      serverNow: ctx.now,
    };
  }

  /**
   * R-task-56 — week → month, onto the Weekly goal's **nearest Monthly ancestor** at that goal's month.
   *
   * The target is derived and then CHECKED against the key the client sent, rather than taken from it:
   * the destination is fully determined by the tree, and requiring the client to name it is what makes
   * the operation's intent explicit and its no-op case detectable. A mismatch is a client that has drifted
   * from the data, and it is refused rather than silently redirected.
   *
   * A Weekly goal with no Monthly ancestor has no target at all — R-goal-32 permits a Weekly goal to hang
   * off a Life, Yearly or Quarterly goal — and is refused with `HORIZON_CONFLICT`. It is the exact shape
   * of R-backlog-29's refusal and is rare for the same reason.
   */
  private async unpark(ctx: RequestContext, task: Task, input: RetargetTaskRequest): Promise<RetargetTaskResponse> {
    if (input.goalId !== undefined || input.newWeeklyGoal !== undefined) {
      throw new DomainError('VALIDATION_FAILED', 'moving a task to its month resolves no goal: it goes to the monthly one above it', {
        taskId: task.id,
      });
    }
    const interior = indexTree(await this.goals.listInterior(ctx.userId));
    const goal = await this.goals.findById(ctx.userId, task.goalId);
    if (!goal) throw notFound('goal');

    let cursor = goal.parentId ? interior.byId.get(goal.parentId) : undefined;
    while (cursor && cursor.horizon !== 'Monthly') cursor = cursor.parentId ? interior.byId.get(cursor.parentId) : undefined;
    if (!cursor) {
      throw new DomainError('HORIZON_CONFLICT', 'this weekly goal has no monthly goal above it, so there is no month to move to', {
        taskId: task.id,
        goalId: goal.id,
      });
    }
    if (cursor.periodKey !== input.period) {
      throw new DomainError('VALIDATION_FAILED', "that is not this task's month; it moves to the month of the goal above it", {
        taskId: task.id,
        period: input.period,
        monthPeriodKey: cursor.periodKey,
      });
    }

    const event = this.activity.append(ctx, task.id, 'unparked', unparkedText(cursor.periodKey), {
      from: task.originPeriodKey,
      to: cursor.periodKey,
      goalId: cursor.id,
    });
    const next = await this.write(
      ctx,
      task,
      { goalId: cursor.id, scope: 'Monthly', originPeriodKey: cursor.periodKey },
      input.version,
      [event.write],
    );
    return { task: await this.detail(ctx, next, cursor.periodKey), goal: null, serverNow: ctx.now };
  }

  /**
   * ⚠ **R-measure-4 — THE `target === start` rule, and it reads two numbers.**
   *
   * It names no movement, and "maintain" — the only thing it could mean — is out of scope for this
   * amendment. **This is the whole enforcement point**, deliberately here rather than in a Zod refinement
   * on `MeasureInput`: a refinement guards `/api/*` alone, and the MCP tools declare their own schemas,
   * so `set_task_measure` used to write a `5 / 5` measure with no progress and a
   * `Measure added: counter, 5 → 5` line beside it. It also could never carry its own code, because
   * `api/validate.ts` flattens every schema failure to `VALIDATION_FAILED` — which is how the web came to
   * render the constant's NAME to the owner as a toast.
   *
   * Refusing it here is only half the rule. The other half is that where such a row exists **anyway** — a
   * migration, a hand-edit, a bug — **no division is performed**: `progressOf` returns `null` and the
   * field is omitted from the wire (`domain/measures.ts`). `NaN`, `Infinity`, `0%` and `100%` are each
   * specifically forbidden as the answer, because this is the one place a divide-by-zero reaches a screen.
   */
  private assertMeasure(m: MeasureInput): MeasureInput {
    if (m.target !== null && m.target === m.start) {
      throw new DomainError('MEASURE_TARGET_EQUALS_START', 'a target equal to the start names no movement', {
        start: m.start,
        target: m.target,
      });
    }
    return m;
  }

  /** R-measure-3 — a reading needs somewhere to go. A checkbox has nowhere (`NO_MEASURE`, 409). */
  private requireMeasure(task: Task): { kind: 'counter' | 'gauge'; start: number; current: number } {
    if (task.measureKind === null) {
      throw new DomainError('NO_MEASURE', 'this task carries no measure; attach one first', { taskId: task.id });
    }
    const start = task.measureStart ?? 0;
    return { kind: task.measureKind, start, current: task.measureCurrent ?? start };
  }

  /**
   * ⚠ **A8** — the period a command response should be rendered in when the caller named none: the
   * CURRENT period **at the task's own scope**.
   *
   * On 2 Sep 2026 that is `2026-08` for a month task and `2026-08-31` for a week task, which are the same
   * week seen at two scales (R-goal-33's Monday rule). Every one of these responses used to say
   * `ctx.currentWeekStart`, which would compare a month key against a Monday and answer nonsense for
   * `carryAge` and `completable`.
   */
  private nowPeriod(ctx: RequestContext, task: Task): string {
    return currentPeriodOf(ctx, task.scope);
  }

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
   * ⚠ **A8 (R-task-51, R-goal-37) — THE task-ownership rule, and it reads ONE ROW. This is the whole
   * enforcement point; the rule lives here and nowhere in SQL.**
   *
   * `assertActiveLeaf` used to load the owner's entire goal list, derive leaf-ness with an O(n) scan and
   * then look up a focus row. This compares one field against two values.
   *
   * **The condition is the HORIZON, full stop — never leaf-ness.** It now names two horizons instead of
   * one, and every other word of R-goal-39's ruling survives, including the trap it exists to catch: a
   * **Quarterly** goal with no Monthly children is a leaf by the structural definition and is precisely
   * the goal that must never hold a task (S-task-51-2). A build that admitted it would have keyed task
   * ownership on leaf-ness, and nothing in the type system or in a test would have caught it.
   *
   * ⚠ **`NOT_A_WEEKLY_GOAL` is retired, not renamed-and-kept** (R-rm-6): the string must survive in no
   * error catalogue, MCP recovery line, client copy or test.
   */
  private async assertTaskGoal(ctx: RequestContext, goalId: string): Promise<Goal> {
    const goal = await this.goals.findById(ctx.userId, goalId);
    if (!goal) throw notFound('goal');
    if (goal.horizon !== 'Monthly' && goal.horizon !== 'Weekly') {
      throw new DomainError('NOT_A_TASK_GOAL', 'a task lives under a monthly or a weekly goal', {
        goalId,
        horizon: goal.horizon,
      });
    }
    return goal;
  }

  /**
   * ⚠ **A8 + A11 (R-task-51/52/57, `32-week-selection` §8.3) — the create's destination table, in one
   * place, and the ONLY place a task's goal and scope are decided.**
   *
   * `period` is one field at two scopes and the key's **format** is the discriminator (R-task-52). The
   * table, exhaustively:
   *
   * | goal's horizon | `period` | outcome |
   * |---|---|---|
   * | Weekly | absent, or `= goal.periodKey` | that goal — a week task |
   * | Weekly | anything else | `VALIDATION_FAILED` — a Weekly goal *is* its week; moving work between weeks is Park |
   * | Monthly | absent, or `= goal.periodKey` | that goal — a **month task**, the default |
   * | Monthly | a month key that is not the goal's | `VALIDATION_FAILED` — `originPeriodKey` is seeded from the goal, so a different month names no destination |
   * | Monthly | a Monday | the Weekly goal at or under it for that week (`weekly-target.ts`) |
   * | Monthly | a year or quarter key | `VALIDATION_FAILED` — no goal holds tasks at those horizons |
   * | Life / Yearly / Quarterly | any | `NOT_A_TASK_GOAL` |
   * | `newWeeklyGoal`, `period` a Monday | — | mint for THAT week |
   * | `newWeeklyGoal`, `period` absent | — | mint for the CURRENT week (the `+` drawer, R-backlog-27) |
   *
   * ⚠ **The month is the default and nothing is inferred on it** (owner ruling, UX-PLAN §9.2): with no
   * `period` a Monthly goal yields one row on the goal you tapped, and `resolveWeeklyTarget` — the only
   * thing that can mint a goal — is not reached at all.
   *
   * **No back-dating at either scope** (R-task-41, R-task-57), enforced THROUGH THE RESOLVED PARENT: the
   * affordance is absent on a past month, a past week and in the carried band, and this is the server's
   * half of that (S-task-41-1, S-task-57-2).
   */
  private async resolveTarget(
    ctx: RequestContext,
    input: CreateTaskRequest,
    today: string,
  ): Promise<{ goal: Goal; createdGoal: Goal | null }> {
    const refuse = (message: string, details: Record<string, unknown>): never => {
      throw new DomainError('VALIDATION_FAILED', message, details);
    };

    if (input.newWeeklyGoal) {
      // The inline create names a WEEK or means the current one. A month key here would ask for a Weekly
      // goal whose period is a month, which is not a thing that can exist (R-goal-33).
      const weekStart = input.period ?? ctx.currentWeekStart;
      if (!isPeriodKeyFor('Weekly', weekStart)) {
        refuse('a new weekly goal needs a week, not a period of another horizon', { period: input.period });
      }
      const createdGoal = await this.mintWeeklyGoal(ctx, input.newWeeklyGoal, weekStart);
      return { goal: createdGoal, createdGoal };
    }

    const goal = await this.assertTaskGoal(ctx, input.goalId!);
    const period = input.period ?? goal.periodKey;

    // The week path: a Monday under a Monthly goal. Resolved by the one resolver, so this create, a
    // backlog conversion and Park cannot disagree about ambiguity (`weekly-target.ts`).
    if (goal.horizon === 'Monthly' && isPeriodKeyFor('Weekly', period)) {
      this.assertNotPast(ctx, 'Weekly', period, today);
      const target = await resolveWeeklyTarget(ctx, this.weeklyDeps(), {
        underGoalId: goal.id,
        weekStart: period,
        subject: input.title,
        requested: undefined,
        inline: undefined,
        details: { goalId: goal.id },
      });
      return { goal: target.goal, createdGoal: target.created };
    }

    if (period !== goal.periodKey) {
      refuse('that period is not this goal\'s own, and a task takes its period from its goal', {
        goalId: goal.id,
        horizon: goal.horizon,
        period,
        goalPeriodKey: goal.periodKey,
      });
    }
    this.assertNotPast(ctx, goal.horizon === 'Monthly' ? 'Monthly' : 'Weekly', goal.periodKey, today);
    return { goal, createdGoal: null };
  }

  /** R-goal-36 / R-task-41 — planning never rewrites history, at either scope. */
  private assertNotPast(ctx: RequestContext, scope: 'Monthly' | 'Weekly', periodKey: string, today: string): void {
    if (!isPastPeriod(scope, periodKey, today)) return;
    throw new DomainError('PERIOD_IN_PAST', 'work cannot be added to a period that has passed', { scope, periodKey });
  }

  /** The three things `weekly-target.ts` needs, gathered once so no caller passes a different clock. */
  private weeklyDeps() {
    return { goals: this.goals, ids: this.ids, now: () => this.clock.nowIso() };
  }

  /**
   * R-task-48 — build the Weekly goal for an inline create, **for the week the request named**.
   *
   * ⚠ **A11** — the target week is a parameter now, not `ctx.currentWeekStart`. `+ Task` on a Monthly
   * goal offers that month's weeks, and an inline create for the week of 19 Oct that minted a goal for
   * *this* week would put the work somewhere the sheet did not say (`32-week-selection` §4.5). The `+`
   * drawer's `Add to this week instead` sends no period and still means the current week.
   *
   * The parent, the horizon, the past-period rule **and Q-12's per-week cap** are all
   * `weekly-target.ts`'s, so this create, a backlog conversion and Park validate identically. The cap
   * used to be re-checked here and nowhere else, which is exactly how the other two paths came to bypass
   * it (see that module's doc block).
   */
  private mintWeeklyGoal(ctx: RequestContext, input: NewWeeklyGoalInput, weekStart: string): Promise<Goal> {
    return mintWeeklyGoal(ctx, this.weeklyDeps(), input, weekStart);
  }

  /**
   * R-backlog-29 / **R-task-59** — the nearest goal that can hold a backlog item: where Move-to-Backlog
   * lands.
   *
   * ⚠ **A8 — the walk TERMINATES IMMEDIATELY for a month task**, because the goal it is already on is a
   * Monthly goal and a Monthly goal holds both a backlog and tasks, deliberately (R-backlog-30). That is
   * the demotion the model needs: a month task that has carried three months and earned its chip is
   * answered by finishing it, cancelling it, or admitting it is a *maybe* and sending it to the backlog
   * **on the goal it already sits on, in one tap, losing nothing** (S-task-59-1). Promotion back is
   * `Add to this month` (R-backlog-31), and the two concepts stay apart because the move between them is
   * cheap and explicit in both directions.
   *
   * For a **week** task the walk is unchanged: over the interior tree, which is exactly the set that can
   * hold a backlog item, one read and O(d) hops. A **Life** root is not a legal host (R-backlog-2), so a
   * Weekly goal hung directly off a Life goal is still refused with `LIFE_GOAL_NO_BACKLOG` rather than
   * given an invented home.
   */
  private async nearestBacklogHost(ctx: RequestContext, task: Task): Promise<{ host: Goal; interior: TreeIndex<Goal> }> {
    const goal = await this.goals.findById(ctx.userId, task.goalId);
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
  private assertPeriodFor(ctx: RequestContext, task: Task, period: string, opts: { allowFuture: boolean }): string {
    /**
     * ⚠ **The scope check comes FIRST, and it is not a formality.** `'2026-08-31' >= '2026-08'` and
     * `'2026-08-31' <= '2026-09'` are both true as string comparisons, so a Monday would satisfy both
     * bounds for a month task — and would then be stamped into `done_period_key`, where no month lens
     * could ever match it again. The keys only compare meaningfully inside one scope (R-task-52), and
     * this is where a request from the wrong surface is caught.
     */
    if (!isPeriodKeyFor(task.scope, period)) {
      throw new DomainError('WEEK_OUT_OF_RANGE', `that is not a ${task.scope === 'Monthly' ? 'month' : 'week'} key`, {
        period,
        scope: task.scope,
        originPeriodKey: task.originPeriodKey,
      });
    }
    if (period < task.originPeriodKey) {
      throw new DomainError('WEEK_OUT_OF_RANGE', 'the task did not exist in that period', {
        period,
        originPeriodKey: task.originPeriodKey,
      });
    }
    const current = this.nowPeriod(ctx, task);
    if (!opts.allowFuture && period > current) {
      throw new DomainError('WEEK_OUT_OF_RANGE', 'a task cannot be completed in a period that has not happened', {
        period,
        currentPeriodKey: current,
      });
    }
    return period;
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

  /**
   * ⚠ **A8** — `viewedPeriodKey` is a period at the TASK'S OWN SCOPE, and `currentPeriodKey` is derived
   * from it, so `carryAge` and `completable` are never computed across scopes.
   *
   * ⚠ **A8 (R-measure-5, Q-26/Q-27)** — the readings ride along, oldest first, bounded by `MAX_READINGS`.
   * The task page renders a sparkline plus the recent values from this one array; there is no second read
   * and no paging, because the cap already bounds the payload.
   */
  private async detail(ctx: RequestContext, task: Task, viewedPeriodKey: string): Promise<TaskDetailView> {
    const [links, events, readings] = await Promise.all([
      this.links.listByTasks(ctx.userId, [task.id]),
      this.activity.list(ctx.userId, task.id),
      task.measureKind === null ? Promise.resolve([]) : this.readings.listByTask(ctx.userId, task.id),
    ]);
    return {
      ...toTaskView(task, links, viewedPeriodKey, currentPeriodOf(ctx, task.scope)),
      events: events.map(toEventView),
      readings: readings.map(toReadingView),
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

