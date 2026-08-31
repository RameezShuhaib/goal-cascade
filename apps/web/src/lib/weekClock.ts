import { useBootstrap } from '../api/queries';
import { useOwnerToday } from '../utils/periods';
import { containingKey, weeksBetween } from '../utils/periodKeys';

/**
 * The two facts about "now" the client is allowed to hold, and where each comes from.
 *
 * R-auth-5 / R-goal-34 put every week boundary and every "current period" on the server, in the owner's
 * timezone. So:
 *
 *  - **the current Monday** is `BootstrapResponse.week.weekStart` — an absolute date the server sent
 *    (D-1). There is no `weekStartOfDate` in this client and there must not be one;
 *  - **the owner's today** is the server's clock (`lib/serverClock`) rendered in the STORED timezone
 *    (`utils/periods.useOwnerToday`), which is the mechanism the create-form defaults have always used.
 *
 * Everything derived here is arithmetic over those two: which offset a week is, and which month today is
 * in. Nothing asks the device clock, and nothing decides whether a period is past or current — that is
 * `PeriodView.isPast` / `.isCurrent`, on the wire.
 */
export interface WeekClock {
  /** The Monday of the week containing today, as the server resolved it. `null` until bootstrap lands. */
  currentMonday: string | null;
  /** The owner's calendar date, `YYYY-MM-DD`. */
  today: string;
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
  const boot = useBootstrap();
  const today = useOwnerToday();
  const currentMonday = boot.data?.week.weekStart ?? null;
  return {
    currentMonday,
    today,
    todayMonthKey: containingKey('Monthly', today),
    offsetOf: (monday) => (currentMonday && monday ? weeksBetween(currentMonday, monday) : 0),
  };
}
