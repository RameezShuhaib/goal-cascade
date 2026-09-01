import type {
  ApiToken,
  AuthUser,
  BacklogItem,
  BacklogLink,
  Goal,
  IdempotencyRecord,
  Learning,
  OutboxEmail,
  Preferences,
  Task,
  TaskEvent,
  TaskLink,
} from '../../domain/entities';
import type { WriteStmt } from './statement';

/**
 * Repository ports. Conventions, all non-negotiable:
 *
 *  - **Every owner-scoped read takes `userId` explicitly** (R-auth-2) and can never return another
 *    owner's rows. A reference to someone else's entity is refused identically to a non-existent one
 *    (R-auth-3), which falls out of scoping the WHERE clause rather than checking afterwards.
 *  - **`*Stmt` methods return UNEXECUTED writes** for `GuardedBatch`; non-`Stmt` writes execute at once.
 *  - **Guarded updates take the precondition read in the command's read phase** (`version`), so a lost
 *    race is a clean `409 CONCURRENT_UPDATE` instead of a half-applied write (Q-2).
 *  - **Repos never call `Date.now()`.** Timestamps arrive as ISO UTC strings from `IClock`, and weeks as
 *    absolute Monday dates (D-1). A repo that reads a clock makes the whole suite time-dependent.
 */

export interface IUserRepo {
  findById(id: string): Promise<AuthUser | null>;
  // ⚠ `findByEmail` is deleted: no caller. Better Auth owns every lookup by address (sign-in, the
  // allowlist, verification), through its own adapter and not through this port.
}
export const IUserRepo = Symbol.for('goal-cascade.IUserRepo');

export interface IPreferencesRepo {
  get(userId: string): Promise<Preferences | null>;
  insertStmt(prefs: Preferences): WriteStmt;
  updateStmt(userId: string, patch: Partial<Omit<Preferences, 'userId'>>): WriteStmt;
}
export const IPreferencesRepo = Symbol.for('goal-cascade.IPreferencesRepo');

/** One lens's coordinates: a horizon and a period. `periodKey` is `''` for the Life lens. */
export type LensKey = { horizon: Goal['horizon']; periodKey: string };
/** One page of a lens read, plus the cursor for the next one (Q-12's page cap, R-lens-16). */
export type GoalPage = { items: Goal[]; nextCursor: string | null };
/** R-lens-22 — one row of the Zoom sheet's single grouped count query. */
export type LensCount = LensKey & { count: number };
/** R-goal-47 — one Weekly goal in a Monthly page's range read, reduced to the two fields the line needs. */
export type WeeklyUnderParent = { parentId: string; periodKey: string };

/**
 * ⚠ **A2 (R-lens-27) — `listAll` is DELETED, not left unused.**
 *
 * It was `SELECT * FROM goals WHERE user_id = ?` with no limit, no cursor and no filter, and it was the
 * single door every goal row came through: `GET /goals`, `GET /goals/:id`, every goal mutation's
 * response, both guards, `POST /tasks`, two backlog reads and every MCP tool. `POST /goals` and
 * `POST /goals/:id/move` each ran it THREE times per request; `GET /bootstrap` twice.
 *
 * **No request may call a repository method that returns every goal.** It is removed rather than
 * deprecated because an unused whole-table read is one refactor away from being a used one — the same
 * R-rm-* discipline that deletes rather than hides. What replaced it:
 *
 * | Need | Method | Cost |
 * |---|---|---|
 * | a lens page | `listByLens` | one indexed seek on `ix_goals_lens` |
 * | grouping, the Life-root walk, parent lines | `listInterior` | one read of `horizon <> 'Weekly'` |
 * | the Life lens | `listByLens` again | the same path, with `periodKey = ''` |
 * | the carried band's goals | `listByIds` | chunked, bounded by open work |
 * | the move/delete guards | `subtreeIds` | one recursive CTE; **zero rows for a Weekly goal** |
 * | the create guard | `findById` | **one row** — it compares two ranks |
 * | the Zoom sheet | `countByLens` | ONE grouped query, never five lens reads |
 */
