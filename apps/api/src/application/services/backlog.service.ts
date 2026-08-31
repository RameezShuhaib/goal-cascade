import { MAX_PAGE } from '@goal-cascade/shared';
import type {
  BacklogItemResponse,
  BacklogItemView,
  BacklogResponse,
  ConvertBacklogItemRequest,
  ConvertBacklogItemResponse,
  CreateBacklogItemRequest,
  DeleteResponse,
  ExternalLinkView,
  MoveBacklogItemRequest,
  PatchBacklogItemRequest,
  GoalView,
  TaskDetailView,
  TaskEventView,
} from '@goal-cascade/shared';
import { inject, injectable } from 'tsyringe';
import type { RequestContext } from '../context';
import type { BacklogItem, BacklogLink, Goal, Task, TaskEvent, TaskLink } from '../../domain/entities';
import { TASK_EVENT_GLYPHS, type TaskSource } from '../../domain/enums';
import { DomainError, notFound } from '../../domain/errors';
import { indexTree, isLifeHorizon, lifeRootIn } from '../../domain/goal-tree';
import { isPastPeriod, labelOf } from '../../domain/periods';
import { dateInTimezone, weekStartFromOffset } from '../../domain/weeks';
import type { GuardedWrite } from '../ports';
import {
  IBacklogLinkRepo,
  IBacklogRepo,
  IClock,
  IGoalRepo,
  IIdGenerator,
  ITaskEventRepo,
  ITaskLinkRepo,
  ITaskRepo,
} from '../ports';
import { GuardedBatch } from './guarded-batch';

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers. `capture.service.ts` imports `newestFirst` so the two capture-style lists answer in
// exactly one order — Q-7 requires a total, stable order, and two implementations of it would drift.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Q-7 / R-backlog-5 / D-17 — `capturedAt` descending, `id` descending as tie-break.
 *
 * Applied in the service even though the repo already ORDERs by the same columns: the ordering rule is a
 * product rule, an aggregate merges rows from several queries, and Q-7 requires an order that is total
 * and stable rather than whatever storage happened to return. The mockup relied on array insertion order
 * and any refetch scrambled it (D-17).
 */
export function newestFirst<T extends { capturedAt: string; id: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) =>
    a.capturedAt === b.capturedAt ? (a.id < b.id ? 1 : a.id > b.id ? -1 : 0) : a.capturedAt < b.capturedAt ? 1 : -1,
  );
}

export function toLinkView(l: { id: string; url: string; createdAt: string }): ExternalLinkView {
  return { id: l.id, url: l.url, createdAt: l.createdAt };
}

