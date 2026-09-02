import {
  Horizon,
  OneLiner,
  PeriodKey,
  Pulse,
  Reason,
  Title,
  Ulid,
  WeekOffset,
  WeekStart,
  isAmbiguous,
  isPeriodKeyFor,
  rankGoals,
} from '@goal-cascade/shared';
import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { BootstrapService, GoalService, GoalTreeGuard } from '../../../application/services';
import { guard } from '../errors';
import { goalOut, lensOutline, ok, stampIdempotencyKey, week, weekOut, type McpDeps } from '../shapes';

/**
 * The week input every week-scoped read tool shares. `WeekOffset` is the repo's own schema, reused
 * verbatim — zod 4.5 exposes `~standard.jsonSchema`, so the SDK advertises it without a conversion step
 * and the bound cannot drift from the API's.
 *
 * ⚠ **A2 (R-lens-7)** — that bound is now `±520`, the absolute storage range. A positive offset is
 * ordinary: any future period is reachable and writable.
 */
const WeekOffsetArg = WeekOffset.default(0);

/**
 * R-goal-33 — a canonical period key.
 *
 * The SHAPE is a `.refine()`, which zod → JSON Schema drops, so the model can only learn it from the
 * prose. Every field that takes one therefore names all four shapes in its own description — a
 * `.describe()` on the field REPLACES this one rather than appending to it, which is exactly the kind of
 * silent loss the refinement test exists to catch.
 */
const PERIOD_KEY_SHAPES = '2026 (Yearly) | 2026-Q3 (Quarterly) | 2026-09 (Monthly) | a Monday 2026-09-07 (Weekly)';
const PeriodKeyArg = PeriodKey.describe(PERIOD_KEY_SHAPES);

/**
 * R-goal-34 — a period as the surface shapes it: the canonical key AND its rendered label.
 *
 * ⚠ **A4 (R-lens-28, R-lens-29)** — `week_range` and `current_week_period` are here for the reason the
 * owner hit them in the UI: an agent reasoning about "September" faces exactly the ambiguity the label
 * created, and would otherwise conclude a lens is broken, or plan this week's work into a month that
 * does not contain this week. The label alone was the whole answer and it was not enough.
 */
function periodOut(p: {
  periodKey: string;
  label: string;
  isCurrent: boolean;
  isPast: boolean;
  hasWork: boolean;
  weekRange: string;
  currentWeekPeriod: { periodKey: string; label: string } | null;
}) {
  return {
    period_key: p.periodKey,
    label: p.label,
    is_current: p.isCurrent,
    is_past: p.isPast,
    has_work: p.hasWork,
    week_range: p.weekRange,
    current_week_period: p.currentWeekPeriod && { period_key: p.currentWeekPeriod.periodKey, label: p.currentWeekPeriod.label },
  };
}

