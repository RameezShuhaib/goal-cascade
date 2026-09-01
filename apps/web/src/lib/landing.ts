/**
 * The two things that arrive on the boot URL and are **not** routes.
 *
 * ⚠ **A2** — `lib/useUrlSync.ts` and `pwa/deepLink.ts` are both deleted, and this is what is left of them.
 * They existed because there was no router: the URL was read once at boot and mirrored one way afterwards,
 * and a deep link had to be parked in `sessionStorage` so it could survive the sign-in round trip. With a
 * real router (R-nav-24) the location IS the state — a `/task/:id` link opened while signed out is still
 * `/task/:id` when the gate opens, with no bookkeeping at all — so the parking lot has nothing to hold.
 *
 * Auth landings still need handling, and they need the opposite of persistence: `?verified=1` and
 * `?reset=1&token=…` must be read once and then **stripped**, because a reload would otherwise re-enter
 * the reset flow with a token that has already been spent.
 */
export interface UrlLanding {
  /** `?verified=1` — Better Auth's `callbackURL` after a verification link. */
  verified: boolean;
  /** `/?reset=1&token=…` — the URL the Worker's reset mail points at. `error` when the link was rejected. */
  reset: { token: string | null; error: string | null } | null;
}

export function parseLanding(search: string): UrlLanding {
  const q = new URLSearchParams(search);
  const reset = q.get('reset');
  return {
    verified: q.get('verified') === '1',
    // `?reset=1&token=X` is what the Worker sends; `?reset=X` is accepted as a shorthand.
    reset: reset ? { token: q.get('token') ?? (reset !== '1' ? reset : null), error: q.get('error') } : null,
  };
}

