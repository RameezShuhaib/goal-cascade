import { addWeeks, periodKeyOf, type TaskScope, weeksBetween, weekStartOfDate } from '@goal-cascade/shared';
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
  /**
   * ⚠ **A8, new (R-task-55) — the period to write a task INTO, at the task's own scope.**
   *
   * A completion, and a Move-to-Backlog, name a canonical period rather than an offset, and the server
   * bounds it **within one scope** — so posting the viewer's Monday for a month task is refused with
   * `WEEK_OUT_OF_RANGE`, which is the scope check doing exactly its job. A week task keeps its offset,
   * which is what every lens surface holds.
   *
   * For a month task the answer is the **current** month, not the task's origin: the origin may be
   * months behind (a carried task), and completing into a past month would hide the task from the lens
   * the owner is standing in. `todayMonthKey` is the same `periodKeyOf('Monthly', today)` the rest of
   * this hook is built from, so this adds no second date rule (R-lens-30).
   *
   * ⚠ **`originPeriodKey`, when the caller holds it, is a LOWER bound and nothing else.** A month task
   * written for a month that has not arrived yet is legal and ordinary (R-goal-36, S-task-57-2), and the
   * current month is *before* its origin — a period the task did not exist in, which every bound in
   * `assertPeriodFor` refuses. So the answer is the later of the two, which is the month the task is
   * actually in: its origin while that is ahead, the current month once it has been reached and for every
   * month it carries into after. Omitting the argument keeps the plain current-month answer, which is
   * what a row holding no origin can ask for.
   *
   * There is one spelling of this because there are four callers — the task page, a task row, the exit
   * sheet and the Park sheet — and a rule each of them re-derived is a rule three of them would get wrong.
   */
  periodFor: (scope: TaskScope, weekOffset: number, originPeriodKey?: string) => string;
}

export function useWeekClock(): WeekClock {
  const { tz, today } = useOwnerClockState();
  const currentMonday = weekStartOfDate(today);
  const todayMonthKey = periodKeyOf('Monthly', today);
  return {
    currentMonday,
    today,
    tz,
    todayMonthKey,
    offsetOf: (monday) => (monday ? weeksBetween(currentMonday, monday) : 0),
    periodFor: (scope, weekOffset, originPeriodKey) =>
      scope === 'Monthly'
        ? // A string comparison of two month keys, not a date computation: `YYYY-MM` sorts
          // lexicographically in calendar order, which is the property R-goal-33 chose the format for.
          originPeriodKey !== undefined && originPeriodKey > todayMonthKey
          ? originPeriodKey
          : todayMonthKey
        : addWeeks(currentMonday, weekOffset),
  };
}
