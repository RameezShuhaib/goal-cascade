import { ChangePasswordRequest, ENDPOINTS as E, PatchPreferencesRequest } from '@goal-cascade/shared';
import { APIError } from 'better-auth/api';
import { Hono } from 'hono';
import { MeService } from '../../application/services';
import { DomainError } from '../../domain/errors';
import { idempotent } from '../middleware/idempotency';
import { ctx, type AppBindings } from '../types';
import { body, zJson } from '../validate';

/**
 * `/me`, `/me/preferences`, `/me/change-password`. No `/me/membership`, no pending-invite list: this
 * product is single-user (R-auth-1), so the session gate is the user plus their preferences and nothing
 * else.
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
  });
