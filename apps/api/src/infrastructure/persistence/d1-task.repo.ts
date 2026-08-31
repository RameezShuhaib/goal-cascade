import { and, asc, desc, eq, gt, inArray, lte, or, sql } from 'drizzle-orm';
import { inject, injectable } from 'tsyringe';
import { chunkIds } from '../../application/ports';
import type { ITaskEventRepo, ITaskLinkRepo, ITaskRepo, WriteStmt } from '../../application/ports';
import { DB } from '../../application/services/guarded-batch';
import type { Task, TaskEvent, TaskLink } from '../../domain/entities';
import type { Db } from './db';
import { taskEvents, taskLinks, tasks } from './schema';

const NEVER = ' never ';
const ids = (list: readonly string[]) => (list.length > 0 ? list : [NEVER]);

/**
 * Run an id-scoped read one chunk at a time and union the results.
 *
 * ⚠ **A2 (RECONCILIATION §3.3)** — the pattern this replaces was `inArray(<all n goal ids>)`, one bound
 * parameter per goal, with no chunking anywhere in the repository layer. That fails on ACCOUNT SIZE
 * rather than on request shape. `chunkIds` is the ceiling; this is the loop.
 */
async function inChunks<I, R>(list: readonly I[], read: (part: I[]) => Promise<R[]>): Promise<R[]> {
  if (list.length === 0) return [];
  const pages = await Promise.all(chunkIds(list).map(read));
  return pages.flat();
}

@injectable()
export class D1TaskRepo implements ITaskRepo {
  constructor(@inject(DB) private readonly db: Db) {}

  findById(userId: string, id: string): Promise<Task | null> {
    return this.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.userId, userId), eq(tasks.id, id)))
      .get()
      .then((r) => r ?? null);
  }

  /**
   * R-task-7/8/32 — the whole week-visibility rule, in SQL, in one place:
   *   OPEN  and `origin_week_start <= week`  → it carries forward, with no write of any kind
   *   DONE  and `done_week_start   =  week`  → visible only in the week it was completed
   *   exited (canceled / movedToBacklog)     → visible in no week at all
   *
   * The exclusion of exited tasks lives HERE rather than in the caller, so no read model can leak one.
   * Ordering is Q-7: open before done, then `created_at` asc, `id` asc.
   */
  listVisibleInWeek(userId: string, weekStart: string, limit?: number): Promise<Task[]> {
    const q = this.db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, userId),
          or(
            and(eq(tasks.status, 'open'), lte(tasks.originWeekStart, weekStart)),
            and(eq(tasks.status, 'done'), eq(tasks.doneWeekStart, weekStart)),
          ),
        ),
      )
      .orderBy(desc(tasks.status), asc(tasks.createdAt), asc(tasks.id));
    // R-lens-16 / Q-12 — `MAX_PAGE`, finally wired. The Weekly lens's payload grows with OPEN WORK,
    // which is correct and owner-controlled, but "owner-controlled" is not the same as bounded.
    return limit === undefined ? q.all() : q.limit(limit).all();
  }

  /** R-goal-24 — the Life-goal carry signal. **Chunked**: the id list is a subtree, not a page. */
  listOpenByGoals(userId: string, goalIds: readonly string[]): Promise<Task[]> {
    return inChunks(goalIds, (part) =>
      this.db
        .select()
        .from(tasks)
        .where(and(eq(tasks.userId, userId), eq(tasks.status, 'open'), inArray(tasks.goalId, part)))
        .orderBy(asc(tasks.originWeekStart), asc(tasks.id))
        .all(),
    );
  }

  /**
   * ⚠ **A2, new (R-lens-4)** — **the group-header counts, as ONE grouped query.**
   *
   * `status='open' AND origin_week_start <= :week GROUP BY goal_id`, served by `ix_tasks_open_week` —
   * the index that already exists; no new task index is needed. It returns one row per goal holding open
   * work, which the service maps to its Life root through the interior index in O(d) per row.
   *
   * The old path built `goalIds = <every goal in the account>` and passed it to `listOpenByGoals`, which
   * is both the Θ(n) read and the bind-parameter cliff. This is bounded by open work instead.
   */
  async countOpenVisibleByGoal(userId: string, weekStart: string): Promise<{ goalId: string; open: number }[]> {
    const rows = await this.db
      .select({ goalId: tasks.goalId, n: sql<number>`count(*)` })
      .from(tasks)
      .where(and(eq(tasks.userId, userId), eq(tasks.status, 'open'), lte(tasks.originWeekStart, weekStart)))
      .groupBy(tasks.goalId)
      .all();
    return rows.map((r) => ({ goalId: r.goalId, open: Number(r.n) }));
  }

  /**
   * R-goal-24 — the Life-goal carry signal, as ONE grouped query.
   *
   * `status='open' AND origin_week_start < :week`, `COUNT(*)` and `MIN(origin_week_start)` per goal, on
   * `ix_tasks_open_week`. The strict `<` is the whole of R-task-38 here: a task with a FUTURE origin can
   * never satisfy it, so this signal needs no future guard of its own.
   */
  async carryingByGoal(
    userId: string,
    beforeWeekStart: string,
  ): Promise<{ goalId: string; open: number; oldestOrigin: string }[]> {
    const rows = await this.db
      .select({ goalId: tasks.goalId, n: sql<number>`count(*)`, oldest: sql<string>`min(${tasks.originWeekStart})` })
      .from(tasks)
      .where(and(eq(tasks.userId, userId), eq(tasks.status, 'open'), sql`${tasks.originWeekStart} < ${beforeWeekStart}`))
      .groupBy(tasks.goalId)
      .all();
    return rows.map((r) => ({ goalId: r.goalId, open: Number(r.n), oldestOrigin: r.oldest }));
  }

  /**
   * R-lens-26 — the Weekly lens's half of the forward-content dot: does any task ORIGINATE in a week
   * after this one? A `>` probe on `ix_tasks_open_week` with `LIMIT 1`; it never counts.
   */
  async hasOriginAfter(userId: string, weekStart: string): Promise<boolean> {
    const row = await this.db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.userId, userId), eq(tasks.status, 'open'), gt(tasks.originWeekStart, weekStart)))
      .limit(1)
      .get();
    return row !== undefined;
  }

  /**
   * Q-5 — every task under these goals, exited ones included. The subtree delete needs the ids to reach
   * the links and events keyed by them; filtering to `open` here would orphan an exited task's log.
   * **Chunked** — a Life goal's subtree is legitimately large.
   */
  listByGoals(userId: string, goalIds: readonly string[]): Promise<Task[]> {
    return inChunks(goalIds, (part) =>
      this.db
        .select()
        .from(tasks)
        .where(and(eq(tasks.userId, userId), inArray(tasks.goalId, part)))
        .orderBy(asc(tasks.createdAt), asc(tasks.id))
        .all(),
    );
  }

  insertStmt(task: Task): WriteStmt {
    return this.db.insert(tasks).values(task);
  }

  updateGuardedStmt(
    userId: string,
    id: string,
    expectedVersion: number,
    patch: Partial<Omit<Task, 'id' | 'userId'>> & { updatedAt: string; version: number },
  ): WriteStmt {
    return this.db
      .update(tasks)
      .set(patch)
      .where(and(eq(tasks.userId, userId), eq(tasks.id, id), eq(tasks.version, expectedVersion)));
  }

  /**
   * Q-5 cascade ONLY. A task is never deleted by an exit — Move-to-Backlog and Cancel set a terminal
   * status and keep the row so the timeline survives (D-15). There is deliberately no `deleteStmt(id)`.
   */
  deleteByGoalsStmt(userId: string, goalIds: readonly string[]): WriteStmt {
    return this.db.delete(tasks).where(and(eq(tasks.userId, userId), inArray(tasks.goalId, ids(goalIds))));
  }
}

