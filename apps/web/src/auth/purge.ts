/**
 * The ONE place a Goal Cascade session is torn off this device.
 *
 * There are three exits and they must all clear the same things, or the one that forgets something is the
 * one that leaks. So there is one function and a `SessionExit` discriminator, not three near-copies:
 *
 * | exit                                | call                                  |
 * |-------------------------------------|---------------------------------------|
 * | Sign out                            | `purgeSession(qc, 'sign-out')`        |
 * | a 401 from any query / expiry       | `purgeSession(qc, 'session-expired')` |
 * | a different account signs in        | `purgeSession(qc, 'sign-in')`         |
 *
 * What goes, in order: the mutation cache, the query cache, every persisted query-cache blob (every
 * account's — the point of calling this is that we no longer know whose device this is), every
 * `goal-cascade.` device key, the identity record, and the service worker's read-model cache.
 *
 * Dropping the identity record is what makes the rest safe rather than merely tidy: with no identity the
 * persister writes nothing and restores nothing, so anything that survived a failed delete is unreachable
 * instead of merely unlikely to be reached.
 */
import type { QueryClient } from '@tanstack/react-query';
import { purgeCachedApiData } from '../sw/handlers';
import { wipePersistedCache } from '../lib/queryClient';
import { forgetIdentity } from './identity';

export type SessionExit = 'sign-out' | 'sign-in' | 'session-expired';

const isMeKey = (key: readonly unknown[]) => key.length === 1 && key[0] === 'me';

/**
 * Sweep the whole `goal-cascade.` namespace rather than named keys. Removing keys by name is how a device
 * key added later gets left behind by a purge written earlier.
 */
function sweep(store: Storage | undefined): void {
  if (!store) return;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (key?.startsWith('goal-cascade.')) doomed.push(key);
    }
    for (const key of doomed) store.removeItem(key);
  } catch {
    /* private mode / no storage */
  }
}

/**
 * Drop every cached API response the service worker holds, from the page. `CacheStorage` is same-origin,
 * so no controlling worker is needed — the `postMessage` is belt and braces for a worker already running.
 *
 * The worker purges the same set itself on a 2xx sign-out and on any 401/403 read (`sw/handlers.ts`), which
 * covers only the paths that produce one of those. This covers the rest.
 */
export async function clearCachedApiData(): Promise<void> {
  try {
    if (typeof caches !== 'undefined') await purgeCachedApiData(caches);
  } catch {
    /* storage blocked (private mode / no SW) — nothing was cached either */
  }
  try {
    navigator.serviceWorker?.controller?.postMessage({ type: 'clear-cached-data' });
  } catch {
    /* no controller yet */
  }
}

export async function purgeSession(qc: QueryClient, exit: SessionExit): Promise<void> {
  qc.getMutationCache().clear();
  if (exit === 'sign-out') {
    // `<App>` is about to remount on a bumped `sessionEpoch`; nothing may survive that.
    qc.clear();
  } else {
    // `['me']` carries the 401 that drives the session gate (and, on sign-in, is about to be refetched).
    // Clearing it here would put the gate back to `pending` and flash the splash on the way out.
    qc.removeQueries({ predicate: (q) => !isMeKey(q.queryKey) });
  }

  wipePersistedCache();
  sweep(typeof window !== 'undefined' ? window.localStorage : undefined);
  // A pending deep link is held in `sessionStorage` and may name a goal from the account we are leaving.
  // Only a sign-in keeps one, because that link was captured on this page load by the person signing in.
  if (exit !== 'sign-in') sweep(typeof window !== 'undefined' ? window.sessionStorage : undefined);

  forgetIdentity();
  await clearCachedApiData();
}
