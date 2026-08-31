import type { GoalView, TaskDetailView, TaskView, WeekView } from '@goal-cascade/shared';
import { WEEK_HISTORY_WEEKS } from '@goal-cascade/shared';
import type { CallToolResult } from '@modelcontextprotocol/server';
import type { DependencyContainer } from 'tsyringe';
import type { RequestContext } from '../../application/context';
import { IIdGenerator } from '../../application/ports';
import { notFound } from '../../domain/errors';
import { activeLeavesUnder, ancestors, descendantIds, isLeaf } from '../../domain/goal-tree';
import { resolveWeek } from '../week';

/**
 * Everything a tool needs, resolved ONCE per HTTP request.
 *
 * `ctx` is the load-bearing field. It carries the `userId` resolved from the verified bearer token in
 * `mcp.routes.ts`, and it is CLOSED OVER by the server factory — no tool receives a user id as an
 * argument, so no tool can forget to scope and no tool argument can be made to point at another account.
 * That is the whole scoping story; there is no second mechanism and no per-tool check to get wrong.
 */
export type McpDeps = {
  dc: DependencyContainer;
  ctx: RequestContext;
  /**
   * Better Auth's password change, injected rather than resolved, because password hashing belongs to
   * Better Auth and Better Auth is built per REQUEST (it needs the D1 binding and the origin) — an
   * `application/` service cannot reach it. `mcp.routes.ts` supplies the closure.
   *
   * The design document recommended not exposing this at all (rail 2: an agent that changes the password
   * from a mis-parsed instruction or a prompt injection locks the owner out permanently, and this
   * deployment cannot send recovery mail). The owner was shown that reasoning and explicitly chose full
   * unrestricted access, so the tool ships. The risk is real and unchanged; it is accepted, not solved.
   */
  changePassword: (currentPassword: string, newPassword: string, revokeOtherSessions: boolean) => Promise<void>;
};

/**
 * How far back an MCP tool may address a week.
 *
 * `/api/*` clamps at `WEEK_HISTORY_WEEKS` (8) because that is the WEEK SWITCHER's range — a UI bound
 * (R-nav-4, D-24), not a data bound. An agent has no switcher and a legitimate reason to read further
 * back ("how long has this been carrying"), and SPEC Q-13 already says older weeks stay readable by
 * naming them. So the MCP surface uses the schema's own bound instead: `WeekOffset` is `-520 … 0`.
 */
const MCP_WEEK_HISTORY = 521;

/** An offset (0 = this week, negative = back) as the absolute Monday everything below the wire uses. */
export function week(ctx: RequestContext, offset = 0): WeekView {
  return resolveWeek(ctx, offset, MCP_WEEK_HISTORY);
}

/** The `week` block on every week-scoped tool result, in the surface's snake_case. */
export function weekOut(w: WeekView) {
  return { week_start: w.weekStart, offset: w.offset, is_current: w.isCurrent };
}

/**
 * A fresh idempotency key for ONE mutating tool call.
 *
 * The design's rail 6 is that the AGENT never supplies one: a model cannot reliably reason about when
 * two calls are "the same operation", and a reused key across genuinely different intents replays a
 * stale result that looks like success. So the server mints one per invocation.
 *
 * What that does NOT buy, and the design document overstates: protection against a dropped response.
 * That requires the CLIENT to send the identical key again, and the stateless MCP transport gives us no
 * hook to make it do so — one POST is one complete interaction. A per-invocation key is exactly the
 * guarantee that is implementable here, and it is recorded on `ctx` so anything downstream that reads
 * it sees a real value rather than `null`.
 */
export function stampIdempotencyKey(deps: McpDeps): void {
  deps.ctx.idempotencyKey = deps.dc.resolve<{ ulid(): string }>(IIdGenerator).ulid();
}

