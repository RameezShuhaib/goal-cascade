import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { HttpApiClient } from '../../src/api/http';
import { ApiError, isTransient } from '../../src/api/errors';
import { shouldRetry } from '../../src/lib/queryClient';
import { apiError, lastRequest, requests, server } from '../msw/handlers';
import * as F from '../msw/fixtures';

const client = (opts: Partial<ConstructorParameters<typeof HttpApiClient>[0]> = {}) =>
  new HttpApiClient({ timezone: 'Europe/Amsterdam', inProgressDelayMs: 1, ...opts });

describe('HttpApiClient', () => {
  it('builds the URL from API_BASE and sends the timezone header', async () => {
    await client().me();
    const req = lastRequest('GET', '/api/me')!;
    expect(new URL(req.url).pathname).toBe('/api/me');
    expect(req.headers.get('X-Timezone')).toBe('Europe/Amsterdam');
  });

  it('omits an undefined query param rather than sending the string "undefined"', async () => {
    // Every query schema is `.strict()`; `?week=undefined` is a 422, not a default.
    await client().tasks({});
    expect(new URL(lastRequest('GET', '/api/tasks')!.url).search).toBe('');
    await client().tasks({ week: -2 });
    expect(new URL(lastRequest('GET', '/api/tasks')!.url).searchParams.get('week')).toBe('-2');
  });

  /**
   * ⚠ **A2 (R-lens-16)** — `GET /goals` is the scoped lens read. `?goalId=` is gone from `TasksQuery`
   * (R-rm-4) and there is no filter of any kind on a lens read (R-lens-15), so the only parameters here
   * are the horizon and the period — and a POSITIVE week offset is now ordinary (R-goal-36, R-rm-3).
   */
  it('sends the lens and the period, and nothing that used to be a filter', async () => {
    await client().lens({ lens: 'Quarterly', period: '2026-Q3' });
    const url = new URL(lastRequest('GET', '/api/goals')!.url);
    expect(url.searchParams.get('lens')).toBe('Quarterly');
    expect(url.searchParams.get('period')).toBe('2026-Q3');
    expect(url.searchParams.has('goalId')).toBe(false);
    expect(url.searchParams.has('week')).toBe(false);

    // The Life lens has no period dimension, so no period is sent at all (R-lens-2).
    await client().lens({ lens: 'Life' });
    expect(new URL(lastRequest('GET', '/api/goals')!.url).searchParams.has('period')).toBe(false);
  });

  it('a future week offset goes out unchanged — there is no forward clamp left in this client', async () => {
    await client().tasks({ week: 6 });
    expect(new URL(lastRequest('GET', '/api/tasks')!.url).searchParams.get('week')).toBe('6');
  });

  it('sends the Idempotency-Key it is given, and only on commands', async () => {
    await client().createGoal({ title: 'A goal', why: '', horizon: 'Life', parentId: null, pulse: 'On track' }, 'key-abc');
    expect(lastRequest('POST', '/api/goals')!.headers.get('Idempotency-Key')).toBe('key-abc');
    await client().lens({ lens: 'Weekly' });
    expect(lastRequest('GET', '/api/goals')!.headers.get('Idempotency-Key')).toBeNull();
  });

  it('turns the error envelope into a typed ApiError with its status and details', async () => {
    server.use(http.post('/api/goals', () => apiError('HORIZON_CONFLICT', 'a child must be shorter', { parentHorizon: 'Monthly' })));
    const err = await client()
      .createGoal({ title: 'x', why: '', horizon: 'Monthly', parentId: F.ulid(2), pulse: 'On track' }, 'k')
      .catch((e: unknown) => e as ApiError);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ code: 'HORIZON_CONFLICT', status: 409, message: 'a child must be shorter' });
    expect((err as ApiError).details).toEqual({ parentHorizon: 'Monthly' });
  });

  it('maps an unknown code to the nearest meaning its status carries', async () => {
    server.use(http.get('/api/goals', () => HttpResponse.json({ error: { code: 'SOMETHING_NEW', message: 'from a newer server' } }, { status: 409 })));
    const err = (await client().lens({ lens: 'Weekly' }).catch((e: unknown) => e)) as ApiError;
    expect(err.code).toBe('CONCURRENT_UPDATE');
    expect(err.status).toBe(409);
  });

  it('a rejected fetch becomes NETWORK, not an unhandled TypeError', async () => {
    server.use(http.get('/api/me', () => HttpResponse.error()));
    const err = (await client().me().catch((e: unknown) => e)) as ApiError;
    expect(err.code).toBe('NETWORK');
    expect(err.status).toBe(0);
  });

  it('a 2xx that fails the shared schema is BAD_RESPONSE, naming where it drifted', async () => {
    server.use(http.get('/api/me', () => HttpResponse.json({ user: { id: 'u' }, serverNow: F.NOW })));
    const err = (await client().me().catch((e: unknown) => e)) as ApiError;
    expect(err.code).toBe('BAD_RESPONSE');
    expect(err.message).toMatch(/did not match the contract/);
  });

  it('retries IDEMPOTENCY_IN_PROGRESS silently, with the SAME key', async () => {
    let n = 0;
    server.use(
      http.post('/api/goals', () => {
        n += 1;
        return n === 1 ? apiError('IDEMPOTENCY_IN_PROGRESS') : HttpResponse.json(F.goalResponse(), { status: 201 });
      }),
    );
    const res = await client().createGoal({ title: 'A goal', why: '', horizon: 'Life', parentId: null, pulse: 'On track' }, 'key-xyz');
    expect(res.goal.title).toBe('Be strong at 60');
    const keys = requests('POST', '/api/goals').map((r) => r.headers.get('Idempotency-Key'));
    expect(keys).toEqual(['key-xyz', 'key-xyz']);
  });

  it('does not retry a read (no key means the server holds nothing to join)', async () => {
    server.use(http.get('/api/goals', () => apiError('IDEMPOTENCY_IN_PROGRESS')));
    await client().lens({ lens: 'Weekly' }).catch(() => null);
    expect(requests('GET', '/api/goals')).toHaveLength(1);
  });
});

