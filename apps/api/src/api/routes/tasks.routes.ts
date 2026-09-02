import {
  AddTaskLinkRequest,
  CancelTaskRequest,
  CompleteTaskRequest,
  CreateTaskRequest,
  ENDPOINTS as E,
  IdParams,
  MoveTaskToBacklogRequest,
  PatchTaskRequest,
  RecordReadingRequest,
  RetargetTaskRequest,
  SetMeasureRequest,
  TaskLinkParams,
  TaskReadingParams,
  TasksQuery,
  UncheckTaskRequest,
  WeekQuery,
} from '@goal-cascade/shared';
import { Hono } from 'hono';
import { TaskService } from '../../application/services';
import { idempotent } from '../middleware/idempotency';
import { ctx, type AppBindings } from '../types';
import { body, params, query, zJson, zParams, zQuery } from '../validate';
import { resolveWeek } from '../week';

/**
 * Tasks. Reads are always week-scoped (`?week=`, default the current week), because "which tasks exist"
 * is meaningless without a week: an open task carries into every week at or after its origin (R-task-7).
 *
 * There are EXACTLY three exits (R-task-13): complete, move-to-backlog, cancel. There is no defer, no
 * snooze, no reschedule, and no move-to-another-week endpoint — S-task-13-1 requires that no such
 * operation exists, so do not add one here.
 *
 * ⚠ **A8 — `/retarget` is NOT a fourth exit** (R-task-56, S-task-56-4). An exit takes work *out* of a
 * period; Park moves it between two it was already committed to, and the task is still open, still
 * visible and still yours to finish. It is also why the route is named for what it does to the task's
 * target rather than for what it feels like: a route called `/defer` would teach the concept the product
 * refuses to have.
 *
 * ⚠ **A2 (R-rm-5)** — the Tasks SCREEN is gone; this read is not. It is the Weekly lens's data source
 * (R-lens-12), and `POST /tasks` now takes **no week at all**: `originPeriodKey` is seeded from the
 * Weekly parent's `periodKey` (R-task-40), and `newWeeklyGoal` creates that parent in the same
 * transaction when there is none (R-task-48).
 */
