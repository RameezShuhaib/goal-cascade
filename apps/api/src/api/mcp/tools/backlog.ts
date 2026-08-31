import { LongText, MAX_LINKS, OneLiner, Title, Ulid, Url, WeekOffset } from '@goal-cascade/shared';
import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { BacklogService, GoalService } from '../../../application/services';
import { guard } from '../errors';
import { goalOut, ok, stampIdempotencyKey, taskOut, type McpDeps } from '../shapes';

export function registerBacklogTools(server: McpServer, deps: McpDeps): void {
  const { dc, ctx } = deps;

  const titleOf = async (goalId: string): Promise<string | undefined> => {
    try {
      const detail = await dc.resolve(GoalService).detail(ctx, goalId);
      return [...detail.ancestors.map((a) => a.title), detail.goal.title].join(' › ');
    } catch {
      return undefined;
    }
  };

  // ── list_backlog ───────────────────────────────────────────────────────────────────────────────
  server.registerTool(
    'list_backlog',
    {
      title: 'Deferred work, by goal',
      description:
        'Deferred future work, newest first. Backlog items have no checkbox, no done-condition, no due date and no status — that poverty is deliberate, not missing features. They sit on a Yearly, Quarterly or Monthly goal: never a life goal, and never a WEEKLY goal, because an item has no week and a weekly goal would give it one. Converted items are never listed. To see what could become work this week, call convert_backlog_item_to_task and read its refusal, or check the weekly lens for a weekly goal under the item\'s goal.',
      inputSchema: z
        .object({
          goal_id: Ulid.optional().describe("Narrow to one goal's OWN items (or, on a life goal, its read-only roll-up)."),
          limit: z.int().min(1).max(200).optional(),
        })
        .strict(),
    },
    async ({ goal_id, limit }) =>
      guard(async () => {
        const res = await dc
          .resolve(BacklogService)
          .list(ctx, { ...(goal_id !== undefined ? { goalId: goal_id } : {}), ...(limit !== undefined ? { limit } : {}) });
        const paths = new Map<string, string | undefined>();
        for (const id of new Set(res.items.map((i) => i.goalId))) paths.set(id, await titleOf(id));
        return ok({
          items: res.items.map((i) => ({ ...i, goal_path: paths.get(i.goalId) })),
          next_cursor: res.nextCursor,
          server_now: res.serverNow,
        });
      }),
  );

  // ── create_backlog_item ────────────────────────────────────────────────────────────────────────
  server.registerTool(
    'create_backlog_item',
    {
      title: 'Park work under a goal',
      description:
        'Park work under a Yearly, Quarterly or Monthly goal. NEVER a life goal and NEVER a weekly goal — both are refused, the second because an item has no week. Use find_goal(only="can_hold_backlog") to pick a valid target.',
      inputSchema: z
        .object({
          goal_id: Ulid.describe('A Yearly, Quarterly or Monthly goal.'),
          title: Title,
          description: LongText.default(''),
          links: z.array(Url).max(MAX_LINKS).default([]),
        })
        .strict(),
    },
    async ({ goal_id, title, description, links }) =>
      guard(async () => {
        stampIdempotencyKey(deps);
        const res = await dc.resolve(BacklogService).create(ctx, { goalId: goal_id, title, description, links });
        return ok({ item: res.item, server_now: res.serverNow });
      }),
  );

  // ── update_backlog_item ────────────────────────────────────────────────────────────────────────
  server.registerTool(
    'update_backlog_item',
    {
      title: 'Edit a parked item',
      description:
        "Edit a parked item's title, description or links. `links` REPLACES the whole list rather than appending. Only open items can be edited; an item that has already been converted into a task is refused.",
      inputSchema: z
        .object({
          item_id: Ulid,
          title: Title.optional(),
          description: LongText.optional(),
          links: z.array(Url).max(MAX_LINKS).optional().describe('Replaces the entire list.'),
        })
        .strict(),
    },
    async ({ item_id, ...patch }) =>
      guard(async () => {
        stampIdempotencyKey(deps);
        const res = await dc.resolve(BacklogService).patch(ctx, item_id, patch);
        return ok({ item: res.item, server_now: res.serverNow });
      }),
  );

  // ── move_backlog_item ──────────────────────────────────────────────────────────────────────────
  server.registerTool(
    'move_backlog_item',
    {
      title: 'Re-home a parked item',
      description:
        'Re-home a parked item under a different Yearly, Quarterly or Monthly goal. Its captured date and its "from week of …" note do not change. A life goal and a WEEKLY goal are both refused. If you read this item id off a life goal\'s get_goal response, check backlog_is_aggregate first — that list is a read-only roll-up of descendants and its ids belong to those descendants, not to the life goal.',
      inputSchema: z.object({ item_id: Ulid, goal_id: Ulid.describe('The new owner. Yearly, Quarterly or Monthly.') }).strict(),
    },
    async ({ item_id, goal_id }) =>
      guard(async () => {
        stampIdempotencyKey(deps);
        const res = await dc.resolve(BacklogService).move(ctx, item_id, { goalId: goal_id });
        return ok({ item: res.item, new_goal_path: await titleOf(res.item.goalId), server_now: res.serverNow });
      }),
  );

  // ── delete_backlog_item ────────────────────────────────────────────────────────────────────────
  server.registerTool(
    'delete_backlog_item',
    {
      title: 'Permanently delete a parked item',
      description:
        'DESTRUCTIVE AND PERMANENT. There is no archive and no undo anywhere in this product. Say what you are deleting and confirm with the user first — move_backlog_item is usually what they actually want, and "clean up my backlog" is not a licence to bulk-delete. One item per call, on purpose.',
      inputSchema: z.object({ item_id: Ulid }).strict(),
    },
    async ({ item_id }) =>
      guard(async () => {
        stampIdempotencyKey(deps);
        const res = await dc.resolve(BacklogService).remove(ctx, item_id);
        return ok({ deleted: res.deleted, server_now: res.serverNow });
      }),
  );

  // ── convert_backlog_item_to_task ───────────────────────────────────────────────────────────────
  server.registerTool(
    'convert_backlog_item_to_task',
    {
      title: 'Pull a parked item into a week',
      description:
        'The ONLY way backlog becomes work. The item is CONSUMED and becomes a task in one atomic operation — never duplicated, never left behind. Say so before the first conversion. The task lands on a WEEKLY GOAL at or under the item\'s goal whose week is the target week: if exactly one qualifies it is used; if several do you MUST name one with goal_id, because the server refuses to pick and that id decides which week the task belongs to for the rest of its life; if NONE does, the call is refused with NO_WEEKLY_GOAL and you should offer new_weekly_goal, which creates one in the same transaction rather than sending the user away. week_offset names the target week and may not be negative — nothing is created into a past week. A second conversion of the same item is refused and creates no second task.',
      inputSchema: z
        .object({
          item_id: Ulid,
          goal_id: Ulid.optional().describe("A WEEKLY goal at or under the item's goal for the target week. Required when several qualify."),
          new_weekly_goal: z
            .object({ parent_id: Ulid, title: Title })
            .strict()
            .optional()
            .describe('Creates the weekly goal for the target week, atomically with the task. Mutually exclusive with goal_id.'),
          week_offset: WeekOffset.min(0).default(0).describe('0 = this week. Negative is refused: no back-dating.'),
          title: Title.optional().describe("Override the item's title on the created task."),
          cond: OneLiner.default(''),
        })
        .strict(),
    },
    async ({ item_id, goal_id, new_weekly_goal, week_offset, title, cond }) =>
      guard(async () => {
        stampIdempotencyKey(deps);
        const res = await dc.resolve(BacklogService).convert(ctx, item_id, {
          ...(goal_id !== undefined ? { goalId: goal_id } : {}),
          ...(new_weekly_goal !== undefined
            ? { newWeeklyGoal: { parentId: new_weekly_goal.parent_id, title: new_weekly_goal.title } }
            : {}),
          week: week_offset,
          ...(title !== undefined ? { title } : {}),
          cond,
        });
        // Through `taskOut` like every other task result: a conversion must not hand the agent a
        // differently-shaped task from the one `create_task` returns.
        return ok({
          task: taskOut(res.task, await titleOf(res.task.goalId)),
          item: res.item,
          created_weekly_goal: res.goal ? goalOut(res.goal) : null,
          server_now: res.serverNow,
        });
      }),
  );
}
