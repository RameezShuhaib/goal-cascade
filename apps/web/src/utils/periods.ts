import type { Horizon } from '@goal-cascade/shared';
import { usePreferences } from '../api/queries';
import { todayInZone } from './dates';

/**
 * R-goal-13 / D-3 — the target period a NEW goal starts in, for the create form's pre-fill only.
 *
 * The mockup returned frozen 2026 literals (`'Q4 2026'`), so every default was wrong from the first day of
 * the next period. This is a pure function of `(horizon, today)`, and `today` comes from the SERVER's
 * clock resolved in the OWNER's timezone (R-auth-5), never from a hardcoded string.
 *
 * ── What used to be here, and why it is gone ───────────────────────────────────
 * `replanPeriods(horizon, today, currentPeriod)` was a client-side mirror of the server's re-plan
 * derivation, written when the contract had no field for it. It does now:
 * `GoalDetailResponse.replanOptions` (`packages/shared/src/read-models.ts`) carries the server's own list,
 * and `ReplanGoalSheet` renders that. Two implementations of a date rule drift on the first period
 * boundary, so there is one — server-side.
 *
 * `period` on a create has no such field: the request may omit it and the server fills its own default
 * (`goal.service.ts`), but the form has to show something before it is submitted. That pre-fill is what
 * this file is still for. If a create-defaults field is ever added to the contract, this goes too.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** R-goal-13 — the period a new goal starts in. Life goals have none (R-goal-3). */
export function defaultPeriod(horizon: Horizon, today: string): string {
  const [y, m] = today.split('-');
  const year = Number(y);
  const month = Number(m);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return '';
  switch (horizon) {
    case 'Life':
      return '';
    case 'Yearly':
      return String(year);
    case 'Quarterly':
      return `Q${Math.floor((month - 1) / 3) + 1} ${year}`;
    case 'Monthly':
      return `${MONTHS[month - 1] ?? ''} ${year}`;
  }
}

/** Today as the owner's account sees it: the server's clock in the stored timezone (R-auth-5). */
export function useOwnerToday(): string {
  const prefs = usePreferences();
  return todayInZone(prefs.data?.preferences.timezone);
}
