import type { Horizon } from './enums';

/**
 * The goal tree, as SERVER-SIDE rules.
 *
 * These are ports of `apps/web/src/utils/tree.ts`, but they are not a mirror of it — they are the
 * authority. SPEC D-5: in the mockup every constraint in §2 was enforced only by disabling a button, and
 * the store could be driven into an illegal tree (a cycle, Monthly-under-Monthly) from the console. A
 * disabled button is a hint, not an invariant; these functions are the invariant, and the goal create /
 * move routes call them before anything is written.
 *
 * ── ⚠ **A2 — the header's old premise was FALSE, and this is what replaced it** ────────────────────
 *
 * This file used to say: *"Every function takes the owner's FULL goal list — at most 500 nodes, at most
 * 4 levels deep (Q-12, R-goal-7) — so nothing here needs a query."* Every clause of that is wrong.
 *
 *  - **The cap never existed.** `MAX_GOALS` and `MAX_CHILDREN` were prose in five files and code in
 *    none; depth was the only real bound. "Raising the cap" was therefore a no-op (Q-12, amended).
 *  - **The cost was worse than quadratic.** `GoalService.toView` ran `isLeaf` + `descendantIds` + a
 *    per-descendant `isLeaf` for EVERY goal, so `GET /goals` was Θ(n²·d). Measured: 1.4 M element visits
 *    at 395 goals — one year of ordinary use — and 845 M / 2.9 s of CPU at 9,755.
 *  - **A latent defect, not a new one.** The redesign merely exposes it: with a Weekly horizon an account
 *    accumulates hundreds of goals a year, so the product would get slower every week with no signal.
 *
 * **Two things replaced it, and both are load-bearing.**
 *
 *  1. **No caller loads every goal** (R-lens-27). `IGoalRepo.listAll` is DELETED. A lens read is one
 *     indexed seek; a create guard reads ONE ROW; a move or delete guard reads ONE SUBTREE (a recursive
 *     CTE, and zero rows when the moved goal is Weekly, which is terminal).
 *  2. **What legitimately needs a tree reads the INTERIOR tree** — every goal whose horizon is not
 *     `Weekly` — once per request, through `indexTree` below. The interior set grows with the PLAN, not
 *     with use (~85 rows a year for a five-line account), so it is bounded where the Weekly rows are not.
 *     Escalate to a denormalised `life_root_id` column only if it exceeds ~2,000 rows.
 *
 * **Every primitive here takes a `TreeIndex`, not an array.** That is the whole fix: the array versions
 * were `.find` / `.filter` / `.some` scans, so calling one inside a `map` over the same list was
 * quadratic by construction. Build the index ONCE per request and hoist it out of every loop. The
 * array-shaped wrappers at the bottom exist for one-off calls; using one in a loop reintroduces exactly
 * the defect this file was rewritten to remove.
 *
 * Pure: no I/O, no clock, no runtime imports (the one `import type` is erased at compile time).
 */

/**
 * ⚠ **A2 (R-goal-30)** — five horizons, longest first; the index is the rank.
 *
 * This is the THIRD copy of the list (`shared/common.ts` and `domain/enums.ts` are the others) plus the
 * Drizzle column's `enum`. `rank()` throws on an unknown horizon, so a build holding four members that
 * meets a persisted `'Weekly'` raises `RangeError` rather than silently mis-ranking it — which is why
 * all four must ship in one change.
 */
export const HORIZONS: readonly Horizon[] = ['Life', 'Yearly', 'Quarterly', 'Monthly', 'Weekly'];

/** Minimal shape these rules need. Any record with these three fields works, including a view model. */
export type TreeNode = { id: string; parentId: string | null; horizon: Horizon };

/** Rank of a horizon: Life 0 › Yearly 1 › Quarterly 2 › Monthly 3 › Weekly 4. Higher rank = SHORTER. */
export function rank(h: Horizon): number {
  const i = HORIZONS.indexOf(h);
  if (i < 0) throw new RangeError(`unknown horizon: ${String(h)}`);
  return i;
}

/**
 * ⚠ **A2 (R-goal-31)** — the shortest horizon. A **WEEKLY** goal can never have sub-goals.
 *
 * The rule kept its shape with one word replaced: it used to say this of Monthly, and a Monthly goal now
 * accepts children (and by R-goal-5 the only horizon it can accept is Weekly). The single rank
 * comparison in `checkCreate` continues to enforce both R-goal-5 and this, because the terminal horizon
 * has the maximum rank and nothing can be strictly greater than it.
 */
