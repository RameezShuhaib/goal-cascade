import type { AppEnv } from '../../env';

/**
 * Better Auth's limiter, on. Without it, sign-in brute force, unlimited sign-up and
 * `send-verification-email` (an unauthenticated, arbitrary-recipient endpoint) are wide open.
 *
 * This is the ONLY rate limiter in Goal Cascade. SPEC Q-16 recommended a per-owner write budget too;
 * the orchestrator ruled against it, because sign-up is allowlisted to one address and the authenticated
 * write surface therefore has no abuse population. The unauthenticated auth endpoints are genuinely
 * exposed, so they keep their limits.
 *
 * Windows below are per **client IP × auth path**. They are deliberately looser than Better Auth's
 * built-in defaults for the *burst* and much tighter over the hour, which is what actually stops brute
 * force. Paths are relative to `basePath` (`/api/auth`), matched by Better Auth's wildcard matcher.
 */
export const AUTH_RATE_LIMIT_WINDOW_S = 60;
export const AUTH_RATE_LIMIT_MAX = 120;

export const AUTH_RATE_LIMIT_RULES = {
  // Online password guessing. 10/min per IP: invisible to a human, useless to a cracker.
  '/sign-in/email': { window: 60, max: 10 },
  '/sign-in/*': { window: 60, max: 10 },
  // Sign-up is allowlisted to one address anyway; this stops the allowlist check itself being hammered.
  '/sign-up/email': { window: 3600, max: 5 },
  // Mail endpoints: arbitrary recipient, no session needed, each call holds the Worker.
  '/send-verification-email': { window: 3600, max: 5 },
  '/request-password-reset': { window: 3600, max: 5 },
  '/forget-password': { window: 3600, max: 5 },
  // Token guessing against a 142-bit token — cheap to cap anyway.
  '/reset-password': { window: 600, max: 10 },
  '/reset-password/*': { window: 600, max: 10 },
  '/change-password': { window: 600, max: 5 },
  '/change-email': { window: 600, max: 5 },
} as const;

/** The longest window we can be asked about — how long a counter row stays useful. */
export const AUTH_RATE_LIMIT_MAX_WINDOW_MS =
  Math.max(AUTH_RATE_LIMIT_WINDOW_S, ...Object.values(AUTH_RATE_LIMIT_RULES).map((r) => r.window)) * 1000;

/**
 * On by default — an unset or garbled var must never silently disable the limiter. Only the exact string
 * `off` turns it off, which is what the test suite passes (a shared D1 plus Better Auth's test fallback
 * to a single `127.0.0.1` IP would otherwise make every test file share one bucket).
 */
export function authRateLimitEnabled(env: AppEnv): boolean {
  return env.AUTH_RATE_LIMIT?.trim().toLowerCase() !== 'off';
}
