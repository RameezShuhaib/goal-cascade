import type { MiddlewareHandler } from 'hono';
import { IClock } from '../../application/ports';
import { DomainError } from '../../domain/errors';
import type { AppBindings } from '../types';

/**
 * R-auth-4 — the Better Auth session cookie becomes `ctx`, or the request is refused. There is no public
 * or demo mode: every operation, INCLUDING every read, needs a session.
 *
 * This creates the `RequestContext`. `tz` and `currentWeekStart` are filled in by `resolveTimezone`,
 * which runs immediately after and needs the `userId` this middleware sets — hence the placeholders.
 * Nothing between the two reads them.
 */
export const requireSession: MiddlewareHandler<AppBindings> = async (c, next) => {
  const result = await c.get('auth').api.getSession({ headers: c.req.raw.headers });
  if (!result?.user) throw new DomainError('UNAUTHENTICATED', 'sign in required');
  const u = result.user;
  const clock = c.get('container').resolve<IClock>(IClock);
  c.set('ctx', {
    userId: u.id,
    user: { id: u.id, name: u.name, email: u.email, emailVerified: u.emailVerified, image: u.image ?? null },
    tz: 'UTC',
    now: clock.nowIso(),
    currentWeekStart: '',
    idempotencyKey: null,
  });
  await next();
};
