import { MAX_PLAN_ENTRIES, Sentence, Ulid, WeekOffset, WeekStart } from '@goal-cascade/shared';
import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { GoalService, PlanService, TaskService } from '../../../application/services';
import { guard } from '../errors';
import { ok, pathIndex, requireGoal, stampIdempotencyKey, week, weekOut, type McpDeps } from '../shapes';

/**
 * The weekly plan — the subtlest object on this surface.
 *
 * `PUT /plan` is a whole-week ATOMIC REPLACE: every non-Life leaf named with a non-empty sentence gets a
 * focus, and every leaf NOT named loses its focus (R-plan-7). An agent that builds `entries` from a
 * partial mental model silently deactivates branches and reports "plan saved".
 *
 * Hence three tools rather than one: the faithful primitive, plus two intent-shaped wrappers that
 * read-modify-write around it so a single-branch change cannot touch anything else. The wrappers are
 * what an agent should reach for; `save_weekly_plan`'s own description says so.
 */
export function registerPlanTools(server: McpServer, deps: McpDeps): void {
  const { dc, ctx } = deps;

  server.registerTool(
    'get_weekly_plan',
    {
      title: 'The focus sentences for one week',
      description:
        'The focus sentences for one week — which branches are active and what each one says, plus the non-Life leaves that are dormant. Past weeks render their own sentences; only the current week is editable. The week_start in this response is exactly what save_weekly_plan requires.',
      inputSchema: z.object({ week_offset: WeekOffset.default(0) }).strict(),
    },
    async ({ week_offset }) =>
      guard(async () => {
        const w = week(ctx, week_offset);
        const [plan, tree] = await Promise.all([
          dc.resolve(PlanService).get(ctx, w),
          dc.resolve(GoalService).list(ctx, w),
        ]);
        const paths = pathIndex(tree.goals);
        return ok({
          week: weekOut(w),
          entries: plan.entries.map((e) => ({
            id: e.id,
            goal_id: e.goalId,
            goal_path: paths.get(e.goalId),
            week_start: e.weekStart,
            sentence: e.sentence,
            created_at: e.createdAt,
            updated_at: e.updatedAt,
          })),
          dormant_leaves: tree.goals.filter((g) => g.dormant).map((g) => ({ id: g.id, path: paths.get(g.id) })),
          editable: w.isCurrent,
          server_now: plan.serverNow,
        });
      }),
  );

  server.registerTool(
    'set_goal_focus',
    {
      title: 'Activate one branch for this week',
      description:
        'PREFERRED for a single branch. Activates one branch for THIS week by giving it a focus sentence, or replaces the sentence it already has. Every other branch keeps its focus untouched. The goal must be a non-Life LEAF. A blank sentence does not activate anything — the sentence is the only thing that makes a branch active. Only the current week can be planned. Use this instead of save_weekly_plan unless you are deliberately replanning the whole week.',
      inputSchema: z.object({ goal_id: Ulid, sentence: Sentence.min(1) }).strict(),
    },
    async ({ goal_id, sentence }) =>
      guard(async () => {
        stampIdempotencyKey(deps);
        const w = week(ctx, 0);
        const current = await dc.resolve(PlanService).get(ctx, w);
        // Read-modify-write around the atomic replace: every existing entry is carried through
        // unchanged, so nothing outside this one goal can go dormant as a side effect.
        const entries = current.entries.map((e) => ({ goalId: e.goalId, sentence: e.sentence }));
        const existing = entries.find((e) => e.goalId === goal_id);
        if (existing) existing.sentence = sentence;
        else entries.push({ goalId: goal_id, sentence });

        const saved = await dc.resolve(PlanService).save(ctx, { weekStart: w.weekStart, entries });
        return ok({ week: weekOut(w), entries: saved.entries, activated: true, server_now: saved.serverNow });
      }),
  );

  server.registerTool(
    'clear_goal_focus',
    {
      title: 'Make one branch dormant this week',
      description:
        'Makes one branch dormant for THIS week by removing its focus sentence. Its open tasks are NOT deleted — they stay visible and keep carrying, and the response tells you how many. Every other branch is untouched. Dormant is a normal, intentional state, not a fault.',
      inputSchema: z.object({ goal_id: Ulid }).strict(),
    },
    async ({ goal_id }) =>
      guard(async () => {
        stampIdempotencyKey(deps);
        const w = week(ctx, 0);
        // Clearing REMOVES an entry, so `PlanService.save` never sees this id and never validates it —
        // unlike set_goal_focus, which adds one. Without this the tool answers `cleared: true` for a
        // goal that does not exist, or belongs to someone else, and writes A's plan back for nothing.
        const tree = await dc.resolve(GoalService).list(ctx, w);
        requireGoal(tree.goals, goal_id);
        const current = await dc.resolve(PlanService).get(ctx, w);
        const entries = current.entries
          .filter((e) => e.goalId !== goal_id)
          .map((e) => ({ goalId: e.goalId, sentence: e.sentence }));

        const saved = await dc.resolve(PlanService).save(ctx, { weekStart: w.weekStart, entries });
        // R-plan-6 / R-task-9 — clearing a focus never touches tasks. Counting them here is the honest
        // way to say so, rather than asserting it in prose the agent has to believe.
        const tasks = await dc.resolve(TaskService).list(ctx, { weekStart: w.weekStart, goalId: goal_id });
        return ok({
          week: weekOut(w),
          entries: saved.entries,
          cleared: true,
          open_tasks_kept: tasks.tasks.filter((t) => t.status === 'open').length,
          server_now: saved.serverNow,
        });
      }),
  );

  server.registerTool(
    'save_weekly_plan',
    {
      title: "Replace the whole week's plan",
      description:
        'WHOLE-WEEK REPLACE. Every leaf you list with a sentence becomes active; EVERY non-Life leaf you leave out becomes DORMANT, in the same write, silently. Only use this when you are deliberately planning the whole week and you have JUST called get_weekly_plan — for a single branch use set_goal_focus or clear_goal_focus instead. week_start must be taken verbatim from a get_weekly_plan or get_overview response in this same session: sending it explicitly is what makes a save that crossed a Monday boundary fail loudly instead of writing into last week. Only the current week can be planned, and a save naming any other week is refused wholesale — nothing is partially applied. Every goal_id must be a non-Life leaf; duplicates are refused; an entry with a blank sentence is a clear.',
      inputSchema: z
        .object({
          week_start: WeekStart.describe('YYYY-MM-DD, a Monday, and the CURRENT week. Take it from a read you just did.'),
          entries: z
            .array(z.object({ goal_id: Ulid, sentence: Sentence }).strict())
            .max(MAX_PLAN_ENTRIES)
            .describe('The COMPLETE set of active branches for the week. Anything omitted goes dormant.'),
        })
        .strict(),
    },
    async ({ week_start, entries }) =>
      guard(async () => {
        stampIdempotencyKey(deps);
        const w = week(ctx, 0);
        const before = await dc.resolve(PlanService).get(ctx, w);
        const saved = await dc
          .resolve(PlanService)
          .save(ctx, { weekStart: week_start, entries: entries.map((e) => ({ goalId: e.goal_id, sentence: e.sentence })) });

        const tree = await dc.resolve(GoalService).list(ctx, w);
        const paths = pathIndex(tree.goals);
        const wasActive = new Set(before.entries.map((e) => e.goalId));
        const nowActive = new Set(saved.entries.map((e) => e.goalId));
        // Reported rather than gated. The design recommended a mandatory `confirm_deactivations` count;
        // the owner chose no guardrails, so the deactivation list is surfaced AFTER the fact instead —
        // the agent can still tell the user exactly which branches it stood down.
        return ok({
          week: weekOut(w),
          entries: saved.entries,
          activated: [...nowActive].filter((id) => !wasActive.has(id)).map((id) => ({ id, path: paths.get(id) })),
          deactivated: [...wasActive].filter((id) => !nowActive.has(id)).map((id) => ({ id, path: paths.get(id) })),
          server_now: saved.serverNow,
        });
      }),
  );
}