export interface IGoalRepo {
  findById(userId: string, id: string): Promise<Goal | null>;
  /** R-lens-16 — one horizon, one period, paginated. The read that replaced the whole-tree one. */
  listByLens(userId: string, key: LensKey, page: { limit: number; cursor?: string }): Promise<GoalPage>;
  /** R-lens-27 — every goal whose horizon is not `Weekly`. Grows with the plan, not with use. */
  listInterior(userId: string): Promise<Goal[]>;
  // ⚠ `listLifeGoals` is deleted — superseded, not merely unused. The Life lens is served by the same
  // `listByLens` path as the other four (`GoalService.lens`), which is the point of there being one lens
  // read; a dedicated method for one horizon is the second implementation that drifts from the first.
  /** R-lens-12 — the goals behind a week's open tasks, for the carried band. Chunked. */
  listByIds(userId: string, ids: readonly string[]): Promise<Goal[]>;
  /**
   * R-goal-41 / R-goal-37 — one goal's direct children, in sibling order. `children` is the ONLY source
   * of "has children" on the wire now that `isLeaf` is retired, so it is a read rather than a derivation.
   * One seek on `ix_goals_owner_parent`.
   */
  listChildren(userId: string, parentId: string): Promise<Goal[]>;
  /** R-goal-18 / Q-5 — one subtree, inclusive of the root, as a recursive CTE. */
  subtreeIds(userId: string, rootId: string): Promise<string[]>;
  /** R-backlog-26 — the Weekly goals at or under one goal for one week: the conversion targets. */
  weeklyUnderForWeek(userId: string, rootId: string, weekStart: string): Promise<Goal[]>;
  /** R-goal-47 — one `period_key BETWEEN` range scan per Monthly page. */
  weeklyUnderParents(
    userId: string,
    parentIds: readonly string[],
    fromKey: string,
    toKey: string,
  ): Promise<WeeklyUnderParent[]>;
  /** R-lens-22 — the Zoom sheet's counts, as ONE grouped query. It must never fetch rows to count them. */
  countByLens(userId: string, keys: readonly LensKey[]): Promise<LensCount[]>;
  /** R-lens-26 — does any later period at this horizon hold a goal? A `>` probe, `LIMIT 1`, no count. */
  hasLaterPeriod(userId: string, horizon: Goal['horizon'], afterKey: string): Promise<boolean>;
  /**
   * ⚠ **A2, new (R-lens-24)** — has this horizon EVER held a goal, in ANY period?
   *
   * A `(user_id, horizon)` exact-prefix seek on `ix_goals_lens` with `LIMIT 1`. It never counts and never
   * fetches a second row, and it is called for exactly one horizon — **Weekly** — and only when that
   * lens's page came back empty. Every other horizon is answered from the interior tree the request
   * already holds, so this is never a second table scan (R-lens-27).
   */
  hasAnyAtHorizon(userId: string, horizon: Goal['horizon']): Promise<boolean>;
  /** Q-12 — the interior-goal cap, checked on create. */
  countInterior(userId: string): Promise<number>;
  /** Q-12 — the per-week Weekly-goal cap, checked on create. */
  countWeeklyInWeek(userId: string, weekStart: string): Promise<number>;
  /** R-goal-46 — one week's Weekly goals, for `Repeat last week`. */
  listWeeklyInWeek(userId: string, weekStart: string): Promise<Goal[]>;
  insertStmt(goal: Goal): WriteStmt;
  /** Guarded on `version = expectedVersion`; the patch MUST bump `version` and set `updatedAt`. */
  updateGuardedStmt(
    userId: string,
    id: string,
    expectedVersion: number,
    patch: Partial<Omit<Goal, 'id' | 'userId'>> & { updatedAt: string; version: number },
  ): WriteStmt;
  /**
   * Q-5 — subtree delete. `ids` is the full set from `subtreeIds`, and deleting a Life goal legitimately
   * takes the whole line, so this is the one id list that stays large — the CALLER chunks it
   * (`chunkIds`, `ports/statement.ts`) and every chunk is a statement in the same `GuardedBatch`.
   */
  deleteManyStmt(userId: string, ids: readonly string[]): WriteStmt;
}
export const IGoalRepo = Symbol.for('goal-cascade.IGoalRepo');

