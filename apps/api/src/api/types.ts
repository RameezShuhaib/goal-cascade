import type { Context } from 'hono';
import type { DependencyContainer } from 'tsyringe';
import type { RequestContext } from '../application/context';
import type { AppEnv } from '../env';
import type { Auth } from '../infrastructure/auth/better-auth';

export type AppBindings = {
  Bindings: AppEnv;
  Variables: {
    container: DependencyContainer;
    auth: Auth;
    ctx: RequestContext;
    validated: { body?: unknown; query?: unknown; params?: unknown };
  };
};

export type AppContext = Context<AppBindings>;

/**
 * The request context for every session route. There is no `tenantCtx` counterpart: Goal Cascade is
 * single-user (R-auth-1), so `ctx.userId` is the one and only scope.
 */
export const ctx = (c: AppContext): RequestContext => c.get('ctx');
