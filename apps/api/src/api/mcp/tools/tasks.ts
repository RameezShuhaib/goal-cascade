import {
  LongText,
  MAX_LINKS,
  MAX_READINGS,
  MeasureNumber,
  MeasureUnit,
  OneLiner,
  PeriodKeyParam,
  Reason,
  TaskSource,
  Title,
  Ulid,
  Url,
  WeekOffset,
  WeekStart,
  periodKeyOf,
} from '@goal-cascade/shared';
import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { GoalService, TaskService } from '../../../application/services';
import { guard } from '../errors';
import { goalOut, ok, readingOut, stampIdempotencyKey, taskOut, week, weekOut, type McpDeps } from '../shapes';

/** ⚠ **A2 (R-lens-7)** — positive offsets are ordinary now: a future week is reachable and writable. */
const WeekOffsetArg = WeekOffset.default(0);

/**
 * ⚠ **A8, new (R-measure-1/2/4)** — a measure, as an agent supplies one.
 *
 * There is **no `current`** and no way to send one: it is derived from the readings (R-measure-3). There
 * is **no direction flag**: `target` above `start` counts up, below it counts down. `target: null` is a
 * real measure with a history and no percentage — the AMRAP case — and not a broken one. `target` equal
 * to `start` is refused (`MEASURE_TARGET_EQUALS_START`): it names no movement.
 */
const MeasureArg = z
  .object({
    kind: z.enum(['counter', 'gauge']).describe('counter = you add to it (+3); gauge = you set it (= 78.5). There is no third.'),
    start: MeasureNumber.default(0).describe('Where the count begins. 0 for a counter unless told otherwise.'),
    target: MeasureNumber.nullable()
      .default(null)
      .describe('Where it is going, or null for a tracked number with no finish line. Must not equal start.'),
    unit: MeasureUnit.default('').describe('leads, kg, reps. A word you were given; never parsed or converted.'),
  })
  .strict();

