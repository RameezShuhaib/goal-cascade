import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { foldForSearch, isAmbiguous, rankGoals, type GoalView } from '../src/index';

/**
 * R-nav-31 — **one ranker**, and the census that keeps it one.
 *
 * The ladder itself is `find_goal`'s, unchanged: `apps/api/tests/mcp/tools.test.ts` still exercises it
 * through the tool. What is new here is that the web app calls the same function, so the ordering has to
 * be pinned somewhere both sides can see it, and nothing may declare a second copy.
 */

const goal = (over: Partial<GoalView> = {}): GoalView => ({
  id: '01J00000000000000000000001',
  parentId: null,
  horizon: 'Life',
  title: 'Be strong at 60',
  why: '',
  pulse: 'On track',
  periodKey: '',
  period: '',
  lifeRootId: null,
  backlogCount: 0,
  carrying: null,
  plannedAgeWeeks: null,
  weeklyBreakdown: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  version: 1,
  ...over,
});

describe('rankGoals — the ladder', () => {
  const exact = goal({ id: 'a', title: 'Squats' });
  const prefix = goal({ id: 'b', title: 'Squats and deadlifts' });
  const substring = goal({ id: 'c', title: 'More squats this month' });
  const why = goal({ id: 'd', title: 'Lift', why: 'because squats are the whole point' });
  const nothing = goal({ id: 'e', title: 'Read more' });
  const all = [nothing, why, substring, prefix, exact];

  it('exact title, then prefix, then substring, then `why` — and no match is not a result', () => {
    const ranked = rankGoals(all, 'squats');
    expect(ranked.map((m) => m.goal.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(ranked.map((m) => m.score)).toEqual([1, 0.9, 0.75, 0.35]);
    expect(ranked.map((m) => m.matchedOn)).toEqual(['title', 'title-prefix', 'title', 'why']);
  });

  it('an empty query matches nothing at all — a picker with no text typed is not a search', () => {
    expect(rankGoals(all, '')).toEqual([]);
    expect(rankGoals(all, '   ')).toEqual([]);
  });

  it('case and diacritics fold, so “Séjour” and “sejour” are the same goal to the matcher', () => {
    expect(foldForSearch('Séjour')).toBe('sejour');
    expect(rankGoals([goal({ id: 'f', title: 'Séjour à Paris' })], 'sejour').map((m) => m.score)).toEqual([0.9]);
  });

  it('ties break toward the SHORTER horizon, then oldest first', () => {
    const life = goal({ id: 'L', horizon: 'Life', title: 'Run', periodKey: '', createdAt: '2026-01-01T00:00:00.000Z' });
    const monthly = goal({ id: 'M', horizon: 'Monthly', title: 'Run', createdAt: '2026-05-01T00:00:00.000Z' });
    const olderMonthly = goal({ id: 'M0', horizon: 'Monthly', title: 'Run', createdAt: '2026-02-01T00:00:00.000Z' });
    expect(rankGoals([life, monthly, olderMonthly], 'run').map((m) => m.goal.id)).toEqual(['M0', 'M', 'L']);
  });

  /**
   * The rung the picker adds. It must sit between a title substring and a `why` substring, and it must be
   * **invisible to a caller that passes no `lineTitleOf`** — which is every MCP call.
   */
  it('a Life-line match ranks below a title substring and above a `why` — and only when asked for', () => {
    const inLine = goal({ id: 'x', title: 'Publish four case studies', lifeRootId: 'life' });
    const byWhy = goal({ id: 'y', title: 'Something else', why: 'to stay fit' });
    const lineTitleOf = (g: GoalView) => (g.id === 'x' ? 'Be genuinely fit at 50' : undefined);

    const withLines = rankGoals([inLine, byWhy], 'fit', { lineTitleOf });
    expect(withLines.map((m) => [m.goal.id, m.score, m.matchedOn])).toEqual([
      ['x', 0.5, 'line'],
      ['y', 0.35, 'why'],
    ]);

    // Without the option — the MCP surface's exact call — the line is not searched at all.
    expect(rankGoals([inLine, byWhy], 'fit').map((m) => m.goal.id)).toEqual(['y']);
  });

  it('isAmbiguous is "two candidates within 0.15", which is a question rather than a ranking', () => {
    expect(isAmbiguous(rankGoals([exact, prefix], 'squats'))).toBe(true);
    expect(isAmbiguous(rankGoals([exact, why], 'squats'))).toBe(false);
    expect(isAmbiguous(rankGoals([exact], 'squats'))).toBe(false);
  });
});

/**
 * ⚠ **The same enforcement `no-second-calendar.test.ts` applies to the calendar.** `rankGoals` used to
 * live in `apps/api/src/api/mcp/shapes.ts`, and the reason the web app had no search was partly that
 * reaching it meant importing from the API. Now that it is shared, nothing may declare it again — a
 * hand-rolled `filter(g => g.title.includes(q))` in a picker is exactly how the assistant's order and the
 * owner's order would come apart, silently, one screen at a time.
 */
const OWNED = ['rankGoals', 'isAmbiguous', 'foldForSearch'] as const;

const declares = (name: string) =>
  new RegExp(
    `(?:^|\\s)(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\b` +
      `|(?:^|\\s)(?:export\\s+)?(?:const|let|var)\\s+${name}\\s*[=:]` +
      `|^\\s*(?:private|public|protected|static|readonly|async)\\s+${name}\\s*\\(`,
    'm',
  );

const ROOT = join(import.meta.dirname, '..', '..', '..');
const SEARCHED = [join(ROOT, 'apps', 'web', 'src'), join(ROOT, 'apps', 'api', 'src'), join(ROOT, 'packages', 'shared', 'src')];
const ALLOWED = join(ROOT, 'packages', 'shared', 'src', 'search');

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

describe('R-nav-31 — there is exactly one goal ranker, and it is in `packages/shared/src/search`', () => {
  it('no file outside it DECLARES one', () => {
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

  it('the matcher recognises the declaration this change moved, and not its call sites', () => {
    expect(declares('rankGoals').test('export function rankGoals(goals: readonly GoalView[], query: string): GoalMatch[] {')).toBe(true);
    expect(declares('isAmbiguous').test('  const isAmbiguous = (m) => false;')).toBe(true);
    expect(declares('rankGoals').test("import { rankGoals } from '@goal-cascade/shared';")).toBe(false);
    expect(declares('rankGoals').test('        const matches = rankGoals(eligible, query);')).toBe(false);
    expect(declares('isAmbiguous').test('  isAmbiguous,')).toBe(false);
  });
});