/*
 * ⚠ **A2 (R-rm-2)** — `IWeeklyFocusRepo` and its DI symbol are DELETED, with all nine methods
 * (`listByWeek`, `listByGoals`, `findByGoalAndWeek`, `insertStmt`, `updateStmt`,
 * `deleteByGoalsAndWeekStmt`, `deleteByWeekStmt`, `deleteByGoalsFromWeekStmt`, `deleteByGoalsStmt`) and
 * `D1WeeklyFocusRepo`. A weekly intent is now an ordinary goal with `horizon = 'Weekly'`.
 */

export interface ITaskRepo {
  findById(userId: string, id: string): Promise<Task | null>;
  /**
   * R-task-7/8/32 — every task that could be visible in `weekStart`: OPEN tasks with
   * `origin_week_start <= weekStart`, plus DONE tasks with `done_week_start = weekStart`. Exited tasks
   * are excluded here, not filtered by the caller, so no read model can leak one.
   */
  listVisibleInWeek(userId: string, weekStart: string, limit?: number): Promise<Task[]>;
  /** R-goal-24 — open tasks under a set of goals, for the Life-goal carry signal. **Chunked.** */
  listOpenByGoals(userId: string, goalIds: readonly string[]): Promise<Task[]>;
  /**
   * ⚠ **A2, new (R-lens-4)** — **the group-header counts, as ONE grouped query**:
   * `SELECT goal_id, COUNT(*) FROM tasks WHERE user_id=? AND status='open' AND origin_week_start<=?
   *  GROUP BY goal_id`, served by `ix_tasks_open_week`. One row per goal holding open work.
   *
   * It is bounded by the account's OPEN WORK, which the owner controls, rather than by its history — and
   * it is only affordable because R-lens-4 anchors the count to ONE week. The UX plan's period-spanning
   * definition would have needed a per-period scan AND been untruthful in both directions: a past month's
   * header would count work open today, and every future month would show the identical number, which is
   * a count firing on work whose period has not arrived (R-lens-11 forbids it outright). A rare case where
   * the cheap answer and the honest one are the same.
   */
  countOpenVisibleByGoal(userId: string, weekStart: string): Promise<{ goalId: string; open: number }[]>;
  /**
   * R-goal-24 — the Life-goal carry signal, as ONE grouped query over open work that originated BEFORE
   * `beforeWeekStart`: `COUNT(*)` and `MIN(origin_week_start)` per goal. A future origin can never
   * satisfy `<`, so the rule needs no future guard and R-task-38 holds automatically.
   */
  carryingByGoal(userId: string, beforeWeekStart: string): Promise<{ goalId: string; open: number; oldestOrigin: string }[]>;
  /** R-lens-26 — does any task originate in a week after this one? The Weekly lens's forward dot. */
  hasOriginAfter(userId: string, weekStart: string): Promise<boolean>;
  /**
   * Q-5 — EVERY task under a set of goals, whatever its status. The subtree delete needs the ids (to
   * remove their links and events, which are keyed by task) and the exact count for `expectedChanges`;
   * an exited task still has both, so `listOpenByGoals` would leave them orphaned.
   */
  listByGoals(userId: string, goalIds: readonly string[]): Promise<Task[]>;
  insertStmt(task: Task): WriteStmt;
  /** Guarded on `version = expectedVersion`; the patch MUST bump `version` and set `updatedAt`. */
  updateGuardedStmt(
    userId: string,
    id: string,
    expectedVersion: number,
    patch: Partial<Omit<Task, 'id' | 'userId'>> & { updatedAt: string; version: number },
  ): WriteStmt;
  /**
   * Q-5 — cascade only. A task is NEVER deleted by an exit; it keeps its row and its log (D-15).
   *
   * The CALLER chunks the id list (`chunkIds`, `ports/statement.ts`) because each chunk is a separate
   * statement needing its own `expectedChanges`, and only the caller knows the rows it read.
   */
  deleteByGoalsStmt(userId: string, goalIds: readonly string[]): WriteStmt;
}
export const ITaskRepo = Symbol.for('goal-cascade.ITaskRepo');

export interface ITaskLinkRepo {
  listByTasks(userId: string, taskIds: readonly string[]): Promise<TaskLink[]>;
  insertStmt(link: TaskLink): WriteStmt;
  deleteStmt(userId: string, taskId: string, linkId: string): WriteStmt;
  deleteByTasksStmt(userId: string, taskIds: readonly string[]): WriteStmt;
}
export const ITaskLinkRepo = Symbol.for('goal-cascade.ITaskLinkRepo');

