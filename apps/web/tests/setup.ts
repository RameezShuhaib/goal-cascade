import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { cleanup } from '@testing-library/react';
import { resetRequests, server } from './msw/handlers';
import { resetServerClock } from '../src/lib/serverClock';

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
  server.resetHandlers();
  resetRequests();
  resetServerClock();
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
