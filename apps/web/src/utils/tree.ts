import { HORIZONS, type GoalView, type Horizon } from '@goal-cascade/shared';

/**
 * PRESENTATION helpers over the goal array the server sends.
 *
 * Everything the mockup computed here that the server now derives — `isLeaf`, `isActive`, `subtreeActive`,
 * `activeLeafFor`, `defaultPeriod`, `replanPeriods` — is gone (see `docs/work/06-web-data/build.md` §5.1).
 * `GoalView` carries `isLeaf` / `isActive` / `dormant` / `subtreeActive` / `carrying` / `branches` /
 * `backlogCount`, computed for the week the read model was built for, and this file must never recompute
 * one of them: a rule enforced in two places is a rule that will disagree with itself.
 *
 * What is left is layout: walking `parentId` for a breadcrumb, flattening the tree for a picker, and
 * rendering a URL's host. None of it is an invariant.
 *
 * Goals arrive already ordered (Q-7: parents before children, then `createdAt`, then `id`). Nothing here
 * re-sorts.
 */

export { HORIZONS };

export function rank(h: Horizon): number {
  return HORIZONS.indexOf(h);
}

export function node(goals: readonly GoalView[], id: string | null | undefined): GoalView | undefined {
  return id ? goals.find((g) => g.id === id) : undefined;
}

export function childrenOf(goals: readonly GoalView[], id: string | null): GoalView[] {
  return goals.filter((g) => g.parentId === id);
}

export const lifeGoals = (goals: readonly GoalView[]): GoalView[] => goals.filter((g) => g.parentId === null);
/** R-backlog-2 — every backlog goal picker lists these and only these. */
export const nonLifeGoals = (goals: readonly GoalView[]): GoalView[] => goals.filter((g) => g.parentId !== null);
/** R-plan-3 — the weekly-focus holders: non-Life goals with no children. */
export const leaves = (goals: readonly GoalView[]): GoalView[] => goals.filter((g) => g.isLeaf && g.parentId !== null);

/** Root → parent. The detail screen prefers `GoalDetailResponse.ancestors`; the tree screen walks here. */
export function ancestorsOf(goals: readonly GoalView[], g: GoalView): GoalView[] {
  const out: GoalView[] = [];
  const seen = new Set<string>([g.id]);
  let p = node(goals, g.parentId);
  // D-27 — a goal whose parent is missing from this payload must not spin or throw; stop walking.
  while (p && !seen.has(p.id)) {
    seen.add(p.id);
    out.unshift(p);
    p = node(goals, p.parentId);
  }
  return out;
}

export function rootOf(goals: readonly GoalView[], g: GoalView): GoalView {
  const a = ancestorsOf(goals, g);
  return a[0] ?? g;
}

/** D-27 — the Life root of a task's goal, defensively: a task whose goal is not in the payload yields null. */
export function rootIdOfGoalId(goals: readonly GoalView[], goalId: string): string | null {
  const g = node(goals, goalId);
  return g ? rootOf(goals, g).id : null;
}

export function descendantIds(goals: readonly GoalView[], id: string): string[] {
  const out: string[] = [];
  const walk = (parentId: string) => {
    for (const c of childrenOf(goals, parentId)) {
      out.push(c.id);
      walk(c.id);
    }
  };
  walk(id);
  return out;
}

/** R-goal-27 — the breadcrumb, root first, the goal itself last. */
export function pathOf(goals: readonly GoalView[], g: GoalView): string[] {
  return [...ancestorsOf(goals, g), g].map((x) => x.title);
}

/**
 * R-backlog-7 / D-18 — the ACTIVE leaves at or under `goalId`, which are the candidates to receive a
 * converted backlog item.
 *
 * This is a filter over the server's own `isActive` / `isLeaf` flags, not a re-derivation of them: the
 * sheet needs the candidate list so it can ASK when there is more than one (the mockup silently took the
 * first in array order). The server is still the guard — it refuses `BRANCH_NOT_ACTIVE` with none and
 * answers with `details.candidates` when the request is ambiguous.
 */
export function activeLeavesUnder(goals: readonly GoalView[], goalId: string): GoalView[] {
  const ids = new Set([goalId, ...descendantIds(goals, goalId)]);
  return goals.filter((g) => ids.has(g.id) && g.isLeaf && g.isActive && g.parentId !== null);
}

export interface FlatRow {
  g: GoalView;
  depth: number;
}

/** The tree, flattened depth-first, for the parent and move pickers. `search` filters after flattening. */
export function flatTree(goals: readonly GoalView[], search: string): FlatRow[] {
  const rows: FlatRow[] = [];
  const walk = (pid: string | null, depth: number) => {
    for (const g of childrenOf(goals, pid)) {
      rows.push({ g, depth });
      walk(g.id, depth + 1);
    }
  };
  walk(null, 0);
  const q = search.trim().toLowerCase();
  return q ? rows.filter((r) => r.g.title.toLowerCase().includes(q)) : rows;
}

/** R-task-24 — the label for a link: hostname minus a leading `www.`, else the raw string truncated. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url.length > 28 ? url.slice(0, 28) + '…' : url;
  }
}

/** Singular/plural without a library. `plural(1, 'task')` → `1 task`. */
export const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;
