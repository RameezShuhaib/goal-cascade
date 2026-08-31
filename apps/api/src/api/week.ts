import { WEEK_HISTORY_WEEKS, type WeekView } from '@goal-cascade/shared';
import type { RequestContext } from '../application/context';
import { DomainError } from '../domain/errors';
import { weekStartFromOffset } from '../domain/weeks';

/**
 * The ONE place a wire week-offset becomes an absolute `weekStart` (SPEC D-1).
 *
 * Offsets exist only on the wire; nothing below this line ever sees one, and nothing is ever stored as
 * one. `ctx.currentWeekStart` was resolved once per request from the OWNER's timezone (R-auth-5), so
 * two devices in different zones resolve `week=-1` to the same Monday.
 *
 * The schema already refuses a positive offset (`WeekOffset`), so a `WEEK_OUT_OF_RANGE` here means the
 * caller reached past the addressable history — which the week switcher cannot do (R-nav-3/4, D-24).
 * Anything older is still readable by naming its `weekStart` explicitly (Q-13); this bound is the
 * switcher's, and it is one number for both controls.
 */
/**
 * `maxHistory` is annotated `number` rather than left to inference: `WEEK_HISTORY_WEEKS` is `8 as const`,
 * so the default alone would type the parameter as the literal `8` and no other bound could be passed.
 * The MCP surface passes its own (`api/mcp/shapes.ts`) — the 8-week clamp is the WEEK SWITCHER's range
 * (R-nav-4, D-24), a UI bound, and an agent has no switcher.
 */
export function resolveWeek(ctx: RequestContext, offset = 0, maxHistory: number = WEEK_HISTORY_WEEKS): WeekView {
  if (offset > 0) throw new DomainError('WEEK_OUT_OF_RANGE', 'future weeks are not addressable', { offset });
  if (offset < -(maxHistory - 1)) {
    throw new DomainError('WEEK_OUT_OF_RANGE', `the week switcher reaches back ${maxHistory} weeks`, { offset, maxHistory });
  }
  return {
    weekStart: weekStartFromOffset(ctx.currentWeekStart, offset),
    offset,
    isCurrent: offset === 0,
  };
}
