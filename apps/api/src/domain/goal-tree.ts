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
 * Pure: no I/O, no clock, no runtime imports (the one `import type` is erased at compile time). Every
 * function takes the owner's FULL goal list — at most 500 nodes, at most 4 levels deep (Q-12, R-goal-7) —
 * so nothing here needs a query.
 */

/** R-goal-2 — longest horizon first; the index is the rank. */
export const HORIZONS: readonly Horizon[] = ['Life', 'Yearly', 'Quarterly', 'Monthly'];

/** Minimal shape these rules need. Any record with these three fields works, including a view model. */
export type TreeNode = { id: string; parentId: string | null; horizon: Horizon };

/** Rank of a horizon: Life 0 › Yearly 1 › Quarterly 2 › Monthly 3. Higher rank = SHORTER horizon. */
export function rank(h: Horizon): number {
  const i = HORIZONS.indexOf(h);
  if (i < 0) throw new RangeError(`unknown horizon: ${String(h)}`);
  return i;
}

/** R-goal-6 — the shortest horizon. A Monthly goal can never have sub-goals. */
export function isTerminalHorizon(h: Horizon): boolean {
  return rank(h) === HORIZONS.length - 1;
}

/** R-goal-3 — a Life goal is the only horizon that may sit at the root, and it has no target period. */
export function isLifeHorizon(h: Horizon): boolean {
  return rank(h) === 0;
}

export function node<T extends TreeNode>(goals: readonly T[], id: string | null): T | undefined {
  return id === null ? undefined : goals.find((g) => g.id === id);
}

export function children<T extends TreeNode>(goals: readonly T[], id: string | null): T[] {
  return goals.filter((g) => g.parentId === id);
}

/** R-goal-8 — a leaf has zero children. */
export function isLeaf<T extends TreeNode>(goals: readonly T[], id: string): boolean {
  return !goals.some((g) => g.parentId === id);
}

/** Root → parent, in that order. Empty for a Life goal. Cycle-safe: it can never loop forever. */
export function ancestors<T extends TreeNode>(goals: readonly T[], id: string): T[] {
  const out: T[] = [];
  const seen = new Set<string>([id]);
  let current = node(goals, id)?.parentId ?? null;
  while (current && !seen.has(current)) {
    seen.add(current);
    const parent = node(goals, current);
    if (!parent) break;
    out.unshift(parent);
    current = parent.parentId;
  }
  return out;
}

/** The Life goal at the top of this goal's line, or the goal itself when it is one. */
export function rootOf<T extends TreeNode>(goals: readonly T[], id: string): T | undefined {
  const chain = ancestors(goals, id);
  return chain[0] ?? node(goals, id);
}

/** Every id strictly below `id`. Cycle-safe. */
export function descendantIds<T extends TreeNode>(goals: readonly T[], id: string): Set<string> {
  const out = new Set<string>();
  const stack = [id];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const child of goals) {
      if (child.parentId === current && !out.has(child.id)) {
        out.add(child.id);
        stack.push(child.id);
      }
    }
  }
  return out;
}

/** R-goal-9 — non-Life leaves: the only goals that may hold a weekly focus or own tasks (R-goal-12). */
export function focusableLeaves<T extends TreeNode>(goals: readonly T[]): T[] {
  return goals.filter((g) => g.parentId !== null && isLeaf(goals, g.id));
}

/**
 * R-goal-9 — a goal is ACTIVE iff it is a non-Life leaf holding a focus for the week in question.
 * `focusedGoalIds` is the set of goal ids with a `weekly_focus` row for that week (D-2): "active" is
 * "a row exists", never "a non-empty string".
 */
export function isActive<T extends TreeNode>(goals: readonly T[], id: string, focusedGoalIds: ReadonlySet<string>): boolean {
  const g = node(goals, id);
  if (!g || g.parentId === null) return false;
  return isLeaf(goals, id) && focusedGoalIds.has(id);
}

/** R-goal-10 — a non-Life leaf with no focus this week. Rendered muted, and it must read as intentional. */
export function isDormant<T extends TreeNode>(goals: readonly T[], id: string, focusedGoalIds: ReadonlySet<string>): boolean {
  const g = node(goals, id);
  if (!g || g.parentId === null) return false;
  return isLeaf(goals, id) && !focusedGoalIds.has(id);
}

/**
 * R-goal-11 — dormancy propagates UP: a non-leaf is muted iff NO leaf anywhere in its subtree is active.
 * One active leaf anywhere below lights the whole ancestor chain.
 */
export function subtreeActive<T extends TreeNode>(goals: readonly T[], id: string, focusedGoalIds: ReadonlySet<string>): boolean {
  if (isLeaf(goals, id)) return isActive(goals, id, focusedGoalIds);
  for (const descendant of descendantIds(goals, id)) {
    if (isActive(goals, descendant, focusedGoalIds)) return true;
  }
  return false;
}

