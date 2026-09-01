import { describe, expect, it } from 'vitest';
import {
  firstMondayIn,
  isCurrentPeriod,
  isPastPeriod,
  isPeriodKeyFor,
  labelOf,
  lastMondayIn,
  periodKeyOf,
  replanPeriods,
  stepPeriod,
  taskWeekForMonth,
  zoomTo,
  zoomWeekForMonth,
} from '../src/index';

/**
 * ⚠ **A2, new (R-goal-33/34, R-lens-9)** — period arithmetic, in the one module it lives in.
 *
 * D-3 is the reason it is one module: the mockup hardcoded 2026 literals in three places and every one
 * of them was wrong from the first day of the next period. Two implementations of a date rule drift on
 * the first boundary.
 */
describe('R-goal-33 — canonical period keys, one shape per horizon', () => {
  it('S-goal-33-1 — the key is the period CONTAINING the given day, derived and never a literal', () => {
    expect(periodKeyOf('Life', '2026-09-01')).toBe('');
    expect(periodKeyOf('Yearly', '2026-09-01')).toBe('2026');
    expect(periodKeyOf('Quarterly', '2026-09-01')).toBe('2026-Q3');
    expect(periodKeyOf('Monthly', '2026-09-01')).toBe('2026-09');
    // A Weekly key IS a WeekStart (D-1): 1 Sep 2026 is a Tuesday, so its week's Monday is 31 Aug.
    expect(periodKeyOf('Weekly', '2026-09-01')).toBe('2026-08-31');
    // …and it moves with the clock, which the mockup's frozen literals could not.
    expect(periodKeyOf('Quarterly', '2027-01-04')).toBe('2027-Q1');
    expect(periodKeyOf('Monthly', '2027-01-04')).toBe('2027-01');
  });

  it('S-goal-33-1 — the LABEL is rendered from the key, and is the only thing `period` ever holds', () => {
    expect(labelOf('Life', '')).toBe('');
    expect(labelOf('Yearly', '2026')).toBe('2026');
    expect(labelOf('Quarterly', '2026-Q3')).toBe('Q3 2026');
    expect(labelOf('Monthly', '2026-09')).toBe('Sep 2026');
    expect(labelOf('Weekly', '2026-09-07')).toBe('Week of 7 Sep');
  });

  it('S-goal-33-2 — a key is validated against its OWN horizon', () => {
    expect(isPeriodKeyFor('Quarterly', '2026-Q5')).toBe(false);
    expect(isPeriodKeyFor('Monthly', '2026-13')).toBe(false);
    expect(isPeriodKeyFor('Weekly', '2026-09-01')).toBe(false); // a Tuesday
    expect(isPeriodKeyFor('Weekly', '2026-08-31')).toBe(true); // a Monday
    // A lens must PARTITION its horizon, so a key valid for one is not valid for another.
    expect(isPeriodKeyFor('Monthly', '2026')).toBe(false);
    expect(isPeriodKeyFor('Yearly', '')).toBe(false);
    expect(isPeriodKeyFor('Life', '')).toBe(true);
  });

  it('R-goal-33 — an unrecognised key renders as itself rather than throwing', () => {
    // A label is display text. A read that 500s because one row's key is malformed HIDES the row, which
    // is the opposite of R-lens-20's principle: a data problem must surface.
    expect(labelOf('Monthly', 'garbage')).toBe('garbage');
  });

  it('R-goal-33 — the keys sort lexicographically in chronological order', () => {
    // Load-bearing, not cosmetic: R-goal-47's BETWEEN range read and R-lens-26's `>` probe are index
    // seeks only because this holds.
    expect(['2026-Q4', '2026-Q1', '2027-Q1'].sort()).toEqual(['2026-Q1', '2026-Q4', '2027-Q1']);
    expect(['2026-10', '2026-02', '2027-01'].sort()).toEqual(['2026-02', '2026-10', '2027-01']);
  });
});

describe('R-goal-36 — the past is the only refusal, and there is no forward half', () => {
  const today = '2026-09-15';

  it('S-goal-36-1 — an earlier period at any horizon is past', () => {
    expect(isPastPeriod('Monthly', '2026-08', today)).toBe(true);
    expect(isPastPeriod('Quarterly', '2026-Q2', today)).toBe(true);
    expect(isPastPeriod('Yearly', '2025', today)).toBe(true);
    expect(isPastPeriod('Weekly', '2026-09-07', today)).toBe(true);
  });

  it('S-goal-36-3 — the current period and EVERY future one are writable, at any distance', () => {
    expect(isPastPeriod('Monthly', '2026-09', today)).toBe(false);
    expect(isPastPeriod('Monthly', '2028-03', today)).toBe(false); // 18 months out
    expect(isPastPeriod('Weekly', '2027-06-21', today)).toBe(false); // 40 weeks out
    // A Life goal has no period at all, so it is never "past".
    expect(isPastPeriod('Life', '', today)).toBe(false);
  });

  it('R-goal-34 — "current" is a comparison against the period containing the owner-local day', () => {
    expect(isCurrentPeriod('Monthly', '2026-09', today)).toBe(true);
    expect(isCurrentPeriod('Monthly', '2026-10', today)).toBe(false);
    expect(isCurrentPeriod('Life', '', today)).toBe(false); // Life has no current period
  });
});

