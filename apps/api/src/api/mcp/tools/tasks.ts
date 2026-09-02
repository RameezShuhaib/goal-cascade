import { LongText, MAX_LINKS, OneLiner, Reason, TaskSource, Title, Ulid, Url, WeekOffset, WeekStart } from '@goal-cascade/shared';
import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { GoalService, TaskService } from '../../../application/services';
import { guard } from '../errors';
import { goalOut, ok, stampIdempotencyKey, taskOut, week, weekOut, type McpDeps } from '../shapes';

/** ⚠ **A2 (R-lens-7)** — positive offsets are ordinary now: a future week is reachable and writable. */
const WeekOffsetArg = WeekOffset.default(0);

export function registerTaskTools(server: McpServer, deps: McpDeps): void {
  const { dc, ctx } = deps;

  /** One goal title for a task's `goal_path`. A task's goal is always a Weekly goal (R-goal-39). */
  const titleOf = async (goalId: string): Promise<string | undefined> => {
    try {
      const detail = await dc.resolve(GoalService).detail(ctx, goalId);
      return [...detail.ancestors.map((a) => a.title), detail.goal.title].join(' › ');
    } catch {
      return undefined;
    }
  };

  // ── list_tasks ─────────────────────────────────────────────────────────────────────────────────
  server.registerTool(
    'list_tasks',
    {
      title: 'Tasks visible in one week',
      description:
        'The tasks visible in one week. Open tasks appear in EVERY week from the one they were created in onwards — they carry automatically, with no rollover step — and a task\'s week is its OWN stored field, taken from its weekly goal at creation and never changed after. Done tasks appear only in the week they were completed. Cancelled and moved-to-backlog tasks appear in no week at all. Carry ages are SIGNED and measured against today, so work planned for a future week reads NEGATIVE and never as late. Use list_lens(lens="Weekly") when you also want the weekly goals these tasks hang off, including the carried ones.',
      inputSchema: z
        .object({
          week_offset: WeekOffsetArg,
          state: z.enum(['all', 'open', 'done', 'carrying']).default('all').describe('carrying = open with carry_weeks >= 1'),
          limit: z.int().min(1).max(200).optional(),
        })
        .strict(),
    },
    async ({ week_offset, state, limit }) =>
      guard(async () => {
        const w = week(ctx, week_offset);
        const res = await dc
          .resolve(TaskService)
          .list(ctx, { weekStart: w.weekStart, ...(limit !== undefined ? { limit } : {}) });
        const tasks = res.tasks.filter((t) =>
          state === 'open'
            ? t.status === 'open'
            : state === 'done'
              ? t.status === 'done'
              : state === 'carrying'
                ? t.status === 'open' && t.carryAge >= 1
                : true,
        );
        const paths = new Map<string, string | undefined>();
        for (const id of new Set(tasks.map((t) => t.goalId))) paths.set(id, await titleOf(id));
        return ok({
          week: weekOut(w),
          tasks: tasks.map((t) => taskOut(t, paths.get(t.goalId))),
          next_cursor: res.nextCursor,
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
        return ok({ task: taskOut(res.task, await titleOf(res.task.goalId)), week: weekOut(w), server_now: res.serverNow });
      }),
  );

  // ── create_task ────────────────────────────────────────────────────────────────────────────────
  server.registerTool(
    'create_task',
    {
      title: 'Add a task under a weekly goal',
      description:
        'Add a task under a WEEKLY goal. That is the whole condition — the horizon, and nothing else. A monthly goal with no weekly children looks like the end of a branch and still cannot hold a task; passing one is refused with NOT_A_WEEKLY_GOAL. Give EITHER goal_id (an existing weekly goal, from find_goal(only="weekly")) OR new_weekly_goal, which creates the weekly goal and the task in ONE transaction — use that instead of sending the user away when no weekly goal exists for the week yet, and tell them it was created, because nothing may be created invisibly. There is NO week argument: the task takes its week from its weekly goal, once, and it never changes. A weekly goal whose week has PASSED refuses the create (PERIOD_IN_PAST) — there is no back-dating — while a weekly goal any distance ahead accepts one. The done-condition is optional by design: do not fabricate one.',
      inputSchema: z
        .object({
          goal_id: Ulid.optional().describe('An existing WEEKLY goal. Mutually exclusive with new_weekly_goal.'),
          new_weekly_goal: z
            .object({ parent_id: Ulid, title: Title })
            .strict()
            .optional()
            .describe('Creates a weekly goal for the CURRENT week under parent_id, atomically with the task.'),
          title: Title,
          cond: OneLiner.default('').describe("The done-condition — how you'll know it's done. Optional."),
          description: LongText.default(''),
          links: z.array(Url).max(MAX_LINKS).default([]).describe('http(s) URLs only, max 2048 chars each.'),
          source: z
            .enum(['goal', 'drawer'])
            .default('goal')
            .describe('Recorded once on the Created event. "backlog" is set by the conversion tool.'),
        })
        .strict()
        .refine(
          (v) => (v.goal_id === undefined) !== (v.new_weekly_goal === undefined),
          'exactly one of goal_id or new_weekly_goal is required',
        ),
    },
    async (args) =>
      guard(async () => {
        stampIdempotencyKey(deps);
        const res = await dc.resolve(TaskService).create(ctx, {
          ...(args.goal_id !== undefined ? { goalId: args.goal_id } : {}),
          ...(args.new_weekly_goal !== undefined
            ? { newWeeklyGoal: { parentId: args.new_weekly_goal.parent_id, title: args.new_weekly_goal.title } }
            : {}),
          title: args.title,
          cond: args.cond,
          description: args.description,
          links: args.links,
          source: TaskSource.parse(args.source),
        });
        return ok({
          task: taskOut(res.task, await titleOf(res.task.goalId)),
          // R-task-49 — when a weekly goal was created for the owner, SAY SO. It was created without
          // being asked for, so the agent must name it back rather than let it appear silently.
          created_weekly_goal: res.goal ? goalOut(res.goal) : null,
          server_now: res.serverNow,
        });
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
        return ok({ task: taskOut(res.task, await titleOf(res.task.goalId)), server_now: res.serverNow });
      }),
  );

  // ── complete_task — exit 1 of 3 ────────────────────────────────────────────────────────────────
  server.registerTool(
    'complete_task',
    {
      title: 'Tick a task off (exit 1 of 3)',
      description:
        "Tick a task off. You may complete into any week from the task's origin week up to and including THIS one, past weeks included — past weeks stay fully editable for work. The task then appears only in the week it was completed in. A week earlier than the task's origin_week_start is refused, and so is ANY future week: you cannot finish work in a week that has not happened. A task whose weekly goal is in a future week therefore cannot be completed at all until that week arrives — `completable` on the task says so.",
      inputSchema: z
        .object({
          task_id: Ulid,
          period: WeekStart.optional().describe(
            'The week you are standing in, as its Monday (2026-09-07). Omit for the current week. A future one is refused.',
          ),
        })
        .strict(),
    },
    async ({ task_id, period }) =>
      guard(async () => {
        stampIdempotencyKey(deps);
        const res = await dc.resolve(TaskService).complete(ctx, task_id, { period: period ?? ctx.currentWeekStart });
        return ok({ task: taskOut(res.task, await titleOf(res.task.goalId)), server_now: res.serverNow });
      }),
  );

  // ── uncheck_task ───────────────────────────────────────────────────────────────────────────────
  server.registerTool(
    'uncheck_task',
    {
      title: 'Re-open a completed task',
      description:
        'Re-open a completed task. It keeps its ORIGINAL creation week, so it immediately carries into the current week with the age it actually earned — not a fresh one — and its weekly goal reappears alongside it in the carried band. Optionally update the done-condition at the same time; omitting it, or passing the same value, writes nothing and logs nothing, which is the normal case. The task must currently be done.',
      inputSchema: z.object({ task_id: Ulid, cond: OneLiner.optional() }).strict(),
    },
    async ({ task_id, cond }) =>
      guard(async () => {
        stampIdempotencyKey(deps);
        const res = await dc.resolve(TaskService).uncheck(ctx, task_id, cond !== undefined ? { cond } : {});
        return ok({ task: taskOut(res.task, await titleOf(res.task.goalId)), server_now: res.serverNow });
      }),
  );

  // ── move_task_to_backlog — exit 2 of 3 ─────────────────────────────────────────────────────────
  server.registerTool(
    'move_task_to_backlog',
    {
      title: 'Park a task above its week (exit 2 of 3)',
      description:
        "Take a task out of the week and park it in the backlog of the nearest goal ABOVE its week — normally the monthly parent — keeping the description and links and noting which week it came from. It does NOT go on its own weekly goal: a weekly goal is a week, and the point of this exit is to leave the week. A weekly goal hanging directly off a life goal has nowhere to put it and the exit is refused (LIFE_GOAL_NO_BACKLOG); complete or cancel remain available. Only OPEN tasks can be moved, future-dated ones included. The reason is OPTIONAL — this product is deliberately guilt-free; pass only what the user actually said.",
      inputSchema: z
        .object({
          task_id: Ulid,
          period: WeekStart.optional().describe('The week you are standing in, as its Monday. Omit for the current week.'),
          reason: Reason.optional(),
        })
        .strict(),
    },
    async ({ task_id, period, reason }) =>
      guard(async () => {
        stampIdempotencyKey(deps);
        const res = await dc
          .resolve(TaskService)
          .moveToBacklog(ctx, task_id, { period: period ?? ctx.currentWeekStart, ...(reason !== undefined ? { reason } : {}) });
        return ok({
          task: taskOut(res.task, await titleOf(res.task.goalId)),
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
        return ok({ task: taskOut(res.task, await titleOf(res.task.goalId)), server_now: res.serverNow });
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
        return ok({ task: taskOut(res.task, await titleOf(res.task.goalId)), server_now: res.serverNow });
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
        return ok({ task: taskOut(res.task, await titleOf(res.task.goalId)), server_now: res.serverNow });
      }),
  );
}
