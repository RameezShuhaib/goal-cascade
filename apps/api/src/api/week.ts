import type { WeekView } from '@goal-cascade/shared';
import type { RequestContext } from '../application/context';
import { weekStartFromOffset } from '../domain/weeks';

/**
 * The ONE place a wire week-offset becomes an absolute `weekStart` (SPEC D-1).
 *
 * Offsets exist only on the wire; nothing below this line ever sees one, and nothing is ever stored as
 * one. `ctx.currentWeekStart` was resolved once per request from the OWNER's timezone (R-auth-5), so
 * two devices in different zones resolve `week=-1` to the same Monday.
 *
 * ── ⚠ **A2 (R-lens-7, R-rm-3) — this function used to be the chokepoint, and both of its bounds are
 * gone** ───────────────────────────────────────────────────────────────────────────────────────────
 *
 * It carried two refusals:
 *
 *  1. `if (offset > 0) throw WEEK_OUT_OF_RANGE` — "future weeks are not addressable". **Deleted.** Any
 *     future period is reachable and writable at every horizon (R-goal-36, owner decision 5), and the
 *     forward chevron is never disabled (S-lens-7-3). One line, and it gated `/goals`, `/tasks`,
 *     `/bootstrap` and every MCP week tool at once.
 *  2. `if (offset < -(maxHistory - 1))` — the 8-week picker window. **Deleted.** `WEEK_HISTORY_WEEKS`
 *     stops being a bound (R-rm-3); there is no picker to enumerate (R-lens-17), and greying out the back
 *     chevron at the account's first period would cost a `MIN(period_key)` probe on every render. A bound
 *     in one direction only rebuilds D-24's asymmetry, and D-24 is now satisfied by construction: one
 *     control per dimension, so no two controls can disagree about a range.
 *
 * **What replaced the forward guard, and where.** The bound that actually mattered — you cannot complete
 * work in a week that has not happened — was being inherited here for free. It is now stated explicitly
 * in the two places that own it: `CompleteTaskRequest.week`'s own `.max(0)` (R-task-44, S-rm-3-1) and
 * `TaskService.resolveWeekFor`. Removing this guard without adding those would have been a **silent**
 * regression with no diff on either line.
 *
 * What remains is `WeekOffset`'s own `±520`, which is the absolute storage range and not a product rule.
 */
export function resolveWeek(ctx: RequestContext, offset = 0): WeekView {
  const weekStart = weekStartFromOffset(ctx.currentWeekStart, offset);
  return {
    weekStart,
    offset,
    isCurrent: offset === 0,
    isPast: offset < 0,
  };
}
