import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { stepPeriod, type Horizon } from '@goal-cascade/shared';
import { useApi } from '../context/ApiContext';
import { keys } from '../lib/queryClient';
import { READ_MODEL_STALE_MS } from '../api/queries';

/**
 * ⚠ **R-lens-30** — prefetch the period either side of the one on screen, so a step is a repaint.
 *
 * A2's header is already instant; this is what makes the *body* instant too, and it is what turns
 * UX-PLAN §3.2's cache-hit rule from the lucky case into the ordinary one. Gestures are coming (item D),
 * and a swipe that steps a period which then takes 300 ms to repaint is a swipe that feels broken.
 *
 * ── Every rule here has a reason, and the depth limit is the important one ────
 *  - **Depth 1 only.** `GoalService.lens` fires six repository calls, and R-lens-27 exists because this
 *    read model has been the performance defect before. Depth 1 triples the read load on a step-heavy
 *    session; depth 2 quintuples it for a case the momentum prefetch already covers.
 *  - **Momentum.** After a step, one further period **in the direction of travel** — because that is the
 *    direction the next step is nearly certain to take, and it costs one request rather than two.
 *  - **`staleTime` matched to the read's own**, so a prefetch of an already-fresh neighbour is a no-op
 *    rather than a request. This is what stops a rapid back-and-forth from issuing anything at all.
 *  - **Scheduled in `requestIdleCallback`** (with a `setTimeout` fallback), never in the render pass.
 *  - **Skipped on save-data and on 2g.** A speculative read is the first thing to give up on a metered
 *    connection; the owner asked for nothing and would pay for it.
 *  - **Never on Life** (no periods), and never for a key the calendar refuses to represent — which is
 *    what `stepPeriod`'s clamp makes detectable: at the format's edge it returns the input unchanged, so
 *    a prefetch there would be a second request for the period already on screen.
 */

/** 300 ms: long enough to be after the first paint, short enough to be before the next step. */
const IDLE_FALLBACK_MS = 300;

type Idle = (cb: () => void) => number;

const schedule: Idle = (cb) => {
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  return ric ? ric(cb, { timeout: 1_000 }) : (setTimeout(cb, IDLE_FALLBACK_MS) as unknown as number);
};

/**
 * `navigator.connection` is Chromium-only and every field of it is optional, so this reads as "skip when
 * the browser has told us to", never as "proceed when it has told us it is fast".
 */
function shouldSkip(): boolean {
  const c = (navigator as { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (!c) return false;
  return c.saveData === true || c.effectiveType === 'slow-2g' || c.effectiveType === '2g';
}

export function useNeighbourPrefetch(lens: Horizon, period: string | null, settled: boolean): void {
  const qc = useQueryClient();
  const client = useApi();
  /** The last period seen, so a change tells us which way the owner is travelling. */
  const previous = useRef<string | null>(null);

  useEffect(() => {
    if (lens === 'Life' || !period || !settled) return;

    const from = previous.current;
    previous.current = period;

    const back = stepPeriod(lens, period, -1);
    const forward = stepPeriod(lens, period, 1);
    const wanted = new Set<string>();
    // `stepPeriod` returns the input unchanged at the format's representable edge; a prefetch of the
    // period already on screen is a wasted request, not a neighbour.
    if (back !== period) wanted.add(back);
    if (forward !== period) wanted.add(forward);

    // Momentum: one further step in the direction just travelled. `from` is null on the first settle, so
    // a cold open prefetches ±1 and nothing more.
    if (from && from !== period) {
      const n: -1 | 1 = from < period ? 1 : -1;
      const further = stepPeriod(lens, period, n * 2);
      if (further !== period) wanted.add(further);
    }

    if (shouldSkip()) return;

    let cancelled = false;
    schedule(() => {
      if (cancelled) return;
      for (const key of wanted) {
        void qc.prefetchQuery({
          queryKey: keys.lens(lens, key),
          queryFn: () => client.lens({ lens, period: key }),
          staleTime: READ_MODEL_STALE_MS,
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [lens, period, settled, qc, client]);
}
