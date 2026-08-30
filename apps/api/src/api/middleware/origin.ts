import type { MiddlewareHandler } from 'hono';
import { DomainError } from '../../domain/errors';
import { parseTrustedOrigins } from '../../infrastructure/auth/better-auth';
import type { AppBindings } from '../types';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF. Better Auth's own origin check is registered on ITS router, so it covers only `/api/auth/*`;
 * our routes would otherwise have nothing but `SameSite=Lax` between them and a cross-site
 * `<form enctype="text/plain">` POST — and that value is a library default nothing in this repo pins.
 *
 * The rule is deliberately narrow so it cannot break a legitimate caller:
 *   - safe methods pass;
 *   - a request whose `Sec-Fetch-Site` says `cross-site` is refused (every current browser sends it, and
 *     page JS cannot set it);
 *   - an `Origin` that is present and is neither this origin nor a trusted one is refused;
 *   - a request with NEITHER header — curl, the e2e scripts, a server-to-server call — passes. Those
 *     carry no ambient cookie, so they are not the CSRF threat; refusing them would break automation for
 *     nothing.
 */
export const checkOrigin: MiddlewareHandler<AppBindings> = async (c, next) => {
  if (SAFE_METHODS.has(c.req.method)) return next();

  const site = c.req.header('Sec-Fetch-Site');
  if (site === 'cross-site') throw new DomainError('FORBIDDEN', 'cross-site requests are not allowed');

  const origin = c.req.header('Origin');
  if (origin && origin !== 'null') {
    const self = new URL(c.req.url).origin;
    if (origin !== self && !parseTrustedOrigins(c.env).includes(origin)) {
      throw new DomainError('FORBIDDEN', 'untrusted request origin');
    }
  }
  await next();
};
