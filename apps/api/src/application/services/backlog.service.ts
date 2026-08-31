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
  TaskDetailView,
  TaskEventView,
} from '@goal-cascade/shared';
import { inject, injectable } from 'tsyringe';
import type { RequestContext } from '../context';
import type { BacklogItem, BacklogLink, Goal, Task, TaskEvent, TaskLink } from '../../domain/entities';
import { TASK_EVENT_GLYPHS, type TaskSource } from '../../domain/enums';
import { DomainError, notFound } from '../../domain/errors';
import { activeLeavesUnder, descendantIds, isLifeHorizon } from '../../domain/goal-tree';
import type { GuardedWrite } from '../ports';
import {
  IBacklogLinkRepo,
  IBacklogRepo,
  IGoalRepo,
  IIdGenerator,
  ITaskEventRepo,
  ITaskLinkRepo,
  ITaskRepo,
  IWeeklyFocusRepo,
} from '../ports';
import { GuardedBatch } from './guarded-batch';

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers. `capture.service.ts` imports these: an Idea's "Attach to a goal" produces a backlog
// item and its "Task this week" produces a task, and both must produce EXACTLY the rows this file
// produces or the two paths would drift into two slightly different backlog items.
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

/** R-task-30 — the `Created — …` line each of the four sources logs. */
export const CREATED_EVENT_TEXT: Record<TaskSource, string> = {
  planning: 'Created — weekly planning',
  backlog: 'Created — pulled from Backlog',
  idea: 'Created — from an Idea',
  drawer: 'Created — added to this week',
};

/** Everything a conversion needs to know to mint a task. Deliberately free of any backlog/idea concept. */
export type NewTaskDraft = {
  goalId: string;
  title: string;
  cond: string;
  description: string;
  links: readonly string[];
  source: TaskSource;
  /** Structured provenance for the `created` event (`{ backlogItemId }` / `{ ideaId }`). */
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
 * R-task-5/6 — `originWeekStart` is the CURRENT week, never the week being viewed and never back-dated.
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
    originWeekStart: ctx.currentWeekStart,
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

/** The freshly created task, with the one event it has. `carryWeeks` is 0: it was born in this week. */
export function toNewTaskDetailView(w: TaskWrites): TaskDetailView {
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
    createdAt: w.task.createdAt,
    updatedAt: w.task.updatedAt,
    version: w.task.version,
    events: [toTaskEventView(w.event)],
  };
}

/**
 * R-backlog-2 — a backlog item attaches to a Yearly/Quarterly/Monthly goal. Never a Life goal (whose
 * detail screen shows a READ-ONLY roll-up of its descendants' items instead, R-backlog-12) and never a
 * week. Enforced on create, on move, and on an Idea's attach — every goal picker in every backlog flow.
 */
export function assertCanHoldBacklog(goal: Goal): void {
  if (isLifeHorizon(goal.horizon)) {
    throw new DomainError('LIFE_GOAL_NO_BACKLOG', 'a Life goal holds no backlog items; choose a sub-goal', {
      goalId: goal.id,
    });
  }
}

