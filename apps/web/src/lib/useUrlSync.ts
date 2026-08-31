import { useEffect, useRef } from 'react';
import { useUI, type Screen } from '../context/UIContext';
import { captureDeepLink, onDeepLink, type DeepLink } from '../pwa/deepLink';

/**
 * The URL shim. There is no router (R-nav-1: five fixed tabs, screen and overlay are state), so the URL is
 * read once at boot and mirrored one way afterwards. That removes a dependency and a whole class of
 * "route vs. auth state" bugs — the gate in `App.tsx` runs off `/me`, never off the address bar.
 *
 * Two kinds of thing arrive on the boot URL and they are handled very differently:
 *
 *  - **Auth landings** (`?verified=1`, `?reset=1&token=…`) are reported to the caller and then stripped.
 *    They must not survive into `history`, because a reload would re-enter the reset flow with a token
 *    that has already been spent.
 *  - **Deep links** (`?tab=`, `?goal=`) go through `pwa/deepLink.ts`, which holds them in `sessionStorage`
 *    until something consumes them — so a link opened while signed out survives the sign-in round trip.
 */

/** What the boot URL asked for. */
export interface UrlLanding {
  /** `?verified=1` — Better Auth's `callbackURL` after a verification link. */
  verified: boolean;
  /** `/?reset=1&token=…` — the URL the Worker's reset mail points at. `error` when the link was rejected. */
  reset: { token: string | null; error: string | null } | null;
}

const TAB_SCREEN: Record<string, Screen> = {
  tasks: 'tasks',
  goals: 'goals',
  learnings: 'learnings',
  backlog: 'backlog',
  plan: 'plan',
};

export function parseLanding(search: string): UrlLanding {
  const q = new URLSearchParams(search);
  const reset = q.get('reset');
  return {
    verified: q.get('verified') === '1',
    // `?reset=1&token=X` is what the Worker sends; `?reset=X` is accepted as a shorthand.
    reset: reset ? { token: q.get('token') ?? (reset !== '1' ? reset : null), error: q.get('error') } : null,
  };
}

export function useUrlSync(onLanding?: (l: UrlLanding) => void) {
  const ui = useUI();
  const onLandingRef = useRef(onLanding);
  onLandingRef.current = onLanding;
  // `ui` is a fresh object on every provider render; the subscription must outlive those renders.
  const uiRef = useRef(ui);
  uiRef.current = ui;

  useEffect(() => {
    onLandingRef.current?.(parseLanding(location.search));

    // `pwa/boot.ts` already did this before React mounted in the real app; repeating it is a no-op there
    // and covers the entry points that never import boot (tests, and any embedding of the tree).
    captureDeepLink(location);

    const apply = (link: DeepLink) => {
      const u = uiRef.current;
      if (link.kind === 'goal') u.openGoal(link.goalId);
      else u.setScreen(TAB_SCREEN[link.tab] ?? 'tasks');
    };
    const off = onDeepLink(apply);

    // Everything the URL carried has now been read into state or into the deep-link store. Clearing the
    // query string is what stops a reload replaying a spent reset token or reopening a consumed deep link.
    if (location.search) history.replaceState(history.state, '', location.pathname);

    return off;
  }, []);

  // One-way mirror, so a reload or a shared link lands where you were. `replaceState`, not `pushState`:
  // the tab bar is not history, and Android back should leave the app rather than walk back through tabs.
  // The shapes written here are exactly the ones `pwa/deepLink.ts` parses, so a mirrored URL is a valid
  // deep link — a copied address bar reopens the same screen.
  useEffect(() => {
    const query =
      ui.screen === 'tasks' ? '' : ui.screen === 'goal' && ui.goalId ? `?tab=goals&goal=${encodeURIComponent(ui.goalId)}` : `?tab=${ui.screen}`;
    history.replaceState(history.state, '', location.pathname + query);
  }, [ui.screen, ui.goalId]);
}
