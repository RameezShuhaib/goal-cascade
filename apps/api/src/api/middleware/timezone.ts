import { HEADERS } from '@goal-cascade/shared';
import type { MiddlewareHandler } from 'hono';
import { IPreferencesRepo } from '../../application/ports';
import { isValidTimezone, weekStartOf } from '../../domain/weeks';
import type { AppBindings } from '../types';

/**
 * R-auth-5 / Q-9 — the OWNER's timezone is authoritative, and this is the one place it is resolved.
 *
 *   an account with preferences → `ctx.tz = preferences.timezone`. `X-Timezone` is IGNORED: an owner
 *                                 travelling in another zone must still get their home week, or
 *                                 `originWeekStart`, carry ages and plan editability would differ per
 *                                 device (S-auth-5-1).
 *   no preferences row yet      → a valid `X-Timezone` → 'UTC'. That is the ONLY thing the header does:
 *                                 it seeds `preferences.timezone` at sign-up provisioning.
 *
 * `currentWeekStart` is derived here, once, so every handler in the request agrees on which week "now"
 * is — including across a midnight boundary mid-request. Downstream code must read it from `ctx` rather
 * than recomputing from `Date.now()`.
 */
export const resolveTimezone: MiddlewareHandler<AppBindings> = async (c, next) => {
  const ctx = c.get('ctx');
  const prefs = await c.get('container').resolve<IPreferencesRepo>(IPreferencesRepo).get(ctx.userId);
  if (prefs) {
    ctx.tz = isValidTimezone(prefs.timezone) ? prefs.timezone : 'UTC';
  } else {
    const header = c.req.header(HEADERS.timezone)?.trim();
    ctx.tz = header && isValidTimezone(header) ? header : 'UTC';
  }
  ctx.currentWeekStart = weekStartOf(ctx.now, ctx.tz);
  await next();
};
