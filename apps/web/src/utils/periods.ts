import { usePreferences } from '../api/queries';
import { todayInZone } from './dates';

/**
 * The owner's calendar day, and nothing else.
 *
 * ── What used to be here, and why it is gone ───────────────────────────────────
 * `defaultPeriod(horizon, today)` pre-filled the create form's free-text `TARGET PERIOD` field. Both
 * halves of that are retired: `period` is **[srv]**, the rendered label of a canonical `periodKey`
 * (R-goal-33), and there is no period field on the create sheet at all any more — a goal is created into
 * **the period you are looking at**, shown as a read-only chip with its reason beside it (UX §6.7). The
 * old field is what let you type `Q9 3026`.
 *
 * `replanPeriods` left earlier for the same reason: `GoalDetailResponse.replanOptions` is the server's own
 * derivation, and two implementations of a date rule drift on the first boundary (D-3).
 *
 * What survives is one value the client legitimately needs and can compute without a second rule: the
 * anchor date for the Zoom sheet (R-lens-18), which is the SERVER's clock (`lib/serverClock`) rendered in
 * the OWNER's stored timezone (R-auth-5) — never the device clock.
 */

/** Today as the owner's account sees it: the server's clock in the stored timezone (R-auth-5). */
export function useOwnerToday(): string {
  const prefs = usePreferences();
  return todayInZone(prefs.data?.preferences.timezone);
}
