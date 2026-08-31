import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { IEmailSender } from '../src/application/ports';
import { createEmailSender } from '../src/infrastructure/di/container';
import { createDb } from '../src/infrastructure/persistence/db';
import { emailOutbox } from '../src/infrastructure/persistence/schema';
import { INTERNAL_SECRET, PASSWORD, createTestApp, env, registrableEmail, signUp, uniqueEmail } from './helpers/app';

/**
 * Account recovery for an account that CANNOT receive mail.
 *
 * This Worker has no way to deliver email, by construction. `LogEmailSender` stores a message body only
 * for addresses matching `E2E_EMAIL_PATTERN`, which is itself restricted to non-registrable domains so
 * `GET /internal/outbox` can never become a standing oracle for the real account. Reset tokens are
 * stored hashed. Together those mean "forgot password" has no completion for the owner's real address.
 *
 * Two endpoints close that trap, and this file is the proof that both work:
 *   POST /api/me/change-password  — the ordinary preventative, while still signed in
 *   POST /internal/reset-link     — the break-glass cure, behind `INTERNAL_SECRET`
 */
const NEW_PASSWORD = 'a brand new passphrase 42';
const db = createDb(env.DB);

/** The PRODUCTION email adapter, not the fake: the reset-link tests must see the real sink behaviour. */
const app = () =>
  createTestApp({
    now: '2026-08-31T10:00:00.000Z',
    overrides: (c) => c.register(IEmailSender, { useFactory: (dc) => createEmailSender(env, dc) }),
  });

/** The ordinary harness, whose `FakeEmailSender` lets `signUp` complete email verification. */
const plainApp = () => createTestApp({ now: '2026-08-31T10:00:00.000Z' });

describe('POST /me/change-password — the lockout guard', () => {
  it('changes the password: the old one stops working and the new one signs in', async () => {
    const t = plainApp();
    const { cookie, email } = await signUp(t, uniqueEmail('owner'));

    const res = await t.fetch('/api/me/change-password', {
      method: 'POST',
      cookie,
      idempotencyKey: crypto.randomUUID(),
      json: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
    });
    expect(res.status).toBe(200);
    expect((await res.json()) as unknown).toMatchObject({ changed: true, revokedOtherSessions: true });

    const signIn = (password: string) => t.fetch('/api/auth/sign-in/email', { method: 'POST', json: { email, password } });
    expect((await signIn(PASSWORD)).status).toBe(401);
    expect((await signIn(NEW_PASSWORD)).status).toBe(200);
  });

  it('the WRONG current password is refused, and the password is unchanged', async () => {
    const t = plainApp();
    const { cookie, email } = await signUp(t, uniqueEmail('owner'));

    const res = await t.fetch('/api/me/change-password', {
      method: 'POST',
      cookie,
      idempotencyKey: crypto.randomUUID(),
      json: { currentPassword: 'not the password', newPassword: NEW_PASSWORD },
    });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');

    const signIn = (password: string) => t.fetch('/api/auth/sign-in/email', { method: 'POST', json: { email, password } });
    expect((await signIn(PASSWORD)).status).toBe(200); // still the old one
    expect((await signIn(NEW_PASSWORD)).status).toBe(401);
  });

  it('OTHER sessions are revoked, and the session that made the change survives', async () => {
    const t = plainApp();
    const { cookie: first, email } = await signUp(t, uniqueEmail('owner'));
    // A second device signs in.
    const secondRes = await t.fetch('/api/auth/sign-in/email', { method: 'POST', json: { email, password: PASSWORD } });
    const second = secondRes.headers.getSetCookie().find((x) => x.includes('session_token'))!.split(';')[0]!;
    expect((await t.fetch('/api/me', { cookie: second })).status).toBe(200);

    const res = await t.fetch('/api/me/change-password', {
      method: 'POST',
      cookie: first,
      idempotencyKey: crypto.randomUUID(),
      json: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
    });
    expect(res.status).toBe(200);

    // The other device is signed out…
    expect((await t.fetch('/api/me', { cookie: second })).status).toBe(401);
    // …and this one is not: the handler forwards Better Auth's re-issued session cookie.
    const refreshed = res.headers.getSetCookie().find((x) => x.includes('session_token'));
    const stillIn = refreshed ? refreshed.split(';')[0]! : first;
    expect((await t.fetch('/api/me', { cookie: stillIn })).status).toBe(200);
  });

  it('`revokeOtherSessions: false` leaves the other device signed in', async () => {
    const t = plainApp();
    const { cookie: first, email } = await signUp(t, uniqueEmail('owner'));
    const secondRes = await t.fetch('/api/auth/sign-in/email', { method: 'POST', json: { email, password: PASSWORD } });
    const second = secondRes.headers.getSetCookie().find((x) => x.includes('session_token'))!.split(';')[0]!;

    const res = await t.fetch('/api/me/change-password', {
      method: 'POST',
      cookie: first,
      idempotencyKey: crypto.randomUUID(),
      json: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD, revokeOtherSessions: false },
    });
    expect(res.status).toBe(200);
    expect((await res.json()) as unknown).toMatchObject({ revokedOtherSessions: false });
    expect((await t.fetch('/api/me', { cookie: second })).status).toBe(200);
  });

  it('R-auth-4 — it is session-gated, strict, and idempotency-wrapped like every other command', async () => {
    const t = plainApp();
    const { cookie } = await signUp(t, uniqueEmail('owner'));
    const call = (init: Record<string, unknown>) => t.fetch('/api/me/change-password', { method: 'POST', ...init });

    expect(
      (await call({ idempotencyKey: crypto.randomUUID(), json: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD } }))
        .status,
    ).toBe(401); // no cookie

    expect((await call({ cookie, json: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD } })).status).toBe(400); // no key

    const unknownKey = await call({
      cookie,
      idempotencyKey: crypto.randomUUID(),
      json: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD, __x: 1 },
    });
    expect(unknownKey.status).toBe(422);

    const tooShort = await call({
      cookie,
      idempotencyKey: crypto.randomUUID(),
      json: { currentPassword: PASSWORD, newPassword: 'short' },
    });
    expect(tooShort.status).toBe(422);
  });
});

