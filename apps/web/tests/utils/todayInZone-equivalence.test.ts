import { describe, expect, it } from 'vitest';
import { dateInTimezone } from '@goal-cascade/shared';

/**
 * ⚠ **A TEMPORARY TEST, deleted in the same commit as the implementation it measures** (`22-instant-periods`
 * §8 step 4, risk 2).
 *
 * The client used to carry its own `dateInTimezone` — `utils/dates.ts:todayInZone`, which formatted with
 * `toLocaleDateString('en-CA', { timeZone })` — while the server formatted with
 * `Intl.DateTimeFormat('en-US', { year, month, day }).formatToParts`. The two agree on every ICU build
 * anyone is likely to meet, **and that is the problem**: they agree by convention, not by construction.
 * `en-CA`'s `YYYY-MM-DD` pattern is a locale-data fact, not a guarantee, and if it ever moved the effect
 * would be an off-by-one day in `isPast`, which strips or restores the create button.
 *
 * So the swap lands behind this: run BOTH implementations over a zone × instant matrix and assert
 * equality, then delete `todayInZone`. The old implementation is inlined here rather than imported,
 * because the point of the test is that it outlives the module by exactly one commit.
 */
const legacyTodayInZone = (at: Date, timezone: string | undefined): string => {
  try {
    return at.toLocaleDateString('en-CA', { timeZone: timezone || undefined });
  } catch {
    return at.toLocaleDateString('en-CA');
  }
};

const ZONES = [
  'UTC',
  'Europe/Berlin',
  'Europe/Amsterdam',
  'America/New_York',
  'America/Santiago',
  'Pacific/Auckland',
  'Asia/Kathmandu',
  'Asia/Tokyo',
  'Pacific/Chatham',
  'Pacific/Kiritimati',
  'Pacific/Niue',
];

/** Midnights, near-midnights and DST transitions in both hemispheres, plus a leap day. */
const INSTANTS = [
  '2026-01-01T00:00:00.000Z',
  '2026-03-29T00:30:00.000Z', // Europe/Berlin spring forward
  '2026-03-29T01:30:00.000Z',
  '2026-04-05T15:00:00.000Z', // Pacific/Auckland autumn back
  '2026-08-31T09:00:00.000Z',
  '2026-08-31T23:30:00.000Z',
  '2026-09-01T00:30:00.000Z',
  '2026-09-06T22:15:00.000Z',
  '2026-10-25T00:30:00.000Z', // Europe/Berlin fall back
  '2026-12-31T23:59:59.000Z',
  '2028-02-29T12:00:00.000Z',
  '2026-09-05T10:45:00.000Z',
];

describe('the client’s `dateInTimezone` is the SERVER’s, and always was (R-lens-30, risk 2)', () => {
  it('agrees with the retired `todayInZone` at every zone × instant', () => {
    for (const tz of ZONES) {
      for (const iso of INSTANTS) {
        expect(dateInTimezone(iso, tz), `${tz} @ ${iso}`).toBe(legacyTodayInZone(new Date(iso), tz));
      }
    }
  });

  /**
   * The ONE place the two deliberately disagree, and the reason the swap is a correction rather than a
   * refactor: `todayInZone`'s catch branch fell back to the **device** zone, which is precisely the
   * traveller disagreement R-auth-5 forbids — an owner whose account is `Europe/Berlin`, in Tokyo, would
   * have got Tokyo's date while the server computed Berlin's. `dateInTimezone` falls back to `'UTC'`,
   * matching `isValidTimezone`'s contract and the server middleware's own fallback.
   */
  it('falls back to UTC, never to the device zone, on an invalid timezone', () => {
    expect(dateInTimezone('2026-08-31T23:30:00.000Z', 'Not/AZone')).toBe('2026-08-31');
    expect(dateInTimezone('2026-08-31T23:30:00.000Z', '')).toBe('2026-08-31');
  });
});