/** A successful tool result: the JSON payload as text, which is what a model actually reads. */
export function ok(payload: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

/** The carry chip, rendered server-side so the agent quotes the same words the owner sees in the UI. */
function carryLabel(carryWeeks: number, originWeekStart: string): string {
  if (carryWeeks <= 0) return '';
  const d = new Date(`${originWeekStart}T00:00:00.000Z`);
  const since = `${d.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]}`;
  return carryWeeks === 1 ? `since ${since}` : `${carryWeeks} weeks · since ${since}`;
}

/**
 * A task as the MCP surface shapes it. `TaskDetailView` extends `TaskView` with `events`, so one
 * function covers both list and detail results and the timeline rides along only when it exists.
 */
export function taskOut(v: TaskView | TaskDetailView, goalPath: string | undefined) {
  const events = 'events' in v ? v.events : undefined;
  return {
    id: v.id,
    goal_id: v.goalId,
    goal_path: goalPath,
    title: v.title,
    cond: v.cond,
    description: v.description,
    links: v.links.map((l) => ({ id: l.id, url: l.url, created_at: l.createdAt })),
    status: v.status,
    done: v.done,
    origin_week_start: v.originWeekStart,
    done_week_start: v.doneWeekStart,
    done_at: v.doneAt,
    exit_reason: v.exitReason,
    exited_at: v.exitedAt,
    carry_weeks: v.carryWeeks,
    carry_label: carryLabel(v.carryWeeks, v.originWeekStart),
    created_at: v.createdAt,
    updated_at: v.updatedAt,
    ...(events ? { events } : {}),
  };
}

/** `Health › Get strong in 2026 › Q3 2026 › Sep 2026` — the breadcrumb an agent quotes back to the user. */
export function pathOf(goals: readonly GoalView[], id: string): string {
  const self = goals.find((g) => g.id === id);
  const chain = [...ancestors(goals, id), ...(self ? [self] : [])];
  return chain.map((g) => g.title).join(' › ');
}

export function pathIndex(goals: readonly GoalView[]): Map<string, string> {
  return new Map(goals.map((g) => [g.id, pathOf(goals, g.id)]));
}

/**
 * One goal, as the MCP surface shapes it: snake_case, path-labelled, with the derived flags the SERVER
 * computed for the week in question. Nothing here is re-derived from a client clock.
 */
export function goalOut(g: GoalView, paths: Map<string, string>, goals: readonly GoalView[]) {
  return {
    id: g.id,
    path: paths.get(g.id) ?? g.title,
    title: g.title,
    horizon: g.horizon,
    period: g.period,
    why: g.why,
    pulse: g.pulse,
    parent_id: g.parentId,
    is_leaf: g.isLeaf,
    is_active: g.isActive,
    dormant: g.dormant,
    subtree_active: g.subtreeActive,
    focus: g.focus,
    backlog_count: g.backlogCount,
    carrying: g.carrying ? { open_tasks: g.carrying.openTasks, oldest_weeks: g.carrying.oldestWeeks } : null,
    branches: g.branches,
    // Included so an agent can tell "this goal could hold a focus" from "this goal has children",
    // without having to reconstruct the tree from `parent_id` itself.
    can_hold_focus: g.parentId !== null && isLeaf(goals, g.id),
  };
}

/**
 * The tree as an indented outline — the form an agent should read to REASON, as opposed to the JSON one,
 * which is for exact field access. One line per goal, deepest information last:
 *
 *   `- Sep 2026 [01J…] (Monthly · Sep 2026 · On track) ACTIVE: "Three gym sessions and one long run."`
 */
export function outline(goals: readonly GoalView[]): string {
  const depth = (g: GoalView) => ancestors(goals, g.id).length;
  return goals
    .map((g) => {
      const meta = [g.horizon, g.period, g.pulse].filter(Boolean).join(' · ');
      const state = g.isActive ? ` ACTIVE: "${g.focus}"` : g.dormant ? ' DORMANT' : '';
      const backlog = g.backlogCount > 0 ? ` · ${g.backlogCount} in backlog` : '';
      return `${'  '.repeat(depth(g))}- ${g.title} [${g.id}] (${meta})${backlog}${state}`;
    })
    .join('\n');
}

/**
 * Every id at or under `goalId`, inclusive — the subtree filters `under_goal_id` needs.
 *
 * **It refuses an id that is not in the owner's tree, and that is not optional.** A subtree filter is a
 * SET INTERSECTION, so an id belonging to nobody — or to another owner — would simply match nothing and
 * return `[]`. That is a silent no-op wearing a success, which is exactly what SPEC Q-10 forbids and
 * exactly the wrong answer for an agent: told "show me what's under X", it would report an empty branch
 * rather than a bad id, and act on that. `NOT_FOUND` is also what R-auth-3 requires — another owner's
 * goal must be indistinguishable from a non-existent one, so both take this same path.
 *
 * `tests/mcp/scoping.test.ts` caught every filter that skipped this check.
 */
export function subtreeIds(goals: readonly GoalView[], goalId: string): Set<string> {
  requireGoal(goals, goalId);
  return new Set([goalId, ...descendantIds(goals, goalId)]);
}

/** The owner's goal, or `NOT_FOUND` — the same refusal another owner's id gets (R-auth-3). */
export function requireGoal(goals: readonly GoalView[], goalId: string): GoalView {
  const g = goals.find((x) => x.id === goalId);
  if (!g) throw notFound('goal');
  return g;
}

/** The active leaves that could receive work filed at or under `goalId` (R-backlog-7 / D-18). */
export function activeLeafCandidates(goals: readonly GoalView[], goalId: string) {
  const focused = new Set(goals.filter((g) => g.isActive).map((g) => g.id));
  return activeLeavesUnder(goals, goalId, focused).map((g) => ({ id: g.id, title: g.title }));
}

// ─────────────────────────────────────────────────────────────────────────────
// find_goal — the ONE place fuzziness is allowed, and it is read-only
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Case- and diacritic-insensitive normalisation. Without the diacritic fold, "Séjour" and "Sejour" are
 * different goals to the matcher and identical to the user, which is exactly the kind of near-miss that
 * makes an agent act on the wrong branch.
 */
function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

export type GoalMatch = { goal: GoalView; score: number; matchedOn: string };

/**
 * Rank goals against a phrase the user said.
 *
 * The ladder is deliberately coarse and ordered by how much the match tells you: an exact title is
 * certainty, a `why` substring is a hint. Ties break toward the SHORTER horizon (the more specific goal
 * — "my fitness goal" almost always means the leaf being worked on, not the Life root), then oldest
 * first for stability.
 *
 * This is the only fuzzy matching on the whole surface, it is read-only, and it reports `ambiguous` so
 * the model is told when to ask rather than guess. Mutating tools take ids and nothing else.
 */
export function rankGoals(goals: readonly GoalView[], query: string, paths: Map<string, string>): GoalMatch[] {
  const q = fold(query);
  if (q === '') return [];
  const out: GoalMatch[] = [];
  for (const g of goals) {
    const title = fold(g.title);
    const path = fold(paths.get(g.id) ?? g.title);
    const why = fold(g.why);
    let score = 0;
    let matchedOn = '';
    if (title === q) [score, matchedOn] = [1, 'title'];
    else if (title.startsWith(q)) [score, matchedOn] = [0.9, 'title-prefix'];
    else if (title.includes(q)) [score, matchedOn] = [0.75, 'title'];
    else if (path.includes(q)) [score, matchedOn] = [0.55, 'path'];
    else if (why.includes(q)) [score, matchedOn] = [0.35, 'why'];
    if (score > 0) out.push({ goal: g, score, matchedOn });
  }
  const rankOf = (g: GoalView) => ['Life', 'Yearly', 'Quarterly', 'Monthly'].indexOf(g.horizon);
  return out.sort(
    (a, b) =>
      b.score - a.score ||
      rankOf(b.goal) - rankOf(a.goal) ||
      (a.goal.createdAt < b.goal.createdAt ? -1 : a.goal.createdAt > b.goal.createdAt ? 1 : 0),
  );
}

/** Two candidates within 0.15 of each other is not a ranking, it is a question for the user. */
export function isAmbiguous(matches: readonly GoalMatch[]): boolean {
  return matches.length >= 2 && matches[0]!.score - matches[1]!.score < 0.15;
}

export { WEEK_HISTORY_WEEKS };
