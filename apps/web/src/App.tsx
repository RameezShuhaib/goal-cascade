import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { usePatchPreferences, usePreferences, useSession } from './api/queries';
import { onIdentityChanged } from './auth/identity';
import { purgeSession } from './auth/purge';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import { useUI } from './context/UIContext';
import { useUrlSync, type UrlLanding } from './lib/useUrlSync';
import AuthScreen from './components/auth/AuthScreen';
import { Lede, PrimaryButton, Splash } from './components/auth/ui';
import { AppProvider, useStore } from './store';
import { TabBar } from './components/TabBar';
import { Toast } from './components/Toast';
import { ConfirmSheet, InactiveBranchSheet, TaskDetailSheet } from './components/TaskSheets';
import { BacklogDrawer, TaskCreateModal } from './components/BacklogSheets';
import { GoalModal, MoveGoalModal } from './components/GoalModals';
import { TasksScreen } from './screens/TasksScreen';
import { GoalsScreen } from './screens/GoalsScreen';
import { GoalDetailScreen } from './screens/GoalDetailScreen';
import { BacklogScreen } from './screens/BacklogScreen';
import { IdeasScreen, LearningsScreen } from './screens/CaptureScreens';
import { PlanScreen } from './screens/PlanScreen';
import { colors } from './ui';

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
 * behave: a link opened while signed out is held by `pwa/deepLink.ts` and applied after the gate opens, and
 * a cold start with a live cookie never flashes the sign-in screen on its way to the app.
 *
 * `useUrlSync` only feeds deep links into `ui` and reports the two auth landings (`?verified=1`, `?reset=`).
 * It decides nothing.
 */
export default function App() {
  const qc = useQueryClient();
  const ui = useUI();
  const { me, signedOut } = useSession();
  const prefs = usePreferences();
  const patchPrefs = usePatchPreferences();
  const [landing, setLanding] = useState<UrlLanding | null>(null);
  useUrlSync(setLanding);

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

  return themed(<MockupShell />);
}

/**
 * TEMPORARY — the mockup, rendered as the signed-in tree so the app still runs end to end while the screens
 * are migrated. It is still driven by `store.tsx`: server data comes from `data/mock.ts`, every mutation is
 * a local array edit plus a fire-and-forget `api.persist()`, and nothing on screen has been near the API.
 *
 * The screens agent replaces this whole component. `docs/work/06-web-data/build.md` maps every `Store`
 * method to the hook or `UIContext` action that supersedes it, and names the behaviours that must change
 * because the server now owns the invariant. Delete `store.tsx`, `api/client.ts` and `data/mock.ts` with it.
 */
function MockupShell() {
  return (
    <AppProvider>
      <MockupScreens />
    </AppProvider>
  );
}

function MockupScreens() {
  const s = useStore();
  const v = s.st.view;
  return (
    <div style={{ minHeight: '100vh', background: colors.paper, color: colors.ink, fontFamily: "'Manrope', sans-serif", fontSize: 15, lineHeight: 1.45 }}>
      {v === 'home' && <TasksScreen />}
      {v === 'goals' && <GoalsScreen />}
      {v === 'line' && <GoalDetailScreen />}
      {v === 'backlog' && <BacklogScreen />}
      {v === 'ideas' && <IdeasScreen />}
      {v === 'learn' && <LearningsScreen />}
      {v === 'plan' && <PlanScreen />}
      <TabBar />
      <Toast />
      <TaskDetailSheet />
      <BacklogDrawer />
      <TaskCreateModal />
      <ConfirmSheet />
      <InactiveBranchSheet />
      <GoalModal />
      <MoveGoalModal />
    </div>
  );
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

/**
 * The toast for everything above the mockup: command failures, sign-out problems, `?verified=1`.
 *
 * It lives here rather than in `components/Toast.tsx` because that file is the mockup's, reads `useStore`,
 * and belongs to the screens agent. Once the screens are migrated there is one toast, driven by `UIContext`,
 * and this component moves into `components/`.
 */
export function UIToast() {
  const { toast, hideToast } = useUI();
  const T = useTheme();
  if (!toast) return null;
  return (
    <div
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: `calc(76px + var(--safe-bottom, 0px))`,
        zIndex: 60,
        display: 'flex',
        justifyContent: 'center',
        padding: '0 16px',
      }}
    >
      <div
        role="status"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          background: toast.tone === 'error' ? T.red : T.ink,
          color: T.night && toast.tone !== 'error' ? T.paper : '#fff',
          borderRadius: 20,
          padding: '10px 18px',
          fontSize: 13.5,
          fontWeight: 600,
          maxWidth: '100%',
        }}
      >
        <span>{toast.message}</span>
        {toast.action && (
          <button
            type="button"
            onClick={() => {
              toast.action?.onClick();
              hideToast();
            }}
            style={{
              border: 'none',
              background: 'none',
              color: 'inherit',
              fontWeight: 800,
              fontSize: 13.5,
              textDecoration: 'underline',
              cursor: 'pointer',
              fontFamily: 'inherit',
              padding: 0,
            }}
          >
            {toast.action.label}
          </button>
        )}
      </div>
    </div>
  );
}
