import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IEmailSender } from '../src/application/ports';
import { RESET_PASSWORD_TOKEN_TTL_S } from '../src/infrastructure/auth/better-auth';
import { createEmailSender } from '../src/infrastructure/di/container';
import { createDb } from '../src/infrastructure/persistence/db';
import { verification } from '../src/infrastructure/persistence/schema';
import { INTERNAL_SECRET, PASSWORD, createTestApp, env, signUp, uniqueEmail } from './helpers/app';

const NEW_PASSWORD = 'a brand new passphrase 42';

/**
 * The full password-reset flow, end to end THROUGH THE OUTBOX — which in this product is not a test
 * convenience but the only place a link ever appears, since the Worker cannot deliver mail.
 *
 * The production email adapter (`createEmailSender` → log + `email_outbox` sink) replaces the
 * `FakeEmailSender` here, so `/internal/outbox` — the exact path the remote e2e agents use — is
 * exercised rather than bypassed.
 */
describe('password reset (sendResetPassword → email_outbox → /api/auth/reset-password)', () => {
  const t = createTestApp({
    now: '2026-08-31T10:00:00.000Z',
    overrides: (c) => c.register(IEmailSender, { useFactory: (dc) => createEmailSender(env, dc) }),
  });
  const headers = { 'X-Internal-Secret': INTERNAL_SECRET };

  const signIn = (email: string, password: string) =>
    t.fetch('/api/auth/sign-in/email', { method: 'POST', json: { email, password } });
  const outbox = async (email: string) =>
    (
      (await (await t.fetch(`/internal/outbox?to=${encodeURIComponent(email)}`, { headers })).json()) as {
        emails: Array<{ subject: string; body: string }>;
      }
    ).emails;
  const clearOutbox = (email: string) =>
    t.fetch(`/internal/outbox?to=${encodeURIComponent(email)}`, { method: 'DELETE', headers });
  const requestReset = (email: string, redirectTo = '/?reset=1') =>
    t.fetch('/api/auth/request-password-reset', { method: 'POST', json: { email, redirectTo } });
  const reset = (token: string, newPassword = NEW_PASSWORD) =>
    t.fetch('/api/auth/reset-password', { method: 'POST', json: { newPassword, token } });

  const tokenFromOutbox = async (email: string) => {
    const mails = await outbox(email);
    expect(mails[0]?.subject).toMatch(/reset your .* password/i);
    const link = mails[0]!.body.match(/https?:\/\/[^\s]+\/\?reset=1&token=([^\s&]+)/);
    expect(link, mails[0]!.body).not.toBeNull();
    // The link lands on the SPA, not on Better Auth's redirect route.
    expect(mails[0]!.body).not.toContain('/api/auth/reset-password/');
    return decodeURIComponent(link![1]!);
  };

  /**
   * `verification: { storeIdentifier: 'hashed' }` — the raw token is NOT in the database: the row is
   * keyed by base64url(SHA-256("reset-password:<token>")). Read access to D1 (a leaked API token, a
   * backup, a `wrangler d1 execute`) is therefore not account takeover. Tests hash the same way.
   */
  const storedIdentifier = async (token: string) => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`reset-password:${token}`));
    return btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  };
  const verificationRow = async (token: string) =>
    createDb(env.DB)
      .select()
      .from(verification)
      .where(eq(verification.identifier, await storedIdentifier(token)))
      .get();

  afterEach(() => vi.restoreAllMocks());

  it('request → outbox link → reset: the new password works, the old one dies, the token is single-use, old sessions are revoked', async () => {
    const email = uniqueEmail('reset');
    const { cookie: preResetCookie } = await signUp(t, email, 'Owner', { verify: false });
    expect((await t.fetch('/api/me', { cookie: preResetCookie })).status).toBe(200);
    await clearOutbox(email); // drop the sign-up verification mail

    // Nothing on the console may carry the token (LogEmailSender logs `to` + subject only).
    const logged: string[] = [];
    for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
        logged.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
      });
    }

    const before = Date.now();
    const req = await requestReset(email);
    expect(req.status, await req.clone().text()).toBe(200);
    const token = await tokenFromOutbox(email);
    expect(logged.some((line) => line.includes(token))).toBe(false);

    // The raw token is nowhere in `verification` either.
    expect(
      await createDb(env.DB).select().from(verification).where(eq(verification.identifier, `reset-password:${token}`)).get(),
    ).toBeUndefined();

    // One row, expiring RESET_PASSWORD_TOKEN_TTL_S (1h) after the request.
    const row = await verificationRow(token);
    expect(row).toBeDefined();
    const ttlMs = row!.expiresAt.getTime() - before;
    expect(ttlMs).toBeGreaterThan((RESET_PASSWORD_TOKEN_TTL_S - 30) * 1000);
    expect(ttlMs).toBeLessThan((RESET_PASSWORD_TOKEN_TTL_S + 30) * 1000);

    const ok = await reset(token);
    expect(ok.status, await ok.clone().text()).toBe(200);
    expect(await verificationRow(token)).toBeUndefined(); // consumed

    expect((await signIn(email, PASSWORD)).status).toBe(401);
    const signedIn = await signIn(email, NEW_PASSWORD);
    expect(signedIn.status, await signedIn.clone().text()).toBe(200);

    // Sessions that existed before the reset are gone — the lost-phone / stolen-password recovery path.
    expect((await t.fetch('/api/me', { cookie: preResetCookie })).status).toBe(401);

    // The token cannot be replayed.
    const again = await reset(token, 'yet another passphrase');
    expect(again.status).toBe(400);

    await clearOutbox(email);
  });

  it('an expired token is refused and the password is unchanged', async () => {
    const email = uniqueEmail('expired');
    await signUp(t, email, 'Owner', { verify: false });
    await clearOutbox(email);
    expect((await requestReset(email)).status).toBe(200);
    const token = await tokenFromOutbox(email);

    // Better Auth stamps expires_at with the real clock; rewind the row instead of waiting an hour.
    await createDb(env.DB)
      .update(verification)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(verification.identifier, await storedIdentifier(token)))
      .run();

    expect((await reset(token)).status).toBe(400);
    expect((await signIn(email, PASSWORD)).status).toBe(200);
    expect((await signIn(email, NEW_PASSWORD)).status).toBe(401);
    await clearOutbox(email);
  });

  it('an unknown address still answers 200 and sends nothing — no account enumeration', async () => {
    const email = uniqueEmail('nobody');
    expect((await requestReset(email)).status).toBe(200);
    expect(await outbox(email)).toEqual([]);
  });

  it('a foreign redirectTo is rejected before any mail is sent — the link cannot be poisoned', async () => {
    const email = uniqueEmail('poison');
    await signUp(t, email, 'Owner', { verify: false });
    await clearOutbox(email);
    expect((await requestReset(email, 'https://evil.example/?reset=1')).status).toBe(403);
    expect(await outbox(email)).toEqual([]);
  });
});

