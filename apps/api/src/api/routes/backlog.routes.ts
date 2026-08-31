import {
  ConvertBacklogItemRequest,
  CreateBacklogItemRequest,
  ENDPOINTS as E,
  BacklogQuery,
  IdParams,
  MoveBacklogItemRequest,
  PatchBacklogItemRequest,
  ReorderBacklogItemRequest,
} from '@goal-cascade/shared';
import { Hono } from 'hono';
import { BacklogService } from '../../application/services';
import { idempotent } from '../middleware/idempotency';
import { ctx, type AppBindings } from '../types';
import { body, params, query, zJson, zParams, zQuery } from '../validate';

/**
 * The backlog. Note what is NOT here: no `?week=`. A backlog item is deferred work attached to a goal
 * and to NO week (R-backlog-2) — that is the whole difference between it and a task, and the endpoint
 * shape says so.
 *
 * `convert-to-task` is idempotency-wrapped like every command, which is the outer half of Q-4: a retried
 * request replays the original response. The inner half — a genuinely second conversion attempt — is
 * refused by the guarded `status = 'open'` update in `IBacklogRepo.markConvertedGuardedStmt`.
 */
export const backlogRoutes = new Hono<AppBindings>()
  .get(E.backlog, zQuery(BacklogQuery), async (c) =>
    c.json(await c.get('container').resolve(BacklogService).list(ctx(c), query(c, BacklogQuery))),
  )

  .post(E.backlog, idempotent, zJson(CreateBacklogItemRequest), async (c) =>
    c.json(await c.get('container').resolve(BacklogService).create(ctx(c), body(c, CreateBacklogItemRequest)), 201),
  )

  .patch(E.backlogItem(':id'), zParams(IdParams), zJson(PatchBacklogItemRequest), async (c) =>
    c.json(
      await c.get('container').resolve(BacklogService).patch(ctx(c), params(c, IdParams).id, body(c, PatchBacklogItemRequest)),
    ),
  )

  .post(E.backlogItemMove(':id'), idempotent, zParams(IdParams), zJson(MoveBacklogItemRequest), async (c) =>
    c.json(
      await c.get('container').resolve(BacklogService).move(ctx(c), params(c, IdParams).id, body(c, MoveBacklogItemRequest)),
    ),
  )

  /**
   * ⚠ **A1, new (R-backlog-19)** — the manual order, as one RELATIVE move within the item's own goal.
   *
   * Idempotency-wrapped like every command, and for a reason this route feels more than most: a reorder is
   * the write a flaky connection retries, and replaying the original response is what stops a retried
   * "move down one" from becoming "move down two".
   */
  .post(E.backlogItemReorder(':id'), idempotent, zParams(IdParams), zJson(ReorderBacklogItemRequest), async (c) =>
    c.json(
      await c
        .get('container')
        .resolve(BacklogService)
        .reorder(ctx(c), params(c, IdParams).id, body(c, ReorderBacklogItemRequest)),
    ),
  )

  .delete(E.backlogItem(':id'), zParams(IdParams), async (c) =>
    c.json(await c.get('container').resolve(BacklogService).remove(ctx(c), params(c, IdParams).id)),
  )

  /** R-backlog-6 — the only way backlog becomes work. Converted, never duplicated (D-19). */
  .post(E.backlogItemConvert(':id'), idempotent, zParams(IdParams), zJson(ConvertBacklogItemRequest), async (c) =>
    c.json(
      await c
        .get('container')
        .resolve(BacklogService)
        .convert(ctx(c), params(c, IdParams).id, body(c, ConvertBacklogItemRequest)),
      201,
    ),
  );