/** Builds the item row + its link rows for a new backlog item. Shared with the Idea attach flow. */
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
    @inject(IWeeklyFocusRepo) private readonly focuses: IWeeklyFocusRepo,
    @inject(ITaskRepo) private readonly tasks: ITaskRepo,
    @inject(ITaskLinkRepo) private readonly taskLinks: ITaskLinkRepo,
    @inject(ITaskEventRepo) private readonly taskEvents: ITaskEventRepo,
    @inject(IIdGenerator) private readonly ids: IIdGenerator,
    @inject(GuardedBatch) private readonly batch: GuardedBatch,
  ) {}

  /**
   * R-backlog-13 / Q-7 — every OPEN item, newest first. Grouping by `<Life goal> › <owning goal>` is the
   * client's job; the server owes it a total order and nothing more.
   *
   * `?goalId=` narrows to one goal — and on a LIFE goal that means the read-only aggregate (R-backlog-12),
   * because a Life goal never holds items itself. See `listForGoal`.
   */
  async list(ctx: RequestContext, queryInput: { goalId?: string }): Promise<BacklogResponse> {
    if (queryInput.goalId !== undefined) {
      const { items } = await this.listForGoal(ctx, queryInput.goalId);
      return { items, serverNow: ctx.now };
    }
    return { items: await this.viewsOf(ctx, await this.items.listOpen(ctx.userId)), serverNow: ctx.now };
  }

  /**
   * R-backlog-11/12 — the backlog block on ONE goal's detail screen, and the shared seam the goals agent
   * calls for `GoalDetailResponse.backlog` / `.backlogIsAggregate`.
   *
   *   non-Life goal → that goal's OWN items; the client offers the three per-item actions (D-20).
   *   Life goal     → `isAggregate: true`: a READ-ONLY roll-up of every open item on any DESCENDANT,
   *                   each row carrying its own `goalId` so the client can label it with its owning goal.
   *                   A Life goal never holds items itself (R-backlog-2), so there is nothing to act on
   *                   here and no per-item action is offered — only `Open Backlog →`.
   */
  async listForGoal(ctx: RequestContext, goalId: string): Promise<{ items: BacklogItemView[]; isAggregate: boolean }> {
    const all = await this.goals.listAll(ctx.userId);
    const goal = all.find((g) => g.id === goalId);
    if (!goal) throw notFound('goal');

    const isAggregate = isLifeHorizon(goal.horizon);
    // The Life roll-up asks for the descendants only — including the root would be meaningless (it can
    // hold nothing) and would hide a data problem rather than surfacing it.
    const scope = isAggregate ? [...descendantIds(all, goalId)] : [goalId];
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

    const target = await this.resolveConversionTarget(ctx, item, input.goalId);
    const itemLinks = await this.links.listByItems(ctx.userId, [item.id]);

    const built = buildTaskWrites(
      ctx,
      { ids: this.ids, tasks: this.tasks, taskLinks: this.taskLinks, taskEvents: this.taskEvents },
      {
        goalId: target.id,
        title: input.title ?? item.title,
        cond: input.cond,
        description: item.description,
        links: itemLinks.map((l) => l.url),
        source: 'backlog',
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

    // ONE batch: the task, its links, its `created` event, and the item's conversion. Either all of it
    // happened or none of it did — there is no state in which a task exists and the item is still open.
    await this.batch.run([
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
      task: toNewTaskDetailView(built),
      item: toBacklogItemView(converted, itemLinks),
      serverNow: ctx.now,
    };
  }

  /**
   * R-backlog-7 / R-backlog-8 / D-18 — which ACTIVE leaf receives the task.
   *
   * Exactly one candidate → use it. Two or more → `AMBIGUOUS_CONVERSION_TARGET` and the user chooses: the mockup took
   * whichever came first in array order, and that id decides which focus the task belongs to for the
   * rest of its life. None → `BRANCH_NOT_ACTIVE`, which is what the client turns into the
   * "This branch isn't active this week" sheet — and, critically, the SERVER's answer, so a conversion
   * submitted directly is refused too (S-backlog-8-3).
   */
  private async resolveConversionTarget(ctx: RequestContext, item: BacklogItem, requested?: string): Promise<Goal> {
    const all = await this.goals.listAll(ctx.userId);
    const focused = new Set((await this.focuses.listByWeek(ctx.userId, ctx.currentWeekStart)).map((f) => f.goalId));
    const candidates = activeLeavesUnder(all, item.goalId, focused);

    if (candidates.length === 0) {
      throw new DomainError('BRANCH_NOT_ACTIVE', `"${item.title}" can only become a task under an active weekly focus`, {
        itemId: item.id,
        goalId: item.goalId,
        weekStart: ctx.currentWeekStart,
      });
    }
    if (requested === undefined) {
      if (candidates.length === 1) return candidates[0]!;
      // R-backlog-7 / D-18 — not a validation failure: the input was fine, the product has no single
      // answer. Its own code so the client can branch on `error.code` and render a chooser rather than a
      // field error; `details.candidates` is what the chooser lists.
      throw new DomainError('AMBIGUOUS_CONVERSION_TARGET', 'more than one active focus can receive this item — choose one', {
        itemId: item.id,
        candidates: candidates.map((g) => ({ id: g.id, title: g.title })),
      });
    }

    const chosen = candidates.find((g) => g.id === requested);
    if (chosen) return chosen;
    // R-auth-3 — a goal that is not the caller's is indistinguishable from one that does not exist.
    const goal = all.find((g) => g.id === requested);
    if (!goal) throw notFound('goal');
    throw new DomainError('BRANCH_NOT_ACTIVE', 'that goal is not an active weekly focus at or under this item', {
      itemId: item.id,
      goalId: requested,
      candidates: candidates.map((g) => ({ id: g.id, title: g.title })),
    });
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