export function isTerminalHorizon(h: Horizon): boolean {
  return rank(h) === HORIZONS.length - 1;
}

/** R-goal-3 — a Life goal is the only horizon that may sit at the root, and it has no target period. */
export function isLifeHorizon(h: Horizon): boolean {
  return rank(h) === 0;
}

/**
 * R-lens-27 — **the per-request index.** Two maps built in one pass, so every primitive below is O(1)
 * per hop instead of a scan over the whole list.
 *
 * Measured against the array-scanning primitives it replaces, on the same synthetic account:
 *
 * | n | before | after | factor |
 * |---|---|---|---|
 * | 395 | 1.4 M visits | 3,290 | 417× |
 * | 1,565 | 21.7 M | 13,130 | 1,653× |
 * | 9,755 | 845 M | 82,010 | **10,300×** |
 *
 * Build it once and pass it down. It is not the answer on its own — scoped reads are (R-lens-16) — but
 * it is the answer's floor, and it makes every remaining legitimate whole-tree walk (the guards, the
 * delete cascade, the MCP outline) linear instead of quadratic.
 */
export type TreeIndex<T extends TreeNode> = {
  byId: Map<string, T>;
  childrenOf: Map<string | null, T[]>;
  all: readonly T[];
};

export function indexTree<T extends TreeNode>(goals: readonly T[]): TreeIndex<T> {
  const byId = new Map<string, T>();
  const childrenOf = new Map<string | null, T[]>();
  for (const g of goals) {
    byId.set(g.id, g);
    const siblings = childrenOf.get(g.parentId);
    if (siblings) siblings.push(g);
    else childrenOf.set(g.parentId, [g]);
  }
  return { byId, childrenOf, all: goals };
}

export function nodeIn<T extends TreeNode>(ix: TreeIndex<T>, id: string | null): T | undefined {
  return id === null ? undefined : ix.byId.get(id);
}

export function childrenIn<T extends TreeNode>(ix: TreeIndex<T>, id: string | null): T[] {
  return ix.childrenOf.get(id) ?? [];
}

/**
 * ⚠ **A2 (R-goal-37) — "leaf" is RETIRED as a product word, and this is its structural half.**
 *
 * The term is retired rather than redefined, because before A2 "leaf", "non-Life leaf", "holds a focus"
 * and "holds tasks" all named ONE set of goals, and after A2 they do not: **a Monthly goal with no
 * Weekly children is a leaf by the structural definition while being precisely the goal that must never
 * hold a task.**
 *
 * So this function answers only the structural fact — "does it have children" — and is used by exactly
 * the three callers that mean it: the create guard, the move guard and the delete cascade. **No rule may
 * key a permission on it.** The thing that holds work is named directly: `horizon === 'Weekly'`
 * (R-goal-39). A redefined `isLeaf` would read correctly to anyone who knew the old meaning and be
 * wrong, and nothing in the type system or in a test would catch a handler that admitted a childless
 * Monthly goal as a task parent.
 */
export function hasChildrenIn<T extends TreeNode>(ix: TreeIndex<T>, id: string): boolean {
  return (ix.childrenOf.get(id)?.length ?? 0) > 0;
}

/** Root → parent, in that order. Empty for a Life goal. Cycle-safe: it can never loop forever. */
export function ancestorsIn<T extends TreeNode>(ix: TreeIndex<T>, id: string): T[] {
  const out: T[] = [];
  const seen = new Set<string>([id]);
  let current = nodeIn(ix, id)?.parentId ?? null;
  while (current && !seen.has(current)) {
    seen.add(current);
    const parent = nodeIn(ix, current);
    if (!parent) break;
    out.unshift(parent);
    current = parent.parentId;
  }
  return out;
}

/**
 * R-lens-3 / R-lens-20 — **the Life-goal group an item belongs to**, resolved by walking `parentId` to
 * the root at any depth, with no assumption that the chain is four long or that the levels are adjacent
 * (R-goal-32 permits a Weekly goal hung directly off a Life goal).
 *
 * Returns `undefined` when the chain does not reach a Life goal — a dangling `parentId`, or a cycle,
 * which the `seen` set turns into a stop rather than a hang. Those items group under **`UNSORTED`**,
 * pinned last. They are never DROPPED: that state is not reachable through the product (`checkCreate`
 * refuses a parentless non-Life goal), so it is a data-integrity fact, and a data problem must surface in
 * the UI rather than silently delete a row from a view.
 *
 * The resolution is a WALK and not a stored column, deliberately (R-lens-3): a denormalised
 * `life_root_id` would need a subtree rewrite on every Move, and it is held in reserve behind a clear
 * trigger (the interior set exceeding ~2,000 rows) rather than adopted on a guess.
 */
