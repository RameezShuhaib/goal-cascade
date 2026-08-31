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
    // CancelTaskRequest is entirely optional → validation passes → the request reaches the service.
    // It answered 501 while `TaskService` was a stub; now that it is implemented, the service is the one
    // refusing, and it refuses on the id (R-auth-3: an unknown task is a plain 404). Either way, the
    // assertion this test exists to make is "not 422": the empty body parsed.
    const res = await t.fetch(`/api/tasks/01J9ZQ8V2M7K3PQRSTVWXY0123/cancel`, {
      method: 'POST',
      cookie,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(res.status).toBe(404);
  });
});

describe('zQuery — query params', () => {
  const t = createTestApp();

  it('coerces `week` from its string form and passes it through', async () => {
    const { cookie } = await signedInOwner(t);
    // Was 501 while `TaskService` was a stub. Now the handler runs, which lets this assert the thing the
    // 501 could only imply: the string `-2` reached the service as the number −2 and resolved to a week.
    const res = await t.fetch('/api/tasks?week=-2', { cookie });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { week: { offset: number } }).week.offset).toBe(-2);
  });

  /**
   * SUPERSEDED - "a FUTURE week is refused, by the schema, before any handler runs" encoded R-nav-3.
   * R-lens-7 supersedes it: any future period is reachable and writable, and the forward chevron is
   * never disabled. It is INVERTED rather than deleted, because the widening is a SILENT break - the
   * guard that actually mattered (you cannot COMPLETE work in a week that has not happened) is now
   * explicit on `CompleteTaskRequest.week`, and this is where its absence would have gone unnoticed.
   */
  it('S-lens-7-3 / S-rm-3-1 - a FUTURE week is an ordinary read, in either direction', async () => {
    const { cookie } = await signedInOwner(t);
    for (const week of [1, 20, 400]) {
      const res = await t.fetch(`/api/tasks?week=${week}`, { cookie });
      expect(res.status, `week=${week}`).toBe(200);
      expect(((await res.json()) as { week: { offset: number } }).week.offset).toBe(week);
    }
    // What remains is the absolute storage range, which is not a product rule.
    expect((await t.fetch('/api/tasks?week=600', { cookie })).status).toBe(422);
  });

  it('a non-numeric week is refused rather than silently becoming 0', async () => {
    const { cookie } = await signedInOwner(t);
    expect((await t.fetch('/api/tasks?week=soon', { cookie })).status).toBe(422);
  });

  it('an unknown query param is refused (`.strict()` applies to queries too)', async () => {
    const { cookie } = await signedInOwner(t);
    expect((await t.fetch('/api/tasks?week=0&sneaky=1', { cookie })).status).toBe(422);
  });

  /**
   * SUPERSEDED - the 8-week history window was D-24's shared bound for two controls. R-rm-3 retires
   * `WEEK_HISTORY_WEEKS` as a bound and R-lens-7 removes the backward clamp entirely: there is no picker
   * to enumerate (R-lens-17), greying out one chevron would cost a `MIN(period_key)` probe per render,
   * and a bound in ONE direction rebuilds exactly the asymmetry D-24 was about. D-24 is now satisfied by
   * construction - one control per dimension, so no two controls can disagree about a range.
   */
  it('S-lens-7-3 - reaching further back than the old window is an ordinary read', async () => {
    const { cookie } = await signedInOwner(t);
    for (const week of [-8, -9, -52, -400]) {
      expect((await t.fetch(`/api/tasks?week=${week}`, { cookie })).status, `week=${week}`).toBe(200);
    }
    expect((await t.fetch('/api/tasks?week=-600', { cookie })).status).toBe(422);
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

  // `GoalService` is implemented now, so "it reached the service" reads as the service's own answer for
  // an id that belongs to nobody: 404 (R-auth-3), not the old stub's 501. The assertion is the same one
  // — the param passed validation and a query ran — and it is now stronger, because a malformed id
  // could never produce it.
  it('a well-formed id passes validation and reaches the service', async () => {
    const { cookie } = await signedInOwner(t);
    expect((await t.fetch('/api/goals/01J9ZQ8V2M7K3PQRSTVWXY0123', { cookie })).status).toBe(404);
  });
});
