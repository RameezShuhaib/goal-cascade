import { describe, expect, it } from 'vitest';
import { dateInTimezone, periodViewOf, stepPeriod, zoomTo } from '@goal-cascade/shared';
import { PERIOD_BOUNDARIES, STEP_CASES, ZOOM_CASES } from '../../../../packages/shared/tests/fixtures/period-boundaries';

/**
 * ⚠ **ANTI-DRIFT LAYER 2, the CLIENT's half** (R-lens-30).
 *
 * This file and `apps/api/tests/lens/period-view-contract.test.ts` both check themselves against
 * `packages/shared/tests/fixtures/period-boundaries.ts`, **and neither imports the other's code.** The
 * table's every string was worked out from the Monday rule by hand. If either side ever drifts from it,
 * exactly one of the two goes red and names which.
 *
 * The client's half asserts `periodViewOf(horizon, key, ownerToday)` — the exact call
 * `lens/useCalendarPeriod.ts` makes to render the header — with `ownerToday` resolved from the row's own
 * `nowIso` and `tz` through `dateInTimezone`, which is how `lib/ownerClock` resolves it.
 *
 * ⚠ **Do not "fix" a failure here by pasting in what the code returned.** Re-derive the row on paper.
 */

describe('R-lens-30 layer 2 — the locally computed `PeriodView` matches the hand-written boundary table', () => {
  for (const row of PERIOD_BOUNDARIES) {
    it(row.name, () => {
      // The owner's today is the STORED zone applied to the server's clock (R-auth-5) — never the device
      // zone. That the row's hand-derived `today` and this call agree is itself part of the assertion.
      const today = dateInTimezone(row.nowIso, row.tz);
      expect(today, 'the row’s own `today` column').toBe(row.today);

      const view = periodViewOf(row.horizon, row.periodKey, today);
      expect(view.periodKey).toBe(row.periodKey);
      expect(view.label).toBe(row.label);
      expect(view.weekRange).toBe(row.weekRange);
      expect(view.isCurrent).toBe(row.isCurrent);
      expect(view.isPast).toBe(row.isPast);
      expect(view.currentWeekPeriod).toEqual(row.currentWeekPeriod);
    });
  }
});

describe('R-lens-30 layer 2 — stepping and zooming match the table', () => {
  it('every rollover, in both directions, plus the format’s own representable edge', () => {
    for (const c of STEP_CASES) {
      expect(stepPeriod(c.horizon, c.from, c.n), `${c.horizon} ${c.from} ${c.n > 0 ? '+' : ''}${c.n}`).toBe(c.to);
    }
  });

  it('R-lens-9’s zoom correction: a week belongs to its MONDAY’s month', () => {
    for (const c of ZOOM_CASES) {
      expect(zoomTo(c.target, c.anchor, c.today), `${c.target} @ ${c.anchor}`).toBe(c.to);
    }
  });
});
