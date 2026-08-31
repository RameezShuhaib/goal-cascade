import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { AppRoot } from '../../src/App';
import { useGoals } from '../../src/api/queries';
import { renderApp } from '../render';
import { apiError, server } from '../msw/handlers';
import * as F from '../msw/fixtures';

/**
 * The gate has exactly four states and they are decided by `/me`, never by the URL. That is the property
 * worth pinning: it is what makes a deep link and a PWA cold start behave, and it is the first thing a
 * refactor towards a router would quietly break.
 */
describe('the session gate', () => {
  it('pending → the splash', async () => {
    server.use(http.get('/api/me', async () => {
      await delay('infinite');
      return HttpResponse.json(F.me());
    }));
    renderApp(<AppRoot />, { withToast: false });
    expect(await screen.findByText('Opening your cascade…')).toBeInTheDocument();
  });

  it('401 → the auth screen, whatever the URL says', async () => {
    // A deep link on the boot URL must not be able to route around the gate.
    window.history.replaceState(null, '', '/?tab=goals');
    server.use(http.get('/api/me', () => apiError('UNAUTHENTICATED')));
    renderApp(<AppRoot />, { withToast: false });
    expect(await screen.findByText('Welcome back')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Goals' })).not.toBeInTheDocument();
  });

  it('a non-401 error → the retry screen, and Try again refetches', async () => {
    // A body that fails the shared schema: `BAD_RESPONSE`, which `shouldRetry` correctly refuses to retry
    // (a contract drift will not heal), so the gate lands on the retry screen rather than looping.
    let attempts = 0;
    server.use(
      http.get('/api/me', () => {
        attempts += 1;
        return attempts === 1 ? HttpResponse.json({ nonsense: true }) : HttpResponse.json(F.me());
      }),
    );
    const { user } = renderApp(<AppRoot />, { withToast: false });
    expect(await screen.findByText("Couldn't reach Goal Cascade")).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: 'Goals' })).toBeInTheDocument();
  });

  it('a session → the app shell', async () => {
    renderApp(<AppRoot />, { withToast: false });
    expect(await screen.findByRole('button', { name: 'Goals' })).toBeInTheDocument();
    expect(screen.queryByText('Welcome back')).not.toBeInTheDocument();
  });

  it('a 401 from a read mid-session drops to the auth screen and clears the persisted cache', async () => {
    // The session dies while the app is open: `/me` is still cached and happy, and only the next read
    // reveals it. The 401 has to reach the gate through `['me']`, not be swallowed by the failing query.
    const s = { signedIn: true };
    server.use(
      http.get('/api/me', () => (s.signedIn ? HttpResponse.json(F.me()) : apiError('UNAUTHENTICATED'))),
      http.get('/api/goals', () => {
        s.signedIn = false;
        return apiError('UNAUTHENTICATED');
      }),
    );
    window.localStorage.setItem('goal-cascade.query-cache:user_owner', '{"stale":"goals"}');

    // The mockup shell reads nothing yet, so stand in for a migrated screen with the real read hook. The
    // path under test is entirely in `createQueryClient`: a 401 on ANY query invalidates `['me']`.
    function WithAScreenQuery() {
      useGoals();
      return <AppRoot />;
    }
    renderApp(<WithAScreenQuery />, { withToast: false });

    expect(await screen.findByText('Welcome back')).toBeInTheDocument();
    await waitFor(() => expect(window.localStorage.getItem('goal-cascade.query-cache:user_owner')).toBeNull());
  });
});
