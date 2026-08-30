import { describe, expect, it } from 'vitest';
import type { Horizon } from '../../src/domain/enums';
import {
  activeLeavesUnder,
  ancestors,
  checkCreate,
  checkMove,
  defaultPeriod,
  descendantIds,
  focusableLeaves,
  isActive,
  isDormant,
  isLeaf,
  moveTargetReason,
  orderedTree,
  rank,
  replanPeriods,
  rootOf,
  subtreeActive,
} from '../../src/domain/goal-tree';

type N = { id: string; parentId: string | null; horizon: Horizon; createdAt: string };
const n = (id: string, parentId: string | null, horizon: Horizon, createdAt = `2026-08-0${id.length}`): N => ({
  id,
  parentId,
  horizon,
  createdAt,
});

/**
 *   L (Life)
 *   ├── Y  (Yearly)
 *   │   └── Q  (Quarterly)
 *   │       └── M  (Monthly)
 *   └── Y2 (Yearly)
 *   L2 (Life) — a separate line
 *   └── M2 under Q2 under Y3
 */
const TREE: N[] = [
  n('L', null, 'Life', '2026-08-01'),
  n('Y', 'L', 'Yearly', '2026-08-02'),
  n('Q', 'Y', 'Quarterly', '2026-08-03'),
  n('M', 'Q', 'Monthly', '2026-08-04'),
  n('Y2', 'L', 'Yearly', '2026-08-05'),
  n('L2', null, 'Life', '2026-08-06'),
  n('Y3', 'L2', 'Yearly', '2026-08-07'),
  n('Q2', 'Y3', 'Quarterly', '2026-08-08'),
  n('M2', 'Q2', 'Monthly', '2026-08-09'),
];

describe('R-goal-2 — horizon ranks', () => {
  it('are Life 0 › Yearly 1 › Quarterly 2 › Monthly 3, strictly increasing', () => {
    expect([rank('Life'), rank('Yearly'), rank('Quarterly'), rank('Monthly')]).toEqual([0, 1, 2, 3]);
  });
});

describe('R-goal-8/11 — leaves, ancestors, descendants', () => {
  it('a leaf has no children', () => {
    expect(isLeaf(TREE, 'M')).toBe(true);
    expect(isLeaf(TREE, 'Y2')).toBe(true);
    expect(isLeaf(TREE, 'Q')).toBe(false);
    expect(isLeaf(TREE, 'L')).toBe(false);
  });

  it('ancestors run root → parent', () => {
    expect(ancestors(TREE, 'M').map((g) => g.id)).toEqual(['L', 'Y', 'Q']);
    expect(ancestors(TREE, 'L')).toEqual([]);
    expect(rootOf(TREE, 'M')?.id).toBe('L');
    expect(rootOf(TREE, 'L')?.id).toBe('L');
  });

  it('descendants are the whole subtree, and a cycle in the data cannot hang the walk', () => {
    expect([...descendantIds(TREE, 'L')].sort()).toEqual(['M', 'Q', 'Y', 'Y2']);
    expect([...descendantIds(TREE, 'M')]).toEqual([]);
    const cyclic: N[] = [n('A', 'B', 'Yearly'), n('B', 'A', 'Quarterly')];
    expect(() => descendantIds(cyclic, 'A')).not.toThrow();
    expect(() => ancestors(cyclic, 'A')).not.toThrow();
  });

  it('R-goal-9 — only NON-Life leaves can hold a focus', () => {
    expect(focusableLeaves(TREE).map((g) => g.id).sort()).toEqual(['M', 'M2', 'Y2']);
    // a childless Life goal is a leaf, but never focusable
    expect(focusableLeaves([n('Solo', null, 'Life')])).toEqual([]);
  });
});

