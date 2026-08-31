import type { Horizon } from '@goal-cascade/shared';
import { usePreferences } from '../api/queries';
import { todayInZone } from './dates';

/**
 * R-goal-13 / R-goal-23 / D-3 — target periods, derived from TODAY.
 *
 * The mockup returned frozen 2026 literals (`'Q4 2026'`, `['Oct 2026','Nov 2026']`), so every default was
 * wrong from the first day of the next period and re-plan offered the period a goal was already in. Those
 * literals are deleted. These are pure functions of `(horizon, today)` and `today` comes from the SERVER's
 * clock resolved in the OWNER's timezone (R-auth-5), never from a hardcoded string.
 *
 * ── A duplication, named ───────────────────────────────────────────────────────
 * The API derives the same lists in `apps/api/src/domain/goal-tree.ts` and is the authority: a create with
 * no `period` gets the server's default, and a re-plan to a period the goal is already in is refused with
 * `VALIDATION_FAILED` whose `details.options` carries the server's own list, which the sheet then renders
 * in place of these. This file exists only so the form can PRE-FILL and the re-plan sheet can offer
 * something before the first refusal.
 *
 * The honest fix is `replanOptions: string[]` on `GoalDetailResponse` (proposed in
 * `docs/work/03-goals-plan/build.md` §5, and flagged again in `docs/work/08-web-app/build.md`). It is a
 * shared-schema change, which this agent may not make.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

function ymOf(today: string): { year: number; month: number } {
  const [y, m] = today.split('-');
  return { year: Number(y), month: Number(m) };
}

/** R-goal-13 — the period a new goal starts in. Life goals have none (R-goal-3). */
export function defaultPeriod(horizon: Horizon, today: string): string {
  const { year, month } = ymOf(today);
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

function ordinalOf(horizon: Horizon, period: string): number | null {
  const p = period.trim();
  if (horizon === 'Yearly') return /^\d{4}$/.test(p) ? Number(p) : null;
  if (horizon === 'Quarterly') {
    const m = /^Q([1-4])\s+(\d{4})$/.exec(p);
    return m ? Number(m[2]) * 4 + (Number(m[1]) - 1) : null;
  }
  if (horizon === 'Monthly') {
    const m = /^([A-Za-z]{3})\s+(\d{4})$/.exec(p);
    const index = m ? MONTHS.findIndex((x) => x.toLowerCase() === m[1]!.toLowerCase()) : -1;
    return m && index >= 0 ? Number(m[2]) * 12 + index : null;
  }
  return null;
}

function periodFromOrdinal(horizon: Horizon, ordinal: number): string {
  if (horizon === 'Yearly') return String(ordinal);
  if (horizon === 'Quarterly') return `Q${(ordinal % 4) + 1} ${Math.floor(ordinal / 4)}`;
  return `${MONTHS[ordinal % 12] ?? ''} ${Math.floor(ordinal / 12)}`;
}

/**
 * R-goal-23 — Monthly → the next two months, Quarterly → the next two quarters, Yearly → next year.
 * Strictly AFTER both today's period and the goal's current one, so re-plan can never offer the period
 * the goal is already in (D-3). Life goals are not re-plannable (R-goal-21), hence the empty list.
 */
export function replanPeriods(horizon: Horizon, today: string, currentPeriod = ''): string[] {
  if (horizon === 'Life') return [];
  const todayOrdinal = ordinalOf(horizon, defaultPeriod(horizon, today));
  if (todayOrdinal === null) return [];
  const currentOrdinal = ordinalOf(horizon, currentPeriod);
  const base = Math.max(todayOrdinal, currentOrdinal ?? todayOrdinal);
  const count = horizon === 'Yearly' ? 1 : 2;
  return Array.from({ length: count }, (_, i) => periodFromOrdinal(horizon, base + i + 1));
}

/** Today as the owner's account sees it: the server's clock in the stored timezone (R-auth-5). */
export function useOwnerToday(): string {
  const prefs = usePreferences();
  return todayInZone(prefs.data?.preferences.timezone);
}
