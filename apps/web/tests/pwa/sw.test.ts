import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  handleReadModelRequest,
  handleSignOutRequest,
  isReadModelRequest,
  isSessionEnded,
  isSignOutRequest,
  parseClientMessage,
  purgeCachedApiData,
  READ_MODEL_CACHE,
  type CacheStorageLike,
  type ReadModelStrategy,
} from '../../src/sw/handlers';

/** A `CacheStorage` stand-in that records what was deleted. */
function fakeCaches(names: string[]): CacheStorageLike & { deleted: string[] } {
  const deleted: string[] = [];
  return {
    deleted,
    keys: async () => names,
    delete: async (name) => {
      deleted.push(name);
      return true;
    },
  };
}

const url = (path: string) => new URL(path, 'https://cascade.example');
const req = (path: string, method = 'GET') => new Request(url(path).href, { method });
const strategyReturning = (response: Response): ReadModelStrategy => ({ handle: async () => response });

describe('isReadModelRequest', () => {
  it('matches GET collection and item reads under the allowed prefixes', () => {
    for (const path of ['/api/goals', '/api/goals/g1', '/api/tasks', '/api/tasks/t1', '/api/plan', '/api/backlog', '/api/learnings']) {
      expect(isReadModelRequest(url(path), 'GET'), path).toBe(true);
    }
    // A query string is part of the request, not the path — the week switcher must still be cacheable.
    expect(isReadModelRequest(url('/api/tasks?week=-2'), 'GET')).toBe(true);
  });

  it('never matches a write, whatever the path', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(isReadModelRequest(url('/api/goals'), method), method).toBe(false);
    }
  });

  it('does not let a neighbouring path slip in on a prefix match', () => {
    // The `p + '/'` guard. Without it `/api/goalsomething` and `/api/tasks-export` are cached as read models.
    expect(isReadModelRequest(url('/api/goalsomething'), 'GET')).toBe(false);
    expect(isReadModelRequest(url('/api/tasks-export'), 'GET')).toBe(false);
    expect(isReadModelRequest(url('/api/other'), 'GET')).toBe(false);
    expect(isReadModelRequest(url('/'), 'GET')).toBe(false);
  });

  /**
   * The guard for the file's most dangerous decision. If `/api/me` or anything under `/api/auth` ever becomes
   * cacheable, a signed-out phone can be told — offline, from cache — that it is signed in as the previous
   * user, and then be handed that user's cached goals. Caching the session endpoint is the bug; this test is
   * what stops someone adding it "for offline cold-open" without also building the identity machinery.
   */
  it('never caches the session or auth endpoints', () => {
    for (const path of ['/api/me', '/api/me/preferences', '/api/auth', '/api/auth/session', '/api/auth/sign-in']) {
      expect(isReadModelRequest(url(path), 'GET'), path).toBe(false);
    }
  });
});

describe('isSignOutRequest', () => {
  it('matches Better Auth sign-out with or without a trailing slash, POST only', () => {
    expect(isSignOutRequest(url('/api/auth/sign-out'), 'POST')).toBe(true);
    expect(isSignOutRequest(url('/api/auth/sign-out/'), 'POST')).toBe(true);
    expect(isSignOutRequest(url('/api/auth/sign-out'), 'GET')).toBe(false);
    expect(isSignOutRequest(url('/api/auth/sign-in'), 'POST')).toBe(false);
  });
});

describe('purgeCachedApiData', () => {
  it('deletes the read-model cache and any user-scoped variant, and nothing else', () => {
    const caches = fakeCaches([READ_MODEL_CACHE, `${READ_MODEL_CACHE}:user-1`, 'workbox-precache-v2', 'unrelated']);
    return purgeCachedApiData(caches).then(() => {
      expect(caches.deleted.sort()).toEqual([READ_MODEL_CACHE, `${READ_MODEL_CACHE}:user-1`].sort());
    });
  });

  it('survives storage that throws (private mode, quota) without rejecting', async () => {
    const throwing: CacheStorageLike = {
      keys: async () => {
        throw new Error('no storage');
      },
      delete: async () => false,
    };
    await expect(purgeCachedApiData(throwing)).resolves.toBeUndefined();
    await expect(purgeCachedApiData(undefined)).resolves.toBeUndefined();
  });
});

