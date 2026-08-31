import { describe, expect, it } from 'vitest';
import type { Horizon } from '../../src/domain/enums';
import {
  ancestorsIn,
  checkCreate,
  checkMove,
  descendantIdsIn,
  hasChildrenIn,
  indexTree,
  isTerminalHorizon,
  lifeRootIn,
  orderedTree,
  rank,
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
 *   │           └── W  (Weekly)   ⚠ A2 — the new level
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
  n('W', 'M', 'Weekly', '2026-08-10'),
];
const IX = indexTree(TREE);
const at = (id: string) => TREE.find((g) => g.id === id) ?? null;
const subtreeOf = (goals: readonly N[], id: string) => descendantIdsIn(indexTree(goals), id);

describe('R-goal-30 — five horizon ranks', () => {
  it('S-goal-30-1 — Life 0 › Yearly 1 › Quarterly 2 › Monthly 3 › Weekly 4, strictly increasing', () => {
    expect([rank('Life'), rank('Yearly'), rank('Quarterly'), rank('Monthly'), rank('Weekly')]).toEqual([0, 1, 2, 3, 4]);
  });

  it('R-goal-31 — the TERMINAL horizon moved from Monthly to Weekly', () => {
    // The single rank comparison in `checkCreate` enforces both R-goal-5 and R-goal-31 because the
    // terminal horizon has the maximum rank and nothing can be strictly greater than it.
    expect(isTerminalHorizon('Weekly')).toBe(true);
    expect(isTerminalHorizon('Monthly')).toBe(false);
  });

  it('an unknown horizon throws rather than silently mis-ranking', () => {
    // The delta's silent break #4: a build holding four members that meets a persisted 'Weekly' must
    // RAISE, not sort it to -1 — below Life.
    expect(() => rank('Fortnightly' as Horizon)).toThrow(RangeError);
  });
});

describe('R-goal-37 — "leaf" is retired; what survives is the structural fact and the LIFE-ROOT walk', () => {
  /**
   * RETIRED — `isLeaf`, `focusableLeaves`, `isActive`, `isDormant`, `subtreeActive` and
   * `activeLeavesUnder` are all deleted (R-rm-2, R-goal-37). "Leaf" stopped being coextensive with
   * "holds work": **a Monthly goal with no Weekly children is a leaf by the structural definition and is
   * precisely the goal that must never hold a task**, so the word is retired rather than redefined —
   * a redefined `isLeaf` reads correctly to anyone who knew the old meaning and is wrong.
   *
   * `hasChildrenIn` is what is left: the structural fact, named as such, used by the create guard, the
   * move guard and the delete cascade, and keyed to NO permission.
   */
  it('S-goal-37-2 — the retired names do not exist on the module', async () => {
    const tree = (await import('../../src/domain/goal-tree')) as Record<string, unknown>;
    for (const gone of ['isLeaf', 'focusableLeaves', 'isActive', 'isDormant', 'subtreeActive', 'activeLeavesUnder', 'moveTargetReason', 'defaultPeriod', 'replanPeriods']) {
      expect(tree, gone).not.toHaveProperty(gone);
    }
  });

  it('hasChildrenIn answers the structural question, and nothing else', () => {
    expect(hasChildrenIn(IX, 'M')).toBe(true); // it has W
    expect(hasChildrenIn(IX, 'W')).toBe(false); // Weekly is terminal
    expect(hasChildrenIn(IX, 'M2')).toBe(false); // ⚠ a childless Monthly goal — the trap
    expect(hasChildrenIn(IX, 'Q')).toBe(true);
  });

  it('ancestors run root → parent', () => {
    expect(ancestorsIn(IX, 'W').map((g) => g.id)).toEqual(['L', 'Y', 'Q', 'M']);
    expect(ancestorsIn(IX, 'L')).toEqual([]);
  });

  it('R-lens-3 — the Life root is a WALK, at any depth and with levels skipped', () => {
    expect(lifeRootIn(IX, 'W')?.id).toBe('L');
    expect(lifeRootIn(IX, 'M2')?.id).toBe('L2');
    expect(lifeRootIn(IX, 'L')?.id).toBe('L');
    // R-goal-32 — a Weekly goal hung directly off a Life goal is legal, and resolves in one hop.
    const skipped = indexTree([n('L3', null, 'Life'), n('Wx', 'L3', 'Weekly')]);
    expect(lifeRootIn(skipped, 'Wx')?.id).toBe('L3');
  });

  it('R-lens-20 — a broken chain or a cycle resolves to UNSORTED (undefined), never a hang', () => {
    const dangling = indexTree([n('X', 'ghost', 'Monthly')]);
    expect(lifeRootIn(dangling, 'X')).toBeUndefined();
    const cyclic = indexTree([n('A', 'B', 'Yearly'), n('B', 'A', 'Quarterly')]);
    expect(() => lifeRootIn(cyclic, 'A')).not.toThrow();
    expect(lifeRootIn(cyclic, 'A')).toBeUndefined();
  });

  it('descendants are the whole subtree, and a cycle in the data cannot hang the walk', () => {
    expect([...descendantIdsIn(IX, 'L')].sort()).toEqual(['M', 'Q', 'W', 'Y', 'Y2']);
    expect([...descendantIdsIn(IX, 'W')]).toEqual([]); // Weekly is terminal
    const cyclic: N[] = [n('A', 'B', 'Yearly'), n('B', 'A', 'Quarterly')];
    expect(() => subtreeOf(cyclic, 'A')).not.toThrow();
    expect(() => ancestorsIn(indexTree(cyclic), 'A')).not.toThrow();
  });
});

