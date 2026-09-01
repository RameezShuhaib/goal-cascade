import type { Horizon, PeriodView } from '../common';
import { isCurrentPeriod, isPastPeriod, labelOf, periodKeyOf, periodKeyOfCurrentWeek, weekRangeOf } from './periods';

/**
 * ⚠ **R-lens-30, new** — `PeriodView` minus the one field that needs a database.
 *
 * `hasWork` is "does this period hold at least one goal at this horizon", which is a question about data.
 * Every other field is arithmetic over `(horizon, periodKey, today)`, so this is the seam that makes the
 * two sides literally the same code path: the server answers `{ ...periodViewOf(…), hasWork }` and the
 * client calls `periodViewOf` directly. **There is no third rendering of `isPast`.**
 */
export type CalendarPeriodView = Omit<PeriodView, 'hasWork'>;

/**
 * The period control's whole contract, computed locally (R-lens-30).
 *
 * ── The decomposition that makes the header instant ────────────────────────────
 * `label` and `weekRange` are pure functions of `(horizon, periodKey)` **with no clock at all**. So on the
 * first paint of a cold, offline, preference-less open, `/month/2026-09` already reads
 * `Sep 2026 · Mon 7 Sep – Sun 4 Oct` — before the session, the timezone or the network are known. Only
 * `isCurrent`, `isPast` and `currentWeekPeriod` consult `today`, and those are badges, not the title;
 * a caller that does not yet know the owner's zone renders them as nothing rather than as a wrong guess
 * (`apps/web/src/lens/useCalendarPeriod.ts`).
 *
 * `today` must be the OWNER's calendar date — the stored account timezone applied to the server's clock
 * (R-auth-5), never the device zone and never the device clock. `dateInTimezone` is how you get one.
 */
export function periodViewOf(horizon: Horizon, periodKey: string, today: string): CalendarPeriodView {
  const weekIn = periodKeyOfCurrentWeek(horizon, today);
  return {
    periodKey,
    label: labelOf(horizon, periodKey),
    isCurrent: isCurrentPeriod(horizon, periodKey, today),
    isPast: isPastPeriod(horizon, periodKey, today),
    weekRange: weekRangeOf(horizon, periodKey),
    // R-lens-29 — where the current week actually is, `null` when it is here. On Tue 1 Sep 2026 the
    // Monthly lens's current period is `2026-09` while the current week began Mon 31 Aug, which is
    // August's: the field's mere presence is the fact the UI flags.
    currentWeekPeriod: weekIn === periodKey ? null : { periodKey: weekIn, label: labelOf(horizon, weekIn) },
  };
}

/**
 * The Life lens has no period at all (R-lens-2, R-goal-3), and `LensResponse.period` is `null` there.
 * Callers that render a header for every horizon need one shape, so this names the empty one rather than
 * letting five call sites each invent a `?? ''`.
 */
export const LIFE_PERIOD_VIEW: CalendarPeriodView = {
  periodKey: '',
  label: '',
  isCurrent: false,
  isPast: false,
  weekRange: '',
  currentWeekPeriod: null,
};

/** The current period of `horizon`, which is what a lens opens on when the URL names none (R-lens-14). */
export function currentPeriodKey(horizon: Horizon, today: string): string {
  return periodKeyOf(horizon, today);
}
