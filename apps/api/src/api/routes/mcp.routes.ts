import {
  createMcpHandler,
  OAuthError,
  OAuthErrorCode,
  originValidationResponse,
  requireBearerAuth,
  type AuthInfo,
} from '@modelcontextprotocol/server';
import { APIError } from 'better-auth/api';
import { Hono } from 'hono';
import { IClock, IPreferencesRepo, IUserRepo } from '../../application/ports';
import { ApiTokenService } from '../../application/services';
import { DomainError } from '../../domain/errors';
import { isValidTimezone, weekStartOf } from '@goal-cascade/shared';
import { mcpAllowedOriginHostnames } from '../middleware/mcp-cors';
import { createMcpServer } from '../mcp/server';
import type { McpDeps } from '../mcp/shapes';
import { resolvePresentedToken } from '../mcp/token-headers';
import type { AppBindings } from '../types';

/**
 * `POST /mcp` — the Model Context Protocol endpoint.
 *
 * ── Transport ────────────────────────────────────────────────────────────────────────────────────
 * Streamable HTTP, one path, POST. There is deliberately NO `/sse`: the 2026-07-28 protocol revision
 * made MCP stateless and formally deprecated the 2024-11-05 HTTP+SSE transport, so a second endpoint
 * would be a new implementation of something new clients must not adopt. GET and DELETE answer 405,
 * which the SDK does for us. `createMcpHandler`'s `legacy` option defaults to `'stateless'`, which
 * serves 2025-era clients from the SAME factory — so one route covers both eras and we never have to
 * know which one a given client speaks.
 *
 * No Durable Object, no `agents` package, no new compatibility flags. The SDK ships a `workerd` export
 * condition that swaps in a Workers-safe JSON Schema validator (Ajv uses `eval` and cannot run here),
 * and it bundles that validator inline — so `@modelcontextprotocol/server` is the ONLY dependency this
 * feature adds.
 *
 * ── Why this route is registered BEFORE the `/api/*` chain ──────────────────────────────────────
 * `app.ts` mounts it above `app.use(\`${'${API_BASE}'}/*\`, checkOrigin, requireSession, resolveTimezone)`.
 * That is load-bearing: `requireSession` demands a Better Auth cookie, and an external agent has a
 * bearer token and no cookie jar. Moving this line below that one 401s every MCP request.
 *
 * `wrangler.jsonc` must also list `"/mcp"` in `assets.run_worker_first`, or the SPA asset router serves
 * `index.html` here and this file never executes. That failure is silent and confusing — it looks like
 * "the MCP server returns HTML" — so `tests/security/mcp-wiring.test.ts` asserts the entry exists.
 */
