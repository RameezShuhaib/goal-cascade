/**
 * Worker bindings + config. Vars come from `wrangler.jsonc` → `vars`; secrets from `wrangler secret put`
 * (production) or `apps/api/.dev.vars` (local dev; vitest also loads it, plus the `miniflare.bindings`
 * block in `vitest.config.ts`).
 *
 * Note what is NOT here: no `EMAIL` / `send_email` binding, no `RESEND_API_KEY`, no `BASE_URL`. The first
 * two are a deliberate product decision (see `wrangler.jsonc` and `infrastructure/email/`); the third is
 * derived from the incoming request origin so localhost, workers.dev and preview URLs need no config.
 */
export type AppEnv = {
  /** D1 `goal-cascade-db` (wrangler.jsonc → d1_databases). */
  DB: D1Database;
  /** Static assets — the SPA build at `apps/web/dist`. Absent in unit tests built without the binding. */
  ASSETS?: Fetcher;

  // ── vars (wrangler.jsonc) ──
  /** Display name used in email copy and `GET /api/health`. */
  APP_NAME: string;
  /** Comma-separated extra origins for CORS + Better Auth `trustedOrigins`. The request origin is always trusted. */
  TRUSTED_ORIGINS?: string;
  /**
   * `Name <address>` used as the `from` of transactional mail. Goal Cascade's value is on a
   * non-registrable `.local` domain on purpose — nothing in this Worker can deliver mail, so this is
   * only ever a header on a message that lands in `email_outbox`.
   */
  EMAIL_FROM?: string;
  /**
   * Comma-separated glob patterns (`*` = any run of characters) matched against the LOWERCASED recipient.
   * Unset/empty matches nothing, which is the safe default:
   *   - `email_outbox` stores a message ONLY when its recipient matches, so a real address is never persisted;
   *   - `GET/DELETE /internal/outbox?to=` answers 403 for any address that does not match.
   * A pattern whose domain is registrable is ignored with a loud error (`parseE2EEmailPatterns`).
   */
  E2E_EMAIL_PATTERN?: string;
  /**
   * Comma-separated list of the EXACT email addresses allowed to register, compared trimmed + lowercased.
   * Goal Cascade is single-user: production holds one address. Unset or empty means "refuse every
   * sign-up" — never "allow everything". Enforced in `databaseHooks.user.create.before` so a refused
   * sign-up creates no `user` row at all.
   */
  SIGNUP_ALLOWLIST?: string;
  /** `off` disables Better Auth's rate limiter (tests only). Anything else, including unset, = enabled. */
  AUTH_RATE_LIMIT?: string;
  /**
   * Comma-separated browser origins allowed to call `/mcp` cross-origin — Claude web and anything like
   * it. Unset falls back to `MCP_DEFAULT_ALLOWED_ORIGINS` (`https://claude.ai,https://claude.com`), so
   * the connector works out of the box and the list is still changeable without a code edit.
   *
   * SEPARATE from `TRUSTED_ORIGINS` on purpose. That one admits an origin to the cookie-authenticated
   * `/api/*` surface, which runs with `Access-Control-Allow-Credentials: true`. This one admits an
   * origin to a bearer-token endpoint that never sends credentials at all (`middleware/mcp-cors.ts`).
   * One list would mean granting the second privilege every time you meant to grant the first.
   */
  MCP_ALLOWED_ORIGINS?: string;

  // ── secrets (`wrangler secret put` / .dev.vars) ──
  /** Signing key for Better Auth sessions and tokens. Required; the Worker cannot serve auth without it. */
  BETTER_AUTH_SECRET: string;
  /** When set, enables `/internal/*` (each call guarded by `X-Internal-Secret`). Unset → those routes 404. */
  INTERNAL_SECRET?: string;
};
