import type { MiddlewareHandler } from 'hono';
import { createAuth } from '../../infrastructure/auth/better-auth';
import { createRequestContainer, type ContainerOverrides } from '../../infrastructure/di/container';
import type { AppBindings } from '../types';

/**
 * Builds the per-request DI container and the per-request Better Auth instance.
 *
 * The auth instance takes its base URL from the REQUEST origin (`new URL(c.req.url).origin`), which is
 * why there is no `BASE_URL` var anywhere: localhost, `*.workers.dev` and versioned preview URLs all
 * work unchanged.
 */
export const withContainer =
  (overrides?: ContainerOverrides): MiddlewareHandler<AppBindings> =>
  async (c, next) => {
    const container = createRequestContainer(c.env, overrides);
    c.set('container', container);
    c.set('auth', createAuth(c.env, container, new URL(c.req.url).origin));
    c.set('validated', {});
    await next();
  };
