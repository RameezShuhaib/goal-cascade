import { describe, expect, it } from 'vitest';
import {
  firstMondayIn,
  firstWeekOf,
  lastMondayIn,
  lastWeekOf,
  periodKeyOf,
  periodKeyOfCurrentWeek,
  weekRangeOf,
} from '../../src/domain/periods';

/**
 * ⚠ **A4, new (R-lens-28, R-lens-29)** — what a period *spans*, as opposed to what it is *called*.
 *
 * The defect these answer is a labelling one, not a modelling one. A week is keyed by its **Monday**
 * everywhere (R-goal-33, RECONCILIATION ★C-19), so the week of Mon 31 Aug 2026 is August's and `Sep 2026`
 * is the four weeks beginning 7, 14, 21 and 28 Sep. That model is right and is not changing here; what was
 * wrong is that `Sep 2026` reads as 1–30 September and the lens never said otherwise.
 *
 * Every expected string below was worked out from the Monday rule by hand, not from the implementation.
 */
describe('R-lens-28 — the range label is the whole weeks a period contains', () => {
  it('the case the owner hit: Sep 2026 begins on the 7th and runs four days into October', () => {
    // 1 Sep 2026 is a TUESDAY, so the week containing it began Mon 31 Aug and belongs to August. The
    // month's first whole week is therefore the one beginning Mon 7 Sep, and its last is Mon 28 Sep,
    // which ends on Sun 4 Oct. This exact string is what the Monthly lens prints under `Sep 2026`.
    expect(weekRangeOf('Monthly', '2026-09')).toBe('Mon 7 Sep – Sun 4 Oct');
  });

  it('a month whose 1st IS a Monday has no leading gap — it starts on the 1st', () => {
    // 1 Jun 2026 is a Monday, so the step-forward clause must NOT fire: the range opens on the 1st.
    expect(weekRangeOf('Monthly', '2026-06')).toBe('Mon 1 Jun – Sun 5 Jul');
    expect(firstWeekOf('Monthly', '2026-06')).toBe('2026-06-01');
    // 1 Feb 2027 is a Monday too, and February 2027 is exactly four weeks — the range ends ON the 28th.
    expect(weekRangeOf('Monthly', '2027-02')).toBe('Mon 1 Feb – Sun 28 Feb');
  });

  it('a five-week month says five weeks — the range is not a fixed four', () => {
    // Aug 2026 holds the Mondays 3, 10, 17, 24 and 31 Aug: five, and the last of them runs into September.
    expect(weekRangeOf('Monthly', '2026-08')).toBe('Mon 3 Aug – Sun 6 Sep');
    expect(firstWeekOf('Monthly', '2026-08')).toBe('2026-08-03');
    expect(lastWeekOf('Monthly', '2026-08')).toBe('2026-08-31');
    // Mar 2026 is the other shape of five: 2, 9, 16, 23, 30 Mar, ending inside April.
    expect(weekRangeOf('Monthly', '2026-03')).toBe('Mon 2 Mar – Sun 5 Apr');
  });

  it('December → January: the years are spelled out, and only when the two ends disagree', () => {
    // `Dec 2026` in the title cannot disambiguate a `Sun 3 Jan` four lines below it, so both ends carry
    // their year. September's did not, because both of its ends are 2026 and a year printed three times
    // in one header is the clutter R-nav-27 budgets against.
    expect(weekRangeOf('Monthly', '2026-12')).toBe('Mon 7 Dec 2026 – Sun 3 Jan 2027');
    expect(weekRangeOf('Monthly', '2027-01')).toBe('Mon 4 Jan – Sun 31 Jan');
    expect(weekRangeOf('Yearly', '2026')).toBe('Mon 5 Jan 2026 – Sun 3 Jan 2027');
    // A year is 52 whole weeks and its 53rd Monday belongs to the next one, so a Yearly range ALWAYS
    // spans two calendar years and always prints both. `Mon 4 Jan – Sun 2 Jan` would be unreadable.
    expect(weekRangeOf('Yearly', '2027')).toBe('Mon 4 Jan 2027 – Sun 2 Jan 2028');
  });

  it('a quarter whose first Monday falls in the PREVIOUS quarter starts a week late', () => {
    // 1 Oct 2026 is a Thursday: its week began Mon 28 Sep, which is Q3's by the Monday rule. So Q4 opens
    // on Mon 5 Oct — the same seam as the month, one horizon up, and the reason all three were fixed.
    expect(weekRangeOf('Quarterly', '2026-Q4')).toBe('Mon 5 Oct 2026 – Sun 3 Jan 2027');
    expect(firstWeekOf('Quarterly', '2026-Q4')).toBe('2026-10-05');
    // Q3 2026 has the same shape (1 Jul is a Wednesday) and its far end is the same Sun 4 Oct that
    // September's is — the quarter and its last month end together, as they must.
    expect(weekRangeOf('Quarterly', '2026-Q3')).toBe('Mon 6 Jul – Sun 4 Oct');
    expect(weekRangeOf('Quarterly', '2027-Q1')).toBe('Mon 4 Jan – Sun 4 Apr');
  });

  it('a week is its own range, and Life has none', () => {
    // Weekly is the degenerate case and is still answered, because the Zoom sheet prints every row.
    expect(weekRangeOf('Weekly', '2026-08-31')).toBe('Mon 31 Aug – Sun 6 Sep');
    expect(weekRangeOf('Life', '')).toBe('');
  });

  it('an unrecognised key measures to nothing rather than throwing (R-goal-33 / R-lens-20)', () => {
    // A range is display text, exactly as a label is. A read that 500s because one row's key is malformed
    // hides the row it was meant to describe.
    expect(weekRangeOf('Monthly', 'garbage')).toBe('');
    expect(weekRangeOf('Quarterly', '2026-Q5')).toBe('');
    expect(weekRangeOf('Weekly', '2026-09-01')).toBe(''); // a Tuesday, so not a canonical week key
  });

  it('the month helpers R-goal-47 scans with ARE these, so the two cannot disagree', () => {
    // `firstMondayIn` / `lastMondayIn` now delegate. A second copy of the step-forward clause is how the
    // header's range and the planned-ness line's scope would come to disagree on one month in seven.
    for (const key of ['2026-06', '2026-08', '2026-09', '2026-12', '2027-02']) {
      expect(firstMondayIn(key)).toBe(firstWeekOf('Monthly', key));
      expect(lastMondayIn(key)).toBe(lastWeekOf('Monthly', key));
    }
  });

  it('every Monday in the range belongs to the period, and the ones either side do not', () => {
    // The invariant the label promises, checked as an invariant rather than as a string: a period is
    // exactly the weeks whose Monday is inside it.
    for (const [horizon, key] of [
      ['Monthly', '2026-09'],
      ['Monthly', '2026-06'],
      ['Quarterly', '2026-Q4'],
      ['Yearly', '2026'],
    ] as const) {
      const first = firstWeekOf(horizon, key);
      const last = lastWeekOf(horizon, key);
      expect(periodKeyOf(horizon, first)).toBe(key);
      expect(periodKeyOf(horizon, last)).toBe(key);
      const before = new Date(Date.parse(`${first}T00:00:00.000Z`) - 7 * 86_400_000).toISOString().slice(0, 10);
      const after = new Date(Date.parse(`${last}T00:00:00.000Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
      expect(periodKeyOf(horizon, before)).not.toBe(key);
      expect(periodKeyOf(horizon, after)).not.toBe(key);
    }
  });
});

describe('R-lens-29 — the period holding the current WEEK is not always the current period', () => {
  it('on Tue 1 Sep 2026 the current month is Sep and the current week is August’s', () => {
    // This is the whole defect in four lines. Both answers are right; only the label was wrong.
    expect(periodKeyOf('Monthly', '2026-09-01')).toBe('2026-09');
    expect(periodKeyOfCurrentWeek('Monthly', '2026-09-01')).toBe('2026-08');
    // The quarter and the year agree with themselves that day — the seam is a month seam only.
    expect(periodKeyOfCurrentWeek('Quarterly', '2026-09-01')).toBe('2026-Q3');
    expect(periodKeyOfCurrentWeek('Yearly', '2026-09-01')).toBe('2026');
    // …and the Weekly horizon can never disagree with itself: a week always holds its own week.
    expect(periodKeyOfCurrentWeek('Weekly', '2026-09-01')).toBe('2026-08-31');
  });

  it('the seam fires at every horizon at once when a year opens mid-week', () => {
    // Fri 1 Jan 2027's week began Mon 28 Dec 2026, so on that day the Yearly, Quarterly AND Monthly
    // lenses all open on a period that does not hold the week in progress. This is why the flag is
    // designed for any lens rather than for months.
    expect(periodKeyOfCurrentWeek('Yearly', '2027-01-01')).toBe('2026');
    expect(periodKeyOfCurrentWeek('Quarterly', '2027-01-01')).toBe('2026-Q4');
    expect(periodKeyOfCurrentWeek('Monthly', '2027-01-01')).toBe('2026-12');
  });

  it('on a Monday the two always agree, at every horizon', () => {
    // Mon 31 Aug 2026 IS the start of its own week, so no horizon can be off by one.
    for (const horizon of ['Yearly', 'Quarterly', 'Monthly', 'Weekly'] as const) {
      expect(periodKeyOfCurrentWeek(horizon, '2026-08-31')).toBe(periodKeyOf(horizon, '2026-08-31'));
    }
    expect(periodKeyOfCurrentWeek('Life', '2026-09-01')).toBe('');
  });
});
