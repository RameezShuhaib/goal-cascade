import { createAuthClient } from 'better-auth/react';
import { HEADERS } from '@goal-cascade/shared';
import { deviceTimezone } from '../api/http';

/**
 * Self-hosted Better Auth, mounted by the Worker at `/api/auth/*` on the same origin as the SPA.
 * `basePath` (not `baseURL`) keeps the client relative: Better Auth resolves it against
 * `window.location.origin`, so dev (the Vite proxy), preview and production all work without config.
 */
export const authClient = createAuthClient({
  basePath: '/api/auth',
  // Resolve `fetch` per call (not at import) so test interceptors and polyfills installed later are honoured.
  fetchOptions: { customFetchImpl: (input, init) => fetch(input, init) },
});

/**
 * Where Better Auth sends the browser after a verification link. `useUrlSync` consumes these.
 *
 * The reset landing is NOT a Better Auth redirect: `sendResetPassword` in the Worker builds
 * `/?reset=1&token=<token>` itself, so the link in the outbox IS this URL.
 */
export const VERIFIED_CALLBACK = '/?verified=1';
export const RESET_CALLBACK = '/?reset=1';

/**
 * Better Auth's own error codes the screens care about — its body is `{ code, message }`, NOT the SPEC §5
 * envelope, which is why this lives beside `api/errors.ts` rather than inside it.
 *
 * `SIGNUP_NOT_ALLOWED` is Goal Cascade's own (R-auth-1): the Worker throws it from
 * `databaseHooks.user.create.before`, so it arrives through the Better Auth error channel with a 403.
 */
export type AuthErrorCode =
  | 'INVALID_EMAIL_OR_PASSWORD'
  | 'USER_ALREADY_EXISTS'
  | 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL'
  | 'PASSWORD_TOO_SHORT'
  | 'PASSWORD_TOO_LONG'
  | 'INVALID_EMAIL'
  | 'EMAIL_NOT_VERIFIED'
  | 'EMAIL_ALREADY_VERIFIED'
  | 'INVALID_TOKEN'
  | 'TOKEN_EXPIRED'
  | 'SIGNUP_NOT_ALLOWED'
  | 'RATE_LIMITED'
  | 'NETWORK'
  | 'UNKNOWN';

export class AuthError extends Error {
  constructor(
    public readonly code: AuthErrorCode,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export const isAuthError = (e: unknown): e is AuthError => e instanceof AuthError;

interface FetchFailure {
  code?: string;
  message?: string;
  status?: number;
  statusText?: string;
}

const KNOWN = new Set<string>([
  'INVALID_EMAIL_OR_PASSWORD',
  'USER_ALREADY_EXISTS',
  'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL',
  'PASSWORD_TOO_SHORT',
  'PASSWORD_TOO_LONG',
  'INVALID_EMAIL',
  'EMAIL_NOT_VERIFIED',
  'EMAIL_ALREADY_VERIFIED',
  'INVALID_TOKEN',
  'TOKEN_EXPIRED',
  'SIGNUP_NOT_ALLOWED',
]);

/** Map a `{ data, error }` failure (or a thrown fetch) onto our code list. */
export function toAuthError(e: unknown): AuthError {
  if (isAuthError(e)) return e;
  const f = (e && typeof e === 'object' ? e : {}) as FetchFailure;
  const status = typeof f.status === 'number' ? f.status : 0;
  const message = typeof f.message === 'string' ? f.message : (f.statusText ?? 'auth request failed');
  if (typeof f.code === 'string' && KNOWN.has(f.code)) return new AuthError(f.code as AuthErrorCode, status, message);
  if (status === 0) return new AuthError('NETWORK', 0, message);
  if (status === 429) return new AuthError('RATE_LIMITED', status, message);
  return new AuthError('UNKNOWN', status, message);
}

/**
 * The copy for every code the owner of a single-user app can actually hit.
 *
 * `SIGNUP_NOT_ALLOWED` is the one worth reading carefully. It is not a fault and it is not a bug report:
 * this deployment holds one person's cascade, and the allowlist refusing an address is the product working
 * exactly as designed. The copy says so plainly and points at the sign-in tab, because the only person who
 * ever sees it is either the owner typing the wrong address or someone who was never getting an account.
 */
export function authCopy(err: AuthError): string {
  switch (err.code) {
    case 'INVALID_EMAIL_OR_PASSWORD':
      return "That email and password don't match.";
    case 'SIGNUP_NOT_ALLOWED':
      return 'Goal Cascade is a single-person app — sign-up is open to one address only. If that address is yours, check the spelling; otherwise sign in.';
    case 'USER_ALREADY_EXISTS':
    case 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL':
      return 'There is already an account for that email — sign in instead?';
    case 'PASSWORD_TOO_SHORT':
      return 'Passwords need at least 8 characters.';
    case 'PASSWORD_TOO_LONG':
      return 'That password is too long — 128 characters is plenty.';
    case 'INVALID_EMAIL':
      return "That doesn't look like an email address.";
    case 'EMAIL_ALREADY_VERIFIED':
      return 'Already verified — carry on.';
    case 'INVALID_TOKEN':
    case 'TOKEN_EXPIRED':
      return 'That link has expired. Request a new one and read it out of the outbox.';
    case 'RATE_LIMITED':
      return 'Too many tries — give it a minute.';
    case 'NETWORK':
      return "Couldn't reach Goal Cascade — try again.";
    default:
      return "Couldn't do that just now — try again.";
  }
}

const unwrap = <T>(res: { data: T | null; error: FetchFailure | null }): T => {
  if (res.error) throw toAuthError(res.error);
  return res.data as T;
};

const guard = async <T>(call: () => Promise<{ data: T | null; error: FetchFailure | null }>): Promise<T> => {
  try {
    return unwrap(await call());
  } catch (e) {
    throw toAuthError(e);
  }
};

/**
 * Thin wrappers: one call each, throwing `AuthError`. These are NOT commands — Better Auth is not behind
 * the idempotency middleware, so no `Idempotency-Key` goes out and none is expected.
 *
 * Every flow the product has is here: sign-up, sign-in, sign-out, verification (send), forgot-password
 * (request), and password reset (redeem). There is no other auth surface.
 */
export const auth = {
  signUp: (v: { name: string; email: string; password: string }) =>
    guard(() =>
      authClient.signUp.email({
        name: v.name,
        email: v.email,
        password: v.password,
        callbackURL: VERIFIED_CALLBACK,
        // R-auth-5 — `ProvisionUserService` seeds `preferences.timezone` from this header, and the stored
        // zone is authoritative for every week boundary in the product from then on.
        fetchOptions: { headers: { [HEADERS.timezone]: deviceTimezone() } },
      }),
    ),
  signIn: (v: { email: string; password: string }) => guard(() => authClient.signIn.email({ email: v.email, password: v.password })),
  signOut: () => guard(() => authClient.signOut()),
  sendVerificationEmail: (email: string) => guard(() => authClient.sendVerificationEmail({ email, callbackURL: VERIFIED_CALLBACK })),
  requestPasswordReset: (email: string) => guard(() => authClient.requestPasswordReset({ email, redirectTo: RESET_CALLBACK })),
  resetPassword: (v: { token: string; newPassword: string }) =>
    guard(() => authClient.resetPassword({ token: v.token, newPassword: v.newPassword })),
};
