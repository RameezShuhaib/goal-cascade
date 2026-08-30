import {
  AddTaskLinkRequest,
  CancelTaskRequest,
  CompleteTaskRequest,
  CreateTaskRequest,
  ENDPOINTS as E,
  IdParams,
  MoveTaskToBacklogRequest,
  PatchTaskRequest,
  TaskLinkParams,
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
 */
export const tasksRoutes = new Hono<AppBindings>()
  .get(E.tasks, zQuery(TasksQuery), async (c) => {
    const q = query(c, TasksQuery);
    const week = resolveWeek(ctx(c), q.week);
    return c.json(
      await c
        .get('container')
        .resolve(TaskService)
        .list(ctx(c), { weekStart: week.weekStart, ...(q.goalId ? { goalId: q.goalId } : {}) }),
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

  .post(E.taskLinks(':id'), idempotent, zParams(IdParams), zJson(AddTaskLinkRequest), async (c) =>
    c.json(await c.get('container').resolve(TaskService).addLink(ctx(c), params(c, IdParams).id, body(c, AddTaskLinkRequest))),
  )

  .delete(E.taskLink(':id', ':linkId'), zParams(TaskLinkParams), async (c) => {
    const p = params(c, TaskLinkParams);
    return c.json(await c.get('container').resolve(TaskService).removeLink(ctx(c), p.id, p.linkId));
  });