describe('R-goal-5/31/32 — create guard (SPEC D-5: the server, not a disabled button)', () => {
  it('S-goal-3-1 — a Life goal needs no parent, and refuses one', () => {
    expect(checkCreate({ horizon: 'Life', parentId: null }, null)).toBeNull();
    expect(checkCreate({ horizon: 'Life', parentId: 'L' }, at('L'))?.kind).toBe('LIFE_GOAL_HAS_PARENT');
  });

  it('S-goal-4-1 — a non-Life goal with no parent is refused', () => {
    expect(checkCreate({ horizon: 'Yearly', parentId: null }, null)?.kind).toBe('PARENT_REQUIRED');
  });

  it('S-goal-5-1 — a Monthly goal under a Quarterly parent is allowed', () => {
    expect(checkCreate({ horizon: 'Monthly', parentId: 'Q' }, at('Q'))).toBeNull();
  });

  it('S-goal-5-2 — equal rank is refused (Yearly under Yearly)', () => {
    expect(checkCreate({ horizon: 'Yearly', parentId: 'Y' }, at('Y'))?.kind).toBe('HORIZON_CONFLICT');
  });

  it('S-goal-5-3 — inverted rank is refused (Quarterly under Monthly)', () => {
    expect(checkCreate({ horizon: 'Quarterly', parentId: 'M' }, at('M'))?.kind).toBe('HORIZON_CONFLICT');
  });

  /**
   * SUPERSEDED — S-goal-6-1 required "a sub-goal under a Monthly goal is refused, at any horizon". Its
   * SUBJECT INVERTED under R-goal-31: Monthly now accepts children, and Weekly is the horizon that can
   * have none. S-goal-31-2 is the exact request the old scenario required to be refused, and a build
   * that still refuses it has implemented the old rule — so it is asserted here, not merely dropped.
   */
  it('S-goal-31-2 — a Weekly goal under a Monthly goal now SUCCEEDS (the rule that reversed)', () => {
    expect(checkCreate({ horizon: 'Weekly', parentId: 'M' }, at('M'))).toBeNull();
  });

  it('S-goal-31-1 — a Weekly goal can never have sub-goals, whatever horizon is asked for', () => {
    for (const h of ['Yearly', 'Quarterly', 'Monthly', 'Weekly'] as const) {
      expect(checkCreate({ horizon: h, parentId: 'W' }, at('W'))?.kind, h).toBe('HORIZON_CONFLICT');
    }
  });

  it('S-goal-32-1 — levels may be SKIPPED: a Weekly goal hangs off any longer horizon, Life included', () => {
    // R-goal-5 requires strictly DECREASING rank, not adjacency. Inventing an adjacency rule for Weekly
    // alone would make it the only horizon carrying a parent constraint the other four do not.
    for (const parent of ['L', 'Y', 'Q', 'M'] as const) {
      expect(checkCreate({ horizon: 'Weekly', parentId: parent }, at(parent)), parent).toBeNull();
    }
  });

  it('S-goal-32-2 — but the inverted case is still refused (Monthly under Weekly)', () => {
    expect(checkCreate({ horizon: 'Monthly', parentId: 'W' }, at('W'))?.kind).toBe('HORIZON_CONFLICT');
  });

  it('an unknown parent is PARENT_NOT_FOUND (which the API renders as a plain 404 — R-auth-3)', () => {
    expect(checkCreate({ horizon: 'Monthly', parentId: 'nope' }, null)?.kind).toBe('PARENT_NOT_FOUND');
  });
});

