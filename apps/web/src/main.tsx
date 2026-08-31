import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { BrowserRouter } from 'react-router';
import { createQueryClient, identityPersister } from './lib/queryClient';
import { ApiProvider } from './context/ApiContext';
import { UIProvider } from './context/UIContext';
import { bootDocumentTheme } from './context/ThemeContext';
import './pwa/boot'; // PWA: install-prompt capture, deep-link capture, SW registration — side effects only.
import { AppRoot } from './App';

// `index.html`'s first paint can only follow `prefers-color-scheme`; the user's stored choice may say
// otherwise, and the CSP forbids an inline boot script that could read it. Repaint the document before the
// tree renders, so a dark-mode phone never flashes white on a cold open.
bootDocumentTheme();

const queryClient = createQueryClient();

/**
 * Offline cold open (Q-15: a read cache, never a mutation queue). The last week's tasks and goals render
 * with no signal — but only for the account this device last saw a live `GET /api/me` 200 for: the persister
 * keys its blob on the identity record and writes NOTHING while that is unknown.
 *
 * Private mode throws on the first `setItem`, so probe once and fall back to a plain in-memory client rather
 * than letting every persist attempt throw for the life of the session.
 */
function usableStorage(): Storage | null {
  try {
    const s = window.localStorage;
    s.setItem('goal-cascade.probe', '1');
    s.removeItem('goal-cascade.probe');
    return s;
  } catch {
    return null;
  }
}
const store = usableStorage();
const persister = store ? identityPersister(store) : null;

/**
 * The provider nest. Order is load-bearing:
 *
 *   query client → BrowserRouter → ApiProvider → UIProvider → AppRoot ( → ThemeProvider, inside the gate )
 *
 * `ApiProvider` is above everything because it is dependency injection — one seam, and a test swaps the
 * network for the whole tree by passing a different client. `UIProvider` is above the gate because UI state
 * has to survive it, and `sessionEpoch` (which remounts the gate) obviously cannot live inside the thing it
 * remounts. `ThemeProvider` is inside `App`, because it needs `/me/preferences` and must not query before
 * the gate knows whether there is a session.
 *
 * ⚠ **A2 (R-nav-24)** — `BrowserRouter` sits ABOVE the auth gate, which is what makes a deep link opened
 * while signed out survive the sign-in round trip for free: the gate renders `AuthScreen` in place of the
 * routes and the location never changes, so the route is still there when the session lands. Routing still
 * decides nothing about auth — the gate runs off `/me`, never off the address bar.
 *
 * `basename` is `/`, and the Worker serves `index.html` for every unknown path, so a pasted `/task/:id`
 * and an installed PWA's deep link both reach the router rather than a 404.
 */
const tree = (
  <BrowserRouter>
    <ApiProvider>
      <UIProvider>
        <AppRoot />
      </UIProvider>
    </ApiProvider>
  </BrowserRouter>
);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {persister ? (
      <PersistQueryClientProvider client={queryClient} persistOptions={{ persister, maxAge: 24 * 60 * 60 * 1000, buster: 'v1' }}>
        {tree}
      </PersistQueryClientProvider>
    ) : (
      <QueryClientProvider client={queryClient}>{tree}</QueryClientProvider>
    )}
  </React.StrictMode>,
);
