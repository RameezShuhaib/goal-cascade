import {
  AttachLearningRequest,
  CreateLearningRequest,
  ENDPOINTS as E,
  IdParams,
  LearningsQuery,
  NoQuery,
  PatchLearningRequest,
  WeekQuery,
} from '@goal-cascade/shared';
import { Hono } from 'hono';
import { BootstrapService, LearningService } from '../../application/services';
import { idempotent } from '../middleware/idempotency';
import { ctx, type AppBindings } from '../types';
import { body, params, query, zJson, zParams, zQuery } from '../validate';
import { resolveWeek } from '../week';

/**
 * Learnings. There is deliberately no convert-to-task and no attach-to-backlog: a learning is an insight
 * that might change the plan, not work (R-learning-1). The only two actions are re-tag and discard.
 */
export const learningsRoutes = new Hono<AppBindings>()
  // A validated query rather than nothing: every other list route validates its query, so `?goalId=…`
  // here was silently ACCEPTED and silently ignored — the shape of mistake a client makes once and never
  // sees. ⚠ **A2 (Q-12)** — `?limit=` joins it, so this list is capped like the other three.
  .get(E.learnings, zQuery(LearningsQuery), async (c) =>
    c.json(await c.get('container').resolve(LearningService).list(ctx(c), query(c, LearningsQuery))),
  )

  .post(E.learnings, idempotent, zJson(CreateLearningRequest), async (c) =>
    c.json(await c.get('container').resolve(LearningService).create(ctx(c), body(c, CreateLearningRequest)), 201),
  )

  /** R-learning-4 / D-23 — this is where the "changed the plan" badge becomes earnable. */
  .patch(E.learning(':id'), zParams(IdParams), zJson(PatchLearningRequest), async (c) =>
    c.json(
      await c.get('container').resolve(LearningService).patch(ctx(c), params(c, IdParams).id, body(c, PatchLearningRequest)),
    ),
  )

  .delete(E.learning(':id'), zParams(IdParams), async (c) =>
    c.json(await c.get('container').resolve(LearningService).remove(ctx(c), params(c, IdParams).id)),
  )

  .post(E.learningAttach(':id'), idempotent, zParams(IdParams), zJson(AttachLearningRequest), async (c) =>
    c.json(
      await c.get('container').resolve(LearningService).attach(ctx(c), params(c, IdParams).id, body(c, AttachLearningRequest)),
    ),
  );

/**
 * `GET /bootstrap` — everything the app needs on cold open, in ONE request (the mockup's `fetchAll`).
 * A PWA's first paint after a cold start should cost one round trip, not seven.
 */
export const bootstrapRoutes = new Hono<AppBindings>().get(E.bootstrap, zQuery(WeekQuery), async (c) => {
  const week = resolveWeek(ctx(c), query(c, WeekQuery).week);
  return c.json(await c.get('container').resolve(BootstrapService).get(ctx(c), week));
});
