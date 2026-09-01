import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * ⚠ **ANTI-DRIFT LAYER 1's ENFORCEMENT — nothing outside this package may DECLARE a calendar function.**
 *
 * Layer 1 is "one module", and it prevents drift only for as long as it stays one module. That property
 * is not self-maintaining: `apps/web/src/utils/periodKeys.ts` held line-for-line copies of `stepPeriod`,
 * `firstDayOf` and `periodKeyOf` for as long as it did **because nothing said no** — its own doc block
 * argued at length that it was not a second implementation while being one.
 *
 * So this says no. Every name below may be **imported** anywhere and **declared** only under
 * `packages/shared/src/calendar/`. The same class of guard already exists as
 * `apps/api/tests/route-surface.test.ts`: a census that turns a convention into a checked fact.
 *
 * It lives in `packages/shared` rather than in either app because it is about the relationship between
 * the three of them, and because a guard that lives inside the thing it guards is one delete away from
 * going quiet.
 */

/** The names that decide what a date MEANS. Each was, or could plausibly become, a second copy. */
const OWNED = [
  'weekStartOfDate',
  'weekStartOf',
  'periodKeyOf',
  'periodKeyOfCurrentWeek',
  'labelOf',
  'weekRangeOf',
  'stepPeriod',
  'firstDayOf',
  'lastDayOf',
  'firstWeekOf',
  'lastWeekOf',
  'firstMondayIn',
  'lastMondayIn',
  'zoomTo',
  // ⚠ **A9** — both were reachable as one mis-named function (`weekForMonth`) with a client wrapper of
  // its own in `apps/web/src/utils/periodKeys.ts`, which is precisely the shape this census exists to
  // refuse. They decide which week a month means; there is one declaration of each and it is here.
  'zoomWeekForMonth',
  'taskWeekForMonth',
  'dateInTimezone',
  'isValidTimezone',
  'addWeeks',
  'weeksBetween',
  'isPastPeriod',
  'isCurrentPeriod',
  'periodViewOf',
] as const;

/**
 * `function foo(`, `const foo =`, and a class method with an explicit modifier (`private foo(`).
 *
 * ⚠ **The modifier on the method form is load-bearing.** A bare `^\s*foo\s*\(` also matches a *call* on
 * its own line — `firstMondayIn(monthKey),` inside an array literal — and a census that reports call
 * sites is a census someone will make pass by loosening it. A declaration this cares about is either a
 * `function`, a binding, or a class member, and a class member here always carries a modifier.
 */
const declares = (name: string) =>
  new RegExp(
    `(?:^|\\s)(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\b` +
      `|(?:^|\\s)(?:export\\s+)?(?:const|let|var)\\s+${name}\\s*[=:]` +
      `|^\\s*(?:private|public|protected|static|readonly|async)\\s+${name}\\s*\\(`,
    'm',
  );

const ROOT = join(import.meta.dirname, '..', '..', '..');
const SEARCHED = [join(ROOT, 'apps', 'web', 'src'), join(ROOT, 'apps', 'api', 'src'), join(ROOT, 'packages', 'shared', 'src')];
const ALLOWED = join(ROOT, 'packages', 'shared', 'src', 'calendar');

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules') continue;
      yield* sourceFiles(full);
    } else if (/\.tsx?$/.test(entry)) {
      yield full;
    }
  }
}

describe('R-lens-30 — there is exactly one calendar, and it is in `packages/shared/src/calendar`', () => {
  it('no file outside it DECLARES a function that decides what a date means', () => {
    const offences: string[] = [];
    for (const dir of SEARCHED) {
      for (const file of sourceFiles(dir)) {
        if (file.startsWith(ALLOWED)) continue;
        const source = readFileSync(file, 'utf8');
        for (const name of OWNED) {
          if (declares(name).test(source)) offences.push(`${file.slice(ROOT.length + 1)} declares \`${name}\``);
        }
      }
    }
    expect(offences, 'these may be IMPORTED from @goal-cascade/shared, never re-declared').toEqual([]);
  });

  /**
   * The guard is only worth having if it would actually fire, and a regex census is exactly the kind of
   * test that silently matches nothing after a refactor. So: prove the matcher on the shape of the code
   * this change deleted.
   */
  it('the matcher recognises the very declarations this change removed', () => {
    expect(declares('stepPeriod').test('export function stepPeriod(horizon: Horizon, key: string, n: number): string {')).toBe(true);
    expect(declares('firstDayOf').test('  const firstDayOf = (h, k) => k;')).toBe(true);
    expect(declares('weekStartOfDate').test('function weekStartOfDate(date) {}')).toBe(true);
    expect(declares('periodViewOf').test('  private periodViewOf(horizon, key, today) {')).toBe(true);
    // …and does not fire on an import, a call, or a property read, which is the whole point.
    expect(declares('stepPeriod').test("import { stepPeriod } from '@goal-cascade/shared';")).toBe(false);
    expect(declares('stepPeriod').test('navigate(lensPath(lens, stepPeriod(lens, period, n)));')).toBe(false);
    expect(declares('labelOf').test('const label = labelOf(lens, key);')).toBe(false);
    // A call alone on a line, which is what a naive `^\s*name\s*\(` would have flagged.
    expect(declares('firstMondayIn').test('          firstMondayIn(monthKey),')).toBe(false);
    // A multi-line import list, which is how the same names legitimately appear in every consumer.
    expect(declares('lastMondayIn').test('  lastMondayIn,')).toBe(false);
  });
});