@injectable()
export class D1TaskLinkRepo implements ITaskLinkRepo {
  constructor(@inject(DB) private readonly db: Db) {}

  /** **Chunked** — a week's task list is owner-controlled, and the delete cascade's is a whole subtree. */
  listByTasks(userId: string, taskIds: readonly string[]): Promise<TaskLink[]> {
    return inChunks(taskIds, (part) =>
      this.db
        .select()
        .from(taskLinks)
        .where(and(eq(taskLinks.userId, userId), inArray(taskLinks.taskId, part)))
        .orderBy(asc(taskLinks.createdAt), asc(taskLinks.id))
        .all(),
    );
  }

  insertStmt(link: TaskLink): WriteStmt {
    return this.db.insert(taskLinks).values(link);
  }

  deleteStmt(userId: string, taskId: string, linkId: string): WriteStmt {
    return this.db
      .delete(taskLinks)
      .where(and(eq(taskLinks.userId, userId), eq(taskLinks.taskId, taskId), eq(taskLinks.id, linkId)));
  }

  deleteByTasksStmt(userId: string, taskIds: readonly string[]): WriteStmt {
    return this.db.delete(taskLinks).where(and(eq(taskLinks.userId, userId), inArray(taskLinks.taskId, ids(taskIds))));
  }
}

@injectable()
export class D1TaskEventRepo implements ITaskEventRepo {
  constructor(@inject(DB) private readonly db: Db) {}

  /** Q-7 — newest first: `at` desc, then insertion sequence (`id`, a ULID) desc. */
  listByTask(userId: string, taskId: string, limit = 500): Promise<TaskEvent[]> {
    return this.db
      .select()
      .from(taskEvents)
      .where(and(eq(taskEvents.userId, userId), eq(taskEvents.taskId, taskId)))
      .orderBy(desc(taskEvents.at), desc(taskEvents.id))
      .limit(limit)
      .all();
  }

  /** Q-5 — the whole log for a set of tasks, so the subtree delete can state its exact row count. Chunked. */
  listByTasks(userId: string, taskIds: readonly string[]): Promise<TaskEvent[]> {
    return inChunks(taskIds, (part) =>
      this.db
        .select()
        .from(taskEvents)
        .where(and(eq(taskEvents.userId, userId), inArray(taskEvents.taskId, part)))
        .orderBy(desc(taskEvents.at), desc(taskEvents.id))
        .all(),
    );
  }

  insertStmt(event: TaskEvent): WriteStmt {
    return this.db.insert(taskEvents).values(event);
  }

  /**
   * R-task-29 / Q-17 — the lazy carry-log producer. There is no cron: carrying itself is derived
   * (`listVisibleInWeek`), and only the cosmetic `Carried to week of …` line needs producing, on first
   * read of a week.
   *
   * `onConflictDoNothing` against `ux_task_events_carried (user_id, task_id, week_start) WHERE
   * kind='carried'` makes that idempotent: a re-read, a refresh, or two devices opening the same new
   * week at once insert nothing the second time. Run it with `expectedChanges: 0` — a duplicate is the
   * normal case, not a failure.
   */
  insertCarriedIgnoreStmt(event: TaskEvent & { weekStart: string }): WriteStmt {
    return this.db.insert(taskEvents).values({ ...event, kind: 'carried' }).onConflictDoNothing();
  }

  /** Q-5 cascade only. The timeline is append-only for every other purpose (R-task-31). */
  deleteByTasksStmt(userId: string, taskIds: readonly string[]): WriteStmt {
    return this.db.delete(taskEvents).where(and(eq(taskEvents.userId, userId), inArray(taskEvents.taskId, ids(taskIds))));
  }
}
