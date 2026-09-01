import { firstDayOf, firstMondayIn, HORIZONS, isPeriodKeyFor, periodKeyOf, type Horizon } from '@goal-cascade/shared';

/**
 * The client's period **vocabulary** — the names and defaults that are genuinely about this UI, and
 * nothing that is about the calendar.
 *
 * ── ⚠ **R-lens-30 — what this file used to be** ────────────────────────────────
 * It carried `stepPeriod`, `firstDayOf`, `containingKey`, `weekForMonth` and `weeksBetween` as its own
 * implementations, under a doc block insisting at length that it was *"not a second implementation of a
 * date rule"*. Line for line it was: `stepPeriod` was identical to the server's including the
 * `((ord % 4) + 4) % 4` normalisation, `firstDayOf` was identical, `containingKey` was `periodKeyOf` with
 * the Weekly branch inlined, and `weekForMonth` reached the same answer by walking whole weeks off a
 * server-sent Monday instead of by `weekStartOfDate`. **The drift D-3 warns about was already latent,
 * kept out of sight by two test files written against the same expectations.**
 *
 * All of it now comes from `@goal-cascade/shared`, which is the SAME MODULE the Worker calls. The old
 * prohibition — *"there is no `weekStartOfDate` in this client and there must not be one"* — is replaced
 * by the rule it was reaching for: **the client may not hold a *second* implementation of a date rule; it
 * may import the *only* one.** A Monday derived from the DEVICE CLOCK is still forbidden, and that is
 * `lib/ownerClock`'s job: every `today` here is the server's clock in the account's stored zone (R-auth-5).
 *
 * What is left below is vocabulary and defaults: what a lens's unit is called, which horizons may sit
 * under a parent, which period a new sub-goal should offer, and whether a URL segment is trustworthy.
 */

export function rank(horizon: Horizon): number {
  return HORIZONS.indexOf(horizon);
}

/** The unit a lens steps by — the word the chevrons' accessible names and the off-now badge use. */
export const PERIOD_UNIT: Record<Horizon, string> = {
  Life: 'period',
  Yearly: 'year',
  Quarterly: 'quarter',
  Monthly: 'month',
  Weekly: 'week',
};

/** The period of `horizon` that encloses the period `key` of `of` — `2026-08` inside `2026-Q3`, `2026`. */
export function enclosingKey(horizon: Horizon, of: Horizon, key: string): string {
  if (horizon === 'Life') return '';
  return periodKeyOf(horizon, firstDayOf(of, key));
}

/**
 * R-goal-48 — the `periodKey` a new SUB-GOAL at `horizon` defaults to, under a parent of `parentHorizon`
 * sitting in `parentKey`.
 *
 * **The current period of the child's own horizon, or the parent's first enclosed period when the parent
 * begins later** — never a past one, so `PERIOD_IN_PAST` (R-goal-36) is unreachable from the affordance.
 * The comparison is a plain `>` because same-horizon keys sort chronologically by construction
 * (R-goal-33) — that is the entire reason the format exists.
 *
 * Periods do not nest (R-goal-35), so this is an *offer*: a Quarterly child of a `2027` Yearly goal is
 * perfectly legal in `2026-Q4`, it is merely a surprising default.
 *
 * ⚠ **R-lens-30 — the Weekly case no longer waits for bootstrap.** It used to take `currentMonday` from
 * `BootstrapResponse.week.weekStart` and answer `''` until that landed, which left `+ Weekly goal` inert
 * on a cold open. `periodKeyOf('Weekly', today)` is the same Monday, from the same rule, with no query
 * dependency — the Monday is still the owner's, because `today` is.
 */
export function subGoalPeriodKey(horizon: Horizon, parentHorizon: Horizon, parentKey: string, today: string): string {
  const now = periodKeyOf(horizon, today);
  if (horizon === 'Weekly' || parentHorizon === 'Life') return now;
  const inside = periodKeyOf(horizon, firstDayOf(parentHorizon, parentKey));
  return inside > now ? inside : now;
}

/** R-goal-5 / R-goal-32 — the horizons a child of `parent` may take: every one of strictly higher rank. */
export function childHorizons(parent: Horizon): Horizon[] {
  return HORIZONS.filter((h) => rank(h) > rank(parent));
}

/**
 * R-lens-9 / R-goal-47 / R-task-49 — **the one answer to "which week does this month mean"**: the week
 * containing today when the month contains today, otherwise the first week whose **Monday** falls in it.
 *
 * ⚠ **R-lens-30** — the body is `@goal-cascade/shared`'s, so this and R-goal-47's `BETWEEN` scope and the
 * header's own range are literally one function. The signature is kept as `(monthKey, currentMonday,
 * todayMonthKey)` because that is what the two call sites hold and because `currentMonday` remains the
 * honest input for "the week containing today" — the client no longer needs the server to send it, but it
 * is still what the answer means.
 */
export function weekForMonth(monthKey: string, currentMonday: string, todayMonthKey: string): string {
  if (monthKey === todayMonthKey) return currentMonday;
  return firstMondayIn(monthKey);
}

/** A URL segment is attacker-supplied: a key that is not canonical for its lens is dropped, not trusted. */
export function validKeyFor(horizon: Horizon, key: string | undefined): string | undefined {
  if (horizon === 'Life' || !key) return undefined;
  return isPeriodKeyFor(horizon, key) ? key : undefined;
}
