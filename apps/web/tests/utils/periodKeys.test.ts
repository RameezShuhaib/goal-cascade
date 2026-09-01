import { describe, expect, it } from 'vitest';
import { firstDayOf, periodKeyOf, stepPeriod, taskWeekForMonth, weeksBetween, zoomWeekForMonth } from '@goal-cascade/shared';
import { enclosingKey, validKeyFor } from '../../src/utils/periodKeys';

/**
 * The period-key arithmetic, and the boundary cases that decide whether the client can disagree with the
 * server about a period.
 *
 * ⚠ **R-lens-30 — every assertion below is UNCHANGED, and only the import line moved.** These
 * expectations were written against `utils/periodKeys.ts`'s own copies of `stepPeriod`, `firstDayOf` and
 * `weeksBetween`; they now run against `@goal-cascade/shared`, which is the module the Worker calls. That
 * this file went green with no edit to a single expectation is the proof, after the fact, that the two
 * implementations had agreed all along — and it is the last moment at which they could ever be asked,
 * because there is only one of them now.
 *
 * ⚠ **A9 — `weekForMonth` is no longer imported from `utils/periodKeys`, because it is no longer declared
 * there.** The client wrapper was the last of the six duplicated calendar functions this file's header
 * describes, and it survived R-lens-30 only because its signature looked like vocabulary. It was not: it
 * decided which week a month means, it was mis-named for two of its three consumers, and the one it was
 * wrong for is the one the owner used. It is now two shared functions, `zoomWeekForMonth` and
 * `taskWeekForMonth`, and both are named in `no-second-calendar.test.ts`'s census.
 *
 * The two still imported from `utils/periodKeys` are genuinely client vocabulary rather than calendar:
 * `enclosingKey` (a create-form scope) and `validKeyFor` (a URL segment is attacker-supplied).
 */

describe('stepPeriod — unbounded in both directions (R-lens-7, R-rm-3)', () => {
  it('steps each horizon by its own unit, across the year boundary in both directions', () => {
    expect(stepPeriod('Yearly', '2026', 1)).toBe('2027');
    expect(stepPeriod('Quarterly', '2026-Q4', 1)).toBe('2027-Q1');
    expect(stepPeriod('Quarterly', '2026-Q1', -1)).toBe('2025-Q4');
    expect(stepPeriod('Monthly', '2026-12', 1)).toBe('2027-01');
    expect(stepPeriod('Monthly', '2026-01', -1)).toBe('2025-12');
    // A Weekly key IS a Monday, and stepping walks whole weeks off it — so the result is a Monday by
    // construction, with no `weekStartOfDate` anywhere in this client.
    expect(stepPeriod('Weekly', '2026-08-31', 1)).toBe('2026-09-07');
    expect(stepPeriod('Weekly', '2026-08-31', -1)).toBe('2026-08-24');
  });

  it('has no clamp at either end — twenty steps forward is twenty periods forward', () => {
    let key = '2026-08';
    for (let i = 0; i < 20; i += 1) key = stepPeriod('Monthly', key, 1);
    expect(key).toBe('2028-04');
  });

  it('Life has no period to step', () => {
    expect(stepPeriod('Life', '', 1)).toBe('');
  });
});

describe('enclosingKey — walking UP from a key we already hold (R-goal-5, §6.7)', () => {
  it('answers the create form’s "which parents are legal in the enclosing period"', () => {
    expect(enclosingKey('Yearly', 'Monthly', '2026-08')).toBe('2026');
    expect(enclosingKey('Quarterly', 'Monthly', '2026-08')).toBe('2026-Q3');
    expect(enclosingKey('Quarterly', 'Monthly', '2026-10')).toBe('2026-Q4');
    // A week belongs to its MONDAY's month (R-lens-9) — which is why the Weekly key is the input.
    expect(enclosingKey('Monthly', 'Weekly', '2026-08-31')).toBe('2026-08');
    expect(enclosingKey('Yearly', 'Weekly', '2026-12-28')).toBe('2026');
  });
});

