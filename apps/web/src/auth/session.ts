import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { auth, toAuthError } from './client';
import { useUI } from '../context/UIContext';
import { keys } from '../lib/queryClient';
import { purgeSession } from './purge';

/**
 * Starting and ending a session. The GATE itself is `useSession()` in `api/queries.ts` (`/me` → 401);
 * these two helpers move everything this device holds so that the gate sees the right thing next. Both go
 * through the one purge path in `auth/purge.ts` — see the table there for every exit.
 *
 *  - `afterSignIn()` purges whatever the previous identity left behind BEFORE the new `/me` lands, then
 *    resets `['me']` so the gate re-runs. Purging first matters: the persister keys its blob on the
 *    identity record, so a cache still holding the previous account's goals would otherwise be written
 *    out under the new user id on the very next successful query.
 *
 *  - `signOut()` calls Better Auth, then the same purge, the UI reset, and the `<App key={sessionEpoch}>`
 *    remount → `/me` → 401 → `AuthScreen`.
 */
export function useAuthActions() {
  const qc = useQueryClient();
  const ui = useUI();
  const [signingOut, setSigningOut] = useState(false);

  const afterSignIn = useCallback(async () => {
    await purgeSession(qc, 'sign-in');
    await qc.resetQueries({ queryKey: keys.me, exact: true });
  }, [qc]);

  const signOut = useCallback(async (): Promise<boolean> => {
    setSigningOut(true);
    try {
      await auth.signOut();
    } catch (e) {
      const err = toAuthError(e);
      // Offline or a server fault: the session cookie is STILL VALID, so pretending to be signed out would
      // leave the next person on this device one "Try again" away from walking back into the account. Stay
      // put and say so.
      if (err.code === 'NETWORK' || err.status >= 500) {
        setSigningOut(false);
        ui.showToast("Couldn't sign out — check the connection and try again", { tone: 'error' });
        return false;
      }
      // A 401/403 means the session was already gone; clear the device either way.
    }
    await purgeSession(qc, 'sign-out');
    // Bumps `sessionEpoch`, which remounts the tree against the cleared cache.
    ui.resetSession();
    return true;
  }, [qc, ui]);

  return { afterSignIn, signOut, signingOut };
}
