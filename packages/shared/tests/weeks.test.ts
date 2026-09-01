import { describe, expect, it } from 'vitest';
import {
  addWeeks,
  dateInTimezone,
  isMonday,
  isValidTimezone,
  offsetOf,
  weekStartFromOffset,
  weekStartOf,
  weekStartOfDate,
  weeksBetween,
} from '../src/index';

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

/**
 * RETIRED — `selectableWeeks` enumerated "the current week plus the previous N−1", and its last
 * assertion was "no future week is ever reachable (R-nav-3)". R-lens-7 supersedes both halves: there is
 * no picker to enumerate (the lens title opens the Zoom sheet instead — R-lens-17), no forward bound
 * (R-goal-36) and no backward one either, because a bound in one direction alone rebuilds D-24's
 * asymmetry. D-24 is now satisfied by CONSTRUCTION: one control per dimension.
 *
 * The function is deleted rather than left unused (R-rm-* discipline), so this asserts its absence.
 */
describe('S-lens-7-3 / S-rm-3-1 — the week bounds are gone in both directions', () => {
  it('offsets resolve in both directions, and no range helper survives to re-impose a bound', async () => {
    const current = '2026-08-31';
    expect(weekStartFromOffset(current, 20)).toBe('2027-01-18');
    expect(offsetOf('2027-01-18', current)).toBe(20);
    expect(isMonday(weekStartFromOffset(current, 20))).toBe(true);

    const weeks = (await import('../src/calendar/weeks')) as Record<string, unknown>;
    expect(weeks, 'selectableWeeks').not.toHaveProperty('selectableWeeks');
  });
});