describe('the target week a Monthly card resolves (R-task-49, A9)', () => {
  /**
   * ⚠ **A9 — the defect the owner actually hit, pinned in the client that hit it.**
   *
   * `MonthlyCard` used to call `weekForMonth`, which compares today's **calendar month** with the card's.
   * On Wed 2 Sep 2026 that answered Mon 31 Aug for a **September** card — a week August owns by the
   * product's own Monday rule — so `+ Task` created a Weekly goal in August under a September parent,
   * R-goal-47's September line went on saying `Nothing planned yet`, and the app navigated to August.
   *
   * `taskWeekForMonth` compares the month of the **current week** instead, which is the same predicate
   * every other rule in the product uses, and its answer is inside the month asked for by construction.
   */
  it('R-task-49: the week the owner is living in, when THAT WEEK belongs to the month', () => {
    expect(taskWeekForMonth('2026-08', '2026-08-31')).toBe('2026-08-31');
    // The seam, from the other side: on 2 Sep the current week is still August's, and August keeps it —
    // so nothing is pushed back to Mon 3 Aug, a week `+ Task` may not write into at all (R-goal-36).
    expect(taskWeekForMonth('2026-08', '2026-09-02')).toBe('2026-08-31');
  });

  it('otherwise the month’s FIRST week — and never one belonging to another month', () => {
    // 1 Nov 2026 is a Sunday, so the week containing it starts Mon 26 Oct. That week is October's.
    expect(taskWeekForMonth('2026-11', '2026-08-31')).toBe('2026-11-02');
    // 1 Sep 2026 is a Tuesday; the first Monday whose own month is September is the 7th.
    expect(taskWeekForMonth('2026-09', '2026-08-31')).toBe('2026-09-07');
    // A month that begins on a Monday keeps its own 1st.
    expect(taskWeekForMonth('2027-02', '2026-08-31')).toBe('2027-02-01');
    // ⚠ **The owner's exact case.** Today is INSIDE September's calendar month and OUTSIDE its week range.
    expect(taskWeekForMonth('2026-09', '2026-09-02')).toBe('2026-09-07');
  });

  it('R-lens-9 — the ZOOM keeps the old answer, under its own name, and that is correct', () => {
    // Landing on the week you are living in is right for a zoom even when it belongs to last month;
    // R-lens-29's `This week is in Aug 2026` pill is what names the seam. Two questions, two functions.
    expect(zoomWeekForMonth('2026-09', '2026-09-02')).toBe('2026-08-31');
    expect(periodKeyOf('Monthly', '2026-08-31')).toBe('2026-08');
  });

  it('always lands on a Monday, and always one whose own month is the month asked for', () => {
    const currentMonday = '2026-08-31';
    for (const month of ['2026-01', '2026-05', '2025-12', '2027-06']) {
      const monday = taskWeekForMonth(month, currentMonday);
      expect(weeksBetween(currentMonday, monday) * 7).toBe(Math.round((Date.parse(`${monday}T00:00:00Z`) - Date.parse(`${currentMonday}T00:00:00Z`)) / 86_400_000));
      expect(periodKeyOf('Monthly', monday)).toBe(month);
    }
  });
});

describe('validKeyFor — a URL segment is attacker-supplied', () => {
  it('accepts only the canonical key for that lens', () => {
    expect(validKeyFor('Quarterly', '2026-Q3')).toBe('2026-Q3');
    expect(validKeyFor('Quarterly', '2026-Q9')).toBeUndefined();
    expect(validKeyFor('Monthly', '2026-13')).toBeUndefined();
    // A Weekly key that is not a Monday is refused: `2026-09-01` is a Tuesday (S-goal-33-2).
    expect(validKeyFor('Weekly', '2026-09-01')).toBeUndefined();
    expect(validKeyFor('Weekly', '2026-08-31')).toBe('2026-08-31');
    // The Life lens has no period dimension at all, so nothing is ever carried for it.
    expect(validKeyFor('Life', '2026')).toBeUndefined();
    expect(validKeyFor('Monthly', undefined)).toBeUndefined();
  });
});

describe('firstDayOf — R-lens-18’s anchor when today is somewhere else', () => {
  it('is the first calendar date inside the period', () => {
    expect(firstDayOf('Yearly', '2027')).toBe('2027-01-01');
    expect(firstDayOf('Quarterly', '2027-Q1')).toBe('2027-01-01');
    expect(firstDayOf('Quarterly', '2026-Q4')).toBe('2026-10-01');
    expect(firstDayOf('Monthly', '2026-11')).toBe('2026-11-01');
    expect(firstDayOf('Weekly', '2026-08-31')).toBe('2026-08-31');
  });
});