export function registerTaskTools(server: McpServer, deps: McpDeps): void {
  const { dc, ctx } = deps;

  /**
   * One goal path for a task's `goal_path`.
   *
   * ⚠ **A8 (R-task-51)** — a task's goal is a **Monthly or a Weekly** goal, and the old comment here
   * ("always a Weekly goal") is false from A8. It is the same walk either way.
   */
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
      title: 'Tasks visible in one week, and that week\'s month',
      description:
        'The tasks visible in one week. Open tasks appear in EVERY period from the one they were created in onwards — they carry automatically, with no rollover step — and a task\'s period is its OWN stored field, taken from its goal at creation and never changed after. Done tasks appear only in the period they were completed in. Cancelled and moved-to-backlog tasks appear in none. Carry ages are SIGNED and measured against today, so work planned ahead reads NEGATIVE and never as late. A task has a SCOPE: a task on a weekly goal has a week, a task on a monthly goal has a MONTH. `scope="month"` returns the month tasks of the month this week belongs to — a week belongs to its MONDAY\'s month, so on Wed 2 Sep 2026 the current week is Mon 31 Aug and its month is AUGUST. `scope="all"` returns both, and a month task in a week is NOT late: its deadline is the end of the month, so never describe one as overdue or behind because a week has passed. Use list_lens(lens="Weekly") when you also want the weekly goals these tasks hang off, including the carried ones.',
      inputSchema: z
        .object({
          week_offset: WeekOffsetArg,
          scope: z
            .enum(['week', 'month', 'all'])
            .default('week')
            .describe("week = this week's own tasks; month = the month tasks of the month this week belongs to; all = both."),
          state: z.enum(['all', 'open', 'done', 'carrying']).default('all').describe('carrying = open with carry_age >= 1'),
          limit: z.int().min(1).max(200).optional(),
        })
        .strict(),
    },
    async ({ week_offset, scope, state, limit }) =>
      guard(async () => {
        const w = week(ctx, week_offset);
        const [weekRes, lens] = await Promise.all([
          scope === 'month'
            ? Promise.resolve(null)
            : dc.resolve(TaskService).list(ctx, { weekStart: w.weekStart, ...(limit !== undefined ? { limit } : {}) }),
          // The month band is a lens field (R-lens-31), so the month half is read where it is computed
          // rather than re-derived here — one answer to "which month does this week belong to".
          scope === 'week' ? Promise.resolve(null) : dc.resolve(GoalService).lens(ctx, { lens: 'Weekly', period: w.weekStart }),
        ]);
        const res = weekRes ?? { tasks: [], nextCursor: null, serverNow: ctx.now };
        const tasks = [...res.tasks, ...(lens?.monthTasks ?? [])].filter((t) =>
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
          /** R-lens-31 — the month this week belongs to, by the Monday rule. Quote it, never re-derive it. */
          month_period_key: periodKeyOf('Monthly', w.weekStart),
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
      title: 'Add a task under a monthly or weekly goal',
      description:
        'Add a task under a MONTHLY or a WEEKLY goal. That is the whole condition — the horizon, and nothing else. A quarterly goal with no monthly children looks like the end of a branch and still cannot hold a task; passing one, or a yearly or life goal, is refused with NOT_A_TASK_GOAL. Give EITHER goal_id OR new_weekly_goal. \n\nOn a MONTHLY goal, leaving `period` out is the normal case and creates a MONTH TASK on that goal, in that goal\'s month: one row, nothing inferred, no weekly goal invented, and the task shows up in the Monthly lens and in the month band of every week of that month. It is not late in any of those weeks — the deadline is the end of the month. Pass `period` as one of that month\'s Mondays ONLY when the user actually named a week; that resolves the weekly goal under it, refuses AMBIGUOUS_CONVERSION_TARGET if two qualify, and answers NO_WEEKLY_GOAL if none does — at which point re-send with new_weekly_goal, which creates the weekly goal and the task in ONE transaction, and TELL the user it was created, because nothing may be created invisibly.\n\nOn a WEEKLY goal the task takes that goal\'s week and `period` is unnecessary. A goal whose period has PASSED refuses the create (PERIOD_IN_PAST) — there is no back-dating at either scope — while any distance ahead is accepted. The done-condition is optional by design: do not fabricate one. `measure` attaches a number in the same call; leave it out for an ordinary checkbox, which is what most tasks are.',
      inputSchema: z
        .object({
          goal_id: Ulid.optional().describe('An existing MONTHLY or WEEKLY goal. Mutually exclusive with new_weekly_goal.'),
          new_weekly_goal: z
            .object({ parent_id: Ulid, title: Title })
            .strict()
            .optional()
            .describe('Creates a weekly goal for `period` (or the current week) under parent_id, atomically with the task.'),
          period: PeriodKeyParam.optional().describe(
            'Where it lands. OMIT on a monthly goal for a month task — that is the normal case. A Monday (2026-09-07) asks for that week instead.',
          ),
          measure: MeasureArg.optional().describe('Attach a number in the same call. Omit for an ordinary checkbox.'),
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
          ...(args.period !== undefined ? { period: args.period } : {}),
          ...(args.measure !== undefined ? { measure: args.measure } : {}),
          title: args.title,
          cond: args.cond,
          description: args.description,
          links: args.links,
          source: TaskSource.parse(args.source),
        });
        return ok({
          task: taskOut(res.task, await titleOf(res.task.goalId)),
          // R-task-48 — when a weekly goal was created for the owner, SAY SO. The agent must name it back
          // rather than let it appear silently. It is null on every month-scope create, which is most.
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
  // ── retarget_task — Park in a week / Move to the month (NOT an exit) ───────────────────────────
  server.registerTool(
    'retarget_task',
    {
      title: 'Park a task in a week, or move it back to its month',
      description:
        "Move a task between its month and a week. A MONTH task parked into a week becomes that week's work; a WEEK task moved to its month goes back to the monthly goal above it. It keeps its title, condition, description, links, timeline and EVERY recorded value — only the goal and the period change.\n\nTHIS IS NOT A FOURTH EXIT. The task is still open, still visible and still the user's to finish; complete, move-to-backlog and cancel remain the only three ways a task leaves. Do not use it as a defer, a snooze or a reschedule, and do not describe it as one. A week task cannot be moved to a DIFFERENT week and a month task cannot be moved to a different month: those are the reschedule this product does not have, and both are refused.\n\n`period` is a Monday to park and a month key (2026-09) to move back. Parking resolves the weekly goal under the task's own monthly goal: one qualifies and it is used, two or more gives AMBIGUOUS_CONVERSION_TARGET and you must ask, none gives NO_WEEKLY_GOAL and you re-send with new_weekly_goal. Moving back needs no goal at all — it is the monthly goal above the weekly one, and a weekly goal with no monthly ancestor is refused with HORIZON_CONFLICT. A past period is refused; parking is planning. Retargeting to the period the task is already in does nothing and logs nothing.",
      inputSchema: z
        .object({
          task_id: Ulid,
          period: PeriodKeyParam.describe('A Monday (2026-09-14) parks it in that week; a month key (2026-09) moves it to that month.'),
          goal_id: Ulid.optional().describe('Parking only: which weekly goal, when several qualify.'),
          new_weekly_goal: z
            .object({ parent_id: Ulid, title: Title })
            .strict()
            .optional()
            .describe('Parking only: creates the weekly goal and parks the task in ONE transaction.'),
        })
        .strict(),
    },
    async ({ task_id, period, goal_id, new_weekly_goal }) =>
      guard(async () => {
        stampIdempotencyKey(deps);
        const res = await dc.resolve(TaskService).retarget(ctx, task_id, {
          period,
          ...(goal_id !== undefined ? { goalId: goal_id } : {}),
          ...(new_weekly_goal !== undefined
            ? { newWeeklyGoal: { parentId: new_weekly_goal.parent_id, title: new_weekly_goal.title } }
            : {}),
        });
        return ok({
          task: taskOut(res.task, await titleOf(res.task.goalId)),
          created_weekly_goal: res.goal ? goalOut(res.goal) : null,
          server_now: res.serverNow,
        });
      }),
  );

  // ── set_task_measure ──────────────────────────────────────────────────────────────────────────
  server.registerTool(
    'set_task_measure',
    {
      title: 'Give a task a number, or change the one it has',
      description:
        "Attach a measure to a task, or replace the one it has. Two kinds and no third: a COUNTER you add to (+3 calls) and a GAUGE you set (= 78.5 kg). A task with no measure is an ordinary checkbox — that is what most tasks are, and it is not a counter that stops at one.\n\nDirection is implied by the two numbers: target above start counts up, target below start counts down. There is no direction to set. The TARGET IS OPTIONAL — `target: null` is a real, tracked number with a history and no percentage (an AMRAP set, a weight you just want recorded), not a degraded one. A target equal to the start is refused; it names no movement.\n\nEditing never touches the recorded values: the history is the history of the number, not of its shape. Reaching a target does NOT complete the task and completing a task does NOT record a value — the user decides both. Never report a pace, a projection, a trend, a streak or an on-track verdict from a measure; report the numbers that were recorded.",
      inputSchema: z.object({ task_id: Ulid, measure: MeasureArg }).strict(),
    },
    async ({ task_id, measure }) =>
      guard(async () => {
        stampIdempotencyKey(deps);
        const res = await dc.resolve(TaskService).setMeasure(ctx, task_id, { measure });
        return ok({ task: taskOut(res.task, await titleOf(res.task.goalId)), server_now: res.serverNow });
      }),
  );

  // ── clear_task_measure ────────────────────────────────────────────────────────────────────────
  server.registerTool(
    'clear_task_measure',
    {
      title: 'Remove a task\'s number and its whole history',
      description:
        'Remove a task\'s measure. THIS DELETES EVERY RECORDED VALUE with it, in one transaction, and cannot be undone. Call list_readings first, tell the user how many values will be lost, and get an explicit yes — this refusal-shaped confirmation is the same discipline the goal cascade delete uses. The task becomes an ordinary checkbox again and keeps everything else: title, condition, description, links, timeline, period. A task with no measure is refused with NO_MEASURE.',
      inputSchema: z.object({ task_id: Ulid }).strict(),
    },
    async ({ task_id }) =>
      guard(async () => {
        stampIdempotencyKey(deps);
        const res = await dc.resolve(TaskService).clearMeasure(ctx, task_id);
        return ok({ task: taskOut(res.task, await titleOf(res.task.goalId)), server_now: res.serverNow });
      }),
  );

  // ── record_reading ────────────────────────────────────────────────────────────────────────────
  server.registerTool(
    'record_reading',
    {
      title: 'Record a value on a measurable task',
      description:
        "Record one value. Give EITHER `value` (the absolute number now) OR `delta` (add this much). A delta against a GAUGE is refused with MEASURE_KIND_MISMATCH, because a gauge is set rather than added to; an absolute value against a COUNTER is fine, and is how you correct one to where it actually is.\n\nWhat is stored is always the ABSOLUTE value after the reading, so deleting one falls the current value back to the one before it. Readings follow the TASK and never the week: they survive the task carrying into a new week or month, being parked into a week, being moved back, being completed and being unchecked. There is no week, month or period on a reading and there never will be.\n\nRecording a value NEVER completes the task, even at or past the target: the user decides when it is done. A reading writes no timeline entry, by design — the values are their own list. A task with no measure is refused with NO_MEASURE; use set_task_measure first.",
      inputSchema: z
        .object({
          task_id: Ulid,
          value: MeasureNumber.optional().describe('The absolute value now. Use this for a gauge.'),
          delta: MeasureNumber.optional().describe('Add this much. Counters only.'),
          at: z.iso.datetime({ offset: true }).optional().describe('When it was recorded. Defaults to now; back-dating is fine.'),
        })
        .strict()
        .refine((v) => (v.value === undefined) !== (v.delta === undefined), 'exactly one of value or delta is required'),
    },
    async ({ task_id, value, delta, at }) =>
      guard(async () => {
        stampIdempotencyKey(deps);
        const res = await dc.resolve(TaskService).recordReading(ctx, task_id, {
          ...(value !== undefined ? { value } : {}),
          ...(delta !== undefined ? { delta } : {}),
          ...(at !== undefined ? { at } : {}),
        });
        return ok({ task: taskOut(res.task, await titleOf(res.task.goalId)), server_now: res.serverNow });
      }),
  );

  // ── list_readings ─────────────────────────────────────────────────────────────────────────────
  server.registerTool(
    'list_readings',
    {
      title: "A measurable task's recorded values",
      description:
        `Every value recorded on a task, oldest first, each with the time it was recorded. Capped at ${MAX_READINGS} per task, and there is no compaction, rollup or pruning: the values are the user's own and the app does not average or bucket them.\n\nRead these to answer "what have I recorded" and to name the count before clear_task_measure. Do NOT compute a pace, a projection, a forecast, a trend, a moving average, a streak, a completion rate or an on-track verdict from them, and do not sum a measure across tasks — the app deliberately has none of those, and inventing one here would be the first number in this product that judged its owner. Report what was recorded.`,
      inputSchema: z.object({ task_id: Ulid }).strict(),
    },
    async ({ task_id }) =>
      guard(async () => {
        const res = await dc.resolve(TaskService).get(ctx, task_id, week(ctx, 0));
        return ok({
          task_id,
          measure: taskOut(res.task, undefined).measure,
          readings: res.task.readings.map(readingOut),
          server_now: res.serverNow,
        });
      }),
  );

  // ── delete_reading ────────────────────────────────────────────────────────────────────────────
  server.registerTool(
    'delete_reading',
    {
      title: 'Delete one recorded value',
      description:
        'Delete one recorded value by its id, from list_readings. This is how a mistyped number is corrected: there is no edit — you delete it and record the right one. Deleting the latest value falls the current value back to the one before it; deleting a middle one changes the current value not at all; deleting the only one returns it to the start. It leaves no trace on the timeline, deliberately.',
      inputSchema: z.object({ task_id: Ulid, reading_id: Ulid }).strict(),
    },
    async ({ task_id, reading_id }) =>
      guard(async () => {
        stampIdempotencyKey(deps);
        const res = await dc.resolve(TaskService).deleteReading(ctx, task_id, reading_id);
        return ok({ task: taskOut(res.task, await titleOf(res.task.goalId)), server_now: res.serverNow });
      }),
  );
}
