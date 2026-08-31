import {
  Horizon,
  OneLiner,
  Period,
  Pulse,
  Reason,
  Title,
  Ulid,
  WeekOffset,
  type GoalView,
} from '@goal-cascade/shared';
import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { BootstrapService, GoalService, GoalTreeGuard } from '../../../application/services';
import { guard } from '../errors';
import {
  activeLeafCandidates,
  goalOut,
  isAmbiguous,
  ok,
  outline,
  pathIndex,
  rankGoals,
  stampIdempotencyKey,
  subtreeIds,
  week,
  weekOut,
  type McpDeps,
} from '../shapes';

/**
 * The week input every read tool shares. `WeekOffset` is the repo's own schema (`z.int().max(0).min(-520)`
 * with a `.describe()`), reused verbatim — zod 4.5 exposes `~standard.jsonSchema`, so the SDK advertises
 * it without a conversion step and the bound cannot drift from the API's.
 */
const WeekOffsetArg = WeekOffset.default(0);

export function registerGoalTools(server: McpServer, deps: McpDeps): void {
  const { dc, ctx } = deps;

  // ── 1. get_overview ────────────────────────────────────────────────────────────────────────────
  server.registerTool(
    'get_overview',
    {
      title: 'Overview of the whole account',
      description:
        'Start here. Returns the owner\'s entire goal tree as an indented outline with ids and paths, the current week, which branches are active this week and their focus sentences, plus counts of open tasks, backlog items, ideas and learnings. One call is enough to answer "what is this person working on".',
      inputSchema: z
        .object({
          include: z
            .array(z.enum(['tree', 'week', 'tasks', 'backlog', 'ideas', 'learnings']))
            .optional()
            .describe('Trim the payload when you already have context. Omit for everything.'),
          week_offset: WeekOffsetArg,
        })
        .strict(),
    },
    async ({ include, week_offset }) =>
      guard(async () => {
        const w = week(ctx, week_offset);
        const b = await dc.resolve(BootstrapService).get(ctx, w);
        const want = (k: string) => !include || include.includes(k as never);
        const paths = pathIndex(b.goals);
        const activeLeaves = b.goals.filter((g) => g.isActive);
        return ok({
          week: weekOut(w),
          week_history_weeks: b.weekHistoryWeeks,
          ...(want('tree') ? { tree: b.goals.map((g) => goalOut(g, paths, b.goals)), outline: outline(b.goals) } : {}),
          active_leaves: activeLeaves.map((g) => ({ id: g.id, path: paths.get(g.id), focus: g.focus })),
          ...(want('tasks') ? { tasks: b.tasks } : {}),
          ...(want('backlog') ? { backlog: b.backlog } : {}),
          ...(want('ideas') ? { ideas: b.ideas } : {}),
          ...(want('learnings') ? { learnings: b.learnings } : {}),
          counts: {
            goals: b.goals.length,
            open_tasks: b.tasks.filter((t) => t.status === 'open').length,
            carrying_tasks: b.tasks.filter((t) => t.status === 'open' && t.carryWeeks >= 1).length,
            backlog: b.backlog.length,
            ideas: b.ideas.length,
            learnings: b.learnings.length,
          },
          server_now: b.serverNow,
        });
      }),
  );

  // ── 2. find_goal ───────────────────────────────────────────────────────────────────────────────
  server.registerTool(
    'find_goal',
    {
      title: 'Resolve a phrase to goal ids',
      description:
        'Turn a phrase the user said ("my fitness goal", "Q3 revenue") into goal ids. Returns ranked candidates with full path, horizon and whether the branch is active this week. ALWAYS call this before any tool that takes a goal_id, unless you already have the id from an earlier result in this conversation. If the result says ambiguous:true, ASK THE USER which one — do not guess. This is the only tool on this surface that matches on text; every mutating tool takes ids only.',
      inputSchema: z
        .object({
          query: z.string().trim().min(1).max(200).describe('Free text, matched against title, why and the full path.'),
          horizon: Horizon.optional().describe('Restrict to one horizon.'),
          only: z
            .enum(['any', 'leaves', 'active_leaves', 'can_hold_backlog', 'life'])
            .default('any')
            .describe(
              'active_leaves = valid task targets; can_hold_backlog = non-Life goals; life = valid Idea/Learning tags.',
            ),
          limit: z.int().min(1).max(20).default(5),
          week_offset: WeekOffsetArg,
        })
        .strict(),
    },
    async ({ query, horizon, only, limit, week_offset }) =>
      guard(async () => {
        const w = week(ctx, week_offset);
        const { goals } = await dc.resolve(GoalService).list(ctx, w);
        const paths = pathIndex(goals);
        const eligible = goals.filter((g) => {
          if (horizon && g.horizon !== horizon) return false;
          if (only === 'leaves') return g.isLeaf && g.parentId !== null;
          if (only === 'active_leaves') return g.isActive;
          if (only === 'can_hold_backlog') return g.parentId !== null;
          if (only === 'life') return g.parentId === null;
          return true;
        });
        const matches = rankGoals(eligible, query, paths);
        return ok({
          matches: matches.slice(0, limit).map((m) => ({
            ...goalOut(m.goal, paths, goals),
            score: m.score,
            matched_on: m.matchedOn,
          })),
          ambiguous: isAmbiguous(matches.slice(0, limit)),
          week: weekOut(w),
          server_now: ctx.now,
        });
      }),
  );

  // ── 3. list_goals ──────────────────────────────────────────────────────────────────────────────
  server.registerTool(
    'list_goals',
    {
      title: 'The goal tree, filterable',
      description:
        'The goal tree, filterable. Use get_overview for a first look; use this to answer narrow questions like "which branches are dormant" or "which goals hold backlog". Ordering is depth-first, parents before children.',
      inputSchema: z
        .object({
          week_offset: WeekOffsetArg,
          horizon: Horizon.optional(),
          state: z.enum(['all', 'active', 'dormant', 'leaves', 'has_backlog']).default('all'),
          under_goal_id: Ulid.optional().describe("Restrict to that goal's subtree, including the goal itself."),
          format: z.enum(['outline', 'flat']).default('outline'),
        })
        .strict(),
    },
    async ({ week_offset, horizon, state, under_goal_id, format }) =>
      guard(async () => {
        const w = week(ctx, week_offset);
        const { goals } = await dc.resolve(GoalService).list(ctx, w);
        const paths = pathIndex(goals);
        const scope = under_goal_id ? subtreeIds(goals, under_goal_id) : null;
        const filtered = goals.filter((g) => {
          if (scope && !scope.has(g.id)) return false;
          if (horizon && g.horizon !== horizon) return false;
          if (state === 'active') return g.isActive;
          if (state === 'dormant') return g.dormant;
          if (state === 'leaves') return g.isLeaf;
          if (state === 'has_backlog') return g.backlogCount > 0;
          return true;
        });
        return ok({
          goals: filtered.map((g) => goalOut(g, paths, goals)),
          ...(format === 'outline' ? { outline: outline(filtered) } : {}),
          week: weekOut(w),
          server_now: ctx.now,
        });
      }),
  );

  // ── 4. get_goal ────────────────────────────────────────────────────────────────────────────────
  server.registerTool(
    'get_goal',
    {
      title: 'One goal in full',
      description:
        'One goal in full: breadcrumb path, children with their active/dormant state, its backlog, the learnings attached to its Life line, and the periods it could be re-planned to. IMPORTANT: when backlog_is_aggregate is true the goal is a Life goal and its backlog list is a READ-ONLY roll-up of every descendant\'s items — those ids must not be passed to move_backlog_item or delete_backlog_item as if they were this goal\'s own. Pass one of replan_options to replan_goal rather than inventing a period string.',
      inputSchema: z.object({ goal_id: Ulid, week_offset: WeekOffsetArg }).strict(),
    },
    async ({ goal_id, week_offset }) =>
      guard(async () => {
        const w = week(ctx, week_offset);
        const [detail, all] = await Promise.all([
          dc.resolve(GoalService).detail(ctx, goal_id, w),
          dc.resolve(GoalService).list(ctx, w),
        ]);
        const paths = pathIndex(all.goals);
        return ok({
          goal: goalOut(detail.goal, paths, all.goals),
          ancestors: detail.ancestors.map((g) => goalOut(g, paths, all.goals)),
          children: detail.children.map((g) => goalOut(g, paths, all.goals)),
          backlog: detail.backlog,
          backlog_is_aggregate: detail.backlogIsAggregate,
          learnings: detail.learnings,
          replan_options: detail.replanOptions,
          week: weekOut(w),
          server_now: detail.serverNow,
        });
      }),
  );

  // ── 5. preview_goal_deletion ───────────────────────────────────────────────────────────────────
  server.registerTool(
    'preview_goal_deletion',
    {
      title: 'What deleting this goal would destroy',
      description:
        'Read-only. Returns exactly what deleting this goal would destroy: the sub-goals, weekly focuses, tasks (with their activity timelines) and backlog items in its whole subtree, plus the ideas and learnings that would fall back to "Unsorted". Nothing is written. It answers for LEAF goals too, which is the case that matters most — a leaf carrying forty open tasks deletes with no warning from the API itself. Show these numbers to the user and get their agreement before calling delete_goal.',
      inputSchema: z.object({ goal_id: Ulid }).strict(),
    },
    async ({ goal_id }) =>
      guard(async () => {
        const w = week(ctx, 0);
        const [preview, all] = await Promise.all([
          dc.resolve(GoalService).remove(ctx, goal_id, { cascade: false, dryRun: true }),
          dc.resolve(GoalService).list(ctx, w),
        ]);
        const paths = pathIndex(all.goals);
        const subtree = [...subtreeIds(all.goals, goal_id)];
        const self = all.goals.find((g) => g.id === goal_id);
        return ok({
          goal: self ? { id: self.id, title: self.title, path: paths.get(self.id), horizon: self.horizon } : null,
          would_remove: {
            goals: preview.removed.goals,
            weekly_focuses: preview.removed.weeklyFocuses,
            tasks: preview.removed.tasks,
            task_events: preview.removed.taskEvents,
            backlog_items: preview.removed.backlogItems,
          },
          would_untag: { ideas: preview.untagged.ideas, learnings: preview.untagged.learnings },
          subtree: all.goals
            .filter((g) => subtree.includes(g.id))
            .map((g) => ({ id: g.id, title: g.title, path: paths.get(g.id), horizon: g.horizon, backlog_items: g.backlogCount })),
          requires_cascade: subtree.length > 1,
          server_now: preview.serverNow,
        });
      }),
  );

  // ── 6. create_goal ─────────────────────────────────────────────────────────────────────────────
  server.registerTool(
    'create_goal',
    {
      title: 'Create a goal',
      description:
        "Create a goal. Horizons nest Life › Yearly › Quarterly › Monthly and a child's horizon must be strictly SHORTER than its parent's. Life goals have no parent and no period; every other horizon needs a parent. Monthly goals can never have sub-goals, so a Monthly parent is always refused. Omit period to let the server derive it from the horizon and today. Whitespace-only titles are refused, not trimmed to empty.",
      inputSchema: z
        .object({
          title: Title,
          horizon: Horizon,
          parent_id: Ulid.nullable().describe('null ONLY for a Life goal. Otherwise a goal of strictly longer horizon.'),
          why: OneLiner.default(''),
          period: Period.optional().describe('e.g. "2026", "Q4 2026", "Sep 2026". Must be omitted for a Life goal.'),
          pulse: Pulse.default('On track'),
        })
        .strict(),
    },
    async (args) =>
      guard(async () => {
        stampIdempotencyKey(deps);
        const input = {
          title: args.title,
          why: args.why,
          horizon: args.horizon,
          parentId: args.parent_id,
          ...(args.period !== undefined ? { period: args.period } : {}),
          pulse: args.pulse,
        };
        // The SAME guard `POST /goals` runs, and it runs BEFORE the service — the service deliberately
        // does not re-check the tree rules, so skipping this would skip R-goal-3/4/5/6/28 entirely.
        await dc.resolve(GoalTreeGuard).assertCanCreate(ctx, input);
        const res = await dc.resolve(GoalService).create(ctx, input);
        return ok(await withPath(deps, res.goal, res.serverNow));
      }),
  );

  // ── 7. update_goal ─────────────────────────────────────────────────────────────────────────────
  server.registerTool(
    'update_goal',
    {
      title: "Edit a goal's card",
      description:
        "Edit a goal's title, motivation, target period and pulse. Horizon and parent are NOT editable here — use move_goal to re-parent and replan_goal to change the period. At least one field must be given. Setting a period on a Life goal is refused: Life goals have no target period.",
      inputSchema: z
        .object({
          goal_id: Ulid,
          title: Title.optional(),
          why: OneLiner.optional(),
          period: Period.optional(),
          pulse: Pulse.optional(),
        })
        .strict(),
    },
    async ({ goal_id, ...patch }) =>
      guard(async () => {
        stampIdempotencyKey(deps);
        const res = await dc.resolve(GoalService).patch(ctx, goal_id, patch);
        return ok(await withPath(deps, res.goal, res.serverNow));
      }),
  );

  // ── 8. move_goal ───────────────────────────────────────────────────────────────────────────────
  server.registerTool(
    'move_goal',
    {
      title: 'Re-parent a goal',
      description:
        "Re-parent a goal. Its children move with it and its own horizon does not change. The new parent must have a LONGER horizon and must not be the goal itself or any of its descendants — a goal cannot move under its own child. Life goals cannot be moved at all. Read the returned new_path back to the user.",
      inputSchema: z.object({ goal_id: Ulid, new_parent_id: Ulid }).strict(),
    },
    async ({ goal_id, new_parent_id }) =>
      guard(async () => {
        stampIdempotencyKey(deps);
        // R-goal-19 — the descendant check must win over the horizon check, and only the guard runs
        // them in that order. The service does not re-check either.
        await dc.resolve(GoalTreeGuard).assertCanMove(ctx, goal_id, new_parent_id);
        const res = await dc.resolve(GoalService).move(ctx, goal_id, { parentId: new_parent_id });
        const after = await dc.resolve(GoalService).list(ctx, week(ctx, 0));
        const paths = pathIndex(after.goals);
        return ok({
          goal: goalOut(res.goal, paths, after.goals),
          new_path: paths.get(res.goal.id),
          moved_descendants: subtreeIds(after.goals, res.goal.id).size - 1,
          server_now: res.serverNow,
        });
      }),
  );

  // ── 9. replan_goal ─────────────────────────────────────────────────────────────────────────────
  server.registerTool(
    'replan_goal',
    {
      title: 'Move a goal to a later period',
      description:
        "Move a goal to a later target period — the product's only \"push\". Pass one of the replan_options from get_goal rather than inventing a period string; the options are derived server-side from today and this goal's horizon. The period must differ from the current one. The reason is OPTIONAL and the product deliberately never demands one — pass only what the user actually said, never an invented reason. Life goals cannot be re-planned.",
      inputSchema: z
        .object({ goal_id: Ulid, period: Period, reason: Reason.optional() })
        .strict(),
    },
    async ({ goal_id, period, reason }) =>
      guard(async () => {
        stampIdempotencyKey(deps);
        const before = await dc.resolve(GoalService).detail(ctx, goal_id, week(ctx, 0));
        const res = await dc
          .resolve(GoalService)
          .replan(ctx, goal_id, { period, ...(reason !== undefined ? { reason } : {}) });
        return ok({ ...(await withPath(deps, res.goal, res.serverNow)), previous_period: before.goal.period });
      }),
  );

  // ── 10. delete_goal ────────────────────────────────────────────────────────────────────────────
  server.registerTool(
    'delete_goal',
    {
      title: 'Delete a goal and its whole subtree',
      description:
        'DESTRUCTIVE AND PERMANENT. Deletes this goal AND its entire subtree: every sub-goal, weekly focus, task (with its activity timeline) and backlog item below it. Ideas and learnings tagged to anything deleted fall back to "Unsorted". There is no undo and no trash. Call preview_goal_deletion first, repeat its counts to the user, and get their explicit agreement before calling this. cascade must be true when the goal has descendants; without it the call is refused with the counts, which IS the confirmation step.',
      inputSchema: z
        .object({
          goal_id: Ulid,
          cascade: z
            .boolean()
            .default(false)
            .describe('Required (true) when the goal has sub-goals. Acknowledges the whole-subtree delete.'),
        })
        .strict(),
    },
    async ({ goal_id, cascade }) =>
      guard(async () => {
        stampIdempotencyKey(deps);
        const res = await dc.resolve(GoalService).remove(ctx, goal_id, { cascade });
        return ok({
          deleted: res.deleted,
          removed: {
            goals: res.removed.goals,
            weekly_focuses: res.removed.weeklyFocuses,
            tasks: res.removed.tasks,
            task_events: res.removed.taskEvents,
            backlog_items: res.removed.backlogItems,
          },
          untagged: res.untagged,
          server_now: res.serverNow,
        });
      }),
  );
}

/** A goal result with its breadcrumb attached — the form an agent can read back to the user. */
async function withPath(deps: McpDeps, goal: GoalView, serverNow: string) {
  const all = await deps.dc.resolve(GoalService).list(deps.ctx, week(deps.ctx, 0));
  const paths = pathIndex(all.goals);
  return { goal: goalOut(goal, paths, all.goals), server_now: serverNow };
}
