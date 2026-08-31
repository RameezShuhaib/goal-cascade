/**
 * Who this browser believes is signed in.
 *
 * It exists for exactly one job: the persisted query cache is keyed on the user id
 * (`goal-cascade.query-cache:<userId>`), and that key has to be resolvable synchronously, on every read
 * and every write, without waiting for `/me`. A blob keyed on nothing is readable by whoever signs in next.
 *
 * The record is written ONLY from a live `GET /api/me` 200. It is not a session and it proves nothing to
 * the server — it is a local answer to "whose cache is this". `sw/handlers.ts` deliberately never caches
 * `/api/me` at all, so there is no cached-identity attack surface to gate here (the reference codebase
 * needed a `CacheStorage` copy and a cache-hit header because its worker did cache the session read; ours
 * takes the blunter, safer route of never caching it).
 *
 * Everything is best-effort against storage: private mode throws on the first `setItem`, and the honest
 * degraded answer is "identity unknown", which means nothing is persisted and nothing is restored.
 */

export const IDENTITY_STORAGE_KEY = 'goal-cascade.identity';

/**
 * How long a record may go unconfirmed before it stops counting. A phone that has not seen a live `/me`
 * for a day should not keep restoring a persisted cache under that user — it matches `maxAge` on the
 * persister in `main.tsx`, so the two expire together rather than one outliving the other.
 */
export const IDENTITY_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface Identity {
  userId: string;
  /** Epoch ms of the live `/me` 200 that wrote this. */
  verifiedAt: number;
}

function parseIdentity(raw: unknown, now: number): Identity | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Partial<Identity>;
  if (typeof v.userId !== 'string' || !v.userId) return null;
  if (typeof v.verifiedAt !== 'number' || !Number.isFinite(v.verifiedAt)) return null;
  if (now - v.verifiedAt > IDENTITY_MAX_AGE_MS) return null;
  return { userId: v.userId, verifiedAt: v.verifiedAt };
}

function readStored(now: number): Identity | null {
  try {
    const raw = window.localStorage.getItem(IDENTITY_STORAGE_KEY);
    return raw ? parseIdentity(JSON.parse(raw) as unknown, now) : null;
  } catch {
    return null;
  }
}

function writeStored(identity: Identity | null): void {
  try {
    if (identity) window.localStorage.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(identity));
    else window.localStorage.removeItem(IDENTITY_STORAGE_KEY);
  } catch {
    /* private mode — no persistence at all, which is the safe degradation */
  }
}

/** The identity this device may currently be trusted with, or `null` when unknown or stale. */
export function currentIdentity(now: number = Date.now()): Identity | null {
  return readStored(now);
}

/** A live `/api/me` 200 — the only thing that may establish or refresh an identity. */
export function recordLiveIdentity(userId: string, now: number = Date.now()): Identity {
  const identity: Identity = { userId, verifiedAt: now };
  writeStored(identity);
  return identity;
}

/** Every exit path calls this (through `auth/purge.ts`). Unknown identity ⇒ nothing persists or restores. */
export function forgetIdentity(): void {
  writeStored(null);
}

/**
 * Another tab changed who is signed in on this origin (`localStorage` is shared; `storage` fires only in the
 * OTHER tabs). That tab purged the device, but this one still holds the previous account's read models in
 * memory — and the persister resolves its key from the identity record on every write, so the next thing
 * this tab persists would be filed under whoever just signed in. The caller drops its cache and remounts.
 *
 * Only a change of `userId` counts: every `/me` 200 rewrites the record with a fresh `verifiedAt`, which
 * would otherwise fire this on every poll in every other tab.
 */
export function onIdentityChanged(handler: (identity: Identity | null) => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  let lastUserId = readStored(Date.now())?.userId ?? null;
  const listener = (event: StorageEvent) => {
    // `key === null` is `localStorage.clear()` from another tab, which takes the record with it.
    if (event.key !== null && event.key !== IDENTITY_STORAGE_KEY) return;
    const next = readStored(Date.now());
    const nextUserId = next?.userId ?? null;
    if (nextUserId === lastUserId) return;
    lastUserId = nextUserId;
    handler(next);
  };
  window.addEventListener('storage', listener);
  return () => window.removeEventListener('storage', listener);
}