export function lifeRootIn<T extends TreeNode>(ix: TreeIndex<T>, id: string): T | undefined {
  const self = nodeIn(ix, id);
  if (!self) return undefined;
  if (self.parentId === null) return isLifeHorizon(self.horizon) ? self : undefined;
  const chain = ancestorsIn(ix, id);
  const root = chain[0];
  return root && root.parentId === null && isLifeHorizon(root.horizon) ? root : undefined;
}

/** Every id strictly below `id`. Cycle-safe. O(subtree), not O(n) — it walks `childrenOf`, never scans. */
export function descendantIdsIn<T extends TreeNode>(ix: TreeIndex<T>, id: string): Set<string> {
  const out = new Set<string>();
  const stack = [id];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const child of ix.childrenOf.get(current) ?? []) {
      if (out.has(child.id)) continue;
      out.add(child.id);
      stack.push(child.id);
    }
  }
  return out;
}

/**
 * Q-7 — a TOTAL, STABLE order: parents before children, siblings by `createdAt` asc then `id` asc.
 * Never storage order. Orphans (a `parentId` pointing at nothing) are appended rather than dropped, so a
 * data problem shows up in the UI instead of silently deleting rows.
 *
 * This was already the one correctly-indexed walk in the file — Θ(n log c), and it never called `isLeaf`.
 * The delta named it as the quadratic; it was not. It survives for the interior tree and the MCP outline.
 */
export function orderedTree<T extends TreeNode & { createdAt: string }>(goals: readonly T[]): T[] {
  const byParent = new Map<string | null, T[]>();
  for (const g of goals) {
    const list = byParent.get(g.parentId) ?? [];
    list.push(g);
    byParent.set(g.parentId, list);
  }
  for (const list of byParent.values()) list.sort(siblingCompare);
  const out: T[] = [];
  const emitted = new Set<string>();
  const walk = (parentId: string | null) => {
    for (const g of byParent.get(parentId) ?? []) {
      if (emitted.has(g.id)) continue;
      emitted.add(g.id);
      out.push(g);
      walk(g.id);
    }
  };
  walk(null);
  for (const g of goals) if (!emitted.has(g.id)) out.push(g);
  return out;
}

/** Q-7 — `createdAt` asc, `id` asc. The one total order every sibling list and every lens page uses. */
export function siblingCompare<T extends { createdAt: string; id: string }>(a: T, b: T): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// The two guards. These are the invariants; the routes call them before writing.
//
// ⚠ **A2 (R-lens-27)** — both used to take the owner's whole goal list. They now take exactly what they
// compare: `checkCreate` takes ONE ROW (the parent), `checkMove` takes two rows and the moved goal's
// subtree. `POST /goals` used to run `SELECT * FROM goals WHERE user_id = ?` THREE times — guard,
// service, response snapshot — and now reads one row.
// ─────────────────────────────────────────────────────────────────────────────

/** What a create/move guard refuses with. Maps 1:1 onto an `ErrorCode` at the API boundary. */
export type TreeViolation =
  /** R-goal-4 — a non-Life goal was submitted with no parent. */
  | { kind: 'PARENT_REQUIRED' }
  /** R-goal-3 — a Life goal was submitted with a parent. */
  | { kind: 'LIFE_GOAL_HAS_PARENT' }
  /** The named parent/target does not exist (or is not the caller's — R-auth-3 makes those identical). */
  | { kind: 'PARENT_NOT_FOUND'; parentId: string }
  /** R-goal-5/31/17 — equal or inverted rank, or a **Weekly** parent (the terminal horizon). */
  | { kind: 'HORIZON_CONFLICT'; parentHorizon: Horizon; childHorizon: Horizon }
  /** R-goal-18(a,b) — the target is the goal itself or one of its descendants. */
  | { kind: 'WOULD_CREATE_CYCLE'; targetId: string }
  /** R-goal-21 — a Life goal cannot be moved. */
  | { kind: 'LIFE_GOAL_IMMUTABLE' };