export function toBacklogItemView(item: BacklogItem, links: readonly BacklogLink[]): BacklogItemView {
  return {
    id: item.id,
    goalId: item.goalId,
    title: item.title,
    description: item.description,
    links: links.filter((l) => l.itemId === item.id).map(toLinkView),
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

/**
 * R-task-30 / R-task-46 — the `Created — …` line each of the three sources logs.
 *
 * ⚠ **A2** — the table changes in exactly two rows and no other way: `Created — weekly planning` is
 * **renamed** `Created — added to a goal` (there is no planning screen), and `Created — from an Idea` is
 * **retired** with the entity. Every other entry, glyph and trigger is unchanged (S-task-46-1).
 */
export const CREATED_EVENT_TEXT: Record<TaskSource, string> = {
  goal: 'Created — added to a goal',
  backlog: 'Created — pulled from Backlog',
  drawer: 'Created — added to this week',
};

/** Everything a conversion needs to know to mint a task. Deliberately free of any backlog concept. */
export type NewTaskDraft = {
  goalId: string;
  title: string;
  cond: string;
  description: string;
  links: readonly string[];
  source: TaskSource;
  /**
   * ⚠ **A2 (R-task-40)** — the task's own stored week, taken from the **Weekly goal** receiving it. There
   * is no target-week parameter anywhere in the product: at creation the two are equal by construction.
   */
  originWeekStart: string;
  /** Structured provenance for the `created` event (`{ backlogItemId }`). */
  detail: Record<string, unknown>;
};

export type TaskWrites = { task: Task; links: TaskLink[]; event: TaskEvent; writes: GuardedWrite[] };

/**
 * Build the rows for a task created by a CONVERSION, as unexecuted statements.
 *
 * They are statements rather than a `TaskService.create()` call on purpose: a conversion is ONE atomic
 * operation (Q-4), and two services each running their own `GuardedBatch` would be two transactions —
 * exactly the split that let the mockup create a task and never persist the item's removal (D-19).
 * `TaskService` owns everything a task does AFTER it exists; this is the narrow seam where a conversion
 * mints one. See `docs/work/05-backlog-capture/build.md`.
 *
 * ⚠ **A2 (R-task-40)** — `originWeekStart` comes from the **Weekly goal** the conversion resolved, not
 * from "the current week": the receiving goal names the target week (R-backlog-26), and the task's week
 * is seeded from it once and then immutable. No back-dating survives that, because the resolution itself
 * refuses a past week.
 */
export function buildTaskWrites(
  ctx: RequestContext,
  deps: { ids: IIdGenerator; tasks: ITaskRepo; taskLinks: ITaskLinkRepo; taskEvents: ITaskEventRepo },
  draft: NewTaskDraft,
): TaskWrites {
  const task: Task = {
    id: deps.ids.ulid(),
    userId: ctx.userId,
    goalId: draft.goalId,
    title: draft.title,
    cond: draft.cond,
    description: draft.description,
    status: 'open',
    originWeekStart: draft.originWeekStart,
    doneWeekStart: null,
    doneAt: null,
    exitReason: null,
    exitedAt: null,
    movedToBacklogItemId: null,
    createdAt: ctx.now,
    updatedAt: ctx.now,
    version: 1,
  };
  const links: TaskLink[] = draft.links.map((url) => ({
    id: deps.ids.ulid(),
    userId: ctx.userId,
    taskId: task.id,
    url,
    createdAt: ctx.now,
  }));
  // R-task-31 — appended by the server as a side effect, in the SAME batch as the row it describes.
  const event: TaskEvent = {
    id: deps.ids.ulid(),
    userId: ctx.userId,
    taskId: task.id,
    kind: 'created',
    text: CREATED_EVENT_TEXT[draft.source],
    glyph: TASK_EVENT_GLYPHS.created,
    detail: JSON.stringify({ source: draft.source, ...draft.detail }),
    weekStart: null,
    at: ctx.now,
  };
  return {
    task,
    links,
    event,
    writes: [
      { label: 'task.insert', stmt: deps.tasks.insertStmt(task) },
      ...links.map((l) => ({ label: 'taskLink.insert', stmt: deps.taskLinks.insertStmt(l) })),
      { label: 'taskEvent.insert', stmt: deps.taskEvents.insertStmt(event) },
    ],
  };
}

/**
 * R-task-48/49 — the Weekly goal a conversion minted, shaped for the toast and the live region.
 *
 * It is a brand-new goal for the target week, so the three derived fields are known without a read:
 * nothing is in its backlog, it carries nothing (that is a Life-goal signal), and it is not stale — it
 * was written for the week it is in (R-goal-43). `lifeRootId` is deliberately null: the client already
 * knows the parent it named, and resolving a Life root here would cost a tree read for a toast.
 */
function toGoalView(goal: Goal): GoalView {
  return {
    id: goal.id,
    parentId: goal.parentId,
    horizon: goal.horizon,
    title: goal.title,
    why: goal.why,
    pulse: goal.pulse,
    periodKey: goal.periodKey,
    period: goal.period,
    lifeRootId: null,
    backlogCount: 0,
    carrying: null,
    plannedAgeWeeks: 0,
    weeklyBreakdown: null,
    createdAt: goal.createdAt,
    updatedAt: goal.updatedAt,
    version: goal.version,
  };
}

export function toTaskEventView(e: TaskEvent): TaskEventView {
  return {
    id: e.id,
    kind: e.kind,
    at: e.at,
    text: e.text,
    glyph: e.glyph,
    detail: e.detail ? (JSON.parse(e.detail) as Record<string, unknown>) : null,
  };
}

/**
 * The freshly created task, with the one event it has.
 *
 * `carryWeeks` is 0 by construction: at creation a task's own week and the week it is being viewed in are
 * the same (R-task-40), so there is nothing for R-task-43's signed age to measure. `completable` is
 * false for a FUTURE week — a task under a Weekly goal that has not arrived cannot be completed at all
 * until it does (R-task-44).
 */
export function toNewTaskDetailView(w: TaskWrites, currentWeekStart: string): TaskDetailView {
  return {
    id: w.task.id,
    goalId: w.task.goalId,
    title: w.task.title,
    cond: w.task.cond,
    description: w.task.description,
    links: w.links.map(toLinkView),
    status: w.task.status,
    done: false,
    originWeekStart: w.task.originWeekStart,
    doneWeekStart: null,
    doneAt: null,
    exitReason: null,
    exitedAt: null,
    carryWeeks: 0,
    completable: w.task.originWeekStart <= currentWeekStart,
    createdAt: w.task.createdAt,
    updatedAt: w.task.updatedAt,
    version: w.task.version,
    events: [toTaskEventView(w.event)],
  };
}

/**
 * R-backlog-2 / R-backlog-26 — a backlog item attaches to a **Yearly, Quarterly or Monthly** goal.
 *
 * Never a **Life** goal (whose detail page shows a READ-ONLY roll-up of its descendants' items instead,
 * R-backlog-12) and ⚠ **A2** never a **Weekly** goal: the whole point of a backlog item is that it has no
 * week (R-backlog-1/3), and a Weekly goal would give it one. Enforced on create and on move — every goal
 * picker in every backlog flow (S-backlog-26-4).
 */
export function assertCanHoldBacklog(goal: Goal): void {
  if (isLifeHorizon(goal.horizon)) {
    throw new DomainError('LIFE_GOAL_NO_BACKLOG', 'a Life goal holds no backlog items; choose a sub-goal', {
      goalId: goal.id,
    });
  }
  if (goal.horizon === 'Weekly') {
    throw new DomainError('LIFE_GOAL_NO_BACKLOG', 'a weekly goal is a week; a backlog item has none', {
      goalId: goal.id,
      horizon: goal.horizon,
    });
  }
}

/** Builds the item row + its link rows for a new backlog item. */
export function buildBacklogItem(
  ctx: RequestContext,
  ids: IIdGenerator,
  input: { goalId: string; title: string; description: string; links: readonly string[]; fromWeekStart?: string | null },
): { item: BacklogItem; links: BacklogLink[] } {
  const item: BacklogItem = {
    id: ids.ulid(),
    userId: ctx.userId,
    goalId: input.goalId,
    title: input.title,
    description: input.description,
    capturedAt: ctx.now,
    fromWeekStart: input.fromWeekStart ?? null,
    status: 'open',
    convertedToTaskId: null,
    convertedAt: null,
    createdAt: ctx.now,
    updatedAt: ctx.now,
    version: 1,
  };
  const links: BacklogLink[] = input.links.map((url) => ({
    id: ids.ulid(),
    userId: ctx.userId,
    itemId: item.id,
    url,
    createdAt: ctx.now,
  }));
  return { item, links };
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * The backlog: deferred future work under a Yearly/Quarterly/Monthly goal (R-backlog-1..16).
 *
 * Note what this shape does NOT have, deliberately: no checkbox, no done-condition, no due date, no
 * status the user can set (R-backlog-3). A backlog item is intentionally poorer than a task, and the one
 * way it becomes work is `convert` (R-backlog-6).
 */
@injectable()
export class BacklogService {
  constructor(
    @inject(IBacklogRepo) private readonly items: IBacklogRepo,
    @inject(IBacklogLinkRepo) private readonly links: IBacklogLinkRepo,
    @inject(IGoalRepo) private readonly goals: IGoalRepo,
    @inject(ITaskRepo) private readonly tasks: ITaskRepo,
    @inject(ITaskLinkRepo) private readonly taskLinks: ITaskLinkRepo,
    @inject(ITaskEventRepo) private readonly taskEvents: ITaskEventRepo,
    @inject(IIdGenerator) private readonly ids: IIdGenerator,
    @inject(IClock) private readonly clock: IClock,
    @inject(GuardedBatch) private readonly batch: GuardedBatch,
  ) {}

  /**
   * R-backlog-13 / Q-7 — every OPEN item, newest first. Grouping by `<Life goal> › <owning goal>` is the
   * client's job; the server owes it a total order and nothing more.
   *
   * `?goalId=` narrows to one goal — and on a LIFE goal that means the read-only aggregate (R-backlog-12),
   * because a Life goal never holds items itself. See `listForGoal`.
   */
  async list(ctx: RequestContext, queryInput: { goalId?: string; limit?: number }): Promise<BacklogResponse> {
    const limit = Math.min(queryInput.limit ?? MAX_PAGE, MAX_PAGE);
    if (queryInput.goalId !== undefined) {
      const { items } = await this.listForGoal(ctx, queryInput.goalId);
      return { items: items.slice(0, limit), nextCursor: null, serverNow: ctx.now };
    }
    // Q-12 / R-lens-16 — `MAX_PAGE`, wired. It existed and was referenced nowhere.
    const rows = await this.items.listOpen(ctx.userId, limit + 1);
    const page = rows.slice(0, limit);
    return {
      items: await this.viewsOf(ctx, page),
      nextCursor: rows.length > limit ? (page[page.length - 1]?.id ?? null) : null,
      serverNow: ctx.now,
    };
  }

  /**
   * R-backlog-11/12 — the backlog block on ONE goal's detail page, and the shared seam the goals reader
   * calls for `GoalDetailResponse.backlog` / `.backlogIsAggregate`.
   *
   *   Yearly/Quarterly/Monthly → that goal's OWN items; the client offers the three per-item actions (D-20).
   *   Life goal                → `isAggregate: true`: a READ-ONLY roll-up of every open item on any
   *                              DESCENDANT, each row carrying its own `goalId`. A Life goal never holds
   *                              items itself (R-backlog-2), so no per-item action is offered.
   *   ⚠ **A2 — Weekly**        → **nothing**. A Weekly goal holds no backlog items at all (R-backlog-2,
   *                              amended); its page shows the ancestors' PULL LIST instead (R-backlog-28).
   *
   * ⚠ **A2 (R-lens-27)** — the Life roll-up's scope is now ONE recursive CTE rather than `descendantIds`
   * over the whole goal table.
   */
  async listForGoal(ctx: RequestContext, goalId: string): Promise<{ items: BacklogItemView[]; isAggregate: boolean }> {
    const goal = await this.goals.findById(ctx.userId, goalId);
    if (!goal) throw notFound('goal');
    if (goal.horizon === 'Weekly') return { items: [], isAggregate: false };

    const isAggregate = isLifeHorizon(goal.horizon);
    // The Life roll-up asks for the descendants only — including the root would be meaningless (it can
    // hold nothing) and would hide a data problem rather than surfacing it.
    const scope = isAggregate ? (await this.goals.subtreeIds(ctx.userId, goalId)).filter((id) => id !== goalId) : [goalId];
    const rows = scope.length === 0 ? [] : await this.items.listOpenByGoals(ctx.userId, scope);
    return { items: await this.viewsOf(ctx, rows), isAggregate };
  }

  /** R-backlog-2/4/16 — capture on a non-Life goal. `title` is trimmed and non-empty by schema. */
  async create(ctx: RequestContext, input: CreateBacklogItemRequest): Promise<BacklogItemResponse> {
    assertCanHoldBacklog(await this.requireGoal(ctx, input.goalId));

    const { item, links } = buildBacklogItem(ctx, this.ids, input);
    await this.batch.run([
      { label: 'backlogItem.insert', stmt: this.items.insertStmt(item) },
      ...links.map((l) => ({ label: 'backlogLink.insert', stmt: this.links.insertStmt(l) })),
    ]);
    return { item: toBacklogItemView(item, links), serverNow: ctx.now };
  }

  /**
   * There is no edit-in-place in the mockup's backlog (R-backlog-10), but the API needs one for the
   * task-detail-style corrections the client makes; `links` is a whole-list REPLACE, so an omitted
   * `links` leaves them alone and `[]` clears them.
   */
  async patch(ctx: RequestContext, id: string, input: PatchBacklogItemRequest): Promise<BacklogItemResponse> {
    const item = await this.requireOpenItem(ctx, id, input.version);
    const existing = await this.links.listByItems(ctx.userId, [id]);

    const next: BacklogItem = {
      ...item,
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      updatedAt: ctx.now,
      version: item.version + 1,
    };
    const nextLinks =
      input.links === undefined
        ? existing
        : input.links.map((url) => ({ id: this.ids.ulid(), userId: ctx.userId, itemId: id, url, createdAt: ctx.now }));

    await this.batch.run([
      ...(input.links !== undefined && existing.length > 0
        ? [
            {
              label: 'backlogLink.deleteAll',
              stmt: this.links.deleteByItemsStmt(ctx.userId, [id]),
              expectedChanges: existing.length,
            },
          ]
        : []),
      ...(input.links !== undefined
        ? nextLinks.map((l) => ({ label: 'backlogLink.insert', stmt: this.links.insertStmt(l) }))
        : []),
      {
        label: 'backlogItem.update',
        stmt: this.items.updateGuardedStmt(ctx.userId, id, item.version, {
          title: next.title,
          description: next.description,
          updatedAt: next.updatedAt,
          version: next.version,
        }),
      },
    ]);
    return { item: toBacklogItemView(next, nextLinks), serverNow: ctx.now };
  }

  /**
   * R-backlog-10 / S-backlog-10-1 — move to any other NON-Life goal. `capturedAt` and `fromWeekStart` are
   * untouched: the item did not become newer by being re-filed, and "came out of the week of …" is a
   * fact about its history, not about its current goal.
   */
  async move(ctx: RequestContext, id: string, input: MoveBacklogItemRequest): Promise<BacklogItemResponse> {
    const item = await this.requireOpenItem(ctx, id, input.version);
    assertCanHoldBacklog(await this.requireGoal(ctx, input.goalId));

    const next: BacklogItem = { ...item, goalId: input.goalId, updatedAt: ctx.now, version: item.version + 1 };
    await this.batch.run([
      {
        label: 'backlogItem.move',
        stmt: this.items.updateGuardedStmt(ctx.userId, id, item.version, {
          goalId: next.goalId,
          updatedAt: next.updatedAt,
          version: next.version,
        }),
      },
    ]);
    return { item: toBacklogItemView(next, await this.links.listByItems(ctx.userId, [id])), serverNow: ctx.now };
  }

  /** R-backlog-10 — Delete. The ONLY thing that removes an item outright; a conversion never deletes. */
  async remove(ctx: RequestContext, id: string): Promise<DeleteResponse> {
    const item = await this.items.findById(ctx.userId, id);
    if (!item) throw notFound('backlog item');
    const links = await this.links.listByItems(ctx.userId, [id]);

    await this.batch.run([
      ...(links.length > 0
        ? [{ label: 'backlogLink.deleteAll', stmt: this.links.deleteByItemsStmt(ctx.userId, [id]), expectedChanges: links.length }]
        : []),
      { label: 'backlogItem.delete', stmt: this.items.deleteStmt(ctx.userId, id) },
    ]);
    return { deleted: true, serverNow: ctx.now };
  }

  /**
   * R-backlog-6/7/8/9, Q-4, D-18, D-19 — "Add to this week": the ONE path from backlog to work.
   *
   * **Why a second conversion is structurally impossible, not merely unlikely.** Three layers, in order:
   *
   *  1. A retry of the SAME request (same `Idempotency-Key`) never reaches this method at all — the
   *     idempotency middleware replays the original 201 and therefore the ORIGINAL task id.
   *  2. A genuinely second attempt reads `status = 'converted'` below and is refused `ALREADY_CONVERTED`
   *     with the id of the task the item already became, so the client can navigate to it.
   *  3. Two attempts racing past (2) at the same instant meet `markConvertedGuardedStmt`, which pins
   *     `status = 'open'` AND the version inside the SAME `GuardedBatch` as the task INSERT. The loser
   *     changes zero rows, `_guard` trips, and D1 rolls the whole batch back — the task insert dies with
   *     it. `ux_backlog_converted_task` (unique on `converted_to_task_id`) is the belt to those braces.
   *
   * The mockup had none of the three: `find`-then-`filter` produced a SECOND task from a vanished item,
   * and the removal was never sent to the API at all (D-19).
   */
  async convert(ctx: RequestContext, id: string, input: ConvertBacklogItemRequest): Promise<ConvertBacklogItemResponse> {
    const item = await this.items.findById(ctx.userId, id);
    // S-backlog-9-1 — converting an item that was deleted or moved is refused; no task is created.
    if (!item) throw notFound('backlog item');
    if (item.status === 'converted') {
      throw new DomainError('ALREADY_CONVERTED', 'this backlog item has already become a task', {
        itemId: item.id,
        taskId: item.convertedToTaskId,
        convertedAt: item.convertedAt,
      });
    }
    if (input.version !== undefined && input.version !== item.version) {
      throw new DomainError('CONCURRENT_UPDATE', 'this backlog item changed on another device — reload and retry', {
        expected: input.version,
        actual: item.version,
      });
    }

    // R-backlog-26 — the conversion names a TARGET WEEK, and the receiving goal is the Weekly goal at or
    // under the item's goal whose `periodKey` is that week. `week` may not be in the past (the schema
    // pins `>= 0`, and R-goal-36 is the reason).
    const weekStart = weekStartFromOffset(ctx.currentWeekStart, input.week);
    const resolved = await this.resolveConversionTarget(ctx, item, weekStart, input.goalId, input.newWeeklyGoal);
    const itemLinks = await this.links.listByItems(ctx.userId, [item.id]);

    const built = buildTaskWrites(
      ctx,
      { ids: this.ids, tasks: this.tasks, taskLinks: this.taskLinks, taskEvents: this.taskEvents },
      {
        goalId: resolved.goal.id,
        title: input.title ?? item.title,
        cond: input.cond,
        description: item.description,
        links: itemLinks.map((l) => l.url),
        source: 'backlog',
        // R-task-40 — from the receiving Weekly goal's own week, never from "today".
        originWeekStart: resolved.goal.periodKey,
        detail: { backlogItemId: item.id },
      },
    );

    const converted: BacklogItem = {
      ...item,
      status: 'converted',
      convertedToTaskId: built.task.id,
      convertedAt: ctx.now,
      updatedAt: ctx.now,
      version: item.version + 1,
    };

    // ONE batch: the Weekly goal when the sheet created one (R-task-48), the task, its links, its
    // `created` event, and the item's conversion. Either all of it happened or none of it did — there is
    // no state in which a task exists and the item is still open.
    await this.batch.run([
      ...(resolved.created ? [{ label: 'goal.insertForConversion', stmt: this.goals.insertStmt(resolved.created) }] : []),
      ...built.writes,
      {
        label: 'backlogItem.markConverted',
        stmt: this.items.markConvertedGuardedStmt(ctx.userId, item.id, item.version, {
          convertedToTaskId: built.task.id,
          convertedAt: converted.convertedAt!,
          updatedAt: converted.updatedAt,
          version: converted.version,
        }),
      },
    ]);

    return {
      task: toNewTaskDetailView(built, ctx.currentWeekStart),
      item: toBacklogItemView(converted, itemLinks),
      goal: resolved.created ? toGoalView(resolved.created) : null,
      serverNow: ctx.now,
    };
  }

  /**
   * ⚠ **A2 (R-backlog-26)** — **which WEEKLY GOAL receives the task.**
   *
   * The rule kept its shape and changed its subject: it used to resolve "the ACTIVE LEAF at or under the
   * item's goal", read against a `weekly_focus` row for today. It now resolves the **Weekly goal at or
   * under the item's goal whose `periodKey` is the TARGET WEEK** — one recursive descent bounded by that
   * goal's subtree, rather than `activeLeavesUnder` over the whole goal table (R-lens-27).
   *
   *  - **exactly one** → used silently.
   *  - **two or more** → `AMBIGUOUS_CONVERSION_TARGET` with `details.candidates`, and the owner chooses.
   *    D-18's ruling is untouched: the mockup took whichever came first in array order, and that id
   *    decides which week the task belongs to for the rest of its life. **Array order is not a decision.**
   *  - **none** → `NO_WEEKLY_GOAL` (replacing `BRANCH_NOT_ACTIVE`), unless the caller supplied
   *    `newWeeklyGoal`, in which case one is created in the SAME transaction (R-task-48). That is what
   *    retires the `This branch isn't active this week` dead end entirely: there is no longer a state in
   *    which a backlog item cannot become work, because the thing it needed to hang off is created for it.
   *
   * The refusal is the SERVER's, so a conversion submitted directly is refused too — the client prompt is
   * never the only guard (S-backlog-26-2).
   */
  private async resolveConversionTarget(
    ctx: RequestContext,
    item: BacklogItem,
    weekStart: string,
    requested?: string,
    inline?: { parentId: string; title: string },
  ): Promise<{ goal: Goal; created: Goal | null }> {
    const candidates = await this.goals.weeklyUnderForWeek(ctx.userId, item.goalId, weekStart);

    if (requested !== undefined) {
      const chosen = candidates.find((g) => g.id === requested);
      if (chosen) return { goal: chosen, created: null };
      // R-auth-3 — a goal that is not the caller's is indistinguishable from one that does not exist.
      const goal = await this.goals.findById(ctx.userId, requested);
      if (!goal) throw notFound('goal');
      throw new DomainError('NO_WEEKLY_GOAL', 'that goal is not a weekly goal at or under this item for that week', {
        itemId: item.id,
        goalId: requested,
        weekStart,
        candidates: candidates.map((g) => ({ id: g.id, title: g.title })),
      });
    }

    if (candidates.length === 1) return { goal: candidates[0]!, created: null };
    if (candidates.length > 1) {
      // Not a validation failure: the input was fine, the product has no single answer. Its own code so
      // the client can branch on `error.code` and render a chooser rather than a field error.
      throw new DomainError('AMBIGUOUS_CONVERSION_TARGET', 'more than one weekly goal can receive this item — choose one', {
        itemId: item.id,
        weekStart,
        candidates: candidates.map((g) => ({ id: g.id, title: g.title })),
      });
    }

    if (!inline) {
      throw new DomainError('NO_WEEKLY_GOAL', `"${item.title}" becomes a task under a weekly goal, and there is none for that week`, {
        itemId: item.id,
        goalId: item.goalId,
        weekStart,
      });
    }
    // Minted ONCE: `goal` and `created` are the same row. It is returned twice so the caller can both
    // hang the task off it and tell the owner it was created — nothing may be created invisibly
    // (R-task-49) — without minting a second id.
    const created = await this.mintWeeklyGoal(ctx, inline, weekStart);
    return { goal: created, created };
  }

  /**
   * R-task-48 — the inline `New weekly goal` the refusal sheet offers instead of sending the owner away.
   *
   * The parent must be able to hold a Weekly child (R-goal-31/32) and the week must not be past
   * (R-goal-36): this path may not be a way around a rule the ordinary create enforces.
   */
  private async mintWeeklyGoal(
    ctx: RequestContext,
    input: { parentId: string; title: string },
    weekStart: string,
  ): Promise<Goal> {
    const parent = await this.goals.findById(ctx.userId, input.parentId);
    if (!parent) throw notFound('goal');
    if (parent.horizon === 'Weekly') {
      throw new DomainError('HORIZON_CONFLICT', 'a weekly goal cannot sit under a weekly goal', {
        parentHorizon: parent.horizon,
        childHorizon: 'Weekly',
      });
    }
    if (isPastPeriod('Weekly', weekStart, dateInTimezone(ctx.now, ctx.tz))) {
      throw new DomainError('PERIOD_IN_PAST', 'a weekly goal cannot be created into a week that has passed', { weekStart });
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

  private async requireGoal(ctx: RequestContext, id: string): Promise<Goal> {
    const goal = await this.goals.findById(ctx.userId, id);
    if (!goal) throw notFound('goal');
    return goal;
  }

  /**
   * A converted item is not editable or movable: it is no longer in the backlog, it is a task. Refusing
   * with `ALREADY_CONVERTED` rather than 404 tells the client where the work went.
   */
  private async requireOpenItem(ctx: RequestContext, id: string, version?: number): Promise<BacklogItem> {
    const item = await this.items.findById(ctx.userId, id);
    if (!item) throw notFound('backlog item');
    if (item.status === 'converted') {
      throw new DomainError('ALREADY_CONVERTED', 'this backlog item has already become a task', {
        itemId: item.id,
        taskId: item.convertedToTaskId,
      });
    }
    if (version !== undefined && version !== item.version) {
      throw new DomainError('CONCURRENT_UPDATE', 'this backlog item changed on another device — reload and retry', {
        expected: version,
        actual: item.version,
      });
    }
    return item;
  }

  private async viewsOf(ctx: RequestContext, rows: readonly BacklogItem[]): Promise<BacklogItemView[]> {
    if (rows.length === 0) return [];
    const links = await this.links.listByItems(
      ctx.userId,
      rows.map((r) => r.id),
    );
    return newestFirst(rows).map((r) => toBacklogItemView(r, links));
  }
}
