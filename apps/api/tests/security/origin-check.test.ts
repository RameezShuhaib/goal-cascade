import { describe, expect, it } from 'vitest';
import { createTestApp, signedInOwner } from './../helpers/app';

/**
 * Better Auth's origin check is registered on ITS router, so it covers only `/api/auth/*`. Without ours,
 * `SameSite=Lax` — a library default nothing in this repo pins — would be the only thing standing
 * between a cross-site `<form enctype="text/plain">` POST and a command.
 *
 * These use `PATCH /api/me/preferences`, which is a real, implemented command, so a pass is a genuine
 * 200 rather than a 501.
 */
const t = createTestApp();
const codeOf = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

describe('cross-site state changes are refused on /api/*', () => {
  it('a cross-site form post is refused BEFORE the handler runs', async () => {
    const { cookie } = await signedInOwner(t);
    const res = await t.fetch('/api/me/preferences', {
      method: 'PATCH',
      cookie,
      headers: { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site', 'Content-Type': 'text/plain' },
      body: JSON.stringify({ theme: 'dark' }),
    });
    expect(res.status).toBe(403);
    expect(await codeOf(res)).toBe('FORBIDDEN');
  });

  it('an untrusted Origin is refused even without Sec-Fetch-Site', async () => {
    const { cookie } = await signedInOwner(t);
    const res = await t.fetch('/api/me/preferences', {
      method: 'PATCH',
      cookie,
      headers: { Origin: 'https://evil.example' },
      json: { theme: 'dark' },
    });
    expect(res.status).toBe(403);
  });

  it('the SPA itself passes: same-origin Origin + Sec-Fetch-Site: same-origin', async () => {
    const { cookie } = await signedInOwner(t);
    const res = await t.fetch('/api/me/preferences', {
      method: 'PATCH',
      cookie,
      headers: { Origin: 'http://localhost', 'Sec-Fetch-Site': 'same-origin' },
      json: { theme: 'dark' },
    });
    expect(res.status, await res.clone().text()).toBe(200);
  });

  it('a configured trusted origin passes (vite dev on :5173)', async () => {
    const { cookie } = await signedInOwner(t);
    const res = await t.fetch('/api/me/preferences', {
      method: 'PATCH',
      cookie,
      headers: { Origin: 'http://localhost:5173' },
      json: { theme: 'light' },
    });
    expect(res.status, await res.clone().text()).toBe(200);
  });

  it('a header-less client (curl, the e2e scripts) is unaffected — it carries no ambient cookie', async () => {
    const { cookie } = await signedInOwner(t);
    const res = await t.fetch('/api/me/preferences', { method: 'PATCH', cookie, json: { theme: 'system' } });
    expect(res.status, await res.clone().text()).toBe(200);
  });

  it('reads are never blocked — the check is about state changes', async () => {
    const { cookie } = await signedInOwner(t);
    const res = await t.fetch('/api/me', { cookie, headers: { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' } });
    expect(res.status).toBe(200);
  });

  it('the origin check runs BEFORE idempotency, not instead of it', async () => {
    const { cookie } = await signedInOwner(t);
    // same-origin but no key → the idempotency check is reached
    const ok = await t.fetch('/api/goals', { method: 'POST', cookie, headers: { Origin: 'http://localhost' }, json: {} });
    expect(ok.status).toBe(400);
    expect(await codeOf(ok)).toBe('IDEMPOTENCY_KEY_MISSING');
    // cross-site → refused first, key or no key
    const blocked = await t.fetch('/api/goals', {
      method: 'POST',
      cookie,
      idempotencyKey: crypto.randomUUID(),
      headers: { 'Sec-Fetch-Site': 'cross-site' },
      json: {},
    });
    expect(blocked.status).toBe(403);
  });
});
