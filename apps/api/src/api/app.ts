import 'reflect-metadata';
import { API_BASE, MCP_PATH } from '@goal-cascade/shared';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { AUTH_BASE_PATH, parseTrustedOrigins } from '../infrastructure/auth/better-auth';
import type { ContainerOverrides } from '../infrastructure/di/container';
import { requireSession } from './middleware/auth';
import { withContainer } from './middleware/container';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { idempotent } from './middleware/idempotency';
import { mcpCors } from './middleware/mcp-cors';
import { checkOrigin } from './middleware/origin';
import { resolveTimezone } from './middleware/timezone';
import { backlogRoutes } from './routes/backlog.routes';
import { bootstrapRoutes, ideasRoutes, learningsRoutes } from './routes/capture.routes';
import { goalsRoutes } from './routes/goals.routes';
import { internalRoutes } from './routes/internal.routes';
import { mcpRoutes } from './routes/mcp.routes';
import { meRoutes } from './routes/me.routes';
import { planRoutes } from './routes/plan.routes';
import { tasksRoutes } from './routes/tasks.routes';
import type { AppBindings } from './types';

export type AppOptions = {
  /** Test hook: swap ports/services in the per-request container (fakes). The ONE seam. */
  overrides?: ContainerOverrides;
};

/**
 * The Hono app factory. **Order is the contract:**
 *
 *   CORS → container/auth → public routes (health, auth, internal) → origin → session → timezone → API routes
 *
 * `checkOrigin` runs before `requireSession` because Better Auth's own origin check is registered on ITS
 * router and covers only `/api/auth/*`; without ours, `SameSite=Lax` would be the only thing between a
 * cross-site form POST and a command.
 *
 * `resolveTimezone` runs after `requireSession` because it reads the OWNER's stored timezone and derives
 * `ctx.currentWeekStart` from it (R-auth-5) — every week-scoped route downstream depends on that value
 * already being there.
 *
 * **Every API route is registered HERE, now.** Feature agents implement services, not routes. That is
 * deliberate: three agents left to design their own route shapes will design three different ones.
 */
export function createApp(options: AppOptions = {}) {
  const app = new Hono<AppBindings>();
  app.onError(errorHandler);
  app.notFound(notFoundHandler);

  /**
   * The app's own CORS: cookie-authenticated, same-origin browser traffic. It runs with
   * `credentials: true` and a narrow origin list and must STAY narrow — widening it is how a
   * third-party origin gets handed the owner's session cookie.
   *
   * In production the SPA is served by this same Worker, so this never fires for the real client. It
   * exists for `vite dev` on :5173 and for the e2e scripts.
   */
  const apiCors = cors({
    origin: (origin, c) => {
      if (!origin) return origin;
      const self = new URL(c.req.url).origin;
      return origin === self || parseTrustedOrigins(c.env).includes(origin) ? origin : null;
    },
    credentials: true,
    allowHeaders: ['Content-Type', 'Idempotency-Key', 'X-Timezone', 'X-Internal-Secret'],
    allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    exposeHeaders: ['Idempotent-Replayed'],
    maxAge: 600,
  });
  /**
   * `/mcp` is EXCLUDED from that policy and gets `mcpCors` instead (registered at the mount below).
   *
   * The two are not variations of one policy, they are two policies: `/mcp` is a bearer-token API that
   * a browser at `https://claude.ai` calls cross-origin, and it must run with credentials OFF. Letting
   * both middlewares touch the same response would mean the narrow one's `Allow-Credentials: true`
   * landing on a cross-origin MCP response, which is the one thing `mcp-cors.ts` exists to prevent.
   */
  app.use('*', (c, next) => (c.req.path === MCP_PATH ? next() : apiCors(c, next)));
  app.use('*', withContainer(options.overrides));

  // ── public ──
  app.get(`${API_BASE}/health`, (c) => c.json({ ok: true, app: c.env.APP_NAME, now: new Date().toISOString() }));
  app.on(['GET', 'POST'], `${AUTH_BASE_PATH}/*`, (c) => c.get('auth').handler(c.req.raw));
  app.route('/internal', internalRoutes);

  /**
   * The MCP endpoint, mounted HERE — above the `/api/*` chain, and that placement is the contract.
   *
   * `requireSession` demands a Better Auth cookie; an external AI agent has a static bearer token and
   * no cookie jar, so a `/mcp` that reached that middleware would 401 every request. Registering it
   * before the `app.use(\`${API_BASE}/*\`, …)` line below is what keeps `checkOrigin`, `requireSession`
   * and `resolveTimezone` off this path — `mcp.routes.ts` does all three jobs itself, with the SDK's
   * own origin primitive and its own bearer gate, and it rebuilds the same `RequestContext` (same
   * timezone rule, same `weekStartOf`) so both paths agree on which week "now" is.
   *
   * `mcpCors` is registered on this exact path, and the app's `/api/*`-shaped CORS is skipped for it
   * (see the exclusion above). It answers the `OPTIONS` preflight Claude web sends with `204` plus the
   * allow headers, reflects only an allowlisted origin, and — the point of the whole file — never
   * sends `Access-Control-Allow-Credentials`. A bearer token needs no ambient cookie, and granting one
   * cross-origin would be a CSRF surface for no benefit.
   *
   * The SPA not-found fallback never sees `/mcp` either, because this IS a registered route.
   */
  app.use(MCP_PATH, mcpCors);
  app.route(MCP_PATH, mcpRoutes);

  // ── R-auth-4: everything else under /api needs a session. Including every read. ──
  app.use(`${API_BASE}/*`, checkOrigin, requireSession, resolveTimezone);

  for (const r of [meRoutes, bootstrapRoutes, goalsRoutes, planRoutes, tasksRoutes, backlogRoutes, ideasRoutes, learningsRoutes]) {
    app.route(API_BASE, r);
  }

  return app;
}

export type App = ReturnType<typeof createApp>;
export { idempotent };
