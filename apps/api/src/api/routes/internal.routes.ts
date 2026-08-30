import { Hono } from 'hono';
import { IEmailOutboxRepo } from '../../application/ports';
import { DomainError } from '../../domain/errors';
import { isE2EAddress } from '../../infrastructure/email/e2e-addresses';
import { requireInternalSecret } from '../middleware/internal-secret';
import type { AppBindings } from '../types';

/**
 * Test/ops endpoints for remote e2e. Mounted at `/internal`, enabled only when `env.INTERNAL_SECRET` is
 * set (404 otherwise), and every call requires `X-Internal-Secret`.
 *
 *   GET    /internal/outbox?to=<email>  emails from the sink, newest first
 *   DELETE /internal/outbox?to=<email>  → { deleted: n }
 *
 * There is no `POST /internal/cron/run` counterpart to the reference codebase's: Goal Cascade has no
 * scheduled work at all (carrying is derived, and the one lazily-produced timeline entry happens on read).
 *
 * SECURITY. This endpoint is how the e2e agents complete a sign-up, and it returns message BODIES — so
 * it serves **test identities only**: `to` must match `E2E_EMAIL_PATTERN`, else 403, and
 * `LogEmailSender` only ever STORES mail for matching addresses, so there is nothing else in the table
 * to read. `E2E_EMAIL_PATTERN` is itself constrained to non-registrable domains, which is what stops it
 * being widened into an account-takeover oracle by a single edit. With the var unset, every `to` is
 * refused.
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