describe('shouldRetry', () => {
  it('never retries a 4xx — a typed refusal will not heal', () => {
    // ⚠ **A2** — `NOT_A_LEAF` is deleted (R-goal-39). `NOT_A_WEEKLY_GOAL` replaces it, and it is just as
    // unretryable: retrying cannot make a Monthly goal a Weekly one.
    for (const code of ['NOT_A_WEEKLY_GOAL', 'VALIDATION_FAILED', 'NOT_FOUND', 'UNAUTHENTICATED'] as const) {
      const status = code === 'NOT_FOUND' ? 404 : code === 'UNAUTHENTICATED' ? 401 : code === 'VALIDATION_FAILED' ? 422 : 409;
      expect(shouldRetry(0, new ApiError(status, code, code))).toBe(false);
    }
  });

  it('retries a dropped network and a 5xx, and gives up after two attempts', () => {
    expect(shouldRetry(0, new ApiError(0, 'NETWORK', 'offline'))).toBe(true);
    expect(shouldRetry(1, new ApiError(503, 'INTERNAL', 'bad gateway'))).toBe(true);
    expect(shouldRetry(2, new ApiError(0, 'NETWORK', 'offline'))).toBe(false);
  });

  it('retries a non-ApiError, because we cannot tell what it was', () => {
    expect(shouldRetry(0, new Error('who knows'))).toBe(true);
  });
});

describe('isTransient', () => {
  it('is true only where the server holds no committed response under the key', () => {
    expect(isTransient(new ApiError(0, 'NETWORK', 'x'))).toBe(true);
    expect(isTransient(new ApiError(409, 'IDEMPOTENCY_IN_PROGRESS', 'x'))).toBe(true);
    expect(isTransient(new ApiError(500, 'INTERNAL', 'x'))).toBe(true);
    // A stored 4xx would just be replayed under the same key.
    expect(isTransient(new ApiError(409, 'NOT_A_WEEKLY_GOAL', 'x'))).toBe(false);
  });
});