export const mcpRoutes = new Hono<AppBindings>().all('/', async (c) => {
  /**
   * Origin validation is OUR job here, and the SDK does not do it.
   *
   * The MCP spec says a server MUST validate `Origin` and answer 403 when it is present and invalid —
   * that is the DNS-rebinding defence. `createMcpHandler` performs no header checking of any kind
   * (its own JSDoc: "the entry performs no token verification… never derived from request headers");
   * origin/Host validation lives in Cloudflare's `agents` wrapper, which this repo does not use. So we
   * call the SDK's own primitive with this deployment's hostnames.
   *
   * A non-browser MCP client sends NO Origin at all, and `originValidationResponse` passes those
   * through — which is exactly right: the header only exists to protect a browser, and its absence is
   * not a claim about anything. `checkOrigin` (the repo's own middleware) is not applied to this path
   * because it is scoped to `/api/*`, and its "no Origin is allowed" rule is the same rule.
   *
   * **Claude web is a browser, so it DOES send an Origin**, and this check is the second half of making
   * it reachable: CORS headers on the preflight are useless if the POST that follows is then answered
   * 403 here. The allowlist and the CORS allowlist are therefore the same list — one `vars` entry,
   * `MCP_ALLOWED_ORIGINS` — because two lists that must agree eventually will not.
   */
  const self = new URL(c.req.url).hostname;
  const rejected = originValidationResponse(c.req.raw, [
    self,
    'localhost',
    '127.0.0.1',
    ...mcpAllowedOriginHostnames(c.env),
  ]);
  if (rejected) return rejected;

  const dc = c.get('container');
  const tokens = dc.resolve(ApiTokenService);

  /**
   * The auth gate.
   *
   * `requireBearerAuth` parses the header, runs the verifier, enforces scopes, and returns either an
   * `AuthInfo` or a ready-made `401`/`403` Response carrying `WWW-Authenticate: Bearer` — which is what
   * an MCP client knows how to read. We never hand-roll that response.
   *
   * **`expiresAt` is REQUIRED and the omission is silent.** Verified in the shipped runtime
   * (`@modelcontextprotocol/server@2.0.0 dist/index.mjs:1408`):
   *
   *     if (typeof authInfo.expiresAt !== "number" || Number.isNaN(authInfo.expiresAt))
   *         throw new OAuthError(OAuthErrorCode.InvalidToken, "Token has no expiration time");
   *
   * A static token has no expiry, so we synthesise a rolling one-hour value purely to satisfy that
   * check. It is a fiction, and an honest one to record: the token's real lifetime is "until the owner
   * replaces or revokes it in Agent access". Nothing downstream reads this number.
   */
  const gate = requireBearerAuth({
    verifier: {
      async verifyAccessToken(token: string): Promise<AuthInfo> {
        try {
          const userId = await tokens.resolveOwner(token);
          return {
            token,
            clientId: 'goal-cascade-agent',
            scopes: ['mcp'],
            expiresAt: Math.floor(Date.now() / 1000) + 3600,
            // The resolved owner rides along for observability. It is NOT how tools get their scope —
            // that is the closure in `createMcpServer` — because a field a handler must remember to
            // read is a field a handler can forget to read.
            extra: { userId },
          };
        } catch (err) {
          // Every refusal collapses to the same InvalidToken. A DomainError here is always
          // INVALID_API_TOKEN and its message is deliberately uninformative.
          if (err instanceof DomainError) throw new OAuthError(OAuthErrorCode.InvalidToken, 'invalid token');
          throw err;
        }
      },
    },
  });

  /**
   * Where the token is READ from, before the gate above verifies it.
   *
   * `Authorization: Bearer …` is the standard and is untouched — when no api-key-style header is
   * present, `resolvePresentedToken` hands the original request straight through. In addition, the
   * seven header names Claude web's connector UI offers are accepted as aliases carrying the raw
   * token, because that UI does not offer `Authorization` at all and the endpoint is otherwise
   * unreachable from it. See `mcp/token-headers.ts`: one resolver, one verification path, and two
   * disagreeing tokens are refused rather than silently reconciled.
   */
  const presented = resolvePresentedToken(c.req.raw);
  if (!presented.ok) return presented.response;

  const auth = await gate(presented.request);
  if (auth instanceof Response) return auth;

  /**
   * The owner context — built here, ONCE, and closed over by every tool.
   *
   * This mirrors `requireSession` + `resolveTimezone` exactly, and it must: `ctx.tz` and
   * `ctx.currentWeekStart` decide which Monday "this week" is for every week-scoped service below, and
   * a second derivation of that rule would let the MCP path and the API path disagree about what week
   * it is. `weekStartOf(now, tz)` is the same call `resolveTimezone` makes, from the same stored
   * preference — `X-Timezone` is ignored on both paths (R-auth-5).
   */
  const userId = String((auth.extra as { userId?: string }).userId ?? '');
  const user = await dc.resolve<IUserRepo>(IUserRepo).findById(userId);
  // A token whose user row vanished (deleted account) is not an authenticated request. The FK cascade
  // should make this unreachable; answering 401 rather than 500 is the safe direction if it is not.
  if (!user) throw new DomainError('INVALID_API_TOKEN', 'the agent access token is not valid');

  const clock = dc.resolve<IClock>(IClock);
  const prefs = await dc.resolve<IPreferencesRepo>(IPreferencesRepo).get(user.id);
  const tz = prefs && isValidTimezone(prefs.timezone) ? prefs.timezone : 'UTC';
  const now = clock.nowIso();
  const ctx = {
    userId: user.id,
    user: { id: user.id, name: user.name, email: user.email, emailVerified: user.emailVerified, image: user.image ?? null },
    tz,
    now,
    currentWeekStart: weekStartOf(now, tz),
    idempotencyKey: null,
  };

  const deps: McpDeps = {
    dc,
    ctx,
    /**
     * Better Auth's password change, closed over here because Better Auth is built PER REQUEST (it
     * needs the D1 binding and the origin) and an `application/` service cannot reach it.
     *
     * `changePassword` requires a session, and this path has none — an agent holds a bearer token, not
     * a cookie. So the flow is: sign in with the supplied `currentPassword` to obtain a session, change
     * the password through it, then sign that session straight back out. The consequences, all
     * deliberate:
     *
     *  - **The current password is what authorises the change, not the bearer token.** A stolen token
     *    alone cannot re-key the account, which is the one mitigation left after the owner overruled
     *    rail 2 and asked for this tool.
     *  - **A wrong password fails at the sign-in step**, and is translated into the same non-oracular
     *    sentence `POST /me/change-password` returns, so the two cannot be told apart.
     *  - **The temporary session is revoked on the way out.** `revokeOtherSessions` spares the session
     *    performing the change, so without the explicit sign-out this would leave a live session row
     *    behind that nothing holds. Signing out is not optional tidiness.
     */
    changePassword: async (currentPassword, newPassword, revokeOtherSessions) => {
      const wrongPassword = () => new DomainError('VALIDATION_FAILED', 'the current password is not correct');
      let cookie: string;
      try {
        const signedIn = await c
          .get('auth')
          .api.signInEmail({ body: { email: user.email, password: currentPassword }, returnHeaders: true });
        const set = (signedIn.headers.getSetCookie?.() ?? []).find((s) => s.includes('session_token'));
        if (!set) throw wrongPassword();
        cookie = set.split(';')[0]!;
      } catch (err) {
        if (err instanceof DomainError) throw err;
        if (err instanceof APIError) throw wrongPassword();
        throw err;
      }

      let changed: { headers: Headers };
      try {
        changed = await c.get('auth').api.changePassword({
          body: { currentPassword, newPassword, revokeOtherSessions },
          headers: new Headers({ Cookie: cookie }),
          returnHeaders: true,
        });
      } catch (err) {
        if (err instanceof APIError) throw wrongPassword();
        throw err;
      }

      // `changePassword` RE-ISSUES the cookie for the session performing the change, so the sign-out
      // must use the refreshed one when there is one. Best-effort: failing to tidy up must not mask a
      // password change that actually succeeded.
      const refreshed = (changed.headers.getSetCookie?.() ?? []).find((s) => s.includes('session_token'));
      await c
        .get('auth')
        .api.signOut({ headers: new Headers({ Cookie: refreshed ? refreshed.split(';')[0]! : cookie }) })
        .catch(() => {});
    },
  };

  const handler = createMcpHandler(() => createMcpServer(deps), {
    onerror: (err) => console.error('[mcp]', err.message),
  });
  return handler.fetch(c.req.raw, { authInfo: auth });
});
