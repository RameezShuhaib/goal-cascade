import { LongText, MAX_LINKS, OneLiner, Reason, TaskSource, Title, Ulid, Url, WeekOffset } from '@goal-cascade/shared';
import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { GoalService, TaskService } from '../../../application/services';
import { guard } from '../errors';
import { ok, pathIndex, requireGoal, stampIdempotencyKey, subtreeIds, taskOut, week, weekOut, type McpDeps } from '../shapes';

const WeekOffsetArg = WeekOffset.default(0);

export function registerTaskTools(server: McpServer, deps: McpDeps): void {
  const { dc, ctx } = deps;

  const paths = async (weekStart: { weekStart: string; offset: number; isCurrent: boolean }) =>
    pathIndex((await dc.resolve(GoalService).list(ctx, weekStart)).goals);

  // ── list_tasks ─────────────────────────────────────────────────────────────────────────────────
  server.registerTool(
    'list_tasks',
    {
      title: 'Tasks visible in one week',
      description:
        'The tasks visible in one week, with that week\'s focus sentences. Open tasks appear in EVERY week from the one they were created in onwards — they carry automatically, with no rollover step. Done tasks appear only in the week they were completed. Cancelled and moved-to-backlog tasks appear in no week at all. Carry ages are computed against the week you asked for, not against today. goal_id filters to that EXACT leaf; use under_goal_id to see a whole branch.',
      inputSchema: z
        .object({
          week_offset: WeekOffsetArg,
          goal_id: Ulid.optional().describe('Exact leaf only — this does NOT include a subtree.'),
          under_goal_id: Ulid.optional().describe('The whole subtree at or under this goal.'),
          state: z.enum(['all', 'open', 'done', 'carrying']).default('all').describe('carrying = open with carry_weeks >= 1'),
        })
        .strict(),
    },
    async ({ week_offset, goal_id, under_goal_id, state }) =>
      guard(async () => {
        const w = week(ctx, week_offset);
        const res = await dc.resolve(TaskService).list(ctx, { weekStart: w.weekStart, ...(goal_id ? { goalId: goal_id } : {}) });
        const tree = await dc.resolve(GoalService).list(ctx, w);
        const p = pathIndex(tree.goals);
        // `TaskService.list` FILTERS by goalId rather than resolving it, so an id that belongs to
        // nobody returns an empty list instead of refusing. Resolve it here (R-auth-3 / Q-10).
        if (goal_id) requireGoal(tree.goals, goal_id);
        const scope = under_goal_id ? subtreeIds(tree.goals, under_goal_id) : null;
        const tasks = res.tasks
          .filter((t) => !scope || scope.has(t.goalId))
          .filter((t) =>
            state === 'open'
              ? t.status === 'open'
              : state === 'done'
                ? t.status === 'done'
                : state === 'carrying'
                  ? t.status === 'open' && t.carryWeeks >= 1
                  : true,
          );
        return ok({
          week: weekOut(w),
          tasks: tasks.map((t) => taskOut(t, p.get(t.goalId))),
          plan: res.plan.map((e) => ({ goal_id: e.goalId, goal_path: p.get(e.goalId), sentence: e.sentence })),
          server_now: res.serverNow,
        });
      }),
  );

  // ── get_task ───────────────────────────────────────────────────────────────────────────────────
  server.registerTool(
    'get_task',
    {
      title: 'One task with its activity timeline',
      description:
        'One task with its full activity timeline — creation source, every week it carried into, renames, done-condition edits, links added and removed, completions, unchecks and exits, newest first. The timeline is written by the server and is READ-ONLY: there is no tool to write, edit or delete a task event, by design.',
      inputSchema: z.object({ task_id: Ulid, week_offset: WeekOffsetArg }).strict(),
    },
    async ({ task_id, week_offset }) =>
      guard(async () => {
        const w = week(ctx, week_offset);
        const res = await dc.resolve(TaskService).get(ctx, task_id, w);
        return ok({ task: taskOut(res.task, (await paths(w)).get(res.task.goalId)), week: weekOut(w), server_now: res.serverNow });
      }),
  );

  // ── create_task ────────────────────────────────────────────────────────────────────────────────
  server.registerTool(
    'create_task',
    {
      title: 'Add a task under an active branch',
      description:
        'Add a task under an ACTIVE branch. A task always lands in the CURRENT week — there is no back-dating and no way to create into a past or future week. The goal must be a non-Life leaf that has a focus THIS week; get it from find_goal(only="active_leaves"). If the branch has no focus this week, activate it first with set_goal_focus and ask the user — never fall back to a different goal that happens to be active. The done-condition is optional by design: do not fabricate one.',
      inputSchema: z
        .object({
          goal_id: Ulid,
          title: Title,
          cond: OneLiner.default('').describe("The done-condition — how you'll know it's done. Optional."),
          description: LongText.default(''),
          links: z.array(Url).max(MAX_LINKS).default([]).describe('http(s) URLs only, max 2048 chars each.'),
          source: z
            .enum(['planning', 'drawer'])
            .default('planning')
            .describe('Recorded once on the Created event. "backlog" and "idea" are set by the conversion tools.'),
        })
        .strict(),
    },
    async (args) =>
      guard(async () => {
        stampIdempotencyKey(deps);
        const res = await dc.resolve(TaskService).create(ctx, {
          goalId: args.goal_id,
          title: args.title,
          cond: args.cond,
          description: args.description,
          links: args.links,
          source: TaskSource.parse(args.source),
        });
        return ok({ task: taskOut(res.task, (await paths(week(ctx, 0))).get(res.task.goalId)), server_now: res.serverNow });
      }),
  );

  // ── update_task ────────────────────────────────────────────────────────────────────────────────
  server.registerTool(
    'update_task',
    {
      title: "Edit a task's text",
      description:
        "Edit a task's title, done-condition or description. Done tasks stay editable; only the exits are withdrawn from them. Each changed field is logged on the activity timeline automatically. A no-op edit writes nothing and logs nothing. At least one field must be given.",
      inputSchema: z
        .object({ task_id: Ulid, title: Title.optional(), cond: OneLiner.optional(), description: LongText.optional() })
        .strict(),
    },
    async ({ task_id, ...patch }) =>
      guard(async () => {
        stampIdempotencyKey(deps);
        const res = await dc.resolve(TaskService).patch(ctx, task_id, patch);
        return ok({ task: taskOut(res.task, (await paths(week(ctx, 0))).get(res.task.goalId)), server_now: res.serverNow });
      }),
  );

  // ── complete_task — exit 1 of 3 ────────────────────────────────────────────────────────────────
  server.registerTool(
    'complete_task',
    {
      title: 'Tick a task off (exit 1 of 3)',
      description:
        "Tick a task off. You may complete into any week from the task's origin week onward, INCLUDING past weeks — past weeks stay fully editable. The task then appears only in the week it was completed in. A week earlier than the task's origin_week_start, or any future week, is refused.",
      inputSchema: z.object({ task_id: Ulid, week_offset: WeekOffsetArg }).strict(),
    },
    async ({ task_id, week_offset }) =>
      guard(async () => {
        stampIdempotencyKey(deps);
        const res = await dc.resolve(TaskService).complete(ctx, task_id, { week: week_offset });
        return ok({ task: taskOut(res.task, (await paths(week(ctx, 0))).get(res.task.goalId)), server_now: res.serverNow });
      }),
  );

  // ── uncheck_task ───────────────────────────────────────────────────────────────────────────────
  server.registerTool(
    'uncheck_task',
    {
      title: 'Re-open a completed task',
      description:
        'Re-open a completed task. It keeps its ORIGINAL creation week, so it immediately carries into the current week with the age it actually earned — not a fresh one. Optionally update the done-condition at the same time; omitting it, or passing the same value, writes nothing and logs nothing, which is the normal case. The task must currently be done.',
      inputSchema: z.object({ task_id: Ulid, cond: OneLiner.optional() }).strict(),
    },
    async ({ task_id, cond }) =>
      guard(async () => {
        stampIdempotencyKey(deps);
        const res = await dc.resolve(TaskService).uncheck(ctx, task_id, cond !== undefined ? { cond } : {});
        return ok({ task: taskOut(res.task, (await paths(week(ctx, 0))).get(res.task.goalId)), server_now: res.serverNow });
      }),
  );

  // ── move_task_to_backlog — exit 2 of 3 ─────────────────────────────────────────────────────────
  server.registerTool(
    'move_task_to_backlog',
    {
      title: 'Park a task on its goal (exit 2 of 3)',
      description:
        "Take a task out of the week and park it in its OWN goal's backlog, keeping the description and links and noting which week it came from. Only OPEN tasks can be moved. The reason is OPTIONAL — this product is deliberately guilt-free; pass only what the user actually said and leave it out otherwise.",
      inputSchema: z.object({ task_id: Ulid, week_offset: WeekOffsetArg, reason: Reason.optional() }).strict(),
    },
    async ({ task_id, week_offset, reason }) =>
      guard(async () => {
        stampIdempotencyKey(deps);
        const res = await dc
          .resolve(TaskService)
          .moveToBacklog(ctx, task_id, { week: week_offset, ...(reason !== undefined ? { reason } : {}) });
        return ok({
          task: taskOut(res.task, (await paths(week(ctx, 0))).get(res.task.goalId)),
          item: res.item,
          server_now: res.serverNow,
        });
      }),
  );

  // ── cancel_task — exit 3 of 3 ──────────────────────────────────────────────────────────────────
  server.registerTool(
    'cancel_task',
    {
      title: 'Drop a task (exit 3 of 3)',
      description:
        'Drop a task. It leaves every week but its record and timeline survive. Only OPEN tasks can be cancelled. The reason is optional. NOTE: these three — complete, move to backlog, cancel — are the ONLY ways a task leaves a week. There is no defer, snooze, reschedule or move-to-another-week, and a request for one must be refused rather than approximated with a cancel.',
      inputSchema: z.object({ task_id: Ulid, reason: Reason.optional() }).strict(),
    },
    async ({ task_id, reason }) =>
      guard(async () => {
        stampIdempotencyKey(deps);
        const res = await dc.resolve(TaskService).cancel(ctx, task_id, reason !== undefined ? { reason } : {});
        return ok({ task: taskOut(res.task, (await paths(week(ctx, 0))).get(res.task.goalId)), server_now: res.serverNow });
      }),
  );

  // ── links ──────────────────────────────────────────────────────────────────────────────────────
  server.registerTool(
    'add_task_link',
    {
      title: 'Attach a link to a task',
      description:
        'Attach an external link to a task. Logs "Link added: <host>" on the timeline. Only http and https URLs are accepted — other schemes are refused, not stored — and a task holds at most 20 links.',
      inputSchema: z.object({ task_id: Ulid, url: Url }).strict(),
    },
    async ({ task_id, url }) =>
      guard(async () => {
        stampIdempotencyKey(deps);
        const res = await dc.resolve(TaskService).addLink(ctx, task_id, { url });
        return ok({ task: taskOut(res.task, (await paths(week(ctx, 0))).get(res.task.goalId)), server_now: res.serverNow });
      }),
  );

  server.registerTool(
    'remove_task_link',
    {
      title: 'Remove a link from a task',
      description: 'Remove a link from a task by its link id, which comes from get_task().task.links[].id. Logs "Link removed: <host>".',
      inputSchema: z.object({ task_id: Ulid, link_id: Ulid }).strict(),
    },
    async ({ task_id, link_id }) =>
      guard(async () => {
        stampIdempotencyKey(deps);
        const res = await dc.resolve(TaskService).removeLink(ctx, task_id, link_id);
        return ok({ task: taskOut(res.task, (await paths(week(ctx, 0))).get(res.task.goalId)), server_now: res.serverNow });
      }),
  );
}
