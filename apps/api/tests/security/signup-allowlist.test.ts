import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { isSignupAllowed, parseSignupAllowlist } from '../../src/infrastructure/auth/signup-allowlist';
import { createDb } from '../../src/infrastructure/persistence/db';
import { user } from '../../src/infrastructure/persistence/schema';
import type { AppEnv } from '../../src/env';
import { PASSWORD, createTestApp, env, uniqueEmail } from '../helpers/app';

/**
 * R-auth-1 — Goal Cascade is single-user: only the owner's address may register. The owner chose this,
 * and the enforcement point matters as much as the rule.
 *
 * The check lives in Better Auth's `databaseHooks.user.create.before`, which is the LAST moment at which
 * no row exists. Every test below therefore asserts BOTH halves: the request is refused AND the `user`
 * table is unchanged. A version of this that created the row and deleted it afterwards would pass the
 * first assertion and fail the second.
 */
const t = createTestApp();
const db = createDb(env.DB);
const countUsers = async (email: string) => (await db.select().from(user).where(eq(user.email, email.toLowerCase())).all()).length;

const signUp = (email: string, allowlist: string) =>
  t.fetch('/api/auth/sign-up/email', {
    method: 'POST',
    json: { name: 'Somebody', email, password: PASSWORD },
    env: { SIGNUP_ALLOWLIST: allowlist },
  });

describe('the allowlist itself', () => {
  const withList = (SIGNUP_ALLOWLIST?: string) => ({ ...env, SIGNUP_ALLOWLIST }) as AppEnv;

  it('an UNSET allowlist refuses everything — the safe default is closed, never open', () => {
    expect(parseSignupAllowlist(withList(undefined))).toEqual([]);
    expect(isSignupAllowed(withList(undefined), 'me@rameezshuhaib.com')).toBe(false);
    expect(isSignupAllowed(withList(undefined), 'anyone@example.com')).toBe(false);
  });

  it('an EMPTY or whitespace allowlist also refuses everything', () => {
    for (const value of ['', '   ', ',', ' , , ']) {
      expect(isSignupAllowed(withList(value), 'me@rameezshuhaib.com'), JSON.stringify(value)).toBe(false);
    }
  });

  it('matching is exact, trimmed and case-insensitive', () => {
    const list = withList(' Me@RameezShuhaib.com , second@test.goal-cascade.local ');
    expect(isSignupAllowed(list, 'me@rameezshuhaib.com')).toBe(true);
    expect(isSignupAllowed(list, '  ME@RAMEEZSHUHAIB.COM  ')).toBe(true);
    expect(isSignupAllowed(list, 'second@test.goal-cascade.local')).toBe(true);
  });

  it('there is no glob support: a wildcard is a literal address and matches nothing real', () => {
    expect(isSignupAllowed(withList('*'), 'anyone@example.com')).toBe(false);
    expect(isSignupAllowed(withList('*@rameezshuhaib.com'), 'me@rameezshuhaib.com')).toBe(false);
    expect(isSignupAllowed(withList('*@*'), 'me@rameezshuhaib.com')).toBe(false);
  });

  it('a near-miss is not a match — no substring, prefix or domain matching', () => {
    const list = withList('me@rameezshuhaib.com');
    for (const attempt of [
      'me@rameezshuhaib.com.evil.example',
      'evil+me@rameezshuhaib.com',
      'me@rameezshuhaib.co',
      'notme@rameezshuhaib.com',
      'me@sub.rameezshuhaib.com',
    ]) {
      expect(isSignupAllowed(list, attempt), attempt).toBe(false);
    }
  });
});

describe('enforcement: a refused sign-up leaves NO user row', () => {
  it('a non-allowlisted address is refused 403 and the user table is unchanged', async () => {
    const email = uniqueEmail('intruder');
    expect(await countUsers(email)).toBe(0);

    const res = await signUp(email, 'me@rameezshuhaib.com');
    expect(res.status).toBe(403);
    expect(await res.text()).toMatch(/SIGNUP_NOT_ALLOWED|single-user|not open/i);

    // The whole point: no row, no session, no preferences.
    expect(await countUsers(email)).toBe(0);
    expect(res.headers.getSetCookie?.().some((c) => c.includes('session_token')) ?? false).toBe(false);
  });

  it('an UNSET allowlist refuses the owner too — a lost var closes sign-up, it does not open it', async () => {
    const email = uniqueEmail('unset');
    const res = await t.fetch('/api/auth/sign-up/email', {
      method: 'POST',
      json: { name: 'Owner', email, password: PASSWORD },
      env: { SIGNUP_ALLOWLIST: '' },
    });
    expect(res.status).toBe(403);
    expect(await countUsers(email)).toBe(0);
  });

  it('an allowlisted address signs up normally and gets a session', async () => {
    const email = uniqueEmail('allowed');
    const res = await signUp(email, `someone.else@test.goal-cascade.local,${email}`);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await countUsers(email)).toBe(1);
    expect(res.headers.getSetCookie?.().some((c) => c.includes('session_token'))).toBe(true);
  });

  it('a refused attempt does not block the owner’s later, allowed attempt on the same address', async () => {
    const email = uniqueEmail('retry');
    expect((await signUp(email, 'nobody@test.goal-cascade.local')).status).toBe(403);
    expect(await countUsers(email)).toBe(0);
    expect((await signUp(email, email)).status).toBe(200);
    expect(await countUsers(email)).toBe(1);
  });
});
