import { ENDPOINTS as E, PatchPreferencesRequest } from '@goal-cascade/shared';
import { Hono } from 'hono';
import { MeService } from '../../application/services';
import { ctx, type AppBindings } from '../types';
import { body, zJson } from '../validate';

/**
 * `/me` and `/me/preferences`. No `/me/membership`, no pending-invite list: this product is single-user
 * (R-auth-1), so the session gate is the user plus their preferences and nothing else.
 *
 * These are the foundation's own routes and are fully implemented — every other route below is a stub.
 */
export const meRoutes = new Hono<AppBindings>()
  .get(E.me, async (c) => c.json(await c.get('container').resolve(MeService).getMe(ctx(c))))
  .get(E.mePreferences, async (c) => c.json(await c.get('container').resolve(MeService).getPreferences(ctx(c))))
  .patch(E.mePreferences, zJson(PatchPreferencesRequest), async (c) =>
    c.json(await c.get('container').resolve(MeService).patchPreferences(ctx(c), body(c, PatchPreferencesRequest))),
  );