describe('POST /internal/reset-link — the break-glass cure', () => {
  const headers = { 'X-Internal-Secret': INTERNAL_SECRET };

  it('the returned token completes a real reset, end to end, for an address that can never receive mail', async () => {
    const t = app();
    // A REGISTRABLE address: it does not match E2E_EMAIL_PATTERN, so nothing is ever written to the
    // outbox for it. This is the owner's situation exactly.
    const email = registrableEmail('owner');
    await signUp(t, email, 'Owner', { verify: false, allowlist: email });

    const res = await t.fetch('/internal/reset-link', { method: 'POST', headers, json: { email } });
    expect(res.status).toBe(200);
    const { resetUrl } = (await res.json()) as { resetUrl: string | null };
    expect(resetUrl).toMatch(/\/\?reset=1&token=/);

    const token = decodeURIComponent(new URL(resetUrl!).searchParams.get('token')!);
    const done = await t.fetch('/api/auth/reset-password', { method: 'POST', json: { newPassword: NEW_PASSWORD, token } });
    expect(done.status).toBe(200);

    const signIn = (password: string) => t.fetch('/api/auth/sign-in/email', { method: 'POST', json: { email, password } });
    expect((await signIn(NEW_PASSWORD)).status).toBe(200);
    expect((await signIn(PASSWORD)).status).toBe(401);
  });

  it('the link is returned ONLY in the response: nothing is written to the outbox', async () => {
    const t = app();
    const email = registrableEmail('owner');
    await signUp(t, email, 'Owner', { verify: false, allowlist: email });

    const before = await db.select().from(emailOutbox).where(eq(emailOutbox.to, email)).all();
    expect((await t.fetch('/internal/reset-link', { method: 'POST', headers, json: { email } })).status).toBe(200);
    const after = await db.select().from(emailOutbox).where(eq(emailOutbox.to, email)).all();

    expect(after.length).toBe(before.length);
    // …and the outbox still refuses this address outright, so the E2E control is untouched.
    const outbox = await t.fetch(`/internal/outbox?to=${encodeURIComponent(email)}`, { headers });
    expect(outbox.status).toBe(403);
  });

  it('it is refused without the secret, and with the wrong secret', async () => {
    const t = app();
    const email = registrableEmail('owner');
    await signUp(t, email, 'Owner', { verify: false, allowlist: email });

    expect((await t.fetch('/internal/reset-link', { method: 'POST', json: { email } })).status).toBe(403);
    expect(
      (await t.fetch('/internal/reset-link', { method: 'POST', headers: { 'X-Internal-Secret': 'wrong' }, json: { email } }))
        .status,
    ).toBe(403);
  });

  it('with INTERNAL_SECRET unset the endpoint does not exist at all', async () => {
    const t = app();
    const email = registrableEmail('owner');
    await signUp(t, email, 'Owner', { verify: false, allowlist: email });

    const res = await t.fetch('/internal/reset-link', {
      method: 'POST',
      headers,
      json: { email },
      env: { INTERNAL_SECRET: undefined },
    });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { message: string } }).error.message).toBe('route not found');
  });

  it('it does not leak whether an address exists: the same 200 and the same keys either way', async () => {
    const t = app();
    const known = registrableEmail('owner');
    await signUp(t, known, 'Owner', { verify: false, allowlist: known });
    const unknown = registrableEmail('nobody');

    const a = await t.fetch('/internal/reset-link', { method: 'POST', headers, json: { email: known } });
    const b = await t.fetch('/internal/reset-link', { method: 'POST', headers, json: { email: unknown } });

    expect([a.status, b.status]).toEqual([200, 200]);
    const bodyA = (await a.json()) as Record<string, unknown>;
    const bodyB = (await b.json()) as Record<string, unknown>;
    expect(Object.keys(bodyA).sort()).toEqual(Object.keys(bodyB).sort());
    expect(typeof bodyA.resetUrl).toBe('string');
    expect(bodyB.resetUrl).toBeNull();
  });

  it('a missing `email` is a validation error, not a silent null', async () => {
    const t = app();
    const res = await t.fetch('/internal/reset-link', { method: 'POST', headers, json: {} });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
  });
});
