import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { usePatchPreferences, usePreferences, useSession } from './api/queries';
import { onIdentityChanged } from './auth/identity';
import { purgeSession } from './auth/purge';
import { ThemeProvider } from './context/ThemeContext';
import { useUI } from './context/UIContext';
import { parseLanding, type UrlLanding } from './lib/landing';
import AuthScreen from './components/auth/AuthScreen';
import { Lede, PrimaryButton, Splash } from './components/auth/ui';
import { UIToast } from './components/Toast';
import { AppShell } from './AppShell';

/**
 * The application root.
 *
 * `sessionEpoch` is bumped by sign-out, and keying the gate on it remounts every query observer against the
 * cleared cache. Resetting observers by hand is the alternative, and it is the kind of thing that works
 * until the day someone adds a hook and forgets.
 */
export function AppRoot() {
  const { sessionEpoch, resetSession } = useUI();
  const qc = useQueryClient();

  /*
   * The multi-tab case. Two tabs of this origin share one identity record but not one query cache: when the
   * other tab signs a different account in, this tab still holds the previous one's goals in memory — and
   * the persister resolves its key from the identity on every WRITE, so the next thing this tab persists
   * would be filed under whoever just signed in. Dropping the cache here is what stops that. `resetSession()`
   * bumps the epoch for the same reason sign-out does: `qc.clear()` alone leaves mounted observers pointing
   * at destroyed queries, so nothing refetches until the gate remounts.
   */
  useEffect(
    () =>
      onIdentityChanged(() => {
        qc.clear();
        resetSession();
      }),
    [qc, resetSession],
  );

  return <App key={sessionEpoch} />;
}

/**
 * The session gate — driven by `/me`, NEVER by the URL:
 *
 *   pending → splash · 401 → AuthScreen · other error → retry · else → the app shell
 *
 * Routing auth off server state rather than the address bar is what makes deep links and PWA cold starts
 * behave: a cold start with a live cookie never flashes the sign-in screen on its way to the app.
 *
 * ⚠ **A2 (R-nav-24)** — the router sits ABOVE this gate (`main.tsx`), which is what makes a deep link
 * opened while signed out survive the sign-in round trip for nothing: the gate renders `AuthScreen` in
 * place of the routes and the location never changes, so the route is still there when the session lands.
 * The deep-link parking lot (`pwa/deepLink.ts`) is deleted because it has nothing left to hold.
 */
export default function App() {
  const qc = useQueryClient();
  const ui = useUI();
  const { me, signedOut } = useSession();
  const prefs = usePreferences();
  const patchPrefs = usePatchPreferences();
  const [landing, setLanding] = useState<UrlLanding | null>(null);

  /**
   * ⚠ **A2** — this is all that is left of `useUrlSync`. There is a router now (R-nav-24), so nothing has
   * to mirror the screen into the address bar and nothing has to park a deep link across the sign-in round
   * trip: the location survives the gate on its own.
   *
   * The auth landings still have to be read once and stripped, because a reload must not replay a spent
   * reset token. `replaceState` on the pathname alone leaves the ROUTE intact, so `/task/:id?verified=1`
   * still lands on the task page.
   */
  useEffect(() => {
    setLanding(parseLanding(location.search));
    if (location.search) history.replaceState(history.state, '', location.pathname);
  }, []);

  // Once the session is gone, nothing of the last one may stay on this device: not the query cache, not the
  // persisted blob, not the identity record, not the service worker's cached read models. This is the one
  // exit a 401 can reach and a deliberate sign-out cannot.
  useEffect(() => {
    if (!signedOut) return;
    void purgeSession(qc, 'session-expired');
  }, [signedOut, qc]);

  // `?verified=1` — the verification link brought us back. A signed-in user gets a toast; a signed-out one
  // gets the notice on the sign-in screen (below), because a toast over an auth form is easy to miss.
  const data = me.data;
  const [verifiedToasted, setVerifiedToasted] = useState(false);
  useEffect(() => {
    if (!landing?.verified || verifiedToasted || !data) return;
    setVerifiedToasted(true);
    ui.showToast('Email verified');
  }, [landing?.verified, data, verifiedToasted, ui]);

  const themed = (children: React.ReactNode) => (
    <ThemeProvider serverTheme={prefs.data?.preferences.theme} onChange={(theme) => patchPrefs.mutate({ theme })}>
      {children}
      {/* R-nav-13 — the ONE toast in the app. The mockup's `useStore`-driven second one is gone. */}
      <UIToast />
    </ThemeProvider>
  );

  if (me.isPending) return themed(<Splash>Opening your cascade…</Splash>);

  if (signedOut) {
    return themed(
      <AuthScreen
        notice={landing?.verified ? 'Email verified — sign in to continue' : null}
        reset={landing?.reset ?? null}
        onResetDone={() => setLanding((l) => (l ? { ...l, reset: null } : l))}
      />,
    );
  }

  // An error that is not a 401 and left us with nothing to render: offer the retry rather than an empty app.
  if (me.error && !data) {
    return themed(<RetryScreen onRetry={() => void me.refetch()} />);
  }

  return themed(<AppShell />);
}

function RetryScreen({ onRetry }: { onRetry: () => void }) {
  return (
    <Splash>
      <div style={{ fontWeight: 800, fontSize: 18 }}>Couldn&apos;t reach Goal Cascade</div>
      <Lede>Check the connection, then try again.</Lede>
      <div style={{ width: 220 }}>
        <PrimaryButton type="button" onClick={onRetry}>
          Try again
        </PrimaryButton>
      </div>
    </Splash>
  );
}
