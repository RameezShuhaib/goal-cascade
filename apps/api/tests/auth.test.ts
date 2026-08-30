import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { IPreferencesRepo } from '../src/application/ports';
import { createDb } from '../src/infrastructure/persistence/db';
import { goals, preferences } from '../src/infrastructure/persistence/schema';
import { PASSWORD, createTestApp, env, sessionCookie, signUp, signedInOwner, uniqueEmail } from './helpers/app';

const t = createTestApp({ now: '2026-08-31T10:00:00.000Z' });
const db = createDb(env.DB);

const signIn = (email: string, password = PASSWORD) =>
  t.fetch('/api/auth/sign-in/email', { method: 'POST', json: { email, password } });

describe('sign-up provisioning', () => {
  it('R-auth-6 — a new account gets a preferences row and NOTHING else: the goal tree starts empty', async () => {
    const u = await signUp(t, uniqueEmail('fresh'), 'Owner', { timezone: 'Europe/Berlin' });
    expect(u.me.user.emailVerified).toBe(true);

    const prefs = await t.container().resolve<IPreferencesRepo>(IPreferencesRepo).get(u.userId);
    expect(prefs).toMatchObject({ theme: 'system', timezone: 'Europe/Berlin' });

    // No default cascade, no sample goals, and above all none of the mockup's fixture ids (D-10).
    const tree = await db.select().from(goals).where(eq(goals.userId, u.userId)).all();
    expect(tree).toEqual([]);
  });

  it('R-auth-5 — X-Timezone seeds preferences.timezone, and that is the only thing the header does', async () => {
    const u = await signUp(t, uniqueEmail('tz'), 'Owner', { timezone: 'Asia/Tokyo' });
    const prefs = await t.container().resolve<IPreferencesRepo>(IPreferencesRepo).get(u.userId);
    expect(prefs?.timezone).toBe('Asia/Tokyo');

    // Once stored, a DIFFERENT header on a later request is ignored: the owner's zone is authoritative.
    const me = await t.fetch('/api/me', { cookie: u.cookie, headers: { 'X-Timezone': 'America/Los_Angeles' } });
    expect(((await me.json()) as { preferences: { timezone: string } }).preferences.timezone).toBe('Asia/Tokyo');
  });

  it('a bogus X-Timezone falls back to UTC rather than being stored', async () => {
    const u = await signUp(t, uniqueEmail('badtz'), 'Owner', { timezone: 'Mars/Olympus' });
    const prefs = await t.container().resolve<IPreferencesRepo>(IPreferencesRepo).get(u.userId);
    expect(prefs?.timezone).toBe('UTC');
  });

  it('an unverified sign-up still gets a session and can call /me, and the verification mail was captured', async () => {
    const u = await signUp(t, uniqueEmail('unverified'), 'Owner', { verify: false });
    expect(u.me.user.emailVerified).toBe(false);
    expect(t.email.lastTo(u.email)?.subject).toMatch(/verify/i);
    expect(t.email.lastTo(u.email)?.text).toMatch(/https?:\/\//);
  });
});

describe('sign-in / session / sign-out', () => {
  it('the right password signs in and the session reaches /me', async () => {
    const email = uniqueEmail('signin');
    await signUp(t, email, 'Owner');
    const res = await signIn(email);
    expect(res.status, await res.clone().text()).toBe(200);
    const cookie = sessionCookie(res);
    const me = await t.fetch('/api/me', { cookie });
    expect(me.status).toBe(200);
    expect(((await me.json()) as { user: { email: string } }).user.email).toBe(email.toLowerCase());
  });

  it('the wrong password is refused, and an unknown address is refused the same way', async () => {
    const email = uniqueEmail('wrong');
    await signUp(t, email, 'Owner');
    expect((await signIn(email, 'not the password')).status).toBe(401);
    expect((await signIn(uniqueEmail('ghost'))).status).toBe(401);
  });

  it('sign-out invalidates the session for every subsequent request', async () => {
    const { cookie } = await signedInOwner(t);
    expect((await t.fetch('/api/me', { cookie })).status).toBe(200);
    // Better Auth requires an `Origin` on its own state-changing routes (a browser always sends one),
    // so this mirrors a real client rather than a header-less script.
    const out = await t.fetch('/api/auth/sign-out', {
      method: 'POST',
      cookie,
      json: {},
      headers: { Origin: 'http://localhost' },
    });
    expect(out.status, await out.clone().text()).toBe(200);
    expect((await t.fetch('/api/me', { cookie })).status).toBe(401);
  });

  it('Better Auth refuses its own state-changing routes with no Origin — a second CSRF layer under ours', async () => {
    const { cookie } = await signedInOwner(t);
    const res = await t.fetch('/api/auth/sign-out', { method: 'POST', cookie, json: {} });
    expect(res.status).toBe(403);
    expect((await res.json()) as { code: string }).toMatchObject({ code: 'MISSING_OR_NULL_ORIGIN' });
    // ...and the session is untouched by the refused call.
    expect((await t.fetch('/api/me', { cookie })).status).toBe(200);
  });

  it('R-auth-2/3 — one owner cannot read another’s data: /me is scoped to the session, not to input', async () => {
    const a = await signedInOwner(t);
    const b = await signedInOwner(t);
    const meA = (await (await t.fetch('/api/me', { cookie: a.cookie })).json()) as { user: { id: string } };
    const meB = (await (await t.fetch('/api/me', { cookie: b.cookie })).json()) as { user: { id: string } };
    expect(meA.user.id).toBe(a.userId);
    expect(meB.user.id).toBe(b.userId);
    expect(meA.user.id).not.toBe(meB.user.id);
  });
});

describe('R-nav-12 / D-25 — the theme is a real persisted preference', () => {
  it('PATCH /me/preferences stores theme and timezone and survives a fresh request', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const res = await t.fetch('/api/me/preferences', { method: 'PATCH', cookie, json: { theme: 'dark', timezone: 'Europe/Berlin' } });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(((await res.json()) as { preferences: { theme: string } }).preferences.theme).toBe('dark');

    const row = await db.select().from(preferences).where(eq(preferences.userId, userId)).get();
    expect(row).toMatchObject({ theme: 'dark', timezone: 'Europe/Berlin' });

    const again = await t.fetch('/api/me/preferences', { cookie });
    expect(((await again.json()) as { preferences: { theme: string; timezone: string } }).preferences).toMatchObject({
      theme: 'dark',
      timezone: 'Europe/Berlin',
    });
  });

  it('an unknown timezone is refused rather than stored — it decides every week boundary (R-auth-5)', async () => {
    const { cookie } = await signedInOwner(t);
    const res = await t.fetch('/api/me/preferences', { method: 'PATCH', cookie, json: { timezone: 'Mars/Olympus' } });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
  });

  it('an unknown theme is refused by the schema', async () => {
    const { cookie } = await signedInOwner(t);
    expect((await t.fetch('/api/me/preferences', { method: 'PATCH', cookie, json: { theme: 'neon' } })).status).toBe(422);
  });
});
