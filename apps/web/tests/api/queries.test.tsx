import { describe, expect, it } from 'vitest';
import { act, waitFor } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { useCreateGoal, useLens, usePatchGoal, useTasks } from '../../src/api/queries';
import { renderAppHook } from '../render';
import { apiError, keysOf, requests, server } from '../msw/handlers';
import * as F from '../msw/fixtures';

describe('read hooks', () => {
  it('are gated on the session, so a signed-out app does not hammer the API with 401s', async () => {
    server.use(http.get('/api/me', () => apiError('UNAUTHENTICATED')));
    const { result } = renderAppHook(() => useLens('Weekly'));
    await waitFor(() => expect(requests('GET', '/api/me').length).toBeGreaterThan(0));
    // Give the query every chance to fire; the `enabled` guard is what stops it.
    await new Promise((r) => setTimeout(r, 20));
    expect(requests('GET', '/api/goals')).toHaveLength(0);
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('fetch once the session is known, and key the cache by the week asked for', async () => {
    const { result, queryClient } = renderAppHook(() => useTasks(-1));
    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(new URL(requests('GET', '/api/tasks')[0]!.url).searchParams.get('week')).toBe('-1');
    expect(queryClient.getQueryData(['tasks', -1])).toBeTruthy();
    expect(queryClient.getQueryData(['tasks', 0])).toBeUndefined();
  });
});

/**
 * The idempotency-key contract, which is the whole reason writes go through one wrapper: ONE key per
 * intent. Reusing it across retries of the same payload is what makes a retry safe; minting a new one when
 * the payload changes is what stops a second, different write being swallowed as a replay of the first.
 */
describe('useCommand and the Idempotency-Key', () => {
  const body = (title: string) => ({ title, why: '', horizon: 'Life' as const, parentId: null, pulse: 'On track' as const });

  it('reuses one key across retries of identical variables after a transient failure', async () => {
    let n = 0;
    server.use(
      http.post('/api/goals', () => {
        n += 1;
        // Two 5xx: the server committed nothing under the key, so the same key must go back out.
        return n <= 2 ? apiError('INTERNAL', 'boom') : HttpResponse.json(F.goalResponse(), { status: 201 });
      }),
    );
    const { result } = renderAppHook(() => useCreateGoal());

    await act(async () => {
      result.current.mutate(body('Be strong at 60'));
      await waitFor(() => expect(requests('POST', '/api/goals')).toHaveLength(1));
    });
    await act(async () => {
      result.current.retry();
      await waitFor(() => expect(requests('POST', '/api/goals')).toHaveLength(2));
    });
    await act(async () => {
      result.current.retry();
      await waitFor(() => expect(requests('POST', '/api/goals')).toHaveLength(3));
    });

    const keys = keysOf('POST', '/api/goals');
    expect(keys).toHaveLength(3);
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBeTruthy();
  });

  it('mints a new key when the variables change — a different payload is a different intent', async () => {
    const { result } = renderAppHook(() => useCreateGoal());
    await act(async () => {
      result.current.mutate(body('Be strong at 60'));
      await waitFor(() => expect(requests('POST', '/api/goals')).toHaveLength(1));
    });
    await act(async () => {
      result.current.mutate(body('Read more'));
      await waitFor(() => expect(requests('POST', '/api/goals')).toHaveLength(2));
    });
    const keys = keysOf('POST', '/api/goals');
    expect(new Set(keys).size).toBe(2);
  });

  it('drops the key after a stored 4xx, so the next attempt is not a replay of the refusal', async () => {
    let n = 0;
    server.use(
      http.post('/api/goals', () => {
        n += 1;
        return n === 1 ? apiError('HORIZON_CONFLICT') : HttpResponse.json(F.goalResponse(), { status: 201 });
      }),
    );
    const { result } = renderAppHook(() => useCreateGoal());
    await act(async () => {
      result.current.mutate(body('Be strong at 60'));
      await waitFor(() => expect(requests('POST', '/api/goals')).toHaveLength(1));
    });
    await act(async () => {
      result.current.retry();
      await waitFor(() => expect(requests('POST', '/api/goals')).toHaveLength(2));
    });
    const keys = keysOf('POST', '/api/goals');
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('drops the key after a success, so a re-tap of the same payload writes again', async () => {
    const { result } = renderAppHook(() => useCreateGoal());
    await act(async () => {
      result.current.mutate(body('Be strong at 60'));
      await waitFor(() => expect(requests('POST', '/api/goals')).toHaveLength(1));
    });
    await act(async () => {
      result.current.mutate(body('Be strong at 60'));
      await waitFor(() => expect(requests('POST', '/api/goals')).toHaveLength(2));
    });
    const keys = keysOf('POST', '/api/goals');
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('patches the cache from the response, then invalidates — patch-then-invalidate', async () => {
    const { result, queryClient } = renderAppHook(() => ({ life: useLens('Life'), rename: usePatchGoal() }));
    await waitFor(() => expect(result.current.life.data).toBeTruthy());

    server.use(
      http.patch('/api/goals/:id', () => HttpResponse.json(F.goalResponse({ title: 'Be strong at 70' }))),
      // Slow the reconciling refetch down so the *patch* is observable. In the app that gap is exactly what
      // the pattern buys: the row renames the moment the command answers, not when the list comes back.
      http.get('/api/goals', async () => {
        await delay(150);
        return HttpResponse.json(F.lensFor('Life'));
      }),
    );
    await act(async () => {
      result.current.rename.mutate({ id: F.L, patch: { title: 'Be strong at 70' } });
    });
    await waitFor(() => expect(result.current.rename.isSuccess).toBe(true));

    // Patched immediately from the command's own response — the row renames the moment the command
    // answers, not when the list comes back. A lens holds its goals in TWO arrays (`items` and R-lens-12's
    // `carried`), and the patch has to reach both.
    const cached = queryClient.getQueryData(['goals', 'Life', null]) as { items: { title: string }[] };
    expect(cached.items[0]!.title).toBe('Be strong at 70');
    // ...and the refetch that reconciles what the response cannot carry was queued.
    await waitFor(() => expect(requests('GET', '/api/goals').length).toBeGreaterThan(1));
  });
});