describe('R-goal-9/10/11 — active, dormant, and dormancy propagating up', () => {
  const focused = new Set(['M']);

  it('active = non-Life leaf with a focus row for the week', () => {
    expect(isActive(TREE, 'M', focused)).toBe(true);
    expect(isActive(TREE, 'Y2', focused)).toBe(false);
    // a non-leaf can never be active, even with a stale focus row (S-goal-9-1)
    expect(isActive(TREE, 'Q', new Set(['Q']))).toBe(false);
    // a Life goal can never be active
    expect(isActive(TREE, 'L', new Set(['L']))).toBe(false);
  });

  it('dormant = non-Life leaf with NO focus this week', () => {
    expect(isDormant(TREE, 'Y2', focused)).toBe(true);
    expect(isDormant(TREE, 'M', focused)).toBe(false);
    expect(isDormant(TREE, 'L', focused)).toBe(false);
  });

  it('S-goal-11-1 — one active leaf lights the whole ancestor chain; clearing it mutes all four', () => {
    for (const id of ['L', 'Y', 'Q', 'M']) expect(subtreeActive(TREE, id, focused), id).toBe(true);
    for (const id of ['L', 'Y', 'Q', 'M']) expect(subtreeActive(TREE, id, new Set()), id).toBe(false);
  });

  it('S-goal-11-2 — a sibling branch with no active leaf stays muted', () => {
    expect(subtreeActive(TREE, 'L2', focused)).toBe(false);
    expect(subtreeActive(TREE, 'Q2', focused)).toBe(false);
  });
});

describe('R-backlog-7 / D-18 — active leaves under a goal', () => {
  it('returns ALL candidates, never just the first: two active leaves must make the user choose', () => {
    const wide: N[] = [
      n('L', null, 'Life'),
      n('Y', 'L', 'Yearly'),
      n('Q', 'Y', 'Quarterly'),
      n('Ma', 'Q', 'Monthly'),
      n('Mb', 'Q', 'Monthly'),
    ];
    const focused = new Set(['Ma', 'Mb']);
    expect(activeLeavesUnder(wide, 'Q', focused).map((g) => g.id).sort()).toEqual(['Ma', 'Mb']);
    expect(activeLeavesUnder(wide, 'Q', new Set(['Mb'])).map((g) => g.id)).toEqual(['Mb']);
    expect(activeLeavesUnder(wide, 'Q', new Set())).toEqual([]);
  });
});

describe('R-goal-5/6 — create guard (SPEC D-5: the server, not a disabled button)', () => {
  it('S-goal-3-1 — a Life goal needs no parent, and refuses one', () => {
    expect(checkCreate(TREE, { horizon: 'Life', parentId: null })).toBeNull();
    expect(checkCreate(TREE, { horizon: 'Life', parentId: 'L' })?.kind).toBe('LIFE_GOAL_HAS_PARENT');
  });

  it('S-goal-4-1 — a non-Life goal with no parent is refused', () => {
    expect(checkCreate(TREE, { horizon: 'Yearly', parentId: null })?.kind).toBe('PARENT_REQUIRED');
  });

  it('S-goal-5-1 — a Monthly goal under a Quarterly parent is allowed', () => {
    expect(checkCreate(TREE, { horizon: 'Monthly', parentId: 'Q' })).toBeNull();
  });

  it('S-goal-5-2 — equal rank is refused (Yearly under Yearly)', () => {
    expect(checkCreate(TREE, { horizon: 'Yearly', parentId: 'Y' })?.kind).toBe('HORIZON_CONFLICT');
  });

  it('S-goal-5-3 — inverted rank is refused (Quarterly under Monthly)', () => {
    expect(checkCreate(TREE, { horizon: 'Quarterly', parentId: 'M' })?.kind).toBe('HORIZON_CONFLICT');
  });

  it('S-goal-6-1 / D-6 — a Monthly goal can never have sub-goals, whatever horizon is asked for', () => {
    for (const h of ['Yearly', 'Quarterly', 'Monthly'] as const) {
      expect(checkCreate(TREE, { horizon: h, parentId: 'M' })?.kind, h).toBe('HORIZON_CONFLICT');
    }
  });

  it('an unknown parent is PARENT_NOT_FOUND (which the API renders as a plain 404 — R-auth-3)', () => {
    expect(checkCreate(TREE, { horizon: 'Monthly', parentId: 'nope' })?.kind).toBe('PARENT_NOT_FOUND');
  });
});