describe('R-lens-7 — stepping a period, unbounded in both directions', () => {
  it('steps by the lens’s own unit and rolls the year over', () => {
    expect(stepPeriod('Yearly', '2026', 1)).toBe('2027');
    expect(stepPeriod('Quarterly', '2026-Q4', 1)).toBe('2027-Q1');
    expect(stepPeriod('Quarterly', '2026-Q1', -1)).toBe('2025-Q4');
    expect(stepPeriod('Monthly', '2026-12', 1)).toBe('2027-01');
    expect(stepPeriod('Monthly', '2026-01', -1)).toBe('2025-12');
    expect(stepPeriod('Weekly', '2026-08-31', 1)).toBe('2026-09-07');
    expect(stepPeriod('Life', '', 1)).toBe('');
  });

  it('S-lens-7-3 — twenty steps forward is an ordinary period, not a refusal', () => {
    let key = '2026-08-31';
    for (let i = 0; i < 20; i++) key = stepPeriod('Weekly', key, 1);
    expect(key).toBe('2027-01-18');
    expect(isPastPeriod('Weekly', key, '2026-08-31')).toBe(false);
  });
});

describe('R-lens-9 / R-lens-18 — zooming between lenses', () => {
  const today = '2026-09-01';

  it('S-lens-9-3 — zoom OUT gives the period containing the anchor', () => {
    expect(zoomTo('Quarterly', '2026-09-15', today)).toBe('2026-Q3');
    expect(zoomTo('Yearly', '2026-09-15', today)).toBe('2026');
  });

  it('S-lens-9-1 — zoom IN prefers TODAY when the anchor is today', () => {
    // R-lens-18 does the work: stepping moves the anchor to the first day of the new period UNLESS today
    // is inside it, in which case the anchor IS today. So "the period containing the anchor" already
    // resolves both of R-lens-9's cases with no branch.
    expect(zoomTo('Monthly', today, today)).toBe('2026-09'); // not 2026-07, the first month of Q3
  });

  it('S-lens-9-2 — and falls back to the FIRST sub-period when the anchor is not today', () => {
    expect(zoomTo('Monthly', '2027-01-01', today)).toBe('2027-01');
  });

  it('S-lens-9-6 — Life has no period, and zooming to it discards nothing else', () => {
    expect(zoomTo('Life', '2026-09-15', today)).toBe('');
  });

  /**
   * SUPERSEDED — **S-lens-9-5 asserted the week containing 1 Sep (Mon 31 Aug) for the Monthly→Weekly
   * zoom, and R-lens-9's reconciliation-pass amendment retires exactly that behaviour**:
   *
   *   "The original text said 'the week containing the 1st' and accepted a Monday in the previous month.
   *    That is retired: R-goal-33 keys a week by its Monday, so zooming into `Nov 2026` would have
   *    landed on the week of Mon 26 Oct — a week every other rule counts as October's, including
   *    R-goal-47's planned-ness scope and R-task-49's target week. One Monday rule, three consumers, no
   *    disagreement."
   *
   * The scenario was written before that amendment and was not updated with it. The RULE governs (the
   * spec's own rule of decision: the spec wins on rules), so the destination is the first week whose
   * MONDAY falls in the month. Asserted here rather than silently changed.
   */
  it('R-lens-9 (amended) — Monthly → Weekly is the first week whose MONDAY falls in that month', () => {
    // Sep 2026 starts on a Tuesday; Mon 31 Aug belongs to August by the Monday rule, so Mon 7 Sep wins.
    expect(zoomTo('Weekly', '2026-09-01', '2026-06-01')).toBe('2026-09-07');
    expect(firstMondayIn('2026-09')).toBe('2026-09-07');
    // Nov 2026 — the case the amendment names: NOT Mon 26 Oct.
    expect(firstMondayIn('2026-11')).toBe('2026-11-02');
    // A month that starts ON a Monday keeps its own first day.
    expect(firstMondayIn('2026-06')).toBe('2026-06-01');
  });

  it('R-lens-9 — `zoomWeekForMonth` lands on the week you are LIVING in, seam and all', () => {
    // Away from the seam the two rules agree, which is why one function passed for three consumers.
    expect(zoomWeekForMonth('2026-09', '2026-09-16')).toBe('2026-09-14'); // the week containing today
    expect(zoomWeekForMonth('2026-11', '2026-09-16')).toBe('2026-11-02'); // first Monday in November
    /**
     * ⚠ **A9 — the seam, asserted rather than left implicit.** On Wed 2 Sep 2026 the zoom answers the week
     * of Mon 31 Aug, which belongs to AUGUST. That is correct for a zoom — it is the week the owner is
     * living in — and R-lens-29's `This week is in Aug 2026` pill is what names it. It is the same answer
     * that was wrong for task creation, which is why the two are now two functions.
     */
    expect(zoomWeekForMonth('2026-09', '2026-09-02')).toBe('2026-08-31');
    expect(periodKeyOf('Monthly', '2026-08-31')).toBe('2026-08');
  });

  it('R-task-49 (A9) — `taskWeekForMonth` never answers a week outside the month it was asked about', () => {
    /**
     * The owner's exact case. `+ Task` on a **September** Monthly goal on Wed 2 Sep 2026 must land in a
     * week September's own lens shows; the old clamp answered Mon 31 Aug and the work vanished.
     */
    expect(taskWeekForMonth('2026-09', '2026-09-02')).toBe('2026-09-07');
    // …and the SAME day, asked about August, answers the week the owner is standing in, not Mon 3 Aug:
    // the month holding the current week keeps it, so nothing is ever pushed backwards into a past week.
    expect(taskWeekForMonth('2026-08', '2026-09-02')).toBe('2026-08-31');

    // Away from the seam it is the ordinary answer, and it agrees with the zoom.
    expect(taskWeekForMonth('2026-09', '2026-09-16')).toBe('2026-09-14');
    expect(taskWeekForMonth('2026-11', '2026-09-16')).toBe('2026-11-02');

    // The property that makes it safe: every answer's own month IS the month asked for.
    for (const month of ['2026-01', '2026-02', '2026-08', '2026-09', '2026-10', '2026-11', '2027-02']) {
      for (const today of ['2026-09-01', '2026-09-02', '2026-09-07', '2026-11-01', '2027-02-03']) {
        expect(periodKeyOf('Monthly', taskWeekForMonth(month, today))).toBe(month);
      }
    }
  });

  it('R-goal-47 — the range read’s two ends are both Mondays inside the month', () => {
    expect(firstMondayIn('2026-09')).toBe('2026-09-07');
    expect(lastMondayIn('2026-09')).toBe('2026-09-28');
    expect(lastMondayIn('2026-11')).toBe('2026-11-30');
  });

  it('S-lens-9-4 — the round trip is lossless, because zooming never moves the anchor', () => {
    const anchor = '2027-01-01';
    expect(zoomTo('Quarterly', anchor, today)).toBe('2027-Q1');
    expect(zoomTo('Monthly', anchor, today)).toBe('2027-01');
    expect(zoomTo('Quarterly', anchor, today)).toBe('2027-Q1'); // and back
  });
});

