import {
  ChangePasswordRequest,
  CreateApiTokenRequest,
  ENDPOINTS as E,
  MCP_PATH,
  NoQuery,
  PatchPreferencesRequest,
} from '@goal-cascade/shared';
import { APIError } from 'better-auth/api';
import { Hono } from 'hono';
import { ApiTokenService, MeService } from '../../application/services';
import { DomainError } from '../../domain/errors';
import { idempotent } from '../middleware/idempotency';
import { ctx, type AppBindings, type AppContext } from '../types';
import { body, zJson, zQuery } from '../validate';

/**
 * The MCP endpoint the owner pastes into their agent, derived from the REQUEST ORIGIN.
 *
 * Never a var and never a literal. `goals.rameezshuhaib.com` is a dashboard-managed custom domain (see
 * `wrangler.jsonc`), `goal-cascade-api.me8468.workers.dev` still resolves, `wrangler dev` is localhost,
 * and every versioned preview gets its own hostname — a hardcoded URL would be wrong on three of those
 * four. This is exactly how `better-auth.ts` derives `baseURL`, for exactly the same reason.
 */
const mcpUrl = (c: AppContext): string => `${new URL(c.req.url).origin}${MCP_PATH}`;

/**
 * `/me`, `/me/preferences`, `/me/change-password`, `/me/api-token`. No `/me/membership`, no
 * pending-invite list: this product is single-user (R-auth-1), so the session gate is the user plus their
 * preferences, their password and their one agent token — and nothing else.
 */
export const meRoutes = new Hono<AppBindings>()
  .get(E.me, async (c) => c.json(await c.get('container').resolve(MeService).getMe(ctx(c))))
  .get(E.mePreferences, async (c) => c.json(await c.get('container').resolve(MeService).getPreferences(ctx(c))))
  .patch(E.mePreferences, zJson(PatchPreferencesRequest), async (c) =>
    c.json(await c.get('container').resolve(MeService).patchPreferences(ctx(c), body(c, PatchPreferencesRequest))),
  )

  /**
   * The lockout guard.
   *
   * This deployment CANNOT send mail — by construction, not by configuration (see
   * `infrastructure/email/`, `wrangler.jsonc`, and `tests/security/no-real-email.test.ts`). The owner's
   * address is on a registrable domain, and `LogEmailSender` stores a body only for addresses matching
   * `E2E_EMAIL_PATTERN`, which is itself restricted to non-registrable domains so that
   * `GET /internal/outbox` can never become an account-takeover oracle. The consequence is that
   * "forgot password" cannot complete for the real account: the reset mail is generated, has nowhere to
   * go, and its token is stored hashed.
   *
   * So THIS is the recovery path, and it is the one that must always work: change the password while
   * still signed in. `currentPassword` is required — a live session on a borrowed laptop must not be
   * enough to re-key the account — and other sessions are revoked by default, because the usual reason
   * to change a password is that some other session should stop working.
   *
   * Better Auth owns the password hashing and the session revocation; this handler only translates. The
   * `Set-Cookie` it returns re-issues THIS session, so the caller stays signed in after the revocation.
   */
  .post(E.meChangePassword, idempotent, zJson(ChangePasswordRequest), async (c) => {
    const input = body(c, ChangePasswordRequest);
    let result: { headers: Headers };
    try {
      result = await c.get('auth').api.changePassword({
        body: {
          currentPassword: input.currentPassword,
          newPassword: input.newPassword,
          revokeOtherSessions: input.revokeOtherSessions,
        },
        headers: c.req.raw.headers,
        returnHeaders: true,
      });
    } catch (err) {
      // A wrong current password is Better Auth's `INVALID_PASSWORD` (400). It is a refusal, not a bug,
      // and it must read the same whatever the reason, so it never becomes a password oracle.
      if (err instanceof APIError) {
        throw new DomainError('VALIDATION_FAILED', 'the current password is not correct');
      }
      throw err;
    }

    for (const cookie of result.headers.getSetCookie?.() ?? []) c.header('Set-Cookie', cookie, { append: true });
    return c.json({
      changed: true as const,
      revokedOtherSessions: input.revokeOtherSessions,
      serverNow: ctx(c).now,
    });
  })

  // ── Agent access: the ONE static bearer token behind `POST /mcp` ─────────────────────────────────
  //
  // This token is the most powerful credential in the product. It bypasses Better Auth completely, has
  // no expiry, and every MCP tool runs as the owner with full read and write access to the whole
  // account. Three properties follow, and all three are enforced below rather than documented:
  //
  //  1. The plaintext is returned EXACTLY ONCE, at creation. Only a SHA-256 hash and `last4` are
  //     stored, so a D1 export contains no live key (`schema.ts#apiTokens`).
  //  2. Creating REPLACES. There is no list, no `:id`, and no state with two live tokens.
  //  3. Creating requires the current password — a live session on a borrowed laptop must not be
  //     enough to mint a permanent key, the same reasoning already recorded on `change-password`.
  //     READING the status does not, because it reveals nothing secret.

  /** Status. No password: `{ createdAt, last4 }` or `null`, plus the URL — never the token. */
  .get(E.meApiToken, zQuery(NoQuery), async (c) =>
    c.json({
      token: await c.get('container').resolve(ApiTokenService).status(ctx(c)),
      mcpUrl: mcpUrl(c),
      serverNow: ctx(c).now,
    }),
  )

  /**
   * Create or replace. Password required; the plaintext is in this response and nowhere else, ever.
   *
   * `auth.api.verifyPassword` is Better Auth's own session-gated check — it verifies and returns
   * `{ status }` with no side effect at all. That matters: the two alternatives both write. Signing in
   * again would mint a second session row, and re-running `changePassword` with the same value would
   * re-hash the account row and revoke the caller's other sessions. Minting a token must do neither.
   *
   * A wrong password answers the SAME sentence `change-password` answers, so the pair cannot become a
   * password oracle by differing.
   */
  .post(E.meApiToken, idempotent, zJson(CreateApiTokenRequest), async (c) => {
    const input = body(c, CreateApiTokenRequest);
    let ok = false;
    try {
      ok = (await c.get('auth').api.verifyPassword({ body: { password: input.password }, headers: c.req.raw.headers }))
        .status;
    } catch (err) {
      // Better Auth answers a wrong password with an APIError. It is a refusal, not a bug.
      if (!(err instanceof APIError)) throw err;
      ok = false;
    }
    if (!ok) throw new DomainError('VALIDATION_FAILED', 'the current password is not correct');

    const token = await c.get('container').resolve(ApiTokenService).create(ctx(c));
    return c.json({ token, mcpUrl: mcpUrl(c), serverNow: ctx(c).now }, 201);
  })

  /**
   * Revoke. Idempotent, and NO password — the safe direction never needs a guard. An owner who thinks
   * their key leaked must be able to kill it with one tap, not find their password first.
   */
  .delete(E.meApiToken, async (c) => {
    await c.get('container').resolve(ApiTokenService).revoke(ctx(c));
    return c.json({ revoked: true as const, serverNow: ctx(c).now });
  });
