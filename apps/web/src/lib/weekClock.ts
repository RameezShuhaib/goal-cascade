import { periodKeyOf, weekStartOfDate, weeksBetween } from '@goal-cascade/shared';
import { useOwnerClockState } from '../utils/periods';

/**
 * The facts about "now" this client holds, and where each comes from.
 *
 * ⚠ **R-lens-30** — both are now derived from ONE input, the owner's today, through the SAME functions
 * the Worker calls (`@goal-cascade/shared`).
 *
 * The previous version sourced `currentMonday` from `BootstrapResponse.week.weekStart` under the rule
 * *"there is no `weekStartOfDate` in this client and there must not be one"*. That rule was right about a
 * **copy** and wrong about an **import**: what R-auth-5 forbids is deriving a week boundary from the
 * DEVICE CLOCK, and `useOwnerToday` is the server's clock rendered in the account's stored timezone —
 * exactly the two inputs the server itself uses. So `currentMonday = weekStartOfDate(ownerToday)` is not a
 * second opinion about time; it is the same one, with no query dependency.
 *
 * What that buys, beyond the header: `currentMonday` stops being `null` until bootstrap lands, so the
 * `+ Weekly goal` affordance is no longer inert on a cold open.
 *
 * `BootstrapResponse.week.weekStart` remains on the wire and becomes an **input to the echo assertion**
 * (`lens/assertPeriodAgrees.ts`), which is the one live check on the timezone ladder: if the client's `tz`
 * resolution is wrong for any reason, the two Mondays disagree and it fires.
 */
export interface WeekClock {
  /** The Monday of the week containing today, in the owner's zone. Never `null` — it needs no read. */
  currentMonday: string;
  /** The owner's calendar date, `YYYY-MM-DD`. */
  today: string;
  /**
   * The stored zone `today` was computed in, or `null` while preferences are unknown. Exported because
   * the echo assertion needs to tell "we do not know the zone yet" from "the owner is in UTC", and
   * because a caller rendering a clock-dependent badge must suppress it rather than guess (R-auth-5).
   */
  tz: string | null;
  /** The month key containing today — R-task-49's "does this month contain today". */
  todayMonthKey: string;
  /**
   * The `?week=` offset for an absolute Monday (0 = this week, −1 = last week, **+1 = next week**).
   *
   * ⚠ **A2 (R-goal-36, R-rm-3)** — a POSITIVE offset is ordinary now. Nothing here clamps: the clamp that
   * used to live in `UIContext.selectWeek` (`Math.min(0, offset)`) is deleted, not moved, because it made
   * every forward navigation silently pin to the current week. The one remaining forward guard is
   * `CompleteTaskRequest.week`'s own `.max(0)`, which is the server's (R-task-44).
   */
  offsetOf: (monday: string | null | undefined) => number;
}

export function useWeekClock(): WeekClock {
  const { tz, today } = useOwnerClockState();
  const currentMonday = weekStartOfDate(today);
  return {
    currentMonday,
    today,
    tz,
    todayMonthKey: periodKeyOf('Monthly', today),
    offsetOf: (monday) => (monday ? weeksBetween(currentMonday, monday) : 0),
  };
}