describe('R-goal-40 / D-3 — re-plan options are derived from today and are strictly forward', () => {
  it('S-goal-40-1 — the next periods, derived from today, rolling the year over', () => {
    expect(replanPeriods('Monthly', '2026-09-15')).toEqual(['2026-10', '2026-11']);
    expect(replanPeriods('Monthly', '2026-12-15')).toEqual(['2027-01', '2027-02']);
    expect(replanPeriods('Quarterly', '2026-09-15')).toEqual(['2026-Q4', '2027-Q1']);
    expect(replanPeriods('Yearly', '2026-09-15')).toEqual(['2027']);
  });

  it('D-3 — options are strictly AFTER the goal’s current period, so re-plan cannot be a no-op', () => {
    expect(replanPeriods('Quarterly', '2026-09-15', '2026-Q4')).toEqual(['2027-Q1', '2027-Q2']);
    expect(replanPeriods('Monthly', '2026-09-15', '2026-12')).toEqual(['2027-01', '2027-02']);
    // an unparseable current period falls back to today's, keeping the sheet useful
    expect(replanPeriods('Monthly', '2026-09-15', 'sometime')).toEqual(['2026-10', '2026-11']);
  });

  it('S-goal-40-2 — NEITHER a Life goal NOR a Weekly goal is re-plannable, for opposite reasons', () => {
    // A Life goal has no period at all (R-goal-21). A Weekly goal IS a week: moving it would silently
    // restate what a past week contained, which is D-2. An intention that did not happen carries forward
    // through its open tasks (R-lens-12), or is written again as a new Weekly goal.
    expect(replanPeriods('Life', '2026-09-15')).toEqual([]);
    expect(replanPeriods('Weekly', '2026-09-15', '2026-09-14')).toEqual([]);
  });
});
