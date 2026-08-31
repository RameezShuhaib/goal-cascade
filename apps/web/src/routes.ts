import { HORIZONS, type Horizon } from '@goal-cascade/shared';

/**
 * R-nav-24 — the URL shapes, in one module.
 *
 * A URL is user-facing, so the segment is a word rather than the horizon's own name (`/quarter/2026-Q3`,
 * not `/goals/Quarterly?period=2026-Q3`). Periods are machine-formatted in the URL and human-formatted on
 * screen (`PeriodView.label`), and **`/week/:monday` carries the absolute Monday, never an offset** — a
 * relative offset in a URL means something different on Tuesday, which is D-1 exactly.
 *
 * The period segment is **optional** on every period lens. That is not a convenience: the client must not
 * derive the current period (R-goal-34), so `/month` means "the month containing today, whichever the
 * server says that is", and the screen rewrites the address bar to the canonical key once the read lands.
 * It is also what `Jump to now` and the tab bar navigate to.
 */

/** The path segment for each lens. */
export const LENS_SEGMENT: Record<Horizon, string> = {
  Life: 'life',
  Yearly: 'year',
  Quarterly: 'quarter',
  Monthly: 'month',
  Weekly: 'week',
};

const BY_SEGMENT = new Map<string, Horizon>(HORIZONS.map((h) => [LENS_SEGMENT[h], h]));

export function lensOfSegment(segment: string | undefined): Horizon | undefined {
  return segment ? BY_SEGMENT.get(segment) : undefined;
}

/** `/quarter/2026-Q3`, or `/quarter` when the period is the server's business (R-lens-14). */
export function lensPath(lens: Horizon, periodKey?: string | null): string {
  const seg = LENS_SEGMENT[lens];
  if (lens === 'Life' || !periodKey) return `/${seg}`;
  return `/${seg}/${encodeURIComponent(periodKey)}`;
}

export const goalPath = (goalId: string) => `/goal/${encodeURIComponent(goalId)}`;
export const taskPath = (taskId: string) => `/task/${encodeURIComponent(taskId)}`;
export const BACKLOG_PATH = '/backlog';
export const LEARNINGS_PATH = '/learnings';

/** R-nav-28 — a cold start opens the Weekly lens at the week containing today. */
export const DEFAULT_LENS: Horizon = 'Weekly';
