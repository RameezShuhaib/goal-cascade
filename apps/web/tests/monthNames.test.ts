import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { labelOf, weekRangeOf } from '@goal-cascade/shared';
import { instantLabel, shortDate, weekLabel } from '../src/utils/dates';

/**
 * ⚠ **A10 — one month vocabulary, client and server.**
 *
 * Found in a browser, not by this suite. `utils/dates.ts` formatted with
 * `toLocaleDateString('en-GB', { month: 'short' })`, and modern ICU renders September as **`Sept`** under
 * `en-GB`, while `@goal-cascade/shared`'s `MONTHS` says `Sep`. So the Monthly lens header read
 * `Mon 7 Sep – Sun 4 Oct` and the task sheet one tap away read `Lands in the week of 7 Sept` — one month,
 * two spellings, on one screen, and which you got depended on the viewer's browser and ICU version.
 *
 * The census in `periodKeys.test.ts` could not catch it: that guards calendar *arithmetic*, and this was
 * *formatting*. This file is its counterpart for names.
 */
describe('A10: the client and the server spell every month the same way', () => {
  it('agrees with the server label for all twelve months', () => {
    for (let m = 1; m <= 12; m++) {
      const key = `2026-${String(m).padStart(2, '0')}`;
      const server = labelOf('Monthly', key); // e.g. `Sep 2026`
      const name = server.split(' ')[0]!;
      // The client's own short date for the 7th of that month must carry the identical month name.
      expect(shortDate(`${key}-07`), key).toBe(`7 ${name}`);
      expect(weekLabel(`${key}-07`).endsWith(` 7 ${name}`), key).toBe(true);
    }
  });

  it('says Sep, never Sept — the exact string the owner saw', () => {
    expect(shortDate('2026-09-07')).toBe('7 Sep');
    expect(weekRangeOf('Monthly', '2026-09')).toBe('Mon 7 Sep – Sun 4 Oct');
    expect(instantLabel('2026-09-07T09:00:00.000Z')).toBe('Mon 7 Sep');
  });

  it('no en-GB Intl month formatting survives in the date helpers', () => {
    const src = readFileSync(join(__dirname, '../src/utils/dates.ts'), 'utf8');
    expect(src).not.toMatch(/toLocaleDateString\(\s*'en-GB'/);
    expect(src).not.toMatch(/month:\s*'(short|long)'/);
  });
});