describe('isSessionEnded', () => {
  it('treats 401 and 403 as the end of the session, and nothing else', () => {
    expect(isSessionEnded({ status: 401 })).toBe(true);
    expect(isSessionEnded({ status: 403 })).toBe(true);
    expect(isSessionEnded({ status: 200 })).toBe(false);
    expect(isSessionEnded({ status: 404 })).toBe(false);
    // A 500 is the server having a bad day, not the session ending — do not throw the offline cache away.
    expect(isSessionEnded({ status: 500 })).toBe(false);
  });
});

describe('handleReadModelRequest', () => {
  let caches: ReturnType<typeof fakeCaches>;
  beforeEach(() => {
    caches = fakeCaches([READ_MODEL_CACHE]);
  });

  it('returns what the strategy returned and leaves the cache alone on success', async () => {
    const ok = new Response('{}', { status: 200 });
    await expect(handleReadModelRequest({ request: req('/api/goals'), strategy: strategyReturning(ok), cacheStorage: caches })).resolves.toBe(ok);
    expect(caches.deleted).toEqual([]);
  });

  it('empties the cache before returning a 401, so the next offline open has nothing to serve', async () => {
    const unauthorized = new Response('', { status: 401 });
    const response = await handleReadModelRequest({ request: req('/api/goals'), strategy: strategyReturning(unauthorized), cacheStorage: caches });
    // The real response is passed through untouched — the page's auth gate has to see the real status.
    expect(response.status).toBe(401);
    expect(caches.deleted).toEqual([READ_MODEL_CACHE]);
  });

  it('does not purge on a server error, which would delete the offline data exactly when it is needed', async () => {
    await handleReadModelRequest({ request: req('/api/goals'), strategy: strategyReturning(new Response('', { status: 503 })), cacheStorage: caches });
    expect(caches.deleted).toEqual([]);
  });

  it('passes the fetch event through to the strategy so `waitUntil` can extend the request lifetime', async () => {
    const handle = vi.fn(async () => new Response('{}'));
    const event = { tag: 'fetch-event' };
    await handleReadModelRequest({ request: req('/api/tasks'), event, strategy: { handle }, cacheStorage: caches });
    expect(handle).toHaveBeenCalledWith({ request: expect.any(Request), event });
  });
});

describe('handleSignOutRequest', () => {
  it('purges after a successful sign-out and returns the API response verbatim', async () => {
    const caches = fakeCaches([READ_MODEL_CACHE]);
    const apiResponse = new Response('{"ok":true}', { status: 200 });
    const response = await handleSignOutRequest({ request: req('/api/auth/sign-out', 'POST'), fetchFn: async () => apiResponse, cacheStorage: caches });
    expect(response).toBe(apiResponse);
    expect(caches.deleted).toEqual([READ_MODEL_CACHE]);
  });

  it('keeps the cache when the sign-out failed — the session is still live', async () => {
    const caches = fakeCaches([READ_MODEL_CACHE]);
    await handleSignOutRequest({ request: req('/api/auth/sign-out', 'POST'), fetchFn: async () => new Response('', { status: 500 }), cacheStorage: caches });
    expect(caches.deleted).toEqual([]);
  });
});

describe('parseClientMessage', () => {
  it('accepts the one message we handle', () => {
    expect(parseClientMessage({ type: 'clear-cached-data' })).toEqual({ type: 'clear-cached-data' });
  });

  it('drops anything else — `event.data` is reachable from any page in scope', () => {
    for (const raw of [null, undefined, 'clear-cached-data', 42, [], {}, { type: 'purge' }, { type: { toString: () => 'clear-cached-data' } }]) {
      expect(parseClientMessage(raw)).toBeNull();
    }
  });
});
