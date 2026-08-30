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
    for (const path of ['/api/me', '/api/goals', '/api/tasks', '/api/bootstrap', '/api/backlog', '/api/ideas', '/api/learnings']) {
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

  it('a stub route answers 501 NOT_IMPLEMENTED in the same envelope — the plumbing works, the behaviour is not written', async () => {
    const { cookie } = await signedInOwner(t);
    const res = await t.fetch('/api/goals', { cookie });
    expect(res.status).toBe(501);
    expect(await codeOf(res)).toBe('NOT_IMPLEMENTED');
  });

  it('health is public and needs no session', async () => {
    const res = await t.fetch('/api/health');
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
  });
});
