import {
  CreateGoalRequest,
  DeleteGoalQuery,
  ENDPOINTS as E,
  IdParams,
  LensQuery,
  MoveGoalRequest,
  NoQuery,
  PatchGoalRequest,
  RepeatWeekRequest,
  ReplanGoalRequest,
  ZoomQuery,
} from '@goal-cascade/shared';
import { Hono } from 'hono';
import { GoalService, GoalTreeGuard } from '../../application/services';
import { idempotent } from '../middleware/idempotency';
import { ctx, type AppBindings } from '../types';
import { body, params, query, zJson, zParams, zQuery } from '../validate';

/**
 * Goals, and the five lenses.
 *
 * Every route is registered, origin-checked, session-gated, idempotency-wrapped (for commands) and
 * schema-validated HERE; a feature agent fills in `GoalService`, not this file.
 *
 * **The two guarded routes are not stubs.** `POST /goals` and `POST /goals/:id/move` call
 * `GoalTreeGuard` BEFORE the service, so the tree invariants (R-goal-5/17/18/21/31) are enforced and a
 * feature agent cannot ship a create or move that skips them. SPEC D-5 is the reason: in the mockup those
 * checks existed only as disabled buttons, and the store could be driven into a cycle from the console.
 *
 * Do not remove the guard calls. Do not re-implement the same checks inside the service.
 *
 * ⚠ **A2** — three shape changes:
 *  - `GET /goals` is the **scoped lens read** (R-lens-16), not the whole tree flat. `GET /goals/:id` no
 *    longer takes a `?week=`: a goal's detail page is not week-scoped; only the Weekly lens is.
 *  - **new** `GET /goals/zoom` (R-lens-22) and `POST /goals/repeat-week` (R-goal-46).
 *  - the Monthly-terminal comment moved to **Weekly** (R-goal-31), because the terminal horizon did.
 */
export const goalsRoutes = new Hono<AppBindings>()
  /**
   * R-lens-16 / R-lens-27 — one horizon, one period, paginated. Registered first among the `/goals`
   * reads; an absent or unparseable period falls back to the current one rather than erroring
   * (R-lens-14).
   */
  .get(E.goals, zQuery(LensQuery), async (c) =>
    c.json(await c.get('container').resolve(GoalService).lens(ctx(c), query(c, LensQuery))),
  )

  /**
   * R-lens-22 — the Zoom sheet's five rows in ONE grouped read.
   *
   * **Registered before `/goals/:id`** so the literal path wins the route match. `IdParams` would refuse
   * `zoom` as a non-ULID anyway, but relying on a 422 to disambiguate a route is a coincidence, not a
   * design.
   */
  .get(E.goalsZoom, zQuery(ZoomQuery), async (c) =>
    c.json(await c.get('container').resolve(GoalService).zoom(ctx(c), query(c, ZoomQuery).anchor)),
  )

  /**
   * R-goal-46 — `Repeat last week` for one Life line. It creates ordinary goals; there is no template,
   * no series and no recurrence machinery behind it.
   */
  .post(E.goalsRepeatWeek, idempotent, zJson(RepeatWeekRequest), async (c) =>
    c.json(await c.get('container').resolve(GoalService).repeatWeek(ctx(c), body(c, RepeatWeekRequest)), 201),
  )

  .get(E.goal(':id'), zParams(IdParams), zQuery(NoQuery), async (c) =>
    c.json(await c.get('container').resolve(GoalService).detail(ctx(c), params(c, IdParams).id)),
  )

  .post(E.goals, idempotent, zJson(CreateGoalRequest), async (c) => {
    const input = body(c, CreateGoalRequest);
    // R-goal-3/4/5/31/32 — refused before anything is written, and it reads ONE ROW (R-lens-27).
    await c.get('container').resolve(GoalTreeGuard).assertCanCreate(ctx(c), input);
    return c.json(await c.get('container').resolve(GoalService).create(ctx(c), input), 201);
  })

  .patch(E.goal(':id'), zParams(IdParams), zJson(PatchGoalRequest), async (c) =>
    c.json(await c.get('container').resolve(GoalService).patch(ctx(c), params(c, IdParams).id, body(c, PatchGoalRequest))),
  )

  .post(E.goalMove(':id'), idempotent, zParams(IdParams), zJson(MoveGoalRequest), async (c) => {
    const id = params(c, IdParams).id;
    const input = body(c, MoveGoalRequest);
    // R-goal-17/18/21 — the descendant check wins over the horizon check (R-goal-19), and it reads ONE
    // SUBTREE (zero rows below the root when the moved goal is Weekly — R-goal-31).
    await c.get('container').resolve(GoalTreeGuard).assertCanMove(ctx(c), id, input.parentId);
    return c.json(await c.get('container').resolve(GoalService).move(ctx(c), id, input));
  })

  .post(E.goalReplan(':id'), idempotent, zParams(IdParams), zJson(ReplanGoalRequest), async (c) =>
    c.json(await c.get('container').resolve(GoalService).replan(ctx(c), params(c, IdParams).id, body(c, ReplanGoalRequest))),
  )

  /**
   * Q-5 / R-task-47 — cascade is opt-in; without it a goal with children refuses with the counts in
   * `details`. Deleting a Monthly goal now takes its Weekly children and all of their tasks, so those
   * counts can be large — and they are a summary, never a list.
   *
   * `?dryRun=true` is the read-only preview: it runs the same subtree walk and returns the same shape
   * with `deleted: false`, writing nothing. It backs `preview_goal_deletion` and covers the case the live
   * guard cannot — a childless goal, which deletes silently and takes its tasks and timelines with it.
   */
  .delete(E.goal(':id'), zParams(IdParams), zQuery(DeleteGoalQuery), async (c) => {
    const q = query(c, DeleteGoalQuery);
    return c.json(
      await c
        .get('container')
        .resolve(GoalService)
        .remove(ctx(c), params(c, IdParams).id, { cascade: q.cascade === true, dryRun: q.dryRun === true }),
    );
  });
