/**
 * Service-worker logic, kept free of the `webworker` lib so it can be unit-tested under jsdom
 * (`tests/pwa/sw.test.ts`) and compiled by the main tsconfig. `src/sw.ts` is wiring: it binds these to the
 * real events and owns the Workbox strategy instances. Everything that makes a *decision* lives here.
 *
 * This product has no push (R-nav-14 removes push flows, reports and wizards by design), so the only
 * decisions the worker makes are cache decisions: what may be cached, and when the cache must be dropped.
 */

/**
 * One cache for every read model. It is **not** scoped to a user id, and that is the reason the rules below
 * exist rather than being merely nice-to-have: the only thing standing between two accounts on the same
 * phone is that the cache is emptied the moment a session ends. See `purgeCachedApiData` and
 * `isSessionEnded`.
 */
export const READ_MODEL_CACHE = 'goal-cascade-read-models';

/**
 * GET read models that may be served from cache when the network is slow or gone.
 *
 * Prefixes, not exact paths, so collection *and* item reads are both covered (`/api/goals`, `/api/goals/g1`).
 * The `p + '/'` guard is what stops `/api/goalsomething` from matching `/api/goals`.
 *
 * Keep this in step with the endpoint constants in `@goal-cascade/shared` — a read model that is missing here
 * is merely uncached (safe), but a *write* path that leaks in would be served stale (not safe). Hence the
 * allowlist-of-prefixes shape rather than "anything under /api that is a GET".
 */
export const READ_MODEL_PREFIXES: readonly string[] = ['/api/goals', '/api/tasks', '/api/plan', '/api/backlog', '/api/ideas', '/api/learnings'];

/**
 * `/api/me` is deliberately absent, and this is the single most important line in the file.
 *
 * A cached 200 for the session endpoint is the thing that would let a *signed-out* phone — or the next person
 * to pick it up — be told it is signed in as the previous user, and then be handed that user's cached goals.
 * NestFeed solved this with a user-scoped cache plus an identity record written by the page (`sw/identity.ts`
 * there, security review H-2). We do not have a page-side identity module to lean on yet, so we take the
 * blunt version instead: the session read is always network-only, and everything else is dropped as soon as
 * the session ends. The cost is that a cold open with no network cannot resolve `/me` and shows the retry
 * screen; React Query's localStorage persister still restores the last view once it can.
 */
export const NEVER_CACHED_PREFIXES: readonly string[] = ['/api/me', '/api/auth'];

const underPrefix = (pathname: string, prefixes: readonly string[]) => prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));

export function isReadModelRequest(url: { pathname: string }, method: string): boolean {
  if (method !== 'GET') return false;
  if (underPrefix(url.pathname, NEVER_CACHED_PREFIXES)) return false;
  return underPrefix(url.pathname, READ_MODEL_PREFIXES);
}

/** Better Auth's sign-out (`basePath: '/api/auth'`, `POST /sign-out`). */
export const isSignOutRequest = (url: { pathname: string }, method: string): boolean =>
  method === 'POST' && (url.pathname === '/api/auth/sign-out' || url.pathname === '/api/auth/sign-out/');

/**
 * A 401 or 403 on any read means the session this cache belongs to is over — expired, revoked, or signed out
 * in another tab. Treat it exactly like a sign-out: the cached bodies are the previous session's, and the
 * next offline open would otherwise serve them to whoever is holding the phone.
 */
export const SESSION_ENDED_STATUSES: readonly number[] = [401, 403];
export const isSessionEnded = (response: { status: number }): boolean => SESSION_ENDED_STATUSES.includes(response.status);

/** The slice of `CacheStorage` we use; typed structurally so tests can pass a plain object. */
export interface CacheStorageLike {
  keys(): Promise<string[]>;
  delete(cacheName: string): Promise<boolean>;
}

/**
 * Drop every cached API response. Deletes by prefix rather than by the one known name so that a cache left
 * behind by an older build (or a future per-user variant, `…:<userId>`) is not silently outlived by a rename.
 */
export async function purgeCachedApiData(cacheStorage: CacheStorageLike | undefined): Promise<void> {
  if (!cacheStorage) return;
  try {
    const names = await cacheStorage.keys();
    await Promise.all(names.filter((n) => n === READ_MODEL_CACHE || n.startsWith(`${READ_MODEL_CACHE}:`)).map((n) => cacheStorage.delete(n)));
  } catch {
    /* storage may be unavailable (private mode, quota); a failed purge must not fail the request */
  }
}

/** The bit of a Workbox strategy we depend on — again structural, so a test can hand in a stub. */
export interface ReadModelStrategy {
  handle(options: { request: Request; event?: unknown }): Promise<Response>;
}

/**
 * The read-model route. Runs the `NetworkFirst` strategy, then enforces the one rule the strategy cannot:
 * if the network answered "your session is over", the caches are emptied before the response goes back to the
 * page. Doing it here rather than in a Workbox plugin keeps it testable and keeps the ordering explicit —
 * the purge completes before the page can act on the 401 and re-render.
 */
export async function handleReadModelRequest(args: {
  request: Request;
  event?: unknown;
  strategy: ReadModelStrategy;
  cacheStorage: CacheStorageLike | undefined;
}): Promise<Response> {
  const response = await args.strategy.handle({ request: args.request, event: args.event });
  if (isSessionEnded(response)) await purgeCachedApiData(args.cacheStorage);
  return response;
}

/**
 * Sign-out: pass the request through, and on success drop the cached read models before the next person on a
 * shared phone can be shown them offline. The response is whatever the API said — we never fabricate one,
 * because the page's own sign-out flow needs to see the real status.
 */
export async function handleSignOutRequest(args: {
  request: Request;
  fetchFn: (request: Request) => Promise<Response>;
  cacheStorage: CacheStorageLike | undefined;
}): Promise<Response> {
  const response = await args.fetchFn(args.request);
  if (response.ok) await purgeCachedApiData(args.cacheStorage);
  return response;
}

/**
 * Messages the page may send the worker. The page is the only thing that can see a live `/api/me`, so it —
 * not the worker — knows when a session ended without a sign-out POST (a 401 from any query, a manual cache
 * reset). `postMessage({ type: 'clear-cached-data' })` is how it says so.
 *
 * Parsed tolerantly and narrowly: `event.data` is attacker-reachable from any page in scope, so anything not
 * on this list is dropped rather than pattern-matched loosely.
 */
export type ClientMessage = { type: 'clear-cached-data' };

export function parseClientMessage(raw: unknown): ClientMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const type = (raw as { type?: unknown }).type;
  return type === 'clear-cached-data' ? { type } : null;
}
