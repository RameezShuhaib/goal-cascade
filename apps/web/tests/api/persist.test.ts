import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { PersistedClient } from '@tanstack/react-query-persist-client';
import { identityPersister, persistKeyFor, wipePersistedCache, PERSIST_KEY_PREFIX } from '../../src/lib/queryClient';
import { currentIdentity, forgetIdentity, recordLiveIdentity, IDENTITY_MAX_AGE_MS } from '../../src/auth/identity';
import { purgeSession } from '../../src/auth/purge';
import { LIGHT, DARK, resolveTokens } from '../../src/context/ThemeContext';
import { MANIFEST_BACKGROUND_COLOR, MANIFEST_DARK_THEME_COLOR, MANIFEST_THEME_COLOR } from '../../src/pwa/manifest';
import { colors } from '../../src/ui';

const blob = (mark: string): PersistedClient =>
  ({ timestamp: Date.now(), buster: 'v1', clientState: { mutations: [], queries: [{ mark }] } }) as unknown as PersistedClient;

describe('the persisted query cache', () => {
  it('writes nothing while the identity is unknown', async () => {
    forgetIdentity();
    const p = identityPersister(window.localStorage);
    await p.persistClient(blob('a'));
    expect(window.localStorage.length).toBe(0);
    expect(await p.restoreClient()).toBeUndefined();
  });

  it('keys the blob on the user id, resolved on every read and write', async () => {
    const p = identityPersister(window.localStorage);

    recordLiveIdentity('user_a');
    await p.persistClient(blob('a'));
    expect(window.localStorage.getItem(persistKeyFor('user_a'))).toContain('"mark":"a"');

    // A sign-in during THIS page load starts persisting under the new user immediately — which a persister
    // bound to one key at boot could not do, because at boot there was no user.
    recordLiveIdentity('user_b');
    await p.persistClient(blob('b'));
    expect(window.localStorage.getItem(persistKeyFor('user_b'))).toContain('"mark":"b"');

    // And B can never restore A's blob: the key does not name them.
    const restored = (await p.restoreClient()) as unknown as { clientState: { queries: { mark: string }[] } };
    expect(restored.clientState.queries[0]!.mark).toBe('b');
  });

  it('treats a record older than the max age as no identity at all', () => {
    window.localStorage.setItem(
      'goal-cascade.identity',
      JSON.stringify({ userId: 'user_a', verifiedAt: Date.now() - IDENTITY_MAX_AGE_MS - 1000 }),
    );
    expect(currentIdentity()).toBeNull();
  });

  it('survives storage that throws (private mode) rather than taking the app with it', async () => {
    const hostile = {
      length: 0,
      key: () => null,
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => undefined,
      clear: () => undefined,
    } as unknown as Storage;
    recordLiveIdentity('user_a');
    const p = identityPersister(hostile);
    await expect(p.persistClient(blob('a'))).resolves.toBeUndefined();
    await expect(p.restoreClient()).resolves.toBeUndefined();
  });

  it('wipes EVERY account’s blob — the point of calling it is that we no longer know whose device this is', () => {
    window.localStorage.setItem(persistKeyFor('user_a'), '{}');
    window.localStorage.setItem(persistKeyFor('user_b'), '{}');
    window.localStorage.setItem(PERSIST_KEY_PREFIX, '{}'); // a legacy unbound key
    window.localStorage.setItem('unrelated', 'keep me');
    wipePersistedCache();
    expect(window.localStorage.getItem(persistKeyFor('user_a'))).toBeNull();
    expect(window.localStorage.getItem(persistKeyFor('user_b'))).toBeNull();
    expect(window.localStorage.getItem(PERSIST_KEY_PREFIX)).toBeNull();
    expect(window.localStorage.getItem('unrelated')).toBe('keep me');
  });
});

describe('purgeSession', () => {
  it('drops the cache, the blob, the whole goal-cascade namespace and the identity', async () => {
    const qc = new QueryClient();
    qc.setQueryData(['me'], { user: { id: 'user_a' } });
    qc.setQueryData(['goals', 0], { goals: [] });
    recordLiveIdentity('user_a');
    window.localStorage.setItem(persistKeyFor('user_a'), '{}');
    window.localStorage.setItem('goal-cascade.theme', 'dark');
    window.sessionStorage.setItem('goal-cascade.deeplink', '{"kind":"tab","tab":"goals"}');

    await purgeSession(qc, 'sign-out');

    expect(qc.getQueryData(['me'])).toBeUndefined();
    expect(qc.getQueryData(['goals', 0])).toBeUndefined();
    expect(window.localStorage.getItem(persistKeyFor('user_a'))).toBeNull();
    expect(window.localStorage.getItem('goal-cascade.theme')).toBeNull();
    expect(window.sessionStorage.getItem('goal-cascade.deeplink')).toBeNull();
    expect(currentIdentity()).toBeNull();
  });

  it('keeps ["me"] on a 401 — it carries the state the gate routes on', async () => {
    const qc = new QueryClient();
    qc.setQueryData(['me'], { user: { id: 'user_a' } });
    qc.setQueryData(['goals', 0], { goals: [] });
    await purgeSession(qc, 'session-expired');
    expect(qc.getQueryData(['me'])).toBeTruthy();
    expect(qc.getQueryData(['goals', 0])).toBeUndefined();
  });

  it('keeps a pending deep link across a sign-in — it was captured by the person signing in', async () => {
    const qc = new QueryClient();
    window.sessionStorage.setItem('goal-cascade.deeplink', '{"kind":"tab","tab":"goals"}');
    await purgeSession(qc, 'sign-in');
    expect(window.sessionStorage.getItem('goal-cascade.deeplink')).toBeTruthy();
  });
});

/**
 * R-nav-12 / D-25 — the theme is a real token set, and the install colours in `src/pwa/manifest.ts` have to
 * name the same two grounds. `tests/pwa/manifest.test.ts` already ties the manifest to `src/ui.ts`; this
 * ties the runtime tokens to it too, so the three cannot drift in a pair.
 */
describe('theme tokens', () => {
  it('are the palette, and match the manifest colours', () => {
    expect(LIGHT.paper).toBe(colors.paper);
    expect(LIGHT.ink).toBe(colors.ink);
    expect(MANIFEST_THEME_COLOR).toBe(LIGHT.paper);
    expect(MANIFEST_BACKGROUND_COLOR).toBe(LIGHT.paper);
    // The dark ground IS the light ink — that is why the manifest can name one literal for both.
    expect(MANIFEST_DARK_THEME_COLOR).toBe(DARK.paper);
    expect(DARK.paper).toBe(colors.ink);
  });

  it('define every token in both sets — a missing dark token renders as `undefined`, i.e. transparent', () => {
    expect(Object.keys(LIGHT).sort()).toEqual(Object.keys(DARK).sort());
    for (const [k, v] of Object.entries(DARK)) expect(v, k).not.toBeUndefined();
  });

  it('resolve `system` against the media query, and an explicit choice against nothing', () => {
    expect(resolveTokens('system', false)).toBe(LIGHT);
    expect(resolveTokens('system', true)).toBe(DARK);
    expect(resolveTokens('light', true)).toBe(LIGHT);
    expect(resolveTokens('dark', false)).toBe(DARK);
  });
});
