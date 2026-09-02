import { MAX_READINGS } from '@goal-cascade/shared';
import { and, asc, desc, eq, gt, inArray, lte, or, sql } from 'drizzle-orm';
import { inject, injectable } from 'tsyringe';
import { chunkIds } from '../../application/ports';
import type { IReadingRepo, ITaskEventRepo, ITaskLinkRepo, ITaskRepo, WriteStmt } from '../../application/ports';
import { DB } from '../../application/services/guarded-batch';
import type { Reading, Task, TaskEvent, TaskLink } from '../../domain/entities';
import type { TaskScope } from '../../domain/enums';
import type { Db } from './db';
import { taskEvents, taskLinks, taskReadings, tasks } from './schema';

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
   * R-task-7/8/32 / **R-task-53** — the whole period-visibility rule, in SQL, in one place:
   *   OPEN  and `scope = :scope AND origin_period_key <= :key` → it carries forward, with no write
   *   DONE  and `scope = :scope AND done_period_key   =  :key` → visible only in the period it was done
   *   exited (canceled / movedToBacklog)                        → visible in no period at all
   *
   * ⚠ **A8 - `scope` is IN THE PREDICATE, not merely on the row.** Without it,
   * `origin_period_key <= '2026-09-07'` would sweep every month key from `1000-01` upward on the way,
   * because `2026-09` sorts below `2026-09-07` and no index can key on the length of a string
   * (R-task-52). It is also the whole of "a month task is invisible in a week list and vice versa": the
   * band that shows a month task inside a week asks for it by name, in `monthTasks`.
   *
   * The exclusion of exited tasks lives HERE rather than in the caller, so no read model can leak one.
   * Ordering is Q-7: open before done, then `created_at` asc, `id` asc.
   */
  listVisibleInPeriod(userId: string, scope: TaskScope, periodKey: string, limit?: number): Promise<Task[]> {
    const q = this.db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, userId),
          eq(tasks.scope, scope),
          or(
            and(eq(tasks.status, 'open'), lte(tasks.originPeriodKey, periodKey)),
            and(eq(tasks.status, 'done'), eq(tasks.donePeriodKey, periodKey)),
          ),
        ),
      )
      .orderBy(desc(tasks.status), asc(tasks.createdAt), asc(tasks.id));
    // R-lens-16 / Q-12 - `MAX_PAGE`, finally wired. The lens's payload grows with OPEN WORK, which is
    // correct and owner-controlled, but "owner-controlled" is not the same as bounded. A8 (Q-C) - the
    // Monthly lens pages here too: a Monthly goal with 200 month tasks is a data pathology, but the read
    // must not be the thing that discovers it.
    return limit === undefined ? q.all() : q.limit(limit).all();
  }

  /** R-goal-24 — the Life-goal carry signal. **Chunked**: the id list is a subtree, not a page. */
  listOpenByGoals(userId: string, goalIds: readonly string[]): Promise<Task[]> {
    return inChunks(goalIds, (part) =>
      this.db
        .select()
        .from(tasks)
        .where(and(eq(tasks.userId, userId), eq(tasks.status, 'open'), inArray(tasks.goalId, part)))
        .orderBy(asc(tasks.originPeriodKey), asc(tasks.id))
        .all(),
    );
  }

  /**
   * ⚠ **A2, new (R-lens-4)** — **the group-header counts, as ONE grouped query.**
   *
   * `status='open' AND scope=:scope AND origin_period_key <= :key GROUP BY goal_id`, served by
   * `ix_tasks_open_period`. One row per goal holding open work, which the service maps to its Life root
   * through the interior index in O(d) per row.
   *
   * The old path built `goalIds = <every goal in the account>` and passed it to `listOpenByGoals`, which
   * is both the Θ(n) read and the bind-parameter cliff. This is bounded by open work instead.
   *
   * ⚠ **A8 (R-lens-31, S-lens-31-3) - every caller passes `'Weekly'`, and that is the RULE, not an
   * oversight.** R-lens-4's number answers *"what is on me this week"*, and a month task is precisely the
   * work this amendment exists to say is **not** on you this week. Counting one here would contradict the
   * no-late-styling rule of the band that renders it, in a number. The parameter exists so the predicate
   * is selective and so the omission is a visible argument rather than a silent absence.
   */
  async countOpenVisibleByGoal(userId: string, scope: TaskScope, periodKey: string): Promise<{ goalId: string; open: number }[]> {
    const rows = await this.db
      .select({ goalId: tasks.goalId, n: sql<number>`count(*)` })
      .from(tasks)
      .where(
        and(eq(tasks.userId, userId), eq(tasks.status, 'open'), eq(tasks.scope, scope), lte(tasks.originPeriodKey, periodKey)),
      )
      .groupBy(tasks.goalId)
      .all();
    return rows.map((r) => ({ goalId: r.goalId, open: Number(r.n) }));
  }

  /**
   * R-goal-24 — the Life-goal carry signal, as ONE grouped query.
   *
   * `status='open' AND scope='Weekly' AND origin_period_key < :week`, `COUNT(*)` and
   * `MIN(origin_period_key)` per goal, on `ix_tasks_open_period`. The strict `<` is the whole of
   * R-task-38 here: a task with a FUTURE origin can never satisfy it, so this signal needs no future
   * guard of its own.
   *
   * ⚠ **A8 - `scope = 'Weekly'` is pinned here, in the query, deliberately.** R-goal-24's line reads
   * `N tasks carrying - oldest W weeks` in WEEKS, and mixing month tasks into it would either report a
   * month count in weeks or need a second number on the same line. A month task's escalation is its own
   * chip at its own scale, in the Monthly lens (R-task-54); this line is not a second one.
   */
  async carryingByGoal(
    userId: string,
    beforeWeekStart: string,
  ): Promise<{ goalId: string; open: number; oldestOrigin: string }[]> {
    const rows = await this.db
      .select({ goalId: tasks.goalId, n: sql<number>`count(*)`, oldest: sql<string>`min(${tasks.originPeriodKey})` })
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, userId),
          eq(tasks.status, 'open'),
          eq(tasks.scope, 'Weekly'),
          sql`${tasks.originPeriodKey} < ${beforeWeekStart}`,
        ),
      )
      .groupBy(tasks.goalId)
      .all();
    return rows.map((r) => ({ goalId: r.goalId, open: Number(r.n), oldestOrigin: r.oldest }));
  }

  /**
   * R-lens-26 — the lens's half of the forward-content dot: does any task ORIGINATE in a period after this
   * one, **at this scope**? A `>` probe on `ix_tasks_open_period` with `LIMIT 1`; it never counts.
   *
   * ⚠ **A8** - scoped, so the Monthly lens's dot answers about month tasks and the Weekly lens's
   * about week tasks. An unscoped probe would light the Weekly chevron for a month task six months out - a
   * dot pointing at something that lens will never show.
   */
  async hasOriginAfter(userId: string, scope: TaskScope, periodKey: string): Promise<boolean> {
    const row = await this.db
      .select({ id: tasks.id })
      .from(tasks)
      .where(
        and(eq(tasks.userId, userId), eq(tasks.status, 'open'), eq(tasks.scope, scope), gt(tasks.originPeriodKey, periodKey)),
      )
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
   * `onConflictDoNothing` against `ux_task_events_carried (user_id, task_id, period_key) WHERE
   * kind='carried'` makes that idempotent: a re-read, a refresh, or two devices opening the same new
   * period at once insert nothing the second time. Run it with `expectedChanges: 'any'` - a duplicate is
   * the normal case, not a failure.
   *
   * ⚠ **A8 (R-task-53)** - the key is a PERIOD, so a month task's `Carried to Sep 2026` is the same
   * line at the month scale and cannot collide with a week's: a month key and a Monday are never equal.
   */
  insertCarriedIgnoreStmt(event: TaskEvent & { periodKey: string }): WriteStmt {
    return this.db.insert(taskEvents).values({ ...event, kind: 'carried' }).onConflictDoNothing();
  }

  /** Q-5 cascade only. The timeline is append-only for every other purpose (R-task-31). */
  deleteByTasksStmt(userId: string, taskIds: readonly string[]): WriteStmt {
    return this.db.delete(taskEvents).where(and(eq(taskEvents.userId, userId), inArray(taskEvents.taskId, ids(taskIds))));
  }
}


