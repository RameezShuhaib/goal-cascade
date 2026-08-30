import { describe, expect, it } from 'vitest';
import { createTestApp, signedInOwner } from './helpers/app';

const err = async (res: Response) =>
  (await res.json()) as { error: { code: string; message: string; details?: { issues?: unknown[] } } };

/**
 * Validation is middleware (`zJson` / `zQuery` / `zParams`), so these tests go through the real router.
 * The route handlers behind them are stubs that throw 501 — which is exactly what makes this a clean
 * test of the validation layer: a 501 means validation PASSED and a 422 means it caught something.
 */
describe('zJson — the request body', () => {
  const t = createTestApp();

  it('a schema failure → 422 VALIDATION_FAILED with the Zod issues attached', async () => {
    const { cookie } = await signedInOwner(t);
    const res = await t.fetch('/api/goals', {
      method: 'POST',
      cookie,
      idempotencyKey: crypto.randomUUID(),
      json: { title: '', horizon: 'Weekly' },
    });
    expect(res.status).toBe(422);
    const body = await err(res);
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.details?.issues?.length).toBeGreaterThan(0);
  });

  it('malformed JSON → 422, not a 500 and not a silently empty body', async () => {
    const { cookie } = await signedInOwner(t);
    const res = await t.fetch('/api/goals', {
      method: 'POST',
      cookie,
      idempotencyKey: crypto.randomUUID(),
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    });
    expect(res.status).toBe(422);
    expect((await err(res)).error.message).toMatch(/malformed JSON/i);
  });

  it('an UNKNOWN key is refused, never silently dropped — a typo or a stale client is a bug', async () => {
    const { cookie } = await signedInOwner(t);
    const res = await t.fetch('/api/goals', {
      method: 'POST',
      cookie,
      idempotencyKey: crypto.randomUUID(),
      json: { title: 'Ship it', horizon: 'Life', focus: 'this is not a Goal field' },
    });
    expect(res.status).toBe(422);
    expect((await err(res)).error.code).toBe('VALIDATION_FAILED');
  });

  it('S-goal-14-2 — a PATCH cannot smuggle in a server-owned or immutable field', async () => {
    const { cookie } = await signedInOwner(t);
    const id = '01J9ZQ8V2M7K3PQRSTVWXY0123';
    for (const patch of [{ parentId: null }, { horizon: 'Yearly' }, { id: 'other' }, { createdAt: '2020-01-01T00:00:00.000Z' }]) {
      const res = await t.fetch(`/api/goals/${id}`, { method: 'PATCH', cookie, json: patch });
      expect(res.status, JSON.stringify(patch)).toBe(422);
    }
  });

  it('an empty body parses as {} so a command whose fields are all optional still works', async () => {
    const { cookie } = await signedInOwner(t);
    // CancelTaskRequest is entirely optional → validation passes → the stub service answers 501.
    const res = await t.fetch(`/api/tasks/01J9ZQ8V2M7K3PQRSTVWXY0123/cancel`, {
      method: 'POST',
      cookie,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(res.status).toBe(501);
  });
});

describe('zQuery — query params', () => {
  const t = createTestApp();

  it('coerces `week` from its string form and passes it through', async () => {
    const { cookie } = await signedInOwner(t);
    expect((await t.fetch('/api/tasks?week=-2', { cookie })).status).toBe(501);
  });

  it('R-nav-3 / S-nav-3-1 — a FUTURE week is refused, by the schema, before any handler runs', async () => {
    const { cookie } = await signedInOwner(t);
    const res = await t.fetch('/api/tasks?week=1', { cookie });
    expect(res.status).toBe(422);
    expect((await err(res)).error.code).toBe('VALIDATION_FAILED');
  });

  it('a non-numeric week is refused rather than silently becoming 0', async () => {
    const { cookie } = await signedInOwner(t);
    expect((await t.fetch('/api/tasks?week=soon', { cookie })).status).toBe(422);
  });

  it('an unknown query param is refused (`.strict()` applies to queries too)', async () => {
    const { cookie } = await signedInOwner(t);
    expect((await t.fetch('/api/tasks?week=0&sneaky=1', { cookie })).status).toBe(422);
  });

  it('R-nav-4 / D-24 — reaching past the switcher’s bound is WEEK_OUT_OF_RANGE, not an empty week', async () => {
    const { cookie } = await signedInOwner(t);
    const res = await t.fetch('/api/tasks?week=-9', { cookie });
    expect(res.status).toBe(422);
    expect((await err(res)).error.code).toBe('WEEK_OUT_OF_RANGE');
    // the last week INSIDE the bound is fine
    expect((await t.fetch('/api/tasks?week=-7', { cookie })).status).toBe(501);
  });
});

describe('zParams — path params', () => {
  const t = createTestApp();

  it('a path id that is not a ULID is 422, so a malformed id never reaches a query', async () => {
    const { cookie } = await signedInOwner(t);
    const res = await t.fetch('/api/goals/not-a-ulid', { cookie });
    expect(res.status).toBe(422);
    expect((await err(res)).error.code).toBe('VALIDATION_FAILED');
  });

  it('a well-formed id passes validation and reaches the (stubbed) service', async () => {
    const { cookie } = await signedInOwner(t);
    expect((await t.fetch('/api/goals/01J9ZQ8V2M7K3PQRSTVWXY0123', { cookie })).status).toBe(501);
  });
});
