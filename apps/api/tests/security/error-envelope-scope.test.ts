import { ERROR_CODES, type ErrorCode } from '@goal-cascade/shared';
import { describe, expect, it } from 'vitest';
import { PASSWORD, createTestApp, signedInOwner, uniqueEmail } from '../helpers/app';

/**
 * REVIEW — where the error envelope applies, and where it deliberately does not.
 *
 * `packages/shared/src/errors.ts` used to claim that EVERY non-2xx from `/api/*` has the
 * `{ error: { code, message } }` shape. Two do not, and a review found them: `SIGNUP_NOT_ALLOWED` and
 * Better Auth's 429 come back FLAT, because `/api/auth/*` is Better Auth's own router — `app.on(...)`
 * returns its Response rather than throwing, so `app.onError(errorHandler)` never sees it.
 *
 * Re-wrapping those would be the wrong fix: `apps/web` talks to that router through the Better Auth
 * CLIENT SDK, which parses the flat shape, and `tests/auth.test.ts` already asserts it for
 * `MISSING_OR_NULL_ORIGIN`. So the claim was corrected instead — and this file is what makes the
 * corrected claim a checked fact rather than a second comment.
 *
 * It also replaces the reason the original slipped through: the allowlist test asserted
 * `expect(await res.text()).toMatch(/SIGNUP_NOT_ALLOWED|.../i)` — a substring match on raw text, which
 * passes for ANY shape. A substring assertion cannot see a shape change; a parse can.
 */
const t = createTestApp({ now: '2026-08-31T10:00:00.000Z' });

type Envelope = { error?: { code?: string; message?: string } };
type Flat = { code?: string; message?: string };

describe('the error envelope covers Goal Cascade’s own routes', () => {
  it('a refusal on an /api route is a well-formed envelope, with a declared code', async () => {
    const { cookie } = await signedInOwner(t);
    const res = await t.fetch('/api/goals/01J9ZQ8V2M7K3PQRSTVWXY0123', { cookie });

    expect(res.status).toBe(404);
    const body = (await res.json()) as Envelope & Flat;
    expect(Object.keys(body)).toEqual(['error']);
    expect(ERROR_CODES).toContain(body.error!.code as ErrorCode);
    expect(typeof body.error!.message).toBe('string');
    // The flat shape must NOT also be present — a client reading `body.code` here must get undefined.
    expect(body.code).toBeUndefined();
  });

  it('an unauthenticated /api read is an envelope too (R-auth-4)', async () => {
    const res = await t.fetch('/api/goals');
    expect(res.status).toBe(401);
    expect(((await res.json()) as Envelope).error?.code).toBe('UNAUTHENTICATED');
  });

  it('an /internal refusal is an envelope', async () => {
    const res = await t.fetch('/internal/outbox?to=nobody@example.com', { headers: { 'X-Internal-Secret': 'wrong' } });
    expect(res.status).toBe(403);
    expect(((await res.json()) as Envelope).error?.code).toBe('FORBIDDEN');
  });
});

describe('/api/auth/* answers in Better Auth’s OWN shape — documented, and pinned here', () => {
  it('SIGNUP_NOT_ALLOWED is FLAT: `body.code`, not `body.error.code`', async () => {
    const email = uniqueEmail('intruder');
    const res = await t.fetch('/api/auth/sign-up/email', {
      method: 'POST',
      json: { name: 'Nope', email, password: PASSWORD },
      env: { SIGNUP_ALLOWLIST: 'me@rameezshuhaib.com' },
    });

    expect(res.status).toBe(403);
    const body = (await res.json()) as Flat & Envelope;
    // Parsed, not substring-matched: this is what the old assertion could not see.
    expect(body.code).toBe('SIGNUP_NOT_ALLOWED');
    expect(typeof body.message).toBe('string');
    expect(body.error).toBeUndefined();
  });

  it('a bad sign-in is FLAT as well — the boundary is the router, not the individual refusal', async () => {
    const res = await t.fetch('/api/auth/sign-in/email', {
      method: 'POST',
      json: { email: uniqueEmail('ghost'), password: PASSWORD },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as Flat & Envelope;
    expect(typeof body.code).toBe('string');
    expect(body.error).toBeUndefined();
  });

  it('RATE_LIMITED is declared but no Goal Cascade route emits it — a client must read the status there', async () => {
    // Q-16: there is no per-owner write budget. The only limiter is Better Auth's, on its own router,
    // in its own shape. This asserts the ABSENCE that `errors.ts` now documents, so if a limiter is ever
    // added to an /api route it must either emit the code or update the note.
    const { cookie } = await signedInOwner(t);
    const codes = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const res = await t.fetch('/api/goals', { cookie });
      if (res.status !== 200) codes.add(((await res.json()) as Envelope).error?.code ?? 'flat');
    }
    expect(codes, 'a Goal Cascade route started rate-limiting; errors.ts’s note on RATE_LIMITED is now stale').toEqual(
      new Set(),
    );
  });
});
