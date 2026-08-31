import { useMemo } from 'react';
import type { GoalView, Horizon } from '@goal-cascade/shared';
import { useLens } from '../api/queries';
import { enclosingKey, rank } from '../utils/periodKeys';

/**
 * UX §6.7 — **the legal parents of a new goal at `horizon` in `periodKey`**, and why grouping earns its
 * keep: sitting inside a group in a period-scoped lens, every field of the create form except the title is
 * already known.
 *
 * R-goal-5 — a parent's horizon must be strictly LONGER, and levels may be skipped (R-goal-32), so a
 * Weekly goal may hang off a Monthly, Quarterly, Yearly **or Life** goal and none of those is an error.
 * The picker therefore asks each longer horizon for **the period that encloses this one** — a Monthly goal
 * for `2026-08` may sit under the Yearly goals of `2026`, the Quarterly goals of `2026-Q3`, or a Life goal.
 *
 * Four scoped lens reads at most, every one an index seek, all of them cached (the Life read is usually
 * already warm). **The client still holds no tree** (R-lens-16): these are ordinary lens pages, and each
 * item's `lifeRootId` is what narrows the picker to one line when the sheet was opened from a group foot.
 *
 * Periods do not nest (R-goal-35), so this is an *offer*, not a constraint: a parent in another period is
 * legal and is simply not listed. The server enforces the horizon rule regardless (D-5 — a disabled button
 * is a hint, not an invariant).
 */
export function useParentOptions(horizon: Horizon, periodKey: string, lifeGoalId?: string | null) {
  const needs = (h: Horizon) => rank(h) < rank(horizon);
  const life = useLens('Life', undefined, needs('Life'));
  const yearly = useLens('Yearly', enclosingKey('Yearly', horizon, periodKey), needs('Yearly'));
  const quarterly = useLens('Quarterly', enclosingKey('Quarterly', horizon, periodKey), needs('Quarterly'));
  const monthly = useLens('Monthly', enclosingKey('Monthly', horizon, periodKey), needs('Monthly'));

  const options = useMemo(() => {
    const all: GoalView[] = [
      ...(life.data?.items ?? []),
      ...(yearly.data?.items ?? []),
      ...(quarterly.data?.items ?? []),
      ...(monthly.data?.items ?? []),
    ].filter((g) => rank(g.horizon) < rank(horizon));
    // Opened from a group foot: one line's legal parents. Opened from the cluster row: every line's.
    return lifeGoalId ? all.filter((g) => g.lifeRootId === lifeGoalId) : all;
  }, [life.data, yearly.data, quarterly.data, monthly.data, horizon, lifeGoalId]);

  const queries = [life, yearly, quarterly, monthly].filter((_, i) => needs((['Life', 'Yearly', 'Quarterly', 'Monthly'] as const)[i]!));
  return {
    options,
    isPending: queries.some((q) => q.isPending),
    error: queries.find((q) => q.error)?.error ?? null,
  };
}

/**
 * R-task-49 — the Weekly goals under one Monthly goal in the target week, which is what decides whether
 * `+ Task` needs a picker, needs nothing, or has to create one.
 */
export function useWeeklyGoalsUnder(parentId: string, weekStart: string | undefined, enabled = true) {
  const q = useLens('Weekly', weekStart, enabled && !!weekStart);
  const candidates = useMemo(() => (q.data?.items ?? []).filter((g) => g.parentId === parentId), [q.data, parentId]);
  return { candidates, isPending: q.isPending, error: q.error };
}
