import type { AppEnv } from '../../env';

/**
 * R-auth-1 — Goal Cascade is a single-user product: one person's cascade, no sharing, no roles. The
 * owner chose that only their own address may ever register.
 *
 * `SIGNUP_ALLOWLIST` is a comma-separated list of EXACT addresses, compared trimmed and lowercased.
 *
 * **Unset or empty means REFUSE EVERYTHING.** That is the whole point of the default: a deployment that
 * loses its var, a preview environment nobody configured, or a typo in `wrangler.jsonc` must close
 * sign-up, not open it. The failure mode of a misconfigured allowlist has to be "the owner cannot sign
 * up and notices", never "anyone can".
 *
 * There is deliberately no glob support. A pattern is one edit away from `*`, and this list exists
 * precisely to make that edit impossible to make by accident.
 */
export function parseSignupAllowlist(env: AppEnv): string[] {
  return (env.SIGNUP_ALLOWLIST ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** True only for an address explicitly listed. An empty list matches nothing — see above. */
export function isSignupAllowed(env: AppEnv, email: string): boolean {
  const allowed = parseSignupAllowlist(env);
  if (allowed.length === 0) return false;
  return allowed.includes(email.trim().toLowerCase());
}

/**
 * Thrown out of Better Auth's `databaseHooks.user.create.before`, which is the LAST point at which no
 * `user` row exists yet — so a refused sign-up leaves the table exactly as it was. `APIError` is what
 * Better Auth's own handlers throw, so it renders as a proper HTTP response inside the auth router
 * rather than escaping as a 500; the `code` is what the client matches on.
 *
 * The message is deliberately about the product ("this deployment is single-user"), not about whether
 * the given address exists anywhere.
 */
export const SIGNUP_NOT_ALLOWED_STATUS = 403;
export const SIGNUP_NOT_ALLOWED_CODE = 'SIGNUP_NOT_ALLOWED';
export const SIGNUP_NOT_ALLOWED_MESSAGE = 'sign-up is not open: this deployment is single-user';