/**
 * R-backlog-7 / D-18 — the active leaves at or under `goalId`, which are the candidates to receive a
 * converted backlog item. ALL of them are returned, never just the first: an item on a Quarterly goal
 * with two active Monthly children must make the user choose (S-backlog-7-2). The mockup's
 * `activeLeafFor` returned whichever came first in array order, and that id determines which focus the
 * task belongs to for the rest of its life.
 */
export function activeLeavesUnder<T extends TreeNode>(
  goals: readonly T[],
  goalId: string,
  focusedGoalIds: ReadonlySet<string>,
): T[] {
  const ids = [goalId, ...descendantIds(goals, goalId)];
  return ids.map((id) => node(goals, id)).filter((g): g is T => !!g && isActive(goals, g.id, focusedGoalIds));
}

/**
 * Q-7 — a TOTAL, STABLE order: parents before children, siblings by `createdAt` asc then `id` asc.
 * Never storage order. Orphans (a `parentId` pointing at nothing) are appended rather than dropped, so a
 * data problem shows up in the UI instead of silently deleting rows.
 */
export function orderedTree<T extends TreeNode & { createdAt: string }>(goals: readonly T[]): T[] {
  const byParent = new Map<string | null, T[]>();
  for (const g of goals) {
    const list = byParent.get(g.parentId) ?? [];
    list.push(g);
    byParent.set(g.parentId, list);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => (a.createdAt === b.createdAt ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.createdAt < b.createdAt ? -1 : 1));
  }
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

// ─────────────────────────────────────────────────────────────────────────────
// The two guards. These are the invariants; the routes call them before writing.
// ─────────────────────────────────────────────────────────────────────────────

/** What a create/move guard refuses with. Maps 1:1 onto an `ErrorCode` at the API boundary. */
export type TreeViolation =
  /** R-goal-4 — a non-Life goal was submitted with no parent. */
  | { kind: 'PARENT_REQUIRED' }
  /** R-goal-3 — a Life goal was submitted with a parent. */
  | { kind: 'LIFE_GOAL_HAS_PARENT' }
  /** The named parent/target does not exist (or is not the caller's — R-auth-3 makes those identical). */
  | { kind: 'PARENT_NOT_FOUND'; parentId: string }
  /** R-goal-5/6/17 — equal or inverted rank, or a Monthly parent. */
  | { kind: 'HORIZON_CONFLICT'; parentHorizon: Horizon; childHorizon: Horizon }
  /** R-goal-18(a,b) — the target is the goal itself or one of its descendants. */
  | { kind: 'WOULD_CREATE_CYCLE'; targetId: string }
  /** R-goal-21 — a Life goal cannot be moved. */
  | { kind: 'LIFE_GOAL_IMMUTABLE' };

/**
 * R-goal-3/4/5/6 — may a goal with `horizon` be created under `parentId`?
 *
 * Returns `null` when it may, or the single reason it may not. Covers S-goal-3-1, S-goal-4-1,
 * S-goal-5-2 (equal rank), S-goal-5-3 (inverted rank) and S-goal-6-1 (any child of a Monthly goal).
 */
export function checkCreate<T extends TreeNode>(
  goals: readonly T[],
  input: { horizon: Horizon; parentId: string | null },
): TreeViolation | null {
  const { horizon, parentId } = input;
  if (isLifeHorizon(horizon)) return parentId === null ? null : { kind: 'LIFE_GOAL_HAS_PARENT' };
  if (parentId === null) return { kind: 'PARENT_REQUIRED' };

  const parent = node(goals, parentId);
  if (!parent) return { kind: 'PARENT_NOT_FOUND', parentId };
  // One comparison covers both R-goal-5 (strictly decreasing) and R-goal-6 (Monthly is terminal): a
  // Monthly parent has the maximum rank, so no horizon can be strictly greater than it.
  if (rank(parent.horizon) >= rank(horizon)) {
    return { kind: 'HORIZON_CONFLICT', parentHorizon: parent.horizon, childHorizon: horizon };
  }
  return null;
}

/**
 * R-goal-16/17/18/21 — may `goalId` be re-parented under `targetId`?
 *
 * The descendant check runs FIRST, because R-goal-19 fixes the order of the two refusal reasons: a
 * Monthly child of the Quarterly goal being moved is "its own descendant", not "horizon conflict".
 *
 * Only the moved goal's own rank is compared. Horizons never change on a move and the subtree was
 * already strictly decreasing, so this one check preserves R-goal-7 for the whole subtree (R-goal-17).
 */