describe('R-goal-17/18/21/40 — move guard', () => {
  const move = (goalId: string, targetId: string) =>
    checkMove(at(goalId), at(targetId), subtreeOf(TREE, goalId), goalId, targetId);

  it('S-goal-17-1 — a Quarterly goal moves under another Yearly goal, keeping its horizon', () => {
    expect(move('Q', 'Y2')).toBeNull();
  });

  it('S-goal-18-1 — moving a goal under itself or a descendant would create a cycle', () => {
    expect(move('Y', 'Y')?.kind).toBe('WOULD_CREATE_CYCLE');
    expect(move('Y', 'Q')?.kind).toBe('WOULD_CREATE_CYCLE');
    expect(move('Y', 'M')?.kind).toBe('WOULD_CREATE_CYCLE');
    expect(move('Y', 'W')?.kind).toBe('WOULD_CREATE_CYCLE');
  });

  it('S-goal-18-2 — an unrelated shorter horizon is a horizon conflict, not a cycle', () => {
    expect(move('Q', 'M2')?.kind).toBe('HORIZON_CONFLICT');
    expect(move('Q', 'Q2')?.kind).toBe('HORIZON_CONFLICT');
  });

  it('S-goal-21-1 — a Life goal cannot be moved', () => {
    expect(move('L', 'L2')?.kind).toBe('LIFE_GOAL_IMMUTABLE');
  });

  it('S-goal-40-3 — a WEEKLY goal CAN be moved, and its subtree is empty, so the cycle check is free', () => {
    // R-goal-40 / SPEC Q-24 — forbidding Move would make Weekly the only horizon in the product that
    // cannot be corrected after the fact, and R-task-49's inference makes a wrong parent MORE likely.
    expect(subtreeOf(TREE, 'W').size).toBe(0);
    expect(move('W', 'M2')).toBeNull();
    expect(move('W', 'L2')).toBeNull(); // levels may be skipped on a move too
  });

  it('S-goal-19-1 / D-7 — the descendant check runs FIRST, so it is the reason when both apply', () => {
    // M is BOTH a descendant of Q and of a shorter horizon: the descendant reason must be the one shown.
    expect(move('Q', 'M')?.kind).toBe('WOULD_CREATE_CYCLE');
    expect(move('Q', 'Q')?.kind).toBe('WOULD_CREATE_CYCLE');
    expect(move('Q', 'M2')?.kind).toBe('HORIZON_CONFLICT');
    expect(move('Q', 'Y2')).toBeNull();
  });
});

describe('Q-7 — ordering is total and stable', () => {
  it('parents come before children; siblings sort by createdAt then id', () => {
    const shuffled = [...TREE].reverse();
    const order = orderedTree(shuffled).map((g) => g.id);
    expect(order).toEqual(['L', 'Y', 'Q', 'M', 'W', 'Y2', 'L2', 'Y3', 'Q2', 'M2']);
    for (const g of TREE) {
      if (g.parentId) expect(order.indexOf(g.parentId), g.id).toBeLessThan(order.indexOf(g.id));
    }
  });

  it('a same-timestamp tie breaks on id, deterministically', () => {
    const tied: N[] = [n('b', null, 'Life', '2026-08-01'), n('a', null, 'Life', '2026-08-01')];
    expect(orderedTree(tied).map((g) => g.id)).toEqual(['a', 'b']);
  });

  it('an orphan is appended rather than dropped — a data problem must be visible, not silent', () => {
    const orphaned: N[] = [...TREE, n('X', 'ghost', 'Monthly', '2026-08-11')];
    expect(orderedTree(orphaned).map((g) => g.id)).toContain('X');
  });
});

describe('R-lens-27 — the per-request index is what makes every primitive O(1) per hop', () => {
  it('one index serves every walk, and building it is one pass', () => {
    const ix = indexTree(TREE);
    expect(ix.byId.size).toBe(TREE.length);
    expect(ix.childrenOf.get('L')?.map((g) => g.id).sort()).toEqual(['Y', 'Y2']);
    expect(ix.childrenOf.get(null)?.map((g) => g.id).sort()).toEqual(['L', 'L2']);
  });

  it('the array-shaped wrappers still exist for ONE-OFF calls, and agree with the indexed ones', async () => {
    // They build an index and delegate. Using one in a loop over the same list rebuilds the index every
    // iteration — which is exactly the Θ(n²·d) defect this module was rewritten to remove.
    const { ancestors, descendantIds } = await import('../../src/domain/goal-tree');
    expect(ancestors(TREE, 'W').map((g) => g.id)).toEqual(ancestorsIn(IX, 'W').map((g) => g.id));
    expect([...descendantIds(TREE, 'L')].sort()).toEqual([...descendantIdsIn(IX, 'L')].sort());
  });
});
