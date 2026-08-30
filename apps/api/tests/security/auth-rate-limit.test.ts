import { describe, expect, it } from 'vitest';
import { AUTH_RATE_LIMIT_RULES, authRateLimitEnabled } from '../../src/infrastructure/auth/rate-limit';
import type { AppEnv } from '../../src/env';
import { PASSWORD, createTestApp, env, uniqueEmail } from '../helpers/app';

/**
 * Better Auth's limiter, backed by D1 (`D1RateLimitStore`), because its memory backend is useless here:
 * this Worker builds a fresh auth instance per request, so nothing survives between two attempts.
 *
 * This is the ONLY rate limiter in the product. SPEC Q-16 also recommended a per-owner write budget; the
 * orchestrator ruled against it, because sign-up is allowlisted to one address and the authenticated
 * write surface has no abuse population. The UNAUTHENTICATED auth endpoints are genuinely exposed, so
 * they keep their limits.
 *
 * The suite runs with `AUTH_RATE_LIMIT: 'off'` by default — a shared D1 plus Better Auth's fallback to a
 * single `127.0.0.1` bucket would otherwise make every test file share one counter. These tests turn it
 * back on per request and assert the real behaviour.
 */
const t = createTestApp();
const withLimiter = { AUTH_RATE_LIMIT: 'on' } as Partial<AppEnv>;

describe('the limiter is on unless explicitly turned off', () => {
  it('only the exact string `off` disables it — an unset or garbled var must never silently do so', () => {
    const e = (AUTH_RATE_LIMIT?: string) => ({ ...env, AUTH_RATE_LIMIT }) as AppEnv;
    expect(authRateLimitEnabled(e(undefined))).toBe(true);
    expect(authRateLimitEnabled(e(''))).toBe(true);
    expect(authRateLimitEnabled(e('false'))).toBe(true);
    expect(authRateLimitEnabled(e('0'))).toBe(true);
    expect(authRateLimitEnabled(e('nonsense'))).toBe(true);
    expect(authRateLimitEnabled(e('off'))).toBe(false);
    expect(authRateLimitEnabled(e(' OFF '))).toBe(false);
  });

  it('the rules cover every unauthenticated auth path that costs something', () => {
    for (const path of ['/sign-in/email', '/sign-up/email', '/request-password-reset', '/reset-password']) {
      expect(AUTH_RATE_LIMIT_RULES, path).toHaveProperty(path);
    }
    // Online password guessing is capped per minute; the mail cannons are capped per hour.
    expect(AUTH_RATE_LIMIT_RULES['/sign-in/email']).toEqual({ window: 60, max: 10 });
    expect(AUTH_RATE_LIMIT_RULES['/request-password-reset'].window).toBe(3600);
  });
});

describe('sign-in brute force is refused with 429', () => {
  it('repeated wrong-password attempts from one IP hit the limit', async () => {
    const email = uniqueEmail('brute');
    // Register the account with the limiter OFF so the sign-up does not consume the sign-in budget.
    await t.fetch('/api/auth/sign-up/email', {
      method: 'POST',
      json: { name: 'Owner', email, password: PASSWORD },
      env: { SIGNUP_ALLOWLIST: email },
    });

    const attempt = () =>
      t.fetch('/api/auth/sign-in/email', {
        method: 'POST',
        json: { email, password: 'wrong' },
        headers: { 'cf-connecting-ip': '203.0.113.77' },
        env: withLimiter,
      });

    const statuses: number[] = [];
    for (let i = 0; i < 14; i++) statuses.push((await attempt()).status);

    expect(statuses.filter((s) => s === 429).length, statuses.join(',')).toBeGreaterThan(0);
    // ...and the limit bites AFTER a handful of genuine attempts, not on the first one.
    expect(statuses.slice(0, 3).every((s) => s === 401), statuses.join(',')).toBe(true);
  });

  it('the bucket is per client IP — a different caller is unaffected by someone else’s budget', async () => {
    const email = uniqueEmail('neighbour');
    await t.fetch('/api/auth/sign-up/email', {
      method: 'POST',
      json: { name: 'Owner', email, password: PASSWORD },
      env: { SIGNUP_ALLOWLIST: email },
    });
    const res = await t.fetch('/api/auth/sign-in/email', {
      method: 'POST',
      json: { email, password: PASSWORD },
      headers: { 'cf-connecting-ip': '198.51.100.4' },
      env: withLimiter,
    });
    expect(res.status, await res.clone().text()).toBe(200);
  });
});
