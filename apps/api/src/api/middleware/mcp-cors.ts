import { cors } from 'hono/cors';
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../../env';
import { API_KEY_HEADERS } from '../mcp/token-headers';
import type { AppBindings } from '../types';

/**
 * CORS for `/mcp`, and ONLY for `/mcp`.
 *
 * ── Why this is separate from the app's CORS ─────────────────────────────────────────────────────
 * The `/api/*` policy guards cookie-authenticated, same-origin browser traffic: it runs with
 * `credentials: true` and a narrow origin list, and it must stay that way. `/mcp` is the opposite kind
 * of endpoint — a bearer-token API that a browser at `https://claude.ai` calls cross-origin. Widening
 * the first policy to admit the second would hand a third-party origin the owner's session cookie.
 * Two policies, one per threat model.
 *
 * ── THE security property: credentials are OFF ───────────────────────────────────────────────────
 * `Access-Control-Allow-Credentials` is never sent here, and `cors()` omits the header entirely when
 * `credentials` is unset. That is deliberate and it is the important line in this file.
 *
 * `/mcp` authenticates with a bearer token that the client puts on the request by hand. It has no use
 * for ambient credentials — and allowing them cross-origin would mean the browser attaches this
 * deployment's `__Secure-` session cookie to requests issued by an allowed third-party origin, turning
 * every page on that origin into a CSRF gun pointed at the account. There is no benefit to weigh
 * against that: a token in a header is not a cookie and never needed the permission.
 *
 * The corollary, which the spec makes an actual rule: `*` and credentials must never appear together.
 * We satisfy it by never sending credentials at all, and by reflecting only an origin we recognise —
 * never `*`, and never an arbitrary echo.
 */

/** Claude web's origins. Overridable through `vars.MCP_ALLOWED_ORIGINS` without touching this file. */
export const MCP_DEFAULT_ALLOWED_ORIGINS = 'https://claude.ai,https://claude.com';

/**
 * The allowlist, as absolute origins (`scheme://host[:port]`).
 *
 * Parsed through `URL` so a trailing slash or a stray path in the var cannot silently produce an entry
 * that never matches the `Origin` header — a mismatch here fails as "the connector will not connect",
 * with nothing in the logs about a typo. An unparseable entry is dropped rather than crashing config.
 */
export function parseMcpAllowedOrigins(env: AppEnv): string[] {
  return (env.MCP_ALLOWED_ORIGINS ?? MCP_DEFAULT_ALLOWED_ORIGINS)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap((s) => {
      try {
        return [new URL(s).origin];
      } catch {
        return [];
      }
    });
}

/** The same list as hostnames, for the SDK's `originValidationResponse` (which matches on hostname). */
export function mcpAllowedOriginHostnames(env: AppEnv): string[] {
  return parseMcpAllowedOrigins(env).map((o) => new URL(o).hostname);
}

/**
 * Every request header the MCP protocol and its clients actually send, verified against the installed
 * `@modelcontextprotocol/server@2.0.0` rather than taken on trust: `dist/index.mjs` reads exactly
 * `accept`, `authorization`, `content-type`, `host`, `origin`, `last-event-id`, `mcp-method`,
 * `mcp-name`, `mcp-protocol-version` and `mcp-session-id` off inbound requests. `host` and `origin` are
 * forbidden header names a page cannot set, so they are not listed; `last-event-id` IS listed, because
 * the SDK reads it for stream resumption and it is not on the CORS safelist.
 *
 * The seven api-key aliases ride along, because a preflight is refused for a header the response does
 * not name — and the whole point of accepting those names is that a browser gets to send one.
 */
export const MCP_ALLOWED_HEADERS = [
  'Authorization',
  'Content-Type',
  'Accept',
  'Last-Event-ID',
  'MCP-Protocol-Version',
  'Mcp-Method',
  'Mcp-Name',
  'Mcp-Session-Id',
  ...API_KEY_HEADERS,
];

/**
 * Response headers a browser client must be able to READ. Without these it can see the status line and
 * nothing else: `Mcp-Session-Id` is set on the SDK's own responses, and `WWW-Authenticate` is the
 * bearer challenge that tells a connector its token was refused rather than that the server is broken.
 */
export const MCP_EXPOSED_HEADERS = ['Mcp-Session-Id', 'WWW-Authenticate'];

/**
 * The middleware. `cors()` answers `OPTIONS` itself with `204` and the allow headers, which is the
 * preflight Claude web sends before its first POST.
 *
 * A request from an origin that is NOT on the list gets no `Access-Control-Allow-Origin` at all — not
 * an echo, not `*` — so the browser refuses the response. That is the whole enforcement: the token
 * remains the guard for non-browser callers, and `checkOrigin` stays scoped to `/api/*` exactly as
 * `app.ts` describes.
 */
export const mcpCors: MiddlewareHandler<AppBindings> = cors({
  origin: (origin, c) => {
    if (!origin) return origin;
    // This deployment's own origin, so the SPA (and any same-origin probe) is never a special case.
    const self = new URL(c.req.url).origin;
    return origin === self || parseMcpAllowedOrigins(c.env).includes(origin) ? origin : null;
  },
  // NO `credentials` key. See the header comment — its absence is the security property.
  allowHeaders: MCP_ALLOWED_HEADERS,
  allowMethods: ['POST', 'GET', 'DELETE', 'OPTIONS'],
  exposeHeaders: MCP_EXPOSED_HEADERS,
  maxAge: 600,
});
