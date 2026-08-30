/// <reference lib="webworker" />
/**
 * Goal Cascade service worker (vite-plugin-pwa `injectManifest`; compiled with tsconfig.sw.json, which is the
 * only tsconfig that gives it the `WebWorker` lib — see the note in `tsconfig.json`).
 *
 *  - Workbox precache of the app shell (`self.__WB_MANIFEST` is injected at build time).
 *  - SPA navigations → the precached index.html, never `/api/*` or `/internal/*`.
 *  - `NetworkFirst` for GET read models so a flaky connection still shows the last state.
 *  - Sign-out and any 401/403 empty that cache.
 *
 * This file is **wiring only**. Every decision — what counts as a read model, when the cache must be dropped,
 * what a page message may say — lives in `sw/handlers.ts`, where it is importable and unit-tested. Logic that
 * only exists inside an event listener here is logic no test can reach.
 */
import { clientsClaim } from 'workbox-core';
import { ExpirationPlugin } from 'workbox-expiration';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { NetworkFirst } from 'workbox-strategies';
import {
  handleReadModelRequest,
  handleSignOutRequest,
  isReadModelRequest,
  isSignOutRequest,
  parseClientMessage,
  purgeCachedApiData,
  READ_MODEL_CACHE,
  type ReadModelStrategy,
} from './sw/handlers';

declare let self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null } | string> };

// `registerType: 'autoUpdate'`: the new worker takes over at once; the page shows "Update available — Reload"
// rather than reloading under the user's hands (see `pwa/updateToast.ts`).
self.skipWaiting();
clientsClaim();

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// The Worker serves index.html for every unknown path, and so must we — except for the two prefixes it
// answers itself. Without the denylist an offline `/api/*` request is handed the HTML shell, and the client
// tries to `JSON.parse` a `<!DOCTYPE html>`.
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html'), { denylist: [/^\/api\//, /^\/internal\//] }));

const readModels: ReadModelStrategy = new NetworkFirst({
  cacheName: READ_MODEL_CACHE,
  // Long enough to ride out a tunnel, short enough that the app does not feel hung on a dead connection.
  networkTimeoutSeconds: 6,
  plugins: [new ExpirationPlugin({ maxEntries: 32, maxAgeSeconds: 24 * 60 * 60, purgeOnQuotaError: true })],
}) as unknown as ReadModelStrategy;

registerRoute(
  ({ url, request }) => url.origin === self.location.origin && isReadModelRequest(url, request.method),
  ({ request, event }) => handleReadModelRequest({ request, event, strategy: readModels, cacheStorage: caches }),
);

registerRoute(
  ({ url, request }) => url.origin === self.location.origin && isSignOutRequest(url, request.method),
  ({ request }) => handleSignOutRequest({ request, fetchFn: (r) => fetch(r), cacheStorage: caches }),
  'POST',
);

// The page sees things the worker cannot (a live `/api/me`, a 401 on any query). This is how it tells us.
self.addEventListener('message', (event: ExtendableMessageEvent) => {
  const message = parseClientMessage(event.data);
  if (message?.type === 'clear-cached-data') event.waitUntil(purgeCachedApiData(caches));
});
