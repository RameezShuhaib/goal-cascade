import { describe, expect, it } from 'vitest';
import {
  addWeeks,
  firstDayOf,
  firstWeekOf,
  HORIZONS,
  isPeriodKeyFor,
  lastDayOf,
  lastWeekOf,
  periodKeyOf,
  stepPeriod,
  weekStartOfDate,
  type Horizon,
} from '../src/index';

/**
 * **The property test — what proves two boundaries can never disagree** (R-lens-30).
 *
 * The fixture table pins a few dozen boundaries by hand. This walks every date from 2015-01-01 to
 * 2040-12-31 — about 9,500 days — across all five horizons, and asserts the invariants a boundary bug
 * must break. Between them, the table says *these particular answers are right* and this says *no answer
 * anywhere in a 26-year window is internally inconsistent*.
 *
 * Invariant 4 is the strongest one here: consecutive periods' week ranges abut with **no gap and no
 * overlap**. The `Sep 2026` class of defect — a client putting the week of Mon 31 Aug in September while
 * the server puts it in August — is exactly a violation of it.
 */

const DAY = 86_400_000;
const FROM = Date.parse('2015-01-01T00:00:00.000Z');
const TO = Date.parse('2040-12-31T00:00:00.000Z');
const NON_LIFE = HORIZONS.filter((h): h is Exclude<Horizon, 'Life'> => h !== 'Life');

function* everyDate(): Generator<string> {
  for (let t = FROM; t <= TO; t += DAY) yield new Date(t).toISOString().slice(0, 10);
}

/** The distinct keys each horizon takes over the window, in the order they first appear. */
function keysOver(horizon: Exclude<Horizon, 'Life'>): string[] {
  const seen: string[] = [];
  let last = '';
  for (const d of everyDate()) {
    const k = periodKeyOf(horizon, d);
    if (k !== last) {
      seen.push(k);
      last = k;
    }
  }
  return seen;
}

describe('every derived key is canonical, and containment holds (R-goal-33)', () => {
  it('1 — `isPeriodKeyFor(h, periodKeyOf(h, d))` for every day and every horizon', () => {
    for (const d of everyDate()) {
      for (const h of NON_LIFE) {
        expect(isPeriodKeyFor(h, periodKeyOf(h, d)), `${h} @ ${d}`).toBe(true);
      }
      expect(periodKeyOf('Life', d)).toBe('');
    }
  });

  it('2 — `firstDayOf(h, k) <= d <= lastDayOf(h, k)` where `k = periodKeyOf(h, d)`', () => {
    for (const d of everyDate()) {
      for (const h of NON_LIFE) {
        const k = periodKeyOf(h, d);
        expect(firstDayOf(h, k) <= d, `${h} ${k} first > ${d}`).toBe(true);
        expect(d <= lastDayOf(h, k), `${h} ${k} last < ${d}`).toBe(true);
      }
    }
  });
});

describe('stepping is invertible, and the ranges partition time (R-lens-7, R-lens-28)', () => {
  it('3 — `stepPeriod(h, stepPeriod(h, k, 1), -1) === k`', () => {
    for (const h of NON_LIFE) {
      for (const k of keysOver(h)) {
        expect(stepPeriod(h, stepPeriod(h, k, 1), -1), `${h} ${k}`).toBe(k);
        expect(stepPeriod(h, stepPeriod(h, k, -1), 1), `${h} ${k}`).toBe(k);
      }
    }
  });

  /**
   * ⚠ **The single strongest invariant in this file.** If consecutive periods' week ranges ever gapped or
   * overlapped, a week would belong to two periods or to none, and the header would print a span that
   * does not match the goals underneath it. Nothing would error; the screen would simply be quietly wrong
   * for the first days of seven months a year.
   */
  it('4 — partition: `firstWeekOf(next) === addWeeks(lastWeekOf(k), 1)`, no gap and no overlap', () => {
    for (const h of NON_LIFE) {
      const keys = keysOver(h);
      for (const k of keys) {
        const next = stepPeriod(h, k, 1);
        expect(firstWeekOf(h, next), `${h} ${k} → ${next}`).toBe(addWeeks(lastWeekOf(h, k), 1));
      }
    }
  });

  it('5 — the range’s own ends belong to the period they measure', () => {
    for (const h of NON_LIFE) {
      for (const k of keysOver(h)) {
        expect(periodKeyOf(h, firstWeekOf(h, k)), `${h} ${k} first`).toBe(k);
        expect(periodKeyOf(h, lastWeekOf(h, k)), `${h} ${k} last`).toBe(k);
      }
    }
  });
});

/**
 * 6 — the property three index reads depend on. R-goal-47's planned-ness read is a `period_key BETWEEN`
 * range scan, R-lens-26's "is there anything later" is a `>` probe on the same index, and R-lens-12's
 * carried band is an `ORDER BY period_key`. Change a format so that lexicographic order stops being
 * chronological order and all three become table scans that also give wrong answers.
 */
describe('lexicographic order IS chronological order (R-goal-33, load-bearing)', () => {
  it('6 — `k1 < k2` ⟺ `firstDayOf(k1) < firstDayOf(k2)`', () => {
    for (const h of NON_LIFE) {
      const keys = keysOver(h);
      for (let i = 1; i < keys.length; i += 1) {
        const a = keys[i - 1]!;
        const b = keys[i]!;
        expect(a < b, `${h}: ${a} should sort before ${b}`).toBe(true);
        expect(firstDayOf(h, a) < firstDayOf(h, b), `${h}: ${a} should start before ${b}`).toBe(true);
      }
    }
  });
});

describe('the Monday rule is total and idempotent (D-1)', () => {
  it('7 — `weekStartOfDate` always lands on a Monday, and lands on itself when it already has', () => {
    for (const d of everyDate()) {
      const monday = weekStartOfDate(d);
      expect(isPeriodKeyFor('Weekly', monday), `${d} → ${monday}`).toBe(true);
      expect(weekStartOfDate(monday), `idempotent @ ${d}`).toBe(monday);
      // And it never moves the date forward: Sunday belongs to the week before, not the week after.
      expect(monday <= d, `${d} → ${monday} moved forward`).toBe(true);
    }
  });
});
