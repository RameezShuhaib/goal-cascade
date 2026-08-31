import type {
  AuthUser,
  BacklogItem,
  BacklogLink,
  Goal,
  Idea,
  IdempotencyRecord,
  Learning,
  OutboxEmail,
  Preferences,
  Task,
  TaskEvent,
  TaskLink,
  WeeklyFocus,
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
  findByEmail(email: string): Promise<AuthUser | null>;
}
export const IUserRepo = Symbol.for('goal-cascade.IUserRepo');

export interface IPreferencesRepo {
  get(userId: string): Promise<Preferences | null>;
  insertStmt(prefs: Preferences): WriteStmt;
  updateStmt(userId: string, patch: Partial<Omit<Preferences, 'userId'>>): WriteStmt;
}
export const IPreferencesRepo = Symbol.for('goal-cascade.IPreferencesRepo');

export interface IGoalRepo {
  /**
   * The owner's ENTIRE tree. Every tree rule is derived in memory from this one list
   * (`domain/goal-tree.ts`) — at most 500 nodes, 4 levels deep (Q-12, R-goal-7) — so there is no
   * recursive SQL anywhere and no second, drifting implementation of "descendant".
   */
  listAll(userId: string): Promise<Goal[]>;
  findById(userId: string, id: string): Promise<Goal | null>;
  insertStmt(goal: Goal): WriteStmt;
  /** Guarded on `version = expectedVersion`; the patch MUST bump `version` and set `updatedAt`. */
  updateGuardedStmt(
    userId: string,
    id: string,
    expectedVersion: number,
    patch: Partial<Omit<Goal, 'id' | 'userId'>> & { updatedAt: string; version: number },
  ): WriteStmt;
  /** Q-5 — subtree delete. `ids` is the full set from `descendantIds`, computed in the read phase. */
  deleteManyStmt(userId: string, ids: readonly string[]): WriteStmt;
}
export const IGoalRepo = Symbol.for('goal-cascade.IGoalRepo');

export interface IWeeklyFocusRepo {
  /** D-2 — the focus rows for ONE week. Their goal ids ARE the set of active leaves for that week. */
  listByWeek(userId: string, weekStart: string): Promise<WeeklyFocus[]>;
  /**
   * R-goal-28 / Q-5 — every week's rows for a set of goals. The delete phase needs the exact row count
   * it is about to remove, because `GuardedBatch` asserts `expectedChanges` exactly — `0` included, which
   * is what catches a row created between the read and the batch.
   */
  listByGoals(userId: string, goalIds: readonly string[]): Promise<WeeklyFocus[]>;
  findByGoalAndWeek(userId: string, goalId: string, weekStart: string): Promise<WeeklyFocus | null>;
  insertStmt(focus: WeeklyFocus): WriteStmt;
  updateStmt(userId: string, goalId: string, weekStart: string, patch: { sentence: string; updatedAt: string }): WriteStmt;
  /**
   * R-plan-7 — the whole-week replace. Deleting rows is how a leaf goes dormant: a blank sentence must
   * never be stored (§1 WeeklyFocus), so "active" stays exactly "a row exists".
   */
  deleteByGoalsAndWeekStmt(userId: string, goalIds: readonly string[], weekStart: string): WriteStmt;
  /**
   * R-plan-7 / Q-3 — the whole-week replace deletes by WEEK, not by the goal ids it happened to read.
   * Paired with `expectedChanges = <rows read for that week>` it asserts that the week still holds
   * exactly the plan this save was built on, so a concurrent save on another device loses cleanly with a
   * 409 instead of the two plans merging. Deleting only the goals this save read cannot do that: a row
   * the other device added for a goal not in that list would survive the replace.
   */
  deleteByWeekStmt(userId: string, weekStart: string): WriteStmt;
  /**
   * R-goal-28 / D-8 — a leaf that gains a child loses its focus for the CURRENT week and any later one,
   * and KEEPS its past weeks. A past row cannot resurrect anything (`isActive` requires leaf-ness at read
   * time, `domain/goal-tree.ts#isActive`), and destroying it would make this week's operation rewrite
   * last week's record — the exact bug D-2 exists to prevent.
   */
  deleteByGoalsFromWeekStmt(userId: string, goalIds: readonly string[], fromWeekStart: string): WriteStmt;
  /** Q-5 — the subtree cascade: every week, because the goal itself is going away. */
  deleteByGoalsStmt(userId: string, goalIds: readonly string[]): WriteStmt;
}
export const IWeeklyFocusRepo = Symbol.for('goal-cascade.IWeeklyFocusRepo');

export interface ITaskRepo {
  findById(userId: string, id: string): Promise<Task | null>;
  /**
   * R-task-7/8/32 — every task that could be visible in `weekStart`: OPEN tasks with
   * `origin_week_start <= weekStart`, plus DONE tasks with `done_week_start = weekStart`. Exited tasks
   * are excluded here, not filtered by the caller, so no read model can leak one.
   */
  listVisibleInWeek(userId: string, weekStart: string): Promise<Task[]>;
  /** R-goal-24 / R-goal-28 — open tasks under a set of goals, for the carry signal and the D-8 guard. */
  listOpenByGoals(userId: string, goalIds: readonly string[]): Promise<Task[]>;
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
  /** Q-5 — cascade only. A task is NEVER deleted by an exit; it keeps its row and its log (D-15). */
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
  listOpen(userId: string): Promise<BacklogItem[]>;
  listOpenByGoals(userId: string, goalIds: readonly string[]): Promise<BacklogItem[]>;
  /**
   * Q-5 — every item under a set of goals, converted ones included: a converted item still owns link
   * rows, and the subtree delete needs both the ids and the exact count for `expectedChanges`.
   */
  listByGoals(userId: string, goalIds: readonly string[]): Promise<BacklogItem[]>;
  insertStmt(item: BacklogItem): WriteStmt;
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

export interface IIdeaRepo {
  findById(userId: string, id: string): Promise<Idea | null>;
  /** Q-7 — `capturedAt` desc, `id` desc. */
  listAll(userId: string): Promise<Idea[]>;
  insertStmt(idea: Idea): WriteStmt;
  deleteStmt(userId: string, id: string): WriteStmt;
  /** Q-5 / S-idea-7-1 — a tag pointing into a deleted subtree nulls out to Unsorted, never cascades. */
  untagByGoalsStmt(userId: string, goalIds: readonly string[]): WriteStmt;
}
export const IIdeaRepo = Symbol.for('goal-cascade.IIdeaRepo');

export interface ILearningRepo {
  findById(userId: string, id: string): Promise<Learning | null>;
  listAll(userId: string): Promise<Learning[]>;
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

/** Better Auth's `rateLimit.customStorage` contract: ONE atomic consume, never a get/set pair. */
export interface IAuthRateLimitRepo {
  consume(key: string, rule: { window: number; max: number }): Promise<{ allowed: boolean; retryAfter: number | null }>;
  purgeBefore(lastRequestBeforeMs: number): Promise<number>;
}
export const IAuthRateLimitRepo = Symbol.for('goal-cascade.IAuthRateLimitRepo');
