import { describe, expect, it } from 'vitest';
import { addWeeks, dateInTimezone, isValidTimezone, periodViewOf, weekStartOf, weeksBetween } from '../src/index';
import { PERIOD_BOUNDARIES } from './fixtures/period-boundaries';

/**
 * **Timezone and DST** (R-lens-30, R-auth-5, Q-9).
 *
 * `dateInTimezone` is the single place the owner's zone turns an instant into a day, and it is now the
 * only such place in the repo — the client's `todayInZone` is deleted. Everything downstream is pure date
 * arithmetic over `YYYY-MM-DD`, which is why DST is a non-event by construction. **This file's job is to
 * pin that it stays a non-event**, and to pin the fallback, which is the one place the client's behaviour
 * genuinely changed.
 *
 * Every expectation below was worked out by hand from the offset, not from the implementation.
 */

describe('`dateInTimezone` — the owner’s day, from the owner’s zone', () => {
  it('agrees with the fixture table’s own hand-derived `today` on every row', () => {
    // The fixture table's `today` column is itself an assertion about this function; asserting it here
    // means a wrong `today` in a row fails once, loudly, rather than as a confusing `label` mismatch.
    for (const row of PERIOD_BOUNDARIES) {
      expect(dateInTimezone(row.nowIso, row.tz), `${row.name}`).toBe(row.today);
    }
  });

  it('a sub-hour offset lands on the right day: Asia/Kathmandu is +05:45', () => {
    // 18:14 UTC + 05:45 = 23:59 → still the 31st. 18:15 UTC + 05:45 = 00:00 → the 1st.
    expect(dateInTimezone('2026-08-31T18:14:00.000Z', 'Asia/Kathmandu')).toBe('2026-08-31');
    expect(dateInTimezone('2026-08-31T18:15:00.000Z', 'Asia/Kathmandu')).toBe('2026-09-01');
  });

  it('the two ends of the 26-hour spread can be two calendar days apart', () => {
    const at = '2026-08-31T11:00:00.000Z';
    expect(dateInTimezone(at, 'Pacific/Kiritimati')).toBe('2026-09-01'); // +14
    expect(dateInTimezone(at, 'Pacific/Niue')).toBe('2026-08-31'); // −11
    // Pacific/Chatham is +12:45 in standard time; 11:00 UTC + 12:45 = 23:45, so still the 31st — and
    // fifteen minutes later it is not. The quarter-hour is the point: an offset table rounded to the hour
    // puts this on the wrong side.
    expect(dateInTimezone(at, 'Pacific/Chatham')).toBe('2026-08-31');
    expect(dateInTimezone('2026-08-31T11:20:00.000Z', 'Pacific/Chatham')).toBe('2026-09-01');
  });

  /**
   * **A day with no local midnight.** America/Santiago has historically shifted at 24:00, so there is no
   * 00:00 on the transition date. Any implementation that constructs a local `Date` at midnight breaks
   * here. Ours parses `T00:00:00.000Z` and formats through `Intl`, so it is immune; this pins that it
   * stays immune.
   */
  it('America/Santiago across its DST shift still names a day', () => {
    for (const iso of ['2026-09-06T03:30:00.000Z', '2026-09-06T04:30:00.000Z', '2026-09-06T05:30:00.000Z']) {
      expect(dateInTimezone(iso, 'America/Santiago')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('an invalid zone falls back to UTC, matching the server middleware — never to the device zone', () => {
    expect(isValidTimezone('Not/AZone')).toBe(false);
    expect(isValidTimezone('')).toBe(false);
    expect(isValidTimezone('Europe/Berlin')).toBe(true);
    expect(dateInTimezone('2026-08-31T23:30:00.000Z', 'Not/AZone')).toBe('2026-08-31');
    expect(dateInTimezone('2026-08-31T23:30:00.000Z', '')).toBe('2026-08-31');
  });
});

describe('DST is irrelevant by construction, and this asserts exactly that', () => {
  it('`addWeeks` and `weeksBetween` over a DST transition answer as over any other week', () => {
    // Europe/Berlin springs forward on Sun 29 Mar 2026 and falls back on Sun 25 Oct 2026. The weeks
    // containing those Sundays begin Mon 23 Mar and Mon 19 Oct.
    for (const monday of ['2026-03-23', '2026-10-19', '2026-08-31']) {
      expect(addWeeks(monday, 1)).toBe(new Date(Date.parse(`${monday}T00:00:00.000Z`) + 7 * 86_400_000).toISOString().slice(0, 10));
      expect(weeksBetween(monday, addWeeks(monday, 5))).toBe(5);
      expect(weeksBetween(addWeeks(monday, -3), monday)).toBe(3);
    }
  });

  it('the Monday of the transition week is the same whichever side of the shift you ask from', () => {
    // 01:30 and 03:30 Berlin on 29 Mar 2026 sit either side of the lost hour (00:30 and 01:30 UTC).
    expect(weekStartOf('2026-03-29T00:30:00.000Z', 'Europe/Berlin')).toBe('2026-03-23');
    expect(weekStartOf('2026-03-29T01:30:00.000Z', 'Europe/Berlin')).toBe('2026-03-23');
    // And the repeated hour on 25 Oct, 00:30 and 01:30 UTC = 02:30 CEST and 02:30 CET.
    expect(weekStartOf('2026-10-25T00:30:00.000Z', 'Europe/Berlin')).toBe('2026-10-19');
    expect(weekStartOf('2026-10-25T01:30:00.000Z', 'Europe/Berlin')).toBe('2026-10-19');
  });

  it('Pacific/Auckland’s transition runs the other way in the calendar year and changes nothing', () => {
    // NZ moves to NZDT on Sun 27 Sep 2026; the week is Mon 21 Sep either side of it.
    expect(weekStartOf('2026-09-26T20:00:00.000Z', 'Pacific/Auckland')).toBe('2026-09-21');
    expect(weekStartOf('2026-09-27T02:00:00.000Z', 'Pacific/Auckland')).toBe('2026-09-21');
  });
});

/**
 * **`label` and `weekRange` need no clock at all**, which is the decomposition that makes the lens header
 * render before the session, the timezone or the network are known. Asserting it directly is what stops a
 * later change quietly making the title depend on `today`.
 */
describe('the title is independent of `today`, and only the badges are not', () => {
  it('`label` and `weekRange` are identical whatever day you ask on', () => {
    const days = ['2015-06-01', '2026-08-31', '2026-09-01', '2040-12-31'];
    for (const row of PERIOD_BOUNDARIES) {
      const views = days.map((d) => periodViewOf(row.horizon, row.periodKey, d));
      for (const v of views) {
        expect(v.label, `${row.name} label`).toBe(row.label);
        expect(v.weekRange, `${row.name} weekRange`).toBe(row.weekRange);
      }
    }
  });
});
