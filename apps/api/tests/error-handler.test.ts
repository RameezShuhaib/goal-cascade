import { ERROR_CODES, ERROR_STATUS, type ErrorCode } from '@goal-cascade/shared';
import { describe, expect, it } from 'vitest';
import { errorResponse } from '../src/api/middleware/error-handler';
import { ConcurrencyError, DomainError, NotImplementedError } from '../src/domain/errors';
import { createTestApp, env, signedInOwner } from './helpers/app';

const codeOf = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

describe('the error envelope — one shape for every failure', () => {
  const t = createTestApp();

  it('every ErrorCode renders with its mapped status and the { error: { code, message } } envelope', async () => {
    for (const code of ERROR_CODES) {
      const res = errorResponse(code, `${code} happened`);
      expect(res.status, code).toBe(ERROR_STATUS[code]);
      expect(res.headers.get('content-type')).toContain('application/json');
      expect(await res.json()).toEqual({ error: { code, message: `${code} happened` } });
    }
  });

  it('details are included only when given (an empty details key would break client parsing)', async () => {
    expect(await errorResponse('NOT_FOUND', 'gone').json()).toEqual({ error: { code: 'NOT_FOUND', message: 'gone' } });
    expect(await errorResponse('NOT_FOUND', 'gone', { id: 'x' }).json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'gone', details: { id: 'x' } },
    });
  });

  it('a DomainError carries the status its code maps to', () => {
    for (const code of ERROR_CODES) expect(new DomainError(code as ErrorCode).status, code).toBe(ERROR_STATUS[code]);
    expect(new NotImplementedError('GET /x').status).toBe(501);
    expect(new ConcurrencyError('goal.update', 1, 0).status).toBe(409);
    expect(new ConcurrencyError('goal.update', 1, 0).code).toBe('CONCURRENT_UPDATE');
  });

  it('R-auth-4 — no session → 401 UNAUTHENTICATED, for READS as well as writes', async () => {
    for (const path of ['/api/me', '/api/goals', '/api/tasks', '/api/bootstrap', '/api/backlog', '/api/learnings']) {
      const res = await t.fetch(path);
      expect(res.status, path).toBe(401);
      expect(await codeOf(res), path).toBe('UNAUTHENTICATED');
    }
  });

  it('an unknown path under /api → 404 envelope; outside /api → the SPA, or the envelope with no assets binding', async () => {
    const { cookie } = await signedInOwner(t);
    const inside = await t.fetch('/api/nope', { cookie });
    expect(inside.status).toBe(404);
    expect(await codeOf(inside)).toBe('NOT_FOUND');

    const outside = await t.app.request('/some/spa/route', {}, { ...env, ASSETS: undefined });
    expect(outside.status).toBe(404);
    expect(await codeOf(outside)).toBe('NOT_FOUND');
  });

  /**
   * This assertion has been re-pointed twice as stubs were implemented: first `GET /api/goals`
   * (03-goals-plan), then `/api/bootstrap` (05-backlog-capture). EVERY route is now implemented, so there
   * is no stub left to point it at — which is the outcome we wanted, but it meant the test failed for a
   * reason that had nothing to do with the envelope it exists to protect.
   *
   * So it no longer borrows an unimplemented endpoint to reach the 501 path. It asserts the path directly,
   * which is what it always meant: a `NotImplementedError` thrown anywhere below the API layer renders in
   * the SAME envelope as every other failure. That is a property of the error handler, not of whichever
   * route happens to be unwritten this week, and phrasing it this way means implementing the next feature
   * can never break it again.
   */
  it('a NotImplementedError renders 501 in the same envelope — the plumbing works, the behaviour is not written', async () => {
    const err = new NotImplementedError('GET /api/example');
    const res = errorResponse(err.code, err.message, err.details, err.status);
    expect(res.status).toBe(501);
    expect(await codeOf(res)).toBe('NOT_IMPLEMENTED');
  });

  it('every route is implemented — no endpoint answers 501 any more', async () => {
    const { cookie } = await signedInOwner(t);
    // A guard, not a formality: a route regressing to a stub is a silent product outage, and the envelope
    // test above can no longer catch it now that it is decoupled from the router.
    const res = await t.fetch('/api/bootstrap', { cookie });
    expect(res.status).toBe(200);
  });

  it('health is public and needs no session', async () => {
    const res = await t.fetch('/api/health');
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
  });
});
