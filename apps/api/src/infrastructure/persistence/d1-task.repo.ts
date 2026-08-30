import { and, asc, desc, eq, inArray, lte, or } from 'drizzle-orm';
import { inject, injectable } from 'tsyringe';
import type { ITaskEventRepo, ITaskLinkRepo, ITaskRepo, WriteStmt } from '../../application/ports';
import { DB } from '../../application/services/guarded-batch';
import type { Task, TaskEvent, TaskLink } from '../../domain/entities';
import type { Db } from './db';
import { taskEvents, taskLinks, tasks } from './schema';

const NEVER = ' never ';
const ids = (list: readonly string[]) => (list.length > 0 ? list : [NEVER]);

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
  listVisibleInWeek(userId: string, weekStart: string): Promise<Task[]> {
    return this.db
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
      .orderBy(desc(tasks.status), asc(tasks.createdAt), asc(tasks.id))
      .all();
  }

  /** R-goal-24 (the carry signal) and R-goal-28 / D-8 (refuse making a leaf with open tasks a parent). */
  listOpenByGoals(userId: string, goalIds: readonly string[]): Promise<Task[]> {
    return this.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.userId, userId), eq(tasks.status, 'open'), inArray(tasks.goalId, ids(goalIds))))
      .orderBy(asc(tasks.originWeekStart), asc(tasks.id))
      .all();
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

  listByTasks(userId: string, taskIds: readonly string[]): Promise<TaskLink[]> {
    return this.db
      .select()
      .from(taskLinks)
      .where(and(eq(taskLinks.userId, userId), inArray(taskLinks.taskId, ids(taskIds))))
      .orderBy(asc(taskLinks.createdAt), asc(taskLinks.id))
      .all();
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