export const tasksRoutes = new Hono<AppBindings>()
  .get(E.tasks, zQuery(TasksQuery), async (c) => {
    const q = query(c, TasksQuery);
    const week = resolveWeek(ctx(c), q.week);
    // ⚠ **A2 (R-rm-4)** — no `goalId`. There are no filter pills, and no lens read accepts a goal filter
    // of any kind (R-lens-15): grouping by Life goal is the whole answer, and it is the server's job.
    return c.json(
      await c
        .get('container')
        .resolve(TaskService)
        .list(ctx(c), { weekStart: week.weekStart, ...(q.limit !== undefined ? { limit: q.limit } : {}) }),
    );
  })

  .get(E.task(':id'), zParams(IdParams), zQuery(WeekQuery), async (c) => {
    const week = resolveWeek(ctx(c), query(c, WeekQuery).week);
    return c.json(await c.get('container').resolve(TaskService).get(ctx(c), params(c, IdParams).id, week));
  })

  .post(E.tasks, idempotent, zJson(CreateTaskRequest), async (c) =>
    c.json(await c.get('container').resolve(TaskService).create(ctx(c), body(c, CreateTaskRequest)), 201),
  )

  .patch(E.task(':id'), zParams(IdParams), zJson(PatchTaskRequest), async (c) =>
    c.json(await c.get('container').resolve(TaskService).patch(ctx(c), params(c, IdParams).id, body(c, PatchTaskRequest))),
  )

  /** Exit 1 of 3 (R-task-14) — any viewed week, including past ones. */
  .post(E.taskComplete(':id'), idempotent, zParams(IdParams), zJson(CompleteTaskRequest), async (c) =>
    c.json(await c.get('container').resolve(TaskService).complete(ctx(c), params(c, IdParams).id, body(c, CompleteTaskRequest))),
  )

  /** R-task-19 — not an exit: it puts the task back into the open state under its ORIGINAL origin. */
  .post(E.taskUncheck(':id'), idempotent, zParams(IdParams), zJson(UncheckTaskRequest), async (c) =>
    c.json(await c.get('container').resolve(TaskService).uncheck(ctx(c), params(c, IdParams).id, body(c, UncheckTaskRequest))),
  )

  /** Exit 2 of 3 (R-task-15) — the task keeps its row and becomes a backlog item on its own goal. */
  .post(E.taskMoveToBacklog(':id'), idempotent, zParams(IdParams), zJson(MoveTaskToBacklogRequest), async (c) =>
    c.json(
      await c
        .get('container')
        .resolve(TaskService)
        .moveToBacklog(ctx(c), params(c, IdParams).id, body(c, MoveTaskToBacklogRequest)),
    ),
  )

  /** Exit 3 of 3 (R-task-16) — the optional reason is retained on the record (D-15). */
  .post(E.taskCancel(':id'), idempotent, zParams(IdParams), zJson(CancelTaskRequest), async (c) =>
    c.json(await c.get('container').resolve(TaskService).cancel(ctx(c), params(c, IdParams).id, body(c, CancelTaskRequest))),
  )

  /**
   * ⚠ **A8, new (R-task-56)** — Park in a week / Move to the month. **Not an exit** (see the file's doc
   * block). Idempotency-wrapped like every command, and retargeting to the period the task is already in
   * is a no-op that writes no event even without it.
   */
  .post(E.taskRetarget(':id'), idempotent, zParams(IdParams), zJson(RetargetTaskRequest), async (c) =>
    c.json(await c.get('container').resolve(TaskService).retarget(ctx(c), params(c, IdParams).id, body(c, RetargetTaskRequest))),
  )

  /**
   * ⚠ **A8, new (R-measure-1)** — attach or replace the task's measure.
   *
   * `PUT` and not `PATCH`: a measure is one coherent triple plus a unit, and a partial edit that changed
   * `start` without restating `target` could silently create the `target === start` state the product
   * refuses (`MEASURE_TARGET_EQUALS_START`). The schema refines the pair together, so it can only refuse
   * a whole measure.
   */
  .put(E.taskMeasure(':id'), idempotent, zParams(IdParams), zJson(SetMeasureRequest), async (c) =>
    c.json(await c.get('container').resolve(TaskService).setMeasure(ctx(c), params(c, IdParams).id, body(c, SetMeasureRequest))),
  )

  /** ⚠ **A8, new (R-measure-1)** — removes the measure AND every reading, in one transaction. */
  .delete(E.taskMeasure(':id'), zParams(IdParams), async (c) =>
    c.json(await c.get('container').resolve(TaskService).clearMeasure(ctx(c), params(c, IdParams).id)),
  )

  /**
   * ⚠ **A8, new (R-measure-3)** — record one value. Append-only: there is deliberately **no PATCH and no
   * PUT on a reading**, because correcting a mistyped 240 is deleting it and recording 24 (R-measure-5).
   */
  .post(E.taskReadings(':id'), idempotent, zParams(IdParams), zJson(RecordReadingRequest), async (c) =>
    c.json(
      await c.get('container').resolve(TaskService).recordReading(ctx(c), params(c, IdParams).id, body(c, RecordReadingRequest)),
    ),
  )

  /** ⚠ **A8, new (R-measure-5)** — delete one reading. It leaves no trace anywhere (R-measure-7). */
  .delete(E.taskReading(':id', ':readingId'), zParams(TaskReadingParams), async (c) => {
    const p = params(c, TaskReadingParams);
    return c.json(await c.get('container').resolve(TaskService).deleteReading(ctx(c), p.id, p.readingId));
  })

  .post(E.taskLinks(':id'), idempotent, zParams(IdParams), zJson(AddTaskLinkRequest), async (c) =>
    c.json(await c.get('container').resolve(TaskService).addLink(ctx(c), params(c, IdParams).id, body(c, AddTaskLinkRequest))),
  )

  .delete(E.taskLink(':id', ':linkId'), zParams(TaskLinkParams), async (c) => {
    const p = params(c, TaskLinkParams);
    return c.json(await c.get('container').resolve(TaskService).removeLink(ctx(c), p.id, p.linkId));
  });
