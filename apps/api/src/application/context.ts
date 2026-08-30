import type { AuthUser } from '../domain/entities';

/**
 * Per-request context handed to every service method. Built by the API middleware chain
 * (container → origin → session → timezone).
 *
 * There is no tenant and no membership: Goal Cascade is single-user (R-auth-1). `userId` IS the scope
 * (SPEC calls it `ownerId`), it ALWAYS comes from the verified session, and it never comes from request
 * input (R-auth-2). A feature agent that finds itself wanting a scope from the body has a bug.
 */
export type RequestContext = {
  userId: string;
  user: AuthUser;
  /**
   * R-auth-5 / Q-9 — the OWNER's IANA timezone, from `preferences.timezone`. Every week boundary in the
   * product is computed from this, never from the client clock, so two devices in different zones agree
   * on "this week" near a Sunday/Monday boundary. `X-Timezone` only seeds it at sign-up.
   */
  tz: string;
  /** serverNow for this request, ISO UTC. Commands stamp rows and events with this exact value. */
  now: string;
  /**
   * The Monday of the CURRENT week in `tz` (D-1). Resolved once per request so every handler in it agrees
   * on which week "now" is, even across a midnight boundary mid-request.
   */
  currentWeekStart: string;
  /** Idempotency-Key of the current command, if any. */
  idempotencyKey: string | null;
};
