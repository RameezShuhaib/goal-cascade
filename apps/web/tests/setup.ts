import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { resetRequests, server } from './msw/handlers';
import { resetServerClock } from '../src/lib/serverClock';
import { resetOwnerClock } from '../src/lib/ownerClock';
import { resetPeriodEchoWarning } from '../src/lens/assertPeriodAgrees';
import { DEFAULT_NOW, resetFixtureNow } from './msw/fixtures';

/**
 * ⚠ **R-lens-30 — the device clock is pinned to the fixtures' instant, and only `Date` is faked.**
 *
 * Until now the client's "today" reached exactly two places (a create-form default and a capture label),
 * so the suite could run against the real wall clock. It cannot any more: the lens header is computed
 * from `(horizon, periodKey, today)`, so a test asserting `Aug 2026` was a test that would start failing
 * on 1 September — a latent flake the suite already carried and nobody had met yet.
 *
 * `toFake: ['Date']` and nothing else. Faking timers wholesale would break MSW, React Query's retries and
 * `userEvent`'s own scheduling; what needs pinning is the calendar, not the event loop. `shouldAdvanceTime`
 * keeps the faked `Date` moving with real time so nothing that measures a duration sees zero.
 *
 * The instant is the fixtures' own `NOW`, so the device clock, the server clock (`serverNow` on every
 * response) and the account timezone all name the same day — which is what the whole product requires of
 * them (R-auth-5) and what the runtime echo assertion checks on every read.
 */
beforeEach(() => {
  resetFixtureNow();
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true, now: new Date(DEFAULT_NOW) });
});

// jsdom has no `matchMedia`; the theme toggle and `detectPlatform` only need it to answer "no".
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

// Node >= 22 defines an experimental `localStorage` / `sessionStorage` global that is a non-functional stub
// unless `--localstorage-file` is set, and it *shadows* jsdom's working implementation. Symptom: the query
// persister and the deep-link store silently no-op in tests and pass for the wrong reason. Give both a real
// in-memory Storage when the global one cannot store.
function installMemoryStorage(name: 'localStorage' | 'sessionStorage') {
  const existing = (globalThis as Record<string, unknown>)[name] as Storage | undefined;
  if (typeof existing?.setItem === 'function') return;
  const mem = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return mem.size;
    },
    key: (i) => [...mem.keys()][i] ?? null,
    getItem: (k) => mem.get(k) ?? null,
    setItem: (k, v) => {
      mem.set(k, String(v));
    },
    removeItem: (k) => {
      mem.delete(k);
    },
    clear: () => mem.clear(),
  };
  Object.defineProperty(globalThis, name, { value: storage, configurable: true, writable: true });
}
installMemoryStorage('localStorage');
installMemoryStorage('sessionStorage');

// `onUnhandledRequest: 'error'` on purpose: a request no handler covers is a real finding — a path the
// client got wrong, or a query nobody meant to fire — and it should fail the test rather than hang it.
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  server.resetHandlers();
  resetRequests();
  resetServerClock();
  // Both are module-level singletons by design — one clock and one "have we already warned" latch per
  // session — so one test's day must not leak into the next's.
  resetOwnerClock();
  resetPeriodEchoWarning();
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch {
    /* ignore */
  }
  // The URL shim mirrors the current tab into the location; do not let one test's navigation boot the next.
  window.history.replaceState(null, '', '/');
});

afterAll(() => server.close());
