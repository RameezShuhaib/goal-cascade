import 'reflect-metadata';
import { env as testEnv } from 'cloudflare:test';
import type { DependencyContainer } from 'tsyringe';
import { createApp, type App } from '../../src/api/app';
import { IClock, IEmailSender } from '../../src/application/ports';
import type { AppEnv } from '../../src/env';
import { createRequestContainer, type ContainerOverrides } from '../../src/infrastructure/di/container';
import { UlidGenerator } from '../../src/infrastructure/ids/ulid';
import { FakeClock, FakeEmailSender } from './fakes';

export const env = testEnv as unknown as AppEnv;
export const INTERNAL_SECRET = env.INTERNAL_SECRET ?? 'test-internal-secret';
export const PASSWORD = 'correct horse battery staple';

export const ids = new UlidGenerator();

export type FetchInit = RequestInit & {
  cookie?: string;
  json?: unknown;
  idempotencyKey?: string;
  /** Per-request env overrides — `app.request(path, init, env)`. Used for the sign-up allowlist. */
  env?: Partial<AppEnv>;
};

export type TestApp = {
  app: App;
  clock: FakeClock;
  email: FakeEmailSender;
  /** A container with the same fakes, for direct repo access in tests. */
  container: () => DependencyContainer;
  fetch: (path: string, init?: FetchInit) => Promise<Response>;
};

/**
 * The real Hono app over the test D1, with `FakeClock` and `FakeEmailSender` swapped in through the ONE
 * seam (`ContainerOverrides`). Almost every test here is an HTTP-level test against the real router,
 * real middleware and real SQL — with time and side effects under control. That is a much better ratio
 * than mocking repositories.
 */
export function createTestApp(opts: { now?: string; overrides?: ContainerOverrides } = {}): TestApp {
  const clock = new FakeClock(opts.now);
  const email = new FakeEmailSender();
  const overrides = (c: DependencyContainer) => {
    c.registerInstance(IClock, clock);
    c.registerInstance(IEmailSender, email);
    opts.overrides?.(c);
  };
  const app = createApp({ overrides });
  return {
    app,
    clock,
    email,
    container: () => createRequestContainer(env, overrides),
    fetch: (path, init = {}) => {
      const headers = new Headers(init.headers);
      if (init.cookie) headers.set('Cookie', init.cookie);
      if (init.idempotencyKey) headers.set('Idempotency-Key', init.idempotencyKey);
      let body = init.body;
      if (init.json !== undefined) {
        headers.set('Content-Type', 'application/json');
        body = JSON.stringify(init.json);
      }
      return Promise.resolve(app.request(path, { ...init, headers, body }, { ...env, ...init.env }));
    },
  };
}

export function sessionCookie(res: Response): string {
  const cookies = res.headers.getSetCookie?.() ?? [];
  const pairs = cookies.map((c) => c.split(';')[0]!).filter((p) => p.includes('session_token'));
  if (pairs.length === 0) throw new Error(`no session cookie in response (${res.status}): ${cookies.join(' | ')}`);
  return pairs.join('; ');
}

/**
 * A **sink** identity: `.local` is non-registrable, so it matches `E2E_EMAIL_PATTERN`, is written to
 * `email_outbox`, and could never be delivered to even if this Worker had a way to deliver mail.
 */
export function uniqueEmail(prefix = 'user'): string {
  return `${prefix}-${crypto.randomUUID()}@test.goal-cascade.local`;
}

/**
 * An address on a REGISTRABLE domain, for the drift tests. Nothing is ever sent to it: the suite has no
 * mail adapter, no binding, and `tests/setup/no-real-email.ts` blocks outbound `fetch` outright. The
 * domain is a placeholder this project does not own and never contacts.
 */
export function registrableEmail(prefix = 'owner'): string {
  return `${prefix}-${crypto.randomUUID()}@delivery-check.goal-cascade-tests.com`;
}

/**
 * Signs up through Better Auth, completes email verification from the captured message, and returns the
 * session cookie plus ids.
 *
 * R-auth-1 — sign-up is allowlisted, and the suite's default `SIGNUP_ALLOWLIST` is EMPTY (the safe
 * default, asserted by `tests/security/signup-allowlist.test.ts`). So this helper widens it to the ONE
 * address it is registering, per request. Every green test in the suite is therefore also a proof that
 * exact-address matching works.
 */
export async function signUp(
  t: TestApp,
  email = uniqueEmail(),
  name = 'Owner',
  opts: { verify?: boolean; timezone?: string; allowlist?: string } = {},
) {
  const allowlist = opts.allowlist ?? email;
  const res = await t.fetch('/api/auth/sign-up/email', {
    method: 'POST',
    json: { name, email, password: PASSWORD },
    headers: opts.timezone ? { 'X-Timezone': opts.timezone } : {},
    env: { SIGNUP_ALLOWLIST: allowlist },
  });
  if (res.status !== 200) throw new Error(`sign-up failed ${res.status}: ${await res.text()}`);
  let cookie = sessionCookie(res);
  const signup = (await res.json()) as { user: { id: string } };

  if (opts.verify !== false) {
    const mail = t.email.lastTo(email);
    if (!mail) throw new Error('no verification email captured');
    const url = mail.text.match(/https?:\/\/\S+/)?.[0];
    if (!url) throw new Error('no verification url in email');
    const target = new URL(url);
    const v = await t.fetch(target.pathname + target.search, { method: 'GET', cookie, redirect: 'manual' });
    if (v.status >= 400) throw new Error(`verify-email failed ${v.status}: ${await v.text()}`);
    const refreshed = v.headers.getSetCookie?.().find((c) => c.includes('session_token'));
    if (refreshed) cookie = refreshed.split(';')[0]!;
  }

  const me = (await (await t.fetch('/api/me', { cookie })).json()) as {
    user: { id: string; emailVerified: boolean };
    preferences: { theme: string; timezone: string };
  };
  return { cookie, userId: signup.user.id, email, me };
}

/** The common fixture: a signed-up, verified owner with a session cookie. */
export async function signedInOwner(t: TestApp, opts: { timezone?: string } = {}) {
  return signUp(t, uniqueEmail('owner'), 'Owner', opts);
}
