import { describe, expect, it } from 'vitest';
import { idempotent } from '../src/api/app';
import { IIdempotencyRepo } from '../src/application/ports';
import { createTestApp, signedInOwner } from './helpers/app';

const codeOf = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

describe('idempotency middleware', () => {
  const t = createTestApp();
  let counter = 0;
  // Test-only command routes, registered AFTER the /api/* session middleware so they inherit it.
  t.app.post('/api/_test/echo', idempotent, async (c) => c.json({ n: ++counter, body: await c.req.json() }, 201));
  t.app.post('/api/_test/boom', idempotent, async () => {
    throw new Error('kaboom');
  });
  t.app.post('/api/_test/gone', idempotent, async (c) => c.body(null, 204));

  it('a missing or malformed key → 400 IDEMPOTENCY_KEY_MISSING', async () => {
    const { cookie } = await signedInOwner(t);
    const r1 = await t.fetch('/api/_test/echo', { method: 'POST', cookie, json: { a: 1 } });
    expect(r1.status).toBe(400);
    expect(await codeOf(r1)).toBe('IDEMPOTENCY_KEY_MISSING');
    const r2 = await t.fetch('/api/_test/echo', { method: 'POST', cookie, json: { a: 1 }, idempotencyKey: 'short' });
    expect(r2.status).toBe(400);
  });

  it('a replay returns the cached response with Idempotent-Replayed: true and does NOT re-execute', async () => {
    const { cookie } = await signedInOwner(t);
    const key = crypto.randomUUID();
    const before = counter;
    const r1 = await t.fetch('/api/_test/echo', { method: 'POST', cookie, json: { b: 2, a: 1 }, idempotencyKey: key });
    expect(r1.status).toBe(201);
    expect(r1.headers.get('Idempotent-Replayed')).toBeNull();
    const body1 = await r1.text();

    // Same body, DIFFERENT key order → the same canonical hash → a replay, not a reuse error.
    const r2 = await t.fetch('/api/_test/echo', { method: 'POST', cookie, json: { a: 1, b: 2 }, idempotencyKey: key });
    expect(r2.status).toBe(201);
    expect(r2.headers.get('Idempotent-Replayed')).toBe('true');
    expect(await r2.text()).toBe(body1);
    expect(counter).toBe(before + 1);
  });

  it('the same key with a DIFFERENT body → 422 IDEMPOTENCY_KEY_REUSED', async () => {
    const { cookie } = await signedInOwner(t);
    const key = crypto.randomUUID();
    await t.fetch('/api/_test/echo', { method: 'POST', cookie, json: { a: 1 }, idempotencyKey: key });
    const r = await t.fetch('/api/_test/echo', { method: 'POST', cookie, json: { a: 2 }, idempotencyKey: key });
    expect(r.status).toBe(422);
    expect(await codeOf(r)).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('a key still in flight → 409 IDEMPOTENCY_IN_PROGRESS', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const key = crypto.randomUUID();
    await t
      .container()
      .resolve<IIdempotencyRepo>(IIdempotencyRepo)
      .begin({ scope: userId, key, userId, requestHash: 'x', createdAt: t.clock.nowIso() });
    const r = await t.fetch('/api/_test/echo', { method: 'POST', cookie, json: {}, idempotencyKey: key });
    expect(r.status).toBe(409);
    expect(await codeOf(r)).toBe('IDEMPOTENCY_IN_PROGRESS');
  });

  it('a 5xx RELEASES the key so the client can genuinely retry', async () => {
    const { cookie, userId } = await signedInOwner(t);
    const key = crypto.randomUUID();
    const r1 = await t.fetch('/api/_test/boom', { method: 'POST', cookie, json: {}, idempotencyKey: key });
    expect(r1.status).toBe(500);

    const repo = t.container().resolve<IIdempotencyRepo>(IIdempotencyRepo);
    const again = await repo.begin({ scope: userId, key, userId, requestHash: 'y', createdAt: t.clock.nowIso() });
    expect(again.inserted).toBe(true); // the row is gone → a retry is possible
    await repo.remove(userId, key);
  });

  it('a 4xx is CACHED — a refusal replays as the same refusal, not as a second attempt', async () => {
    const { cookie } = await signedInOwner(t);
    const key = crypto.randomUUID();
    const r1 = await t.fetch('/api/goals', { method: 'POST', cookie, idempotencyKey: key, json: { title: '', horizon: 'Life' } });
    expect(r1.status).toBe(422);
    const r2 = await t.fetch('/api/goals', { method: 'POST', cookie, idempotencyKey: key, json: { title: '', horizon: 'Life' } });
    expect(r2.status).toBe(422);
    expect(r2.headers.get('Idempotent-Replayed')).toBe('true');
  });

  it('a 204 replays as a 204 with no body', async () => {
    const { cookie } = await signedInOwner(t);
    const key = crypto.randomUUID();
    expect((await t.fetch('/api/_test/gone', { method: 'POST', cookie, idempotencyKey: key })).status).toBe(204);
    const replay = await t.fetch('/api/_test/gone', { method: 'POST', cookie, idempotencyKey: key });
    expect(replay.status).toBe(204);
    expect(replay.headers.get('Idempotent-Replayed')).toBe('true');
    expect(await replay.text()).toBe('');
  });

  it('keys are scoped per OWNER: another account can reuse the same key (R-auth-2)', async () => {
    const a = await signedInOwner(t);
    const b = await signedInOwner(t);
    const key = crypto.randomUUID();
    expect((await t.fetch('/api/_test/echo', { method: 'POST', cookie: a.cookie, json: { a: 1 }, idempotencyKey: key })).status).toBe(
      201,
    );
    const r = await t.fetch('/api/_test/echo', {
      method: 'POST',
      cookie: b.cookie,
      json: { totally: 'different' },
      idempotencyKey: key,
    });
    expect(r.status).toBe(201);
    expect(r.headers.get('Idempotent-Replayed')).toBeNull();
  });

  it('every command route is wrapped — a POST/PUT without a key is refused across the surface', async () => {
    const { cookie } = await signedInOwner(t);
    const id = '01J9ZQ8V2M7K3PQRSTVWXY0123';
    const commands: Array<[string, string, unknown]> = [
      ['POST', '/api/goals', { title: 'x', horizon: 'Life' }],
      ['POST', `/api/goals/${id}/move`, { parentId: id }],
      ['POST', `/api/goals/${id}/replan`, { period: '2027' }],
      ['PUT', '/api/plan', { weekStart: '2026-08-31', entries: [] }],
      ['POST', '/api/tasks', { goalId: id, title: 'x' }],
      ['POST', `/api/tasks/${id}/complete`, {}],
      ['POST', `/api/tasks/${id}/uncheck`, {}],
      ['POST', `/api/tasks/${id}/move-to-backlog`, {}],
      ['POST', `/api/tasks/${id}/cancel`, {}],
      ['POST', `/api/tasks/${id}/links`, { url: 'https://example.com' }],
      ['POST', '/api/backlog', { goalId: id, title: 'x' }],
      ['POST', `/api/backlog/${id}/move`, { goalId: id }],
      ['POST', `/api/backlog/${id}/convert-to-task`, {}],
      ['POST', '/api/ideas', { text: 'x' }],
      ['POST', `/api/ideas/${id}/attach`, { goalId: id }],
      ['POST', `/api/ideas/${id}/convert-to-task`, { goalId: id }],
      ['POST', '/api/learnings', { text: 'x' }],
      ['POST', `/api/learnings/${id}/attach`, { goalId: null }],
    ];
    for (const [method, path, json] of commands) {
      const res = await t.fetch(path, { method, cookie, json });
      expect(res.status, `${method} ${path}`).toBe(400);
      expect(await codeOf(res), `${method} ${path}`).toBe('IDEMPOTENCY_KEY_MISSING');
    }
  });
});