describe('R-goal-17/18/19/21 — move guard', () => {
  it('S-goal-17-1 — a Quarterly goal moves under another Yearly goal, keeping its horizon', () => {
    expect(checkMove(TREE, 'Q', 'Y2')).toBeNull();
  });

  it('S-goal-18-1 — moving a goal under itself or a descendant would create a cycle', () => {
    expect(checkMove(TREE, 'Y', 'Y')?.kind).toBe('WOULD_CREATE_CYCLE');
    expect(checkMove(TREE, 'Y', 'Q')?.kind).toBe('WOULD_CREATE_CYCLE');
    expect(checkMove(TREE, 'Y', 'M')?.kind).toBe('WOULD_CREATE_CYCLE');
  });

  it('S-goal-18-2 — an unrelated shorter horizon is a horizon conflict, not a cycle', () => {
    expect(checkMove(TREE, 'Q', 'M2')?.kind).toBe('HORIZON_CONFLICT');
    expect(checkMove(TREE, 'Q', 'Q2')?.kind).toBe('HORIZON_CONFLICT');
  });

  it('S-goal-21-1 — a Life goal cannot be moved', () => {
    expect(checkMove(TREE, 'L', 'L2')?.kind).toBe('LIFE_GOAL_IMMUTABLE');
  });

  it('S-goal-19-1 / D-7 — exactly two reasons, and "its own descendant" wins over "horizon conflict"', () => {
    // M is BOTH a descendant of Q and of a shorter horizon: the descendant reason must be the one shown.
    expect(moveTargetReason(TREE, 'Q', 'M')).toBe('its own descendant');
    expect(moveTargetReason(TREE, 'Q', 'Q')).toBe('its own descendant');
    expect(moveTargetReason(TREE, 'Q', 'M2')).toBe('horizon conflict');
    expect(moveTargetReason(TREE, 'Q', 'Y2')).toBeNull();
  });
});

describe('Q-7 — ordering is total and stable', () => {
  it('parents come before children; siblings sort by createdAt then id', () => {
    const shuffled = [...TREE].reverse();
    const order = orderedTree(shuffled).map((g) => g.id);
    expect(order).toEqual(['L', 'Y', 'Q', 'M', 'Y2', 'L2', 'Y3', 'Q2', 'M2']);
    for (const g of TREE) {
      if (g.parentId) expect(order.indexOf(g.parentId), g.id).toBeLessThan(order.indexOf(g.id));
    }
  });

  it('a same-timestamp tie breaks on id, deterministically', () => {
    const tied: N[] = [n('b', null, 'Life', '2026-08-01'), n('a', null, 'Life', '2026-08-01')];
    expect(orderedTree(tied).map((g) => g.id)).toEqual(['a', 'b']);
  });

  it('an orphan is appended rather than dropped — a data problem must be visible, not silent', () => {
    const orphaned: N[] = [...TREE, n('X', 'ghost', 'Monthly', '2026-08-10')];
    expect(orderedTree(orphaned).map((g) => g.id)).toContain('X');
  });
});

describe('R-goal-13/23 / D-3 — periods are derived from TODAY, never hardcoded', () => {
  it('S-goal-13-1 — the default period is the period CONTAINING today', () => {
    expect(defaultPeriod('Life', '2026-08-31')).toBe('');
    expect(defaultPeriod('Yearly', '2026-08-31')).toBe('2026');
    expect(defaultPeriod('Quarterly', '2026-08-31')).toBe('Q3 2026');
    expect(defaultPeriod('Monthly', '2026-08-31')).toBe('Aug 2026');
    // and it moves with the clock — the mockup's frozen 2026 literals could not
    expect(defaultPeriod('Quarterly', '2027-01-04')).toBe('Q1 2027');
    expect(defaultPeriod('Monthly', '2027-01-04')).toBe('Jan 2027');
  });

  it('S-goal-23-1 — re-plan offers the next periods, derived from today, and rolls the year over', () => {
    expect(replanPeriods('Monthly', '2026-09-15')).toEqual(['Oct 2026', 'Nov 2026']);
    expect(replanPeriods('Monthly', '2026-12-15')).toEqual(['Jan 2027', 'Feb 2027']);
    expect(replanPeriods('Quarterly', '2026-09-15')).toEqual(['Q4 2026', 'Q1 2027']);
    expect(replanPeriods('Yearly', '2026-09-15')).toEqual(['2027']);
    expect(replanPeriods('Life', '2026-09-15')).toEqual([]);
  });

  it('D-3 — options are strictly AFTER the goal’s current period, so re-plan cannot be a no-op', () => {
    // a Quarterly goal already targeting Q4 2026, in September 2026: Q4 must NOT be offered
    expect(replanPeriods('Quarterly', '2026-09-15', 'Q4 2026')).toEqual(['Q1 2027', 'Q2 2027']);
    expect(replanPeriods('Monthly', '2026-09-15', 'Dec 2026')).toEqual(['Jan 2027', 'Feb 2027']);
    // an unparseable current period falls back to today's, keeping the sheet useful
    expect(replanPeriods('Monthly', '2026-09-15', 'sometime')).toEqual(['Oct 2026', 'Nov 2026']);
  });
});