export interface ITaskEventRepo {
  /** R-task-30 — newest first: `at` desc, then insertion sequence (`id`) desc. */
  listByTask(userId: string, taskId: string, limit?: number): Promise<TaskEvent[]>;
  /** Q-5 — the whole log for a set of tasks, so the subtree delete knows its exact `expectedChanges`. */
  listByTasks(userId: string, taskIds: readonly string[]): Promise<TaskEvent[]>;
  /** Append-only (R-task-31): there is deliberately no update and no single-row delete. */
  insertStmt(event: TaskEvent): WriteStmt;
  /**
   * R-task-29 / Q-17 — the lazy carry-log producer. `carried` rows carry the week they were produced
   * for, and the table has a UNIQUE index on `(user_id, task_id, week_start)` where `kind = 'carried'`,
   * so this insert is a no-op on a re-read and a week can never be logged twice. Use
   * `expectedChanges: 'any'` in the guarded batch — a duplicate is the normal case, not a failure, and a
   * numeric `0` would instead ASSERT that the first (real) insert never happens.
   */
  insertCarriedIgnoreStmt(event: TaskEvent & { weekStart: string }): WriteStmt;
  deleteByTasksStmt(userId: string, taskIds: readonly string[]): WriteStmt;
}
export const ITaskEventRepo = Symbol.for('goal-cascade.ITaskEventRepo');

export interface IBacklogRepo {
  findById(userId: string, id: string): Promise<BacklogItem | null>;
  /** R-backlog-6 — `status = 'open'` only. A converted item never appears in a backlog list again. */
  listOpen(userId: string, limit?: number): Promise<BacklogItem[]>;
  listOpenByGoals(userId: string, goalIds: readonly string[]): Promise<BacklogItem[]>;
  /**
   * ⚠ **A1, new (R-backlog-17/19)** — ONE goal's open items in their **manual** order: `sort_key` asc,
   * then `capturedAt` desc, then `id` desc, straight off `ix_backlog_goal_sort`.
   *
   * It is separate from `listOpenByGoals` because the two orders are different rules, not a parameter:
   * within a goal the order is the owner's, and across goals there is no manual order at all
   * (R-backlog-21). A single method taking a flag would let a cross-goal caller ask for a per-goal order
   * that does not exist.
   */
  listOpenByGoalOrdered(userId: string, goalId: string): Promise<BacklogItem[]>;
  /** R-backlog-18/20 — the top key of a goal's list, or `null` when it holds nothing. `LIMIT 1`. */
  topSortKey(userId: string, goalId: string): Promise<string | null>;
  /**
   * Q-5 — every item under a set of goals, converted ones included: a converted item still owns link
   * rows, and the subtree delete needs both the ids and the exact count for `expectedChanges`.
   */
  listByGoals(userId: string, goalIds: readonly string[]): Promise<BacklogItem[]>;
  insertStmt(item: BacklogItem): WriteStmt;
  /**
   * ⚠ **A1, new (R-backlog-19)** — the RE-KEY write: `sort_key` and nothing else.
   *
   * It deliberately does not bump `version` or `updatedAt`. A re-key is invisible to the client and
   * changes no order, and the client never holds, parses or sends a key — so bumping the version would
   * make every other device's pending edit lose a race to a write that changed nothing anybody can see.
   */
  setSortKeyStmt(userId: string, id: string, sortKey: string): WriteStmt;
  updateGuardedStmt(
    userId: string,
    id: string,
    expectedVersion: number,
    patch: Partial<Omit<BacklogItem, 'id' | 'userId'>> & { updatedAt: string; version: number },
  ): WriteStmt;
  /**
   * D-19 — the conversion half of "converted, never duplicated". Guarded on `status = 'open'` AND the
   * expected version, so a second conversion changes zero rows and the whole batch (including the task
   * insert) rolls back. That is the constraint S-backlog-6-2 needs; a `find`-then-`filter` is not.
   */
  markConvertedGuardedStmt(
    userId: string,
    id: string,
    expectedVersion: number,
    patch: { convertedToTaskId: string; convertedAt: string; updatedAt: string; version: number },
  ): WriteStmt;
  deleteStmt(userId: string, id: string): WriteStmt;
  deleteByGoalsStmt(userId: string, goalIds: readonly string[]): WriteStmt;
}
export const IBacklogRepo = Symbol.for('goal-cascade.IBacklogRepo');

