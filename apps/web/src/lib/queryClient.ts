import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import type { PersistedClient, Persister } from '@tanstack/react-query-persist-client';
import { isApiError } from '../api/errors';
import { currentIdentity } from '../auth/identity';

/**
 * Query keys, in ONE module. Never inline a key at a call site: an invalidation that misspells a key fails
 * silently and shows stale data, which is the hardest class of bug in this layer to notice.
 *
 * Week-scoped keys carry the OFFSET the caller asked for (`0` = this week), because that is what the hook
 * receives. The response still answers with the absolute `weekStart` (D-1) — the key is a cache address,
 * not a fact about time.
 */
export const keys = {
  me: ['me'] as const,
  preferences: ['me', 'preferences'] as const,
  bootstrap: (week: number) => ['bootstrap', week] as const,
  /**
   * ⚠ **A2 (R-lens-16)** — a lens read is keyed by its HORIZON and its PERIOD, not by a week offset,
   * because that is what the read is scoped to. `null` is "whatever the server says is current": a
   * distinct address on purpose, since the screen rewrites the URL to the canonical key the moment the
   * answer lands and the two must not collide in the cache.
   */
  goalsAll: ['goals'] as const,
  lens: (lens: string, period: string | null) => ['goals', lens, period] as const,
  zoomAll: ['zoom'] as const,
  zoom: (anchor: string | null) => ['zoom', anchor] as const,
  goal: (id: string) => ['goal', id] as const,
  goalAll: (id: string) => ['goal', id] as const,
  tasksAll: ['tasks'] as const,
  tasks: (week: number) => ['tasks', week] as const,
  task: (id: string) => ['task', id] as const,
  backlogAll: ['backlog'] as const,
  backlog: (goalId?: string) => ['backlog', goalId ?? null] as const,
  learnings: ['learnings'] as const,
  /** Whether an agent token exists, and its `last4`. Never the token itself — it is shown once, in memory. */
  agentToken: ['agentToken'] as const,
  /**
   * Q-5 — what deleting one goal would destroy. Per-goal and deliberately ungrouped: it is read once when
   * the delete sheet opens and dropped when it closes (`gcTime: 0`), because a stale count on a
   * confirmation is worse than no count at all.
   */
  goalDeletePreview: (id: string) => ['goalDeletePreview', id] as const,
};

/**
 * Every read model that belongs to the signed-in owner — i.e. everything except `['me']`. A sign-out or a
 * 401 must drop all of them: they are persisted to localStorage for 24h and hold this person's goals,
 * tasks and private notes.
 */
export const OWNER_KEYS: readonly (readonly unknown[])[] = [
  keys.goalsAll,
  ['goal'],
  keys.zoomAll,
  keys.tasksAll,
  ['task'],
  keys.backlogAll,
  keys.learnings,
  keys.agentToken,
  ['bootstrap'],
];

/**
 * localStorage key prefix of the persisted query cache (`main.tsx`). The real key is `<prefix>:<userId>`,
 * so one account's blob is not even addressable while another is signed in. The bare prefix is swept too,
 * because an older build may have written one.
 */
export const PERSIST_KEY_PREFIX = 'goal-cascade.query-cache';
export const persistKeyFor = (userId: string) => `${PERSIST_KEY_PREFIX}:${userId}`;

/** Sweeps EVERY account's blob — the point of calling this is that we no longer know whose device this is. */
export function wipePersistedCache(): void {
  try {
    const store = window.localStorage;
    const doomed: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (key === PERSIST_KEY_PREFIX || key?.startsWith(`${PERSIST_KEY_PREFIX}:`)) doomed.push(key);
    }
    for (const key of doomed) store.removeItem(key);
  } catch {
    /* private mode / no storage */
  }
}

/**
 * A persister that resolves its key from the identity record on EVERY read and write, rather than binding
 * one key when the app boots. Three properties fall out of that, and the third is why it is worth the
 * indirection:
 *
 *  - hydrating another user's blob is impossible: the key never names them;
 *  - nothing is persisted at all while the identity is unknown (signed out, purged, or a record older than
 *    `IDENTITY_MAX_AGE_MS`) — a signed-out device writes nothing and restores nothing;
 *  - a sign-in during THIS page load starts persisting under the new user immediately, with no reload —
 *    which a boot-bound key cannot do, because at boot there was no user yet.
 */
export function identityPersister(store: Storage): Persister {
  return {
    persistClient: async (client: PersistedClient) => {
      const identity = currentIdentity();
      if (!identity) return;
      try {
        store.setItem(persistKeyFor(identity.userId), JSON.stringify(client));
      } catch {
        /* quota or private mode — the cache stays in memory only */
      }
    },
    restoreClient: async () => {
      const identity = currentIdentity();
      if (!identity) return undefined;
      try {
        const raw = store.getItem(persistKeyFor(identity.userId));
        return raw ? (JSON.parse(raw) as PersistedClient) : undefined;
      } catch {
        return undefined;
      }
    },
    removeClient: async () => wipePersistedCache(),
  };
}

/**
 * Retry only on things that might heal on their own: a dropped network and a 5xx. NEVER a 4xx.
 *
 * A 4xx from this API is a decision, not a hiccup (Q-10: every refusal is a typed code). Retrying a
 * `409 NOT_A_WEEKLY_GOAL` cannot make a Monthly goal a Weekly one; it just delays the message by two
 * round trips.
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= 2) return false;
  if (!isApiError(error)) return true;
  return error.code === 'NETWORK' || error.status >= 500;
}

/**
 * One factory for the app and the tests. A 401 from ANY query means the session is gone, so refetch `/me`
 * and let the gate in `App.tsx` take over — the alternative is every screen rendering its own "signed out"
 * state, inconsistently.
 *
 * The `/me` query itself is excluded, or a 401 on `/me` invalidates `/me` and loops forever.
 */
export function createQueryClient(opts: { retry?: boolean } = {}): QueryClient {
  let client: QueryClient;
  const onUnauthenticated = (error: unknown, queryKey?: readonly unknown[]) => {
    if (!isApiError(error) || error.status !== 401) return;
    if (queryKey && queryKey[0] === 'me' && queryKey.length === 1) return;
    void client.invalidateQueries({ queryKey: keys.me, exact: true });
  };
  client = new QueryClient({
    queryCache: new QueryCache({ onError: (error, query) => onUnauthenticated(error, query.queryKey) }),
    mutationCache: new MutationCache({ onError: (error) => onUnauthenticated(error) }),
    defaultOptions: {
      queries: { staleTime: 30_000, refetchOnWindowFocus: true, retry: opts.retry === false ? false : shouldRetry },
      // Q-15: online-only with a read cache. A write is never replayed automatically — a retry is a
      // deliberate act by the person, through `useCommand`'s `retry`, reusing the same Idempotency-Key.
      mutations: { retry: false },
    },
  });
  return client;
}