describe('/internal/outbox is not a general mail reader', () => {
  const t = createTestApp();
  const headers = { 'X-Internal-Secret': INTERNAL_SECRET };

  it('requires the secret, and answers 404 (not 403) when the deployment has none', async () => {
    expect((await t.fetch('/internal/outbox?to=x@test.goal-cascade.local')).status).toBe(403);
    expect((await t.fetch('/internal/outbox?to=x@test.goal-cascade.local', { headers: { 'X-Internal-Secret': 'wrong' } })).status).toBe(
      403,
    );
    const res = await t.app.request('/internal/outbox?to=x@test.goal-cascade.local', { headers }, { ...env, INTERNAL_SECRET: undefined });
    expect(res.status).toBe(404);
  });

  it('refuses an address outside E2E_EMAIL_PATTERN — a real account’s links are unreadable', async () => {
    const res = await t.fetch('/internal/outbox?to=me@rameezshuhaib.com', { headers });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('FORBIDDEN');
  });

  it('refuses every address when E2E_EMAIL_PATTERN is unset, and when it is widened to a registrable one', async () => {
    for (const pattern of [undefined, '*', '*@gmail.com', '*@rameezshuhaib.com']) {
      const res = await t.app.request(
        '/internal/outbox?to=x@test.goal-cascade.local',
        { headers },
        { ...env, E2E_EMAIL_PATTERN: pattern },
      );
      expect(res.status, String(pattern)).toBe(403);
    }
  });
});
