import type { GoalView } from '@goal-cascade/shared';

/**
 * What is left of the tree helpers, which is almost nothing — **and that is the point.**
 *
 * ⚠ **A2 (R-lens-16, S-lens-16-2)** — the client no longer holds the goal tree, so it cannot walk one.
 * Every read is one horizon and one period (R-lens-27), each item arrives with its Life-goal group already
 * resolved by the server (`lifeRootId`), and a goal's ancestry comes from `GET /goals/:id`, which returns
 * `ancestors`. Deleted with the tree, and not coming back under another name:
 *
 *  - `childrenOf`, `ancestorsOf`, `rootOf`, `rootIdOfGoalId`, `descendantIds`, `pathOf`, `flatTree` —
 *    walks over an array the client no longer has;
 *  - `activeLeavesUnder`, `leaves` — both keyed on `isLeaf`/`isActive`, which left the wire (R-goal-37,
 *    R-rm-2). "Leaf" is **retired as a product word**, not renamed: a Monthly goal with no children is a
 *    leaf by the structural definition and is precisely the goal that must never hold a task;
 *  - `rank` — moved to `utils/periodKeys.ts`, beside the period arithmetic it belongs with.
 *
 * What survives is rendering: a URL's host, and singular/plural. Neither is an invariant.
 */

/** Find one goal in a list this screen already holds. Never a lookup into a tree we do not have. */
export function node(goals: readonly GoalView[], id: string | null | undefined): GoalView | undefined {
  return id ? goals.find((g) => g.id === id) : undefined;
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