export interface IBacklogLinkRepo {
  listByItems(userId: string, itemIds: readonly string[]): Promise<BacklogLink[]>;
  insertStmt(link: BacklogLink): WriteStmt;
  deleteByItemsStmt(userId: string, itemIds: readonly string[]): WriteStmt;
}
export const IBacklogLinkRepo = Symbol.for('goal-cascade.IBacklogLinkRepo');

export interface ILearningRepo {
  findById(userId: string, id: string): Promise<Learning | null>;
  /** ⚠ **A2 (Q-12)** — `limit` wires `MAX_PAGE`. Unbounded before, which made Q-12's cap untrue here. */
  listAll(userId: string, limit?: number): Promise<Learning[]>;
  /** R-learning-5 — the learnings on a Life root's whole line. */
  listByGoals(userId: string, goalIds: readonly string[]): Promise<Learning[]>;
  insertStmt(learning: Learning): WriteStmt;
  updateGuardedStmt(
    userId: string,
    id: string,
    expectedVersion: number,
    patch: Partial<Omit<Learning, 'id' | 'userId'>> & { updatedAt: string; version: number },
  ): WriteStmt;
  deleteStmt(userId: string, id: string): WriteStmt;
  untagByGoalsStmt(userId: string, goalIds: readonly string[]): WriteStmt;
}
export const ILearningRepo = Symbol.for('goal-cascade.ILearningRepo');

export interface IIdempotencyRepo {
  begin(
    rec: Omit<IdempotencyRecord, 'statusCode' | 'responseBody'>,
  ): Promise<{ inserted: true } | { inserted: false; existing: IdempotencyRecord }>;
  complete(scope: string, key: string, statusCode: number, responseBody: string): Promise<void>;
  remove(scope: string, key: string): Promise<void>;
  purgeBefore(createdBefore: string): Promise<number>;
}
export const IIdempotencyRepo = Symbol.for('goal-cascade.IIdempotencyRepo');

export interface IEmailOutboxRepo {
  insert(email: OutboxEmail): Promise<void>;
  listByTo(to: string, limit?: number): Promise<OutboxEmail[]>;
  deleteByTo(to: string): Promise<number>;
  purgeBefore(createdBefore: string): Promise<number>;
}
export const IEmailOutboxRepo = Symbol.for('goal-cascade.IEmailOutboxRepo');

/**
 * The agent-access token. The ONE repo in this file whose primary read is NOT owner-scoped, and that is
 * the point: `findByHash` is how an anonymous `POST /mcp` RESOLVES an owner. Every other read below is
 * scoped by a `userId` the caller already proved; this one produces that `userId`.
 *
 * Consequences, both deliberate:
 *  - `findByHash` takes a HASH, never a plaintext. Hashing happens in the service, above this port, so a
 *    repo can never be handed a live key and can never log one.
 *  - `upsert` is create-or-replace against the `user_id` primary key, in one statement. There is no
 *    `insert` and no `update`: two tokens must not be a representable state, so no method can make one.
 */
export interface IApiTokenRepo {
  findByUser(userId: string): Promise<ApiToken | null>;
  /** The `/mcp` bearer lookup. One indexed seek on `ux_api_tokens_hash`; returns null for anything else. */
  findByHash(tokenHash: string): Promise<ApiToken | null>;
  /** Create or REPLACE. The previous token stops authenticating in the same write. */
  upsert(token: ApiToken): Promise<void>;
  /** Idempotent: returns the number of rows removed, which is 0 when nothing was active. */
  deleteByUser(userId: string): Promise<number>;
}
export const IApiTokenRepo = Symbol.for('goal-cascade.IApiTokenRepo');

/** Better Auth's `rateLimit.customStorage` contract: ONE atomic consume, never a get/set pair. */
export interface IAuthRateLimitRepo {
  consume(key: string, rule: { window: number; max: number }): Promise<{ allowed: boolean; retryAfter: number | null }>;
  purgeBefore(lastRequestBeforeMs: number): Promise<number>;
}
export const IAuthRateLimitRepo = Symbol.for('goal-cascade.IAuthRateLimitRepo');
