import {
  AttachIdeaRequest,
  AttachLearningRequest,
  ConvertIdeaRequest,
  CreateIdeaRequest,
  CreateLearningRequest,
  ENDPOINTS as E,
  IdParams,
  PatchLearningRequest,
  WeekQuery,
} from '@goal-cascade/shared';
import { Hono } from 'hono';
import { BootstrapService, IdeaService, LearningService } from '../../application/services';
import { idempotent } from '../middleware/idempotency';
import { ctx, type AppBindings } from '../types';
import { body, params, query, zJson, zParams, zQuery } from '../validate';
import { resolveWeek } from '../week';

/**
 * Ideas — the parking lot. Capture is two seconds of typing, so `POST /ideas` takes a text and an
 * optional LIFE-goal tag and nothing else (R-idea-1/2).
 *
 * `attach` and `convert-to-task` each consume the idea in the SAME transaction as what they create
 * (R-idea-4/5, D-22): the mockup deleted the idea before the create modal was saved, so cancelling lost
 * it permanently in the one feature whose promise is "capture it and get back to work".
 */
export const ideasRoutes = new Hono<AppBindings>()
  .get(E.ideas, async (c) => c.json(await c.get('container').resolve(IdeaService).list(ctx(c))))

  .post(E.ideas, idempotent, zJson(CreateIdeaRequest), async (c) =>
    c.json(await c.get('container').resolve(IdeaService).create(ctx(c), body(c, CreateIdeaRequest)), 201),
  )

  .delete(E.idea(':id'), zParams(IdParams), async (c) =>
    c.json(await c.get('container').resolve(IdeaService).remove(ctx(c), params(c, IdParams).id)),
  )

  .post(E.ideaAttach(':id'), idempotent, zParams(IdParams), zJson(AttachIdeaRequest), async (c) =>
    c.json(await c.get('container').resolve(IdeaService).attach(ctx(c), params(c, IdParams).id, body(c, AttachIdeaRequest))),
  )

  .post(E.ideaConvert(':id'), idempotent, zParams(IdParams), zJson(ConvertIdeaRequest), async (c) =>
    c.json(await c.get('container').resolve(IdeaService).convert(ctx(c), params(c, IdParams).id, body(c, ConvertIdeaRequest)), 201),
  );

/**
 * Learnings. There is deliberately no convert-to-task and no attach-to-backlog: a learning is an insight
 * that might change the plan, not work (R-learning-1). The only two actions are re-tag and discard.
 */
export const learningsRoutes = new Hono<AppBindings>()
  .get(E.learnings, async (c) => c.json(await c.get('container').resolve(LearningService).list(ctx(c))))

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
