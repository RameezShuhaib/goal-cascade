import { describe, expect, it } from 'vitest';
import {
  addWeeks,
  carryWeeks,
  dateInTimezone,
  isMonday,
  isValidTimezone,
  isVisibleInWeek,
  offsetOf,
  selectableWeeks,
  weekStartFromOffset,
  weekStartOf,
  weekStartOfDate,
  weeksBetween,
} from '../../src/domain/weeks';

describe('weeks start Monday', () => {
  it('maps every day of a week to the same Monday, and Sunday to the week BEFORE', () => {
    expect(weekStartOfDate('2026-08-31')).toBe('2026-08-31'); // Monday itself
    expect(weekStartOfDate('2026-09-01')).toBe('2026-08-31'); // Tuesday
    expect(weekStartOfDate('2026-09-06')).toBe('2026-08-31'); // Sunday belongs to the week before
    expect(weekStartOfDate('2026-09-07')).toBe('2026-09-07'); // the next Monday
  });

  it('isMonday agrees with the resolver', () => {
    expect(isMonday('2026-08-31')).toBe(true);
    expect(isMonday('2026-09-01')).toBe(false);
    expect(isMonday('not-a-date')).toBe(false);
  });

  it('rejects anything that is not an ISO date rather than silently coercing it', () => {
    expect(() => weekStartOfDate('2026-8-31')).toThrow();
    expect(() => weekStartOfDate('2026-08-31T00:00:00Z')).toThrow();
  });
});

describe('R-auth-5 / Q-9 — the week comes from the OWNER’s timezone, not the client clock', () => {
  it('S-auth-5-1 — an instant near the Sunday/Monday boundary resolves per zone', () => {
    // 2026-08-31T00:30Z is already Monday in Berlin (+02:00) but still Sunday in Los Angeles (-07:00).
    const instant = '2026-08-31T00:30:00.000Z';
    expect(dateInTimezone(instant, 'Europe/Berlin')).toBe('2026-08-31');
    expect(dateInTimezone(instant, 'America/Los_Angeles')).toBe('2026-08-30');
    expect(weekStartOf(instant, 'Europe/Berlin')).toBe('2026-08-31');
    expect(weekStartOf(instant, 'America/Los_Angeles')).toBe('2026-08-24');
  });

  it('an unknown zone falls back to UTC rather than throwing mid-request', () => {
    expect(isValidTimezone('Europe/Berlin')).toBe(true);
    expect(isValidTimezone('Mars/Olympus')).toBe(false);
    expect(weekStartOf('2026-08-31T00:30:00.000Z', 'Mars/Olympus')).toBe('2026-08-31');
  });

  it('date-only arithmetic makes DST irrelevant: a spring-forward week is still 7 days', () => {
    // Europe/Berlin springs forward on 2026-03-29 (a Sunday), inside the week of 2026-03-23.
    expect(weeksBetween('2026-03-23', '2026-03-30')).toBe(1);
    expect(addWeeks('2026-03-23', 1)).toBe('2026-03-30');
    expect(weekStartOf('2026-03-30T12:00:00.000Z', 'Europe/Berlin')).toBe('2026-03-30');
  });
});

describe('D-1 — offsets are a wire projection, never storage', () => {
  const current = '2026-08-31';

  it('round-trips offset ↔ weekStart against the current week', () => {
    expect(weekStartFromOffset(current, 0)).toBe('2026-08-31');
    expect(weekStartFromOffset(current, -1)).toBe('2026-08-24');
    expect(weekStartFromOffset(current, -4)).toBe('2026-08-03');
    expect(offsetOf('2026-08-24', current)).toBe(-1);
    expect(offsetOf('2026-08-31', current)).toBe(0);
    for (const o of [0, -1, -3, -12]) expect(offsetOf(weekStartFromOffset(current, o), current)).toBe(o);
  });

  it('the whole point: an absolute weekStart does NOT age when the current week moves on', () => {
    const origin = '2026-08-24';
    expect(offsetOf(origin, '2026-08-31')).toBe(-1);
    // one week later, nothing was written, and the row still means the same week
    expect(offsetOf(origin, '2026-09-07')).toBe(-2);
    expect(origin).toBe('2026-08-24');
  });
});

describe('R-task-10/11/12 — carry age depends on the VIEWED week, not on today', () => {
  it('S-task-11-2 — origin two weeks back, viewed one week back, is age 1 (gray), not age 2 (red)', () => {
    expect(carryWeeks('2026-08-17', '2026-08-24')).toBe(1);
    expect(carryWeeks('2026-08-17', '2026-08-31')).toBe(2);
    expect(carryWeeks('2026-08-31', '2026-08-31')).toBe(0);
  });

  it('never reports a negative age for a week before the origin', () => {
    expect(carryWeeks('2026-08-31', '2026-08-24')).toBe(0);
  });
});

describe('R-task-7/8/32 — week visibility, derived with no write at all', () => {
  const open = { status: 'open' as const, originWeekStart: '2026-08-17', doneWeekStart: null };

  it('S-task-7-1 — an open task is visible in every week at or after its origin, with no prompt', () => {
    for (const w of ['2026-08-17', '2026-08-24', '2026-08-31', '2026-09-07']) {
      expect(isVisibleInWeek(open, w), w).toBe(true);
    }
  });

  it('S-task-7-2 — and in no week before it', () => {
    expect(isVisibleInWeek(open, '2026-08-10')).toBe(false);
  });

  it('S-task-8-1 — a done task is visible ONLY in the week it was completed', () => {
    const done = { status: 'done' as const, originWeekStart: '2026-08-17', doneWeekStart: '2026-08-24' };
    expect(isVisibleInWeek(done, '2026-08-24')).toBe(true);
    expect(isVisibleInWeek(done, '2026-08-17')).toBe(false);
    expect(isVisibleInWeek(done, '2026-08-31')).toBe(false);
  });

  it('D-15 — an exited task is visible in NO week, though its row and timeline survive', () => {
    for (const status of ['canceled', 'movedToBacklog'] as const) {
      const exited = { status, originWeekStart: '2026-08-17', doneWeekStart: null };
      for (const w of ['2026-08-10', '2026-08-17', '2026-08-31']) {
        expect(isVisibleInWeek(exited, w), `${status} @ ${w}`).toBe(false);
      }
    }
  });
});

describe('R-nav-4 / D-24 — one bound for both week controls', () => {
  it('the selectable range is the current week plus the previous N-1, newest first', () => {
    const weeks = selectableWeeks('2026-08-31', 8);
    expect(weeks).toHaveLength(8);
    expect(weeks[0]).toBe('2026-08-31');
    expect(weeks.at(-1)).toBe('2026-07-13');
    expect(weeks.every(isMonday)).toBe(true);
    // no future week is ever reachable (R-nav-3)
    expect(weeks.every((w) => offsetOf(w, '2026-08-31') <= 0)).toBe(true);
  });
});