export function registerGoalTools(server: McpServer, deps: McpDeps): void {
  const { dc, ctx } = deps;

  // ── 1. get_overview ────────────────────────────────────────────────────────────────────────────
  server.registerTool(
    'get_overview',
    {
      title: 'Overview of the whole account',
      description:
        'Start here. Returns the owner\'s life goals, THIS WEEK\'s lens — the weekly goals written for this week, the ones still carrying open work from earlier weeks, and every task visible in the week — plus the backlog, the learnings, and counts. One call is enough to answer "what is this person working on". It is deliberately NOT the whole goal tree: reading is by lens (list_lens), one horizon and one period at a time.',
      inputSchema: z
        .object({
          include: z
            .array(z.enum(['lens', 'tasks', 'backlog', 'learnings']))
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
        return ok({
          week: weekOut(w),
          life_goals: b.lifeGoals.map(goalOut),
          ...(want('lens')
            ? {
                weekly_lens: {
                  groups: b.lens.groups.map((g) => ({ id: g.id, title: g.title, open_tasks: g.openTasks })),
                  this_week: b.lens.items.map(goalOut),
                  // R-lens-12 — goals whose own week has passed but whose open work carries into this
                  // one. They are a SEPARATE band on purpose: never this week's plan, and never a
                  // `+ Task` target (adding new work to a past week's goal would be back-dating).
                  carried: b.lens.carried.map(goalOut),
                  outline: lensOutline(b.lens.groups, [...b.lens.items, ...b.lens.carried]),
                  has_forward_content: b.lens.hasForwardContent,
                },
              }
            : {}),
          ...(want('tasks') ? { tasks: b.lens.tasks } : {}),
          ...(want('backlog') ? { backlog: b.backlog } : {}),
          ...(want('learnings') ? { learnings: b.learnings } : {}),
          counts: {
            life_goals: b.lifeGoals.length,
            weekly_goals_this_week: b.lens.items.length,
            carried_weekly_goals: b.lens.carried.length,
            open_tasks: b.lens.tasks.filter((t) => t.status === 'open').length,
            carrying_tasks: b.lens.tasks.filter((t) => t.status === 'open' && t.carryAge >= 1).length,
            backlog: b.backlog.length,
            learnings: b.learnings.length,
          },
          server_now: b.serverNow,
        });
      }),
  );

  // ── 2. list_lens ───────────────────────────────────────────────────────────────────────────────
  server.registerTool(
    'list_lens',
    {
      title: 'One horizon, one period',
      description:
        'The main read. Every goal at ONE horizon in ONE period, from all life lines, grouped under the life goal each belongs to. This is how the product is navigated — there is no whole-tree read and no filter, because grouping already answers "just this line". Omit period for the current one. The Life lens has no period: it is simply all of them. On the Weekly lens the result also carries `carried` (goals whose own week has passed but whose open work carries into this one, oldest first) and `tasks`. `has_forward_content` says whether any later period holds anything. READ `period.week_range` BEFORE REASONING ABOUT DATES: a period is the whole weeks it contains, so `Sep 2026` is `Mon 7 Sep – Sun 4 Oct` and not 1–30 September. When `period.current_week_period` is present, the week happening right now belongs to THAT period, not this one — say so rather than reporting this period as empty of current work.',
      inputSchema: z
        .object({
          lens: Horizon.default('Weekly').describe('Life | Yearly | Quarterly | Monthly | Weekly.'),
          period: PeriodKeyArg.optional().describe(`Omit for the current period of that horizon. Shapes: ${PERIOD_KEY_SHAPES}.`),
          cursor: z.string().max(64).optional().describe('From a previous result’s next_cursor.'),
          limit: z.int().min(1).max(200).optional(),
        })
        .strict(),
    },
    async ({ lens, period, cursor, limit }) =>
      guard(async () => {
        // R-lens-14 — an unparseable period falls back to the current one rather than erroring, so a
        // stale link lands somewhere real. Refusing it here would be a second rule.
        const usable = period !== undefined && isPeriodKeyFor(lens, period) ? period : undefined;
        const res = await dc.resolve(GoalService).lens(ctx, {
          lens,
          ...(usable !== undefined ? { period: usable } : {}),
          ...(cursor !== undefined ? { cursor } : {}),
          ...(limit !== undefined ? { limit } : {}),
        });
        return ok({
          lens: res.lens,
          period: res.period ? periodOut(res.period) : null,
          groups: res.groups.map((g) => ({ id: g.id, title: g.title, pulse: g.pulse, open_tasks: g.openTasks })),
          items: res.items.map(goalOut),
          carried: res.carried.map(goalOut),
          tasks: res.tasks,
          outline: lensOutline(res.groups, [...res.items, ...res.carried]),
          next_cursor: res.nextCursor,
          has_forward_content: res.hasForwardContent,
          server_now: res.serverNow,
        });
      }),
  );

  // ── 3. get_period ──────────────────────────────────────────────────────────────────────────────
  server.registerTool(
    'get_period',
    {
      title: 'The current period at every horizon',
      description:
        'For an anchor date (default: the server\'s today in the owner\'s timezone), the period each of the five horizons would land on, with how many goals are there and the whole weeks each one spans (`week_range`). Use it to turn "this quarter" or "next month" into the canonical period key the other tools take — never compute a period from your own clock, and never construct a key by hand. Quote `week_range`, not the label alone, whenever the dates matter: a period is the whole weeks it contains, so on 1 Sep 2026 the Monthly row is `Sep 2026` spanning `Mon 7 Sep – Sun 4 Oct` while the week in progress belongs to `Aug 2026`.',
      inputSchema: z.object({ anchor: z.iso.date().optional().describe('YYYY-MM-DD. Omit for today.') }).strict(),
    },
    async ({ anchor }) =>
      guard(async () => {
        const res = await dc.resolve(GoalService).zoom(ctx, anchor);
        return ok({
          anchor: res.anchor,
          periods: res.rows.map((r) => ({
            lens: r.lens,
            period_key: r.periodKey,
            label: r.label,
            // R-lens-28 — the whole weeks that period contains. `Sep 2026` is NOT 1–30 September.
            week_range: r.weekRange,
            goals: r.count,
            is_current: r.isCurrent,
          })),
          server_now: res.serverNow,
        });
      }),
  );

  // ── 4. find_goal ───────────────────────────────────────────────────────────────────────────────
  server.registerTool(
    'find_goal',
    {
      title: 'Resolve a phrase to goal ids',
      description:
        'Turn a phrase the user said ("my fitness goal", "Q3 revenue") into goal ids. Returns ranked candidates with horizon, period and whether the goal is WEEKLY — which is the only thing that decides whether it can hold a task. ALWAYS call this before any tool that takes a goal_id, unless you already have the id from an earlier result in this conversation. If the result says ambiguous:true, ASK THE USER which one — do not guess. This is the only tool on this surface that matches on text; every mutating tool takes ids only. It searches ONE lens at a time, because that is how the data is read.',
      inputSchema: z
        .object({
          query: z.string().trim().min(1).max(200).describe('Free text, matched against title and why.'),
          lens: Horizon.default('Weekly').describe('Which horizon to search.'),
          period: PeriodKeyArg.optional().describe(`Omit for the current period of that horizon. Shapes: ${PERIOD_KEY_SHAPES}.`),
          only: z
            .enum(['any', 'weekly', 'can_hold_backlog', 'life'])
            .default('any')
            .describe('weekly = valid task targets; can_hold_backlog = Yearly/Quarterly/Monthly; life = valid Learning tags.'),
          limit: z.int().min(1).max(20).default(5),
        })
        .strict(),
    },
    async ({ query, lens, period, only, limit }) =>
      guard(async () => {
        const usable = period !== undefined && isPeriodKeyFor(lens, period) ? period : undefined;
        const res = await dc.resolve(GoalService).lens(ctx, { lens, ...(usable !== undefined ? { period: usable } : {}), limit: 200 });
        const pool = [...res.items, ...res.carried];
        const eligible = pool.filter((g) => {
          // ⚠ **A2** — `only: 'active_leaves'` and `only: 'leaves'` are DELETED (R-rm-2). "Leaf" is
          // retired as a product word, and a childless Monthly goal is a leaf that must never hold work.
          if (only === 'weekly') return g.horizon === 'Weekly';
          if (only === 'can_hold_backlog') return g.horizon !== 'Life' && g.horizon !== 'Weekly';
          if (only === 'life') return g.horizon === 'Life';
          return true;
        });
        const matches = rankGoals(eligible, query);
        return ok({
          matches: matches.slice(0, limit).map((m) => ({ ...goalOut(m.goal), score: m.score, matched_on: m.matchedOn })),
          ambiguous: isAmbiguous(matches.slice(0, limit)),
          lens: res.lens,
          period: res.period,
          server_now: ctx.now,
        });
      }),
  );

  // ── 5. get_goal ────────────────────────────────────────────────────────────────────────────────
  server.registerTool(
    'get_goal',
    {
      title: 'One goal in full',
      description:
        'One goal in full: its ancestors with their periods, its children, its backlog, the learnings attached to its life line, and the periods it could be re-planned to. On a WEEKLY goal it also carries its tasks and `pull_list` — the backlog items sitting on the goals ABOVE it, ready to pull in — and its own backlog is always empty, because a weekly goal holds none. IMPORTANT: when backlog_is_aggregate is true the goal is a life goal and its backlog list is a READ-ONLY roll-up of every descendant\'s items; those ids must not be passed to move_backlog_item or delete_backlog_item as if they were this goal\'s own. Pass one of replan_options to replan_goal rather than inventing a period key. `children` is the only way to tell whether a goal has any — there is no is_leaf field, on purpose.',
      inputSchema: z.object({ goal_id: Ulid }).strict(),
    },
    async ({ goal_id }) =>
      guard(async () => {
        const detail = await dc.resolve(GoalService).detail(ctx, goal_id);
        return ok({
          goal: goalOut(detail.goal),
          ancestors: detail.ancestors.map(goalOut),
          children: detail.children.map(goalOut),
          backlog: detail.backlog,
          backlog_is_aggregate: detail.backlogIsAggregate,
          pull_list: detail.pullList,
          tasks: detail.tasks,
          learnings: detail.learnings,
          replan_options: detail.replanOptions.map((p) => ({ period_key: p.periodKey, label: p.label })),
          server_now: detail.serverNow,
        });
      }),
  );

  // ── 6. preview_goal_deletion ───────────────────────────────────────────────────────────────────
  server.registerTool(
    'preview_goal_deletion',
    {
      title: 'What deleting this goal would destroy',
      description:
        'Read-only. Returns exactly what deleting this goal would destroy: the sub-goals — of which `weekly_goals` are weeks of intention — the tasks with their activity timelines, and the backlog items in its whole subtree, plus the learnings that would fall back to "Unsorted". Nothing is written. Deleting a MONTHLY goal takes every weekly goal under it and all of their tasks, so these numbers can be large. It answers for childless goals too, which is the case that matters most — a weekly goal carrying forty open tasks deletes with no warning from the API itself. Show these numbers to the user and get their agreement before calling delete_goal.',
      inputSchema: z.object({ goal_id: Ulid }).strict(),
    },
    async ({ goal_id }) =>
      guard(async () => {
        const [preview, detail] = await Promise.all([
          dc.resolve(GoalService).remove(ctx, goal_id, { cascade: false, dryRun: true }),
          dc.resolve(GoalService).detail(ctx, goal_id),
        ]);
        return ok({
          goal: { id: detail.goal.id, title: detail.goal.title, horizon: detail.goal.horizon, period: detail.goal.period },
          would_remove: {
            goals: preview.removed.goals,
            weekly_goals: preview.removed.weeklyGoals,
            tasks: preview.removed.tasks,
            task_events: preview.removed.taskEvents,
            backlog_items: preview.removed.backlogItems,
          },
          would_untag: { learnings: preview.untagged.learnings },
          requires_cascade: preview.removed.goals > 1,
          server_now: preview.serverNow,
        });
      }),
  );

  // ── 7. create_goal ─────────────────────────────────────────────────────────────────────────────
  server.registerTool(
    'create_goal',
    {
      title: 'Create a goal',
      description:
        "Create a goal at any of the five horizons. They nest Life › Yearly › Quarterly › Monthly › WEEKLY and a child's horizon must be strictly SHORTER than its parent's, so WEEKLY goals can never have sub-goals and a weekly parent is always refused. Levels may be SKIPPED: a weekly goal may hang off a monthly, quarterly, yearly or life goal, and none of those is an error. Life goals have no parent and no period; every other horizon needs a parent. Omit period_key to let the server derive the current period for that horizon — never construct one from your own clock. A period earlier than the current one is refused with PERIOD_IN_PAST; there is no limit in the other direction. Whitespace-only titles are refused, not trimmed to empty.",
      inputSchema: z
        .object({
          title: Title,
          horizon: Horizon,
          parent_id: Ulid.nullable().describe('null ONLY for a Life goal. Otherwise a goal of strictly longer horizon.'),
          why: OneLiner.default(''),
          period_key: PeriodKeyArg.optional().describe(`Must be omitted for a Life goal, and must match the horizon: ${PERIOD_KEY_SHAPES}.`),
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
          ...(args.period_key !== undefined ? { periodKey: args.period_key } : {}),
          pulse: args.pulse,
        };
        // The SAME guard `POST /goals` runs, and it runs BEFORE the service — the service deliberately
        // does not re-check the tree rules, so skipping this would skip R-goal-3/4/5/31/32 entirely.
        await dc.resolve(GoalTreeGuard).assertCanCreate(ctx, input);
        const res = await dc.resolve(GoalService).create(ctx, input);
        return ok({ goal: goalOut(res.goal), server_now: res.serverNow });
      }),
  );

  // ── 8. update_goal ─────────────────────────────────────────────────────────────────────────────
  server.registerTool(
    'update_goal',
    {
      title: "Edit a goal's card",
      description:
        "Edit a goal's title, motivation, period and pulse. Horizon and parent are NOT editable here — use move_goal to re-parent and replan_goal to change the period. At least one field must be given. Setting a period on a Life goal is refused (it has none), and setting one on a WEEKLY goal is refused outright: a weekly goal IS a week, and moving it would restate what a past week held. A period earlier than the current one is refused with PERIOD_IN_PAST.",
      inputSchema: z
        .object({
          goal_id: Ulid,
          title: Title.optional(),
          why: OneLiner.optional(),
          period_key: PeriodKeyArg.optional(),
          pulse: Pulse.optional(),
        })
        .strict(),
    },
    async ({ goal_id, period_key, ...patch }) =>
      guard(async () => {
        stampIdempotencyKey(deps);
        const res = await dc
          .resolve(GoalService)
          .patch(ctx, goal_id, { ...patch, ...(period_key !== undefined ? { periodKey: period_key } : {}) });
        return ok({ goal: goalOut(res.goal), server_now: res.serverNow });
      }),
  );

  // ── 9. move_goal ───────────────────────────────────────────────────────────────────────────────
  server.registerTool(
    'move_goal',
    {
      title: 'Re-parent a goal',
      description:
        "Re-parent a goal. Its children move with it and its own horizon does not change. The new parent must have a LONGER horizon and must not be the goal itself or any of its descendants — a goal cannot move under its own child. Life goals cannot be moved at all. A WEEKLY goal CAN be moved: that corrects which intention a week served, and it never changes the goal's week or any of its tasks' weeks.",
      inputSchema: z.object({ goal_id: Ulid, new_parent_id: Ulid }).strict(),
    },
    async ({ goal_id, new_parent_id }) =>
      guard(async () => {
        stampIdempotencyKey(deps);
        // R-goal-19 — the descendant check must win over the horizon check, and only the guard runs
        // them in that order. The service does not re-check either.
        await dc.resolve(GoalTreeGuard).assertCanMove(ctx, goal_id, new_parent_id);
        const res = await dc.resolve(GoalService).move(ctx, goal_id, { parentId: new_parent_id });
        return ok({ goal: goalOut(res.goal), server_now: res.serverNow });
      }),
  );

  // ── 10. replan_goal ────────────────────────────────────────────────────────────────────────────
  server.registerTool(
    'replan_goal',
    {
      title: 'Move a goal to a later period',
      description:
        "Move a goal to a later period — the product's only \"push\". Pass one of the replan_options from get_goal rather than inventing a period key; the options are derived server-side from today and this goal's horizon. The period must differ from the current one and must not be in the past. The reason is OPTIONAL and the product deliberately never demands one — pass only what the user actually said, never an invented reason. NEITHER a Life goal NOR a WEEKLY goal is re-plannable: a life goal has no period, and a weekly goal is a week. An intention that did not happen carries forward through its open tasks, or is written again as a new weekly goal for the new week — say that rather than trying to move it.",
      inputSchema: z.object({ goal_id: Ulid, period_key: PeriodKeyArg, reason: Reason.optional() }).strict(),
    },
    async ({ goal_id, period_key, reason }) =>
      guard(async () => {
        stampIdempotencyKey(deps);
        const before = await dc.resolve(GoalService).detail(ctx, goal_id);
        const res = await dc
          .resolve(GoalService)
          .replan(ctx, goal_id, { periodKey: period_key, ...(reason !== undefined ? { reason } : {}) });
        return ok({ goal: goalOut(res.goal), previous_period: before.goal.period, server_now: res.serverNow });
      }),
  );

  // ── 11. repeat_last_week ───────────────────────────────────────────────────────────────────────
  server.registerTool(
    'repeat_last_week',
    {
      title: "Copy last week's weekly goals into a week",
      description:
        "Copy the previous week's weekly goals FOR ONE LIFE LINE into the named week as ordinary new goals — same titles and parents, pulse reset to On track, NO tasks copied, and nothing linking a copy to its source. This is deliberately not a recurrence feature: there is no template, no series and no \"detached from the series\" state, and every copy is an ordinary goal that can be edited, moved or deleted. It is per life line, not account-wide, so the owner reviews one line at a time. A past week is refused; an empty previous week creates nothing.",
      inputSchema: z
        .object({ life_goal_id: Ulid, week_start: WeekStart.describe('The Monday to copy INTO.') })
        .strict(),
    },
    async ({ life_goal_id, week_start }) =>
      guard(async () => {
        stampIdempotencyKey(deps);
        const res = await dc.resolve(GoalService).repeatWeek(ctx, { lifeGoalId: life_goal_id, weekStart: week_start });
        return ok({ created: res.created.map(goalOut), count: res.created.length, server_now: res.serverNow });
      }),
  );

  // ── 12. delete_goal ────────────────────────────────────────────────────────────────────────────
  server.registerTool(
    'delete_goal',
    {
      title: 'Delete a goal and its whole subtree',
      description:
        'DESTRUCTIVE AND PERMANENT. Deletes this goal AND its entire subtree: every sub-goal — weekly goals included — every task with its activity timeline, and every backlog item below it. Learnings tagged to anything deleted fall back to "Unsorted". There is no undo and no trash. Call preview_goal_deletion first, repeat its counts to the user, and get their explicit agreement before calling this. cascade must be true when the goal has descendants; without it the call is refused with the counts, which IS the confirmation step.',
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
            weekly_goals: res.removed.weeklyGoals,
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