export function checkMove<T extends TreeNode>(goals: readonly T[], goalId: string, targetId: string): TreeViolation | null {
  const goal = node(goals, goalId);
  if (!goal) return { kind: 'PARENT_NOT_FOUND', parentId: goalId };
  if (goal.parentId === null) return { kind: 'LIFE_GOAL_IMMUTABLE' };

  const target = node(goals, targetId);
  if (!target) return { kind: 'PARENT_NOT_FOUND', parentId: targetId };

  if (targetId === goalId || descendantIds(goals, goalId).has(targetId)) {
    return { kind: 'WOULD_CREATE_CYCLE', targetId };
  }
  if (rank(target.horizon) >= rank(goal.horizon)) {
    return { kind: 'HORIZON_CONFLICT', parentHorizon: target.horizon, childHorizon: goal.horizon };
  }
  return null;
}

/**
 * R-goal-19 — the exact reason string the Move sheet shows next to a disabled target. There are exactly
 * two, and the descendant one wins (S-goal-19-1). `null` means the target is selectable.
 *
 * D-7: the goal itself is DISABLED with `its own descendant`, not filtered out of its own move list — a
 * row that disappears reads as a bug.
 */
export function moveTargetReason<T extends TreeNode>(goals: readonly T[], goalId: string, targetId: string): string | null {
  const violation = checkMove(goals, goalId, targetId);
  if (!violation) return null;
  if (violation.kind === 'WOULD_CREATE_CYCLE') return 'its own descendant';
  if (violation.kind === 'HORIZON_CONFLICT') return 'horizon conflict';
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Periods. D-3: the mockup hardcoded 2026 literals, so every default was wrong from
// the first day of the next period and re-plan offered the period the goal was in.
// These are pure functions of (horizon, today) — and re-plan is strictly forward.
// ─────────────────────────────────────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** `today` is the owner-local date (`YYYY-MM-DD`) — resolve it with `weeks.dateInTimezone` first. */
function ymOf(today: string): { year: number; month: number } {
  const [y, m] = today.split('-');
  return { year: Number(y), month: Number(m) };
}

/** R-goal-13 — the period a new goal starts in, derived from TODAY. Life goals have none. */
export function defaultPeriod(horizon: Horizon, today: string): string {
  const { year, month } = ymOf(today);
  switch (horizon) {
    case 'Life':
      return '';
    case 'Yearly':
      return String(year);
    case 'Quarterly':
      return `Q${Math.floor((month - 1) / 3) + 1} ${year}`;
    case 'Monthly':
      return `${MONTHS[month - 1]} ${year}`;
  }
}

/** Absolute ordinal of a period, for comparing "is this period after that one?". */
function ordinalOf(horizon: Horizon, period: string): number | null {
  const p = period.trim();
  if (horizon === 'Yearly') return /^\d{4}$/.test(p) ? Number(p) : null;
  if (horizon === 'Quarterly') {
    const m = /^Q([1-4])\s+(\d{4})$/.exec(p);
    return m ? Number(m[2]) * 4 + (Number(m[1]) - 1) : null;
  }
  if (horizon === 'Monthly') {
    const m = /^([A-Za-z]{3})\s+(\d{4})$/.exec(p);
    const index = m ? MONTHS.findIndex((x) => x.toLowerCase() === m[1]!.toLowerCase()) : -1;
    return m && index >= 0 ? Number(m[2]) * 12 + index : null;
  }
  return null;
}

function periodFromOrdinal(horizon: Horizon, ordinal: number): string {
  if (horizon === 'Yearly') return String(ordinal);
  if (horizon === 'Quarterly') return `Q${(ordinal % 4) + 1} ${Math.floor(ordinal / 4)}`;
  return `${MONTHS[ordinal % 12]} ${Math.floor(ordinal / 12)}`;
}

/**
 * R-goal-23 — the contextual next periods offered by the re-plan sheet: Monthly → the next two months,
 * Quarterly → the next two quarters, Yearly → next year. Life goals are not re-plannable (R-goal-21), so
 * the list is empty.
 *
 * Options are strictly AFTER both today's period and the goal's CURRENT period (D-3), so a re-plan can
 * never "move" a goal to the period it is already in. An unparseable current period falls back to
 * today's, which keeps the sheet useful rather than empty.
 */
export function replanPeriods(horizon: Horizon, today: string, currentPeriod = ''): string[] {
  if (horizon === 'Life') return [];
  const todayOrdinal = ordinalOf(horizon, defaultPeriod(horizon, today));
  if (todayOrdinal === null) return [];
  const currentOrdinal = ordinalOf(horizon, currentPeriod);
  const base = Math.max(todayOrdinal, currentOrdinal ?? todayOrdinal);
  const count = horizon === 'Yearly' ? 1 : 2;
  return Array.from({ length: count }, (_, i) => periodFromOrdinal(horizon, base + i + 1));
}
