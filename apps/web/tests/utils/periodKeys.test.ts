import { describe, expect, it } from 'vitest';
import { enclosingKey, firstDayOf, stepPeriod, validKeyFor, weekForMonth, weeksBetween } from '../../src/utils/periodKeys';

/**
 * The period-key arithmetic — the one piece of date handling this client is allowed to own, and the
 * boundary cases that decide whether it can disagree with the server.
 *
 * It consults no clock. Every function here takes canonical keys (R-goal-33) or a Monday the server sent
 * (D-1), so it cannot form an opinion about *now* — which is the whole reason it is allowed to exist while
 * `defaultPeriod` and `replanPeriods` were deleted (D-3).
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

describe('weekForMonth — the one answer to "which week does this month mean"', () => {
  const currentMonday = '2026-08-31';
  const todayMonth = '2026-08';

  it('R-task-49: the week containing today, when the month contains today', () => {
    expect(weekForMonth('2026-08', currentMonday, todayMonth)).toBe('2026-08-31');
  });

  /**
   * ⚠ **R-lens-9's correction.** The retired text said "the week containing the 1st" and accepted a Monday
   * in the previous month — zooming into `Nov 2026` would have landed on the week of Mon 26 Oct, a week
   * every other rule counts as October's. One Monday rule, three consumers (zoom, `+ Task` from a Monthly
   * card, R-goal-47's scope), no disagreement.
   */
  it('otherwise the first week whose MONDAY falls in that month — never one in the previous month', () => {
    // 1 Nov 2026 is a Sunday, so the week containing it starts Mon 26 Oct. That week is October's.
    expect(weekForMonth('2026-11', currentMonday, todayMonth)).toBe('2026-11-02');
    // 1 Sep 2026 is a Tuesday; the first Monday whose own month is September is the 7th.
    expect(weekForMonth('2026-09', currentMonday, todayMonth)).toBe('2026-09-07');
    // A month that begins on a Monday keeps its own 1st.
    expect(weekForMonth('2027-02', currentMonday, todayMonth)).toBe('2027-02-01');
  });

  it('works backwards from the known Monday too, and always lands on a Monday', () => {
    for (const month of ['2026-01', '2026-05', '2025-12', '2027-06']) {
      const monday = weekForMonth(month, currentMonday, todayMonth);
      expect(weeksBetween(currentMonday, monday) * 7).toBe(Math.round((Date.parse(`${monday}T00:00:00Z`) - Date.parse(`${currentMonday}T00:00:00Z`)) / 86_400_000));
      expect(monday.slice(0, 7)).toBe(month);
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
