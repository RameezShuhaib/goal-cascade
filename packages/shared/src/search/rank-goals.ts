import { HORIZONS, type GoalView, type Horizon } from '../common';

/**
 * **One ranker, two callers.** This is `find_goal`'s ordering, moved out of
 * `apps/api/src/api/mcp/shapes.ts` so that the assistant and the human get the same order for the same
 * words.
 *
 * The MCP tool ranks a phrase the user said against a lens page; the web app's goal picker ranks what the
 * owner is typing against the options that picker is offering (R-nav-31). Those are the same question, and
 * two implementations of it would disagree on the first near-miss — the class of drift the calendar move
 * (R-lens-30) was made to end. `packages/shared/tests/rank-goals.test.ts` holds the census that keeps it
 * one implementation.
 *
 * It is pure: no clock, no I/O, no zod. It ships to the Worker and to the browser bundle.
 */

/**
 * Case- and diacritic-insensitive normalisation. Without the diacritic fold, "Séjour" and "Sejour" are
 * different goals to the matcher and identical to the user, which is exactly the kind of near-miss that
 * makes an agent act on the wrong branch — and, in a picker, makes the owner think a goal has gone.
 */
export function foldForSearch(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * The shape a thing must have to be ranked: a title, the prose behind it, a horizon to break ties on and
 * a birthday to break those. **`GoalView` satisfies it, and so does a picker's own row** — which is why
 * this is structural rather than `GoalView` itself. The web picker ranks rows that carry a Life-line
 * title the wire has no field for, and the server's refusal list carries `{ id, title }` and nothing
 * else; both are rankable without inventing a `GoalView` to hold them.
 */
export type Rankable = { title: string; why: string; horizon: Horizon; createdAt: string };

export type GoalMatch<T extends Rankable = GoalView> = { goal: T; score: number; matchedOn: string };

/**
 * How a match was made, and what each rung is worth. The ladder is deliberately coarse and ordered by how
 * much the match tells you: an exact title is certainty, a `why` substring is a hint.
 *
 * ⚠ **`line` is the one rung the move adds, and it is the picker's.** A goal picker groups by Life goal,
 * so "fitness" typed at it means *that line* at least as often as it means a goal's own title. It scores
 * below a title substring (the goal itself said the word) and above a `why` substring (a line is an
 * identity; a `why` is prose). **The MCP surface passes no `lineTitleOf`, so its ranking is unchanged,
 * rung for rung** — `apps/api/tests/mcp/tools.test.ts` is what says so.
 */
export const MATCH_SCORES = {
  title: 1,
  titlePrefix: 0.9,
  titleSubstring: 0.75,
  line: 0.5,
  why: 0.35,
} as const;

export interface RankOptions<T extends Rankable> {
  /**
   * The Life-goal line a goal belongs to, when the caller knows it (`LensResponse.groups`). Omitted, no
   * goal matches on its line and the ladder is the four rungs `find_goal` has always used.
   */
  lineTitleOf?: (goal: T) => string | undefined;
}

/**
 * Rank goals against a phrase.
 *
 * Ties break toward the SHORTER horizon (the more specific goal — "my fitness goal" almost always means
 * the thing being worked on, not the Life root), then oldest first for stability.
 *
 * This is the only fuzzy matching in the product, on either surface, and it is read-only: `isAmbiguous`
 * reports when a model should ask rather than guess, and the picker makes a person choose from rows.
 * Mutating commands take ids and nothing else.
 */
export function rankGoals<T extends Rankable>(goals: readonly T[], query: string, opts: RankOptions<T> = {}): GoalMatch<T>[] {
  const q = foldForSearch(query);
  if (q === '') return [];
  const out: GoalMatch<T>[] = [];
  for (const g of goals) {
    const title = foldForSearch(g.title);
    const why = foldForSearch(g.why);
    const line = foldForSearch(opts.lineTitleOf?.(g) ?? '');
    let score = 0;
    let matchedOn = '';
    if (title === q) [score, matchedOn] = [MATCH_SCORES.title, 'title'];
    else if (title.startsWith(q)) [score, matchedOn] = [MATCH_SCORES.titlePrefix, 'title-prefix'];
    else if (title.includes(q)) [score, matchedOn] = [MATCH_SCORES.titleSubstring, 'title'];
    else if (line !== '' && line.includes(q)) [score, matchedOn] = [MATCH_SCORES.line, 'line'];
    else if (why.includes(q)) [score, matchedOn] = [MATCH_SCORES.why, 'why'];
    if (score > 0) out.push({ goal: g, score, matchedOn });
  }
  // ⚠ **A2** — the rank comes from the shared `HORIZONS` array rather than an inline four-member literal.
  // That literal was one of the four copies of the horizon list, and it would have silently ranked every
  // Weekly goal as `-1` — below Life — the moment the fifth horizon shipped (the delta's silent break #4).
  const rankOf = (g: T) => (HORIZONS as readonly Horizon[]).indexOf(g.horizon);
  return out.sort(
    (a, b) =>
      b.score - a.score ||
      rankOf(b.goal) - rankOf(a.goal) ||
      (a.goal.createdAt < b.goal.createdAt ? -1 : a.goal.createdAt > b.goal.createdAt ? 1 : 0),
  );
}

/** Two candidates within 0.15 of each other is not a ranking, it is a question for the user. */
export function isAmbiguous(matches: readonly { score: number }[]): boolean {
  return matches.length >= 2 && matches[0]!.score - matches[1]!.score < 0.15;
}
