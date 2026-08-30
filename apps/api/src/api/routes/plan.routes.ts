import { ENDPOINTS as E, SavePlanRequest, WeekQuery } from '@goal-cascade/shared';
import { Hono } from 'hono';
import { PlanService } from '../../application/services';
import { idempotent } from '../middleware/idempotency';
import { ctx, type AppBindings } from '../types';
import { body, query, zJson, zQuery } from '../validate';
import { resolveWeek } from '../week';

/**
 * The weekly plan. `PUT` rather than `POST`: R-plan-7 makes the save a whole-week REPLACE over every
 * non-Life leaf, not an append — the method should say so.
 *
 * `PUT /plan` carries its own `weekStart` and the service refuses anything but the current week
 * (`WEEK_NOT_CURRENT`, R-plan-2). `GET /plan?week=` reads any addressable week, because a past week
 * renders the sentences it actually had (D-2).
 */
export const planRoutes = new Hono<AppBindings>()
  .get(E.plan, zQuery(WeekQuery), async (c) => {
    const week = resolveWeek(ctx(c), query(c, WeekQuery).week);
    return c.json(await c.get('container').resolve(PlanService).get(ctx(c), week));
  })
  .put(E.plan, idempotent, zJson(SavePlanRequest), async (c) =>
    c.json(await c.get('container').resolve(PlanService).save(ctx(c), body(c, SavePlanRequest))),
  );