/**
 * ⚠ **A8, new (R-measure-3, R-measure-5)** - the append-only reading history.
 *
 * **No read here filters by any period, and none ever may.** A reading is keyed by `task_id` and by
 * nothing else, which is what makes it survive carrying, parking, un-parking, re-parenting, completion
 * and unchecking (S-measure-5-2). There is deliberately no `update` either: a reading is never edited in
 * place, because correcting a mistyped 240 is deleting it and recording 24.
 */
@injectable()
export class D1ReadingRepo implements IReadingRepo {
  constructor(@inject(DB) private readonly db: Db) {}

  /** Oldest first - the sparkline's own order, and the order `TaskDetailView.readings` ships in. */
  listByTask(userId: string, taskId: string, limit = MAX_READINGS): Promise<Reading[]> {
    return this.db
      .select()
      .from(taskReadings)
      .where(and(eq(taskReadings.userId, userId), eq(taskReadings.taskId, taskId)))
      .orderBy(asc(taskReadings.at), asc(taskReadings.id))
      .limit(limit)
      .all();
  }

  /** **Chunked** - Q-5's cascade passes a whole subtree's worth of task ids. */
  listByTasks(userId: string, taskIds: readonly string[]): Promise<Reading[]> {
    return inChunks(taskIds, (part) =>
      this.db
        .select()
        .from(taskReadings)
        .where(and(eq(taskReadings.userId, userId), inArray(taskReadings.taskId, part)))
        .orderBy(asc(taskReadings.at), asc(taskReadings.id))
        .all(),
    );
  }

  /** Q-26's cap on write, and the count the `This deletes N recorded values.` confirm names. */
  async countByTask(userId: string, taskId: string): Promise<number> {
    const row = await this.db
      .select({ n: sql<number>`count(*)` })
      .from(taskReadings)
      .where(and(eq(taskReadings.userId, userId), eq(taskReadings.taskId, taskId)))
      .get();
    return Number(row?.n ?? 0);
  }

  insertStmt(reading: Reading): WriteStmt {
    return this.db.insert(taskReadings).values(reading);
  }

  /** R-measure-5 - the ONE single-row delete in this model, and the only thing that removes a reading. */
  deleteStmt(userId: string, taskId: string, readingId: string): WriteStmt {
    return this.db
      .delete(taskReadings)
      .where(and(eq(taskReadings.userId, userId), eq(taskReadings.taskId, taskId), eq(taskReadings.id, readingId)));
  }

  /** R-measure-1 - removing a measure takes its whole history, in the same transaction. */
  deleteByTaskStmt(userId: string, taskId: string): WriteStmt {
    return this.db.delete(taskReadings).where(and(eq(taskReadings.userId, userId), eq(taskReadings.taskId, taskId)));
  }

  /** Q-5 cascade only. Chunked by the caller, like every other subtree delete. */
  deleteByTasksStmt(userId: string, taskIds: readonly string[]): WriteStmt {
    return this.db.delete(taskReadings).where(and(eq(taskReadings.userId, userId), inArray(taskReadings.taskId, ids(taskIds))));
  }
}
