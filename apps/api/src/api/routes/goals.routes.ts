import {
  CreateGoalRequest,
  DeleteGoalQuery,
  ENDPOINTS as E,
  IdParams,
  MoveGoalRequest,
  PatchGoalRequest,
  ReplanGoalRequest,
  WeekQuery,
} from '@goal-cascade/shared';
import { Hono } from 'hono';
import { GoalService, GoalTreeGuard } from '../../application/services';
import { idempotent } from '../middleware/idempotency';
import { ctx, type AppBindings } from '../types';
import { body, params, query, zJson, zParams, zQuery } from '../validate';
import { resolveWeek } from '../week';

/**
 * Goals. Every route is registered, origin-checked, session-gated, idempotency-wrapped (for commands)
 * and schema-validated HERE; a feature agent fills in `GoalService`, not this file.
 *
 * **The two guarded routes are not stubs.** `POST /goals` and `POST /goals/:id/move` call
 * `GoalTreeGuard` BEFORE the service, so the tree invariants (R-goal-5/6/17/18/21/28) are enforced from
 * the day the skeleton lands and a feature agent cannot ship a create or move that skips them. SPEC D-5
 * is the reason: in the mockup those checks existed only as disabled buttons, and the store could be
 * driven into a cycle or a Monthly-under-Monthly from the console.
 *
 * Do not remove the guard calls. Do not re-implement the same checks inside the service.
 */
export const goalsRoutes = new Hono<AppBindings>()
  .get(E.goals, zQuery(WeekQuery), async (c) => {
    const week = resolveWeek(ctx(c), query(c, WeekQuery).week);
    return c.json(await c.get('container').resolve(GoalService).list(ctx(c), week));
  })

  .get(E.goal(':id'), zParams(IdParams), zQuery(WeekQuery), async (c) => {
    const week = resolveWeek(ctx(c), query(c, WeekQuery).week);
    return c.json(await c.get('container').resolve(GoalService).detail(ctx(c), params(c, IdParams).id, week));
  })

  .post(E.goals, idempotent, zJson(CreateGoalRequest), async (c) => {
    const input = body(c, CreateGoalRequest);
    // R-goal-3/4/5/6 + R-goal-28 — refused before anything is written.
    await c.get('container').resolve(GoalTreeGuard).assertCanCreate(ctx(c), input);
    return c.json(await c.get('container').resolve(GoalService).create(ctx(c), input), 201);
  })

  .patch(E.goal(':id'), zParams(IdParams), zJson(PatchGoalRequest), async (c) =>
    c.json(await c.get('container').resolve(GoalService).patch(ctx(c), params(c, IdParams).id, body(c, PatchGoalRequest))),
  )

  .post(E.goalMove(':id'), idempotent, zParams(IdParams), zJson(MoveGoalRequest), async (c) => {
    const id = params(c, IdParams).id;
    const input = body(c, MoveGoalRequest);
    // R-goal-17/18/21 + R-goal-28 — the descendant check wins over the horizon check (R-goal-19).
    await c.get('container').resolve(GoalTreeGuard).assertCanMove(ctx(c), id, input.parentId);
    return c.json(await c.get('container').resolve(GoalService).move(ctx(c), id, input));
  })

  .post(E.goalReplan(':id'), idempotent, zParams(IdParams), zJson(ReplanGoalRequest), async (c) =>
    c.json(await c.get('container').resolve(GoalService).replan(ctx(c), params(c, IdParams).id, body(c, ReplanGoalRequest))),
  )

  /** Q-5 — cascade is opt-in; without it a goal with children refuses with the counts in `details`. */
  .delete(E.goal(':id'), zParams(IdParams), zQuery(DeleteGoalQuery), async (c) =>
    c.json(
      await c
        .get('container')
        .resolve(GoalService)
        .remove(ctx(c), params(c, IdParams).id, { cascade: query(c, DeleteGoalQuery).cascade === true }),
    ),
  );
