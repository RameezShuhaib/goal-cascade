import { useMemo } from 'react';
import { labelOf, periodViewOf, weekRangeOf, type CalendarPeriodView, type Horizon } from '@goal-cascade/shared';
import { useOwnerClockState } from '../utils/periods';

/**
 * ⚠ **R-lens-30 — the lens header never waits.**
 *
 * `(horizon, periodKey)` in, a `CalendarPeriodView` out, **synchronously, with nothing awaited**. This is
 * the hook that deletes `period?.label ?? '…'`: every field on the header is calendar arithmetic over
 * `(horizon, periodKey, today)` and not one of them needs the database.
 *
 * ── The decomposition, which is the design and not an optimisation ────────────
 * `label` and `weekRange` are pure functions of `(horizon, periodKey)` **with no clock at all**. So on the
 * first paint of a cold, offline, preference-less open, `/month/2026-09` already reads
 * `Sep 2026 · Mon 7 Sep – Sun 4 Oct` — before the session, the timezone or the network are known.
 *
 * `isCurrent`, `isPast` and `currentWeekPeriod` do need `today`, and `today` needs the owner's stored
 * timezone. Until that is known the clock falls back to `'UTC'` (matching the server middleware), which
 * near midnight could name a different current period. **So those three are suppressed — rendered as
 * nothing, never as a wrong guess — while `tz` is null.** They are badges; the title is not. That is what
 * makes the `'UTC'` fallback govern nothing the owner ever sees.
 *
 * What this deliberately does NOT answer: `hasWork`, `hasForwardContent`, `hasAnyAtHorizon` and every
 * count. Those are questions about data, they arrive with the read, and the forward-content dot is
 * absolutely positioned inside the chevron so its late arrival moves nothing on screen.
 */
export interface CalendarPeriod extends CalendarPeriodView {
  /**
   * False until the owner's timezone is known. The three clock-dependent fields are already neutralised
   * when this is false; it is exported so a caller can tell "no badge" from "a badge that says nothing".
   */
  clockKnown: boolean;
}

export function useCalendarPeriod(lens: Horizon, periodKey: string): CalendarPeriod {
  const { tz, today } = useOwnerClockState();
  return useMemo(() => {
    if (lens === 'Life') {
      return { periodKey: '', label: '', weekRange: '', isCurrent: false, isPast: false, currentWeekPeriod: null, clockKnown: tz !== null };
    }
    if (tz === null) {
      // The title and the range, and nothing that consults a clock. `isCurrent: false` and `isPast: false`
      // together mean "we are not saying" — `isPast` false is also the safe side of R-goal-36's create
      // guard, since the server refuses a past write regardless and the client is only choosing whether to
      // offer the affordance.
      return {
        periodKey,
        label: labelOf(lens, periodKey),
        weekRange: weekRangeOf(lens, periodKey),
        isCurrent: false,
        isPast: false,
        currentWeekPeriod: null,
        clockKnown: false,
      };
    }
    return { ...periodViewOf(lens, periodKey, today), clockKnown: true };
  }, [lens, periodKey, tz, today]);
}