/**
 * R-goal-3/4/5/31/32 — may a goal with `horizon` be created under `parent`?
 *
 * Returns `null` when it may, or the single reason it may not. **It compares two ranks and needs nothing
 * else**, which is why it takes the parent ROW rather than the tree: covers S-goal-3-1, S-goal-4-1,
 * S-goal-5-2 (equal rank), S-goal-5-3 (inverted rank) and S-goal-31-1 (any child of a Weekly goal).
 *
 * ⚠ **A2 — two things reversed here, and both are the whole point of the amendment.** A **Monthly**
 * parent is now legal — S-goal-31-2 is the exact request the old rule required to be refused, and a build
 * that still refuses it has implemented the old rule. And because R-goal-5 requires strictly DECREASING
 * rank rather than adjacency, a Weekly goal may hang off a Monthly, Quarterly, Yearly **or Life** goal
 * (R-goal-32, S-goal-32-1); inventing an adjacency rule for Weekly alone would make it the only horizon
 * in the product carrying a parent constraint the other four do not.
 */
export function checkCreate(
  input: { horizon: Horizon; parentId: string | null },
  parent: TreeNode | null,
): TreeViolation | null {
  const { horizon, parentId } = input;
  if (isLifeHorizon(horizon)) return parentId === null ? null : { kind: 'LIFE_GOAL_HAS_PARENT' };
  if (parentId === null) return { kind: 'PARENT_REQUIRED' };
  if (!parent) return { kind: 'PARENT_NOT_FOUND', parentId };
  // ONE comparison covers both R-goal-5 (strictly decreasing) and R-goal-31 (Weekly is terminal): the
  // terminal horizon has the MAXIMUM rank, so no horizon can be strictly greater than it and a Weekly
  // parent refuses every child without a rule of its own.
  if (rank(parent.horizon) >= rank(horizon)) {
    return { kind: 'HORIZON_CONFLICT', parentHorizon: parent.horizon, childHorizon: horizon };
  }
  return null;
}

/**
 * R-goal-16/17/18/21 — may `goal` be re-parented under `target`?
 *
 * The descendant check runs FIRST, because R-goal-19 fixes the order of the two refusal reasons: a
 * Monthly child of the Quarterly goal being moved is "its own descendant", not "horizon conflict".
 *
 * Only the moved goal's own rank is compared. Horizons never change on a move and the subtree was
 * already strictly decreasing, so this one check preserves R-goal-32 for the whole subtree (R-goal-17).
 *
 * `descendants` is the moved goal's subtree, read as ONE recursive CTE rather than derived from the whole
 * table (R-lens-27) — and it is **empty for a Weekly goal**, which is terminal (R-goal-31) and can have
 * no descendants at all.
 *
 * ⚠ **A2 (R-goal-40, SPEC Q-24)** — Move REMAINS available on a Weekly goal, deliberately: forbidding it
 * would make Weekly the only horizon in the product that cannot be corrected after the fact, and
 * R-task-49's inference makes a wrong parent MORE likely, not less, because it picks the parent for you.
 * What Move may never do is change a Weekly goal's `periodKey` — see `GoalService.move`.
 */
export function checkMove(
  goal: TreeNode | null,
  target: TreeNode | null,
  descendants: ReadonlySet<string>,
  goalId: string,
  targetId: string,
): TreeViolation | null {
  if (!goal) return { kind: 'PARENT_NOT_FOUND', parentId: goalId };
  if (goal.parentId === null) return { kind: 'LIFE_GOAL_IMMUTABLE' };
  if (!target) return { kind: 'PARENT_NOT_FOUND', parentId: targetId };

  if (targetId === goalId || descendants.has(targetId)) return { kind: 'WOULD_CREATE_CYCLE', targetId };
  if (rank(target.horizon) >= rank(goal.horizon)) {
    return { kind: 'HORIZON_CONFLICT', parentHorizon: target.horizon, childHorizon: goal.horizon };
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Array-shaped wrappers.
//
// They build an index and delegate. They are for ONE-OFF calls — a single ancestor
// walk, a single subtree. **Calling one inside a loop over the same list rebuilds the
// index every iteration and reintroduces exactly the Θ(n²·d) defect this file was
// rewritten to remove.** Hoist `indexTree` out of the loop instead.
// ─────────────────────────────────────────────────────────────────────────────

export function node<T extends TreeNode>(goals: readonly T[], id: string | null): T | undefined {
  return id === null ? undefined : goals.find((g) => g.id === id);
}

export function ancestors<T extends TreeNode>(goals: readonly T[], id: string): T[] {
  return ancestorsIn(indexTree(goals), id);
}

export function descendantIds<T extends TreeNode>(goals: readonly T[], id: string): Set<string> {
  return descendantIdsIn(indexTree(goals), id);
}
