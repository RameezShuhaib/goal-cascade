import { Hono } from 'hono';
import { IEmailOutboxRepo, IEmailSender, type OutgoingEmail } from '../../application/ports';
import { DomainError } from '../../domain/errors';
import { createAuth } from '../../infrastructure/auth/better-auth';
import { isE2EAddress } from '../../infrastructure/email/e2e-addresses';
import { requireInternalSecret } from '../middleware/internal-secret';
import type { AppBindings } from '../types';

/**
 * Test/ops endpoints for remote e2e and for account recovery. Mounted at `/internal`, enabled only when
 * `env.INTERNAL_SECRET` is set (404 otherwise), and every call requires `X-Internal-Secret`.
 *
 *   GET    /internal/outbox?to=<email>  emails from the sink, newest first
 *   DELETE /internal/outbox?to=<email>  → { deleted: n }
 *   POST   /internal/reset-link         → { resetUrl } — the break-glass cure (see below)
 *
 * There is no `POST /internal/cron/run` counterpart to the reference codebase's: Goal Cascade has no
 * scheduled work at all (carrying is derived, and the one lazily-produced timeline entry happens on read).
 *
 * SECURITY. The outbox returns message BODIES — so it serves **test identities only**: `to` must match
 * `E2E_EMAIL_PATTERN`, else 403, and `LogEmailSender` only ever STORES mail for matching addresses, so
 * there is nothing else in the table to read. `E2E_EMAIL_PATTERN` is itself constrained to
 * non-registrable domains, which is what stops it being widened into an account-takeover oracle by a
 * single edit. With the var unset, every `to` is refused.
 */
export const internalRoutes = new Hono<AppBindings>()
  .use('*', requireInternalSecret)
  .get('/outbox', async (c) => {
    const to = requireTestAddress(c.req.query('to'), c.env.E2E_EMAIL_PATTERN);
    const emails = await c.get('container').resolve<IEmailOutboxRepo>(IEmailOutboxRepo).listByTo(to, 50);
    return c.json({ emails });
  })
  .delete('/outbox', async (c) => {
    const to = requireTestAddress(c.req.query('to'), c.env.E2E_EMAIL_PATTERN);
    const deleted = await c.get('container').resolve<IEmailOutboxRepo>(IEmailOutboxRepo).deleteByTo(to);
    return c.json({ deleted });
  })

  /**
   * **The break-glass cure for a locked-out owner.**
   *
   * This deployment cannot deliver mail, and reset tokens are stored HASHED, so a genuinely forgotten
   * password had exactly one remedy before this endpoint: a five-step `wrangler d1 execute` procedure
   * that rewrote the account's email to a `.local` address, triggered a reset, read the outbox and put
   * the address back. That is a trap, not a recovery path, and it would be discovered at the worst
   * possible moment. `POST /me/change-password` is the ordinary preventative; this is the cure.
   *
   * It mints a REAL Better Auth reset token — same hashing, same 1-hour TTL, same
   * `revokeSessionsOnPasswordReset` — by running the ordinary `requestPasswordReset` flow against an email
   * sender that CAPTURES the message instead of sending it. The URL is returned in the response body and
   * nowhere else: never stored in `email_outbox` (the capture replaces the sink), never logged, never
   * emailed. The `E2E_EMAIL_PATTERN` control is untouched and is deliberately NOT widened — doing that
   * would make `GET /internal/outbox` a standing oracle for the real account, whereas this is a single
   * deliberate act that leaves no artefact behind.
   *
   * ── What this means, stated plainly ─────────────────────────────────────────────────────────────────
   * `INTERNAL_SECRET` is now an ACCOUNT-TAKEOVER CREDENTIAL for this deployment. Whoever holds it can
   * mint a password reset for any address and take the account.
   *
   * That is an acceptable trade HERE and only here, and it rests on two properties of this specific
   * product: there is exactly one account, and its owner is the sole holder of the secret. Under those
   * two facts the endpoint grants the owner nothing they do not already have, and it is strictly better
   * than the alternative — an account that is permanently unrecoverable the first time a password is
   * forgotten.
   *
   * **It would NOT be acceptable in a multi-user product**, where one operational secret would become a
   * master key to every user's account with no audit trail and no consent. If you are copying this
   * pattern, that is the property you are relying on; check that you still have it.
   *
   * Like every `/internal` route it is inert unless `INTERNAL_SECRET` is set (`requireInternalSecret`
   * answers 404), so a deployment that does not configure one has no such endpoint at all.
   *
   * The response shape is identical whether or not the address exists, so it is not an enumeration
   * oracle: an unknown address simply yields `{ resetUrl: null }` — the same 200 and the same keys.
   */
  .post('/reset-link', async (c) => {
    const input = (await c.req.json().catch(() => null)) as { email?: unknown } | null;
    const email = typeof input?.email === 'string' ? input.email.trim().toLowerCase() : '';
    if (!email) throw new DomainError('VALIDATION_FAILED', 'body field `email` is required');

    const captured: OutgoingEmail[] = [];
    const container = c.get('container').createChildContainer();
    // The ONE seam: the reset mail is captured here rather than reaching `LogEmailSender`, so this token
    // never touches `email_outbox` and never appears in a log line.
    container.registerInstance<IEmailSender>(IEmailSender, {
      send: async (mail) => {
        captured.push(mail);
      },
    });
    const auth = createAuth(c.env, container, new URL(c.req.url).origin);

    // Better Auth answers 200 for an unknown address too (it must not confirm existence); the capture
    // being empty is how we learn nothing was minted.
    await auth.api.requestPasswordReset({ body: { email }, headers: c.req.raw.headers }).catch(() => undefined);

    const resetUrl = captured[0]?.text.match(/https?:\/\/\S+/)?.[0] ?? null;
    return c.json({ resetUrl });
  });

function requireTestAddress(to: string | undefined, pattern: string | undefined): string {
  const v = to?.trim().toLowerCase();
  if (!v) throw new DomainError('VALIDATION_FAILED', 'query param `to` is required');
  if (!isE2EAddress(pattern, v)) {
    // Deliberately identical for "no pattern configured" and "address does not match": the response must
    // not reveal whether the deployment has a test-address pattern at all.
    throw new DomainError('FORBIDDEN', 'the outbox only serves addresses matching E2E_EMAIL_PATTERN');
  }
  return v;
}
