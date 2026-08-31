import { LongText, MAX_LINKS, OneLiner, Title, Ulid, Url, WeekOffset } from '@goal-cascade/shared';
import type { BacklogItemView } from '@goal-cascade/shared';
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

  /**
   * ⚠ **A2 (R-backlog-13)** — the branch path an agent reads to know WHICH goal an item sits on, now taken
   * straight off the view.
   *
   * It used to be one `GoalService.detail` per distinct goal in the list — each of those a full detail
   * read with its own interior-tree load — for a label. The server resolves the same two names once per
   * request now, so the path is free and the shape an agent sees is unchanged.
   */
  const pathOf = (item: BacklogItemView): string =>
    item.lifeGoalTitle ? `${item.lifeGoalTitle} › ${item.goalTitle}` : item.goalTitle;

  // ── list_backlog ───────────────────────────────────────────────────────────────────────────────
  server.registerTool(
    'list_backlog',
    {
      title: 'Deferred work, by goal',
      description:
        'Deferred future work. Backlog items have no checkbox, no done-condition, no due date and no status — that poverty is deliberate, not missing features. They sit on a Yearly, Quarterly or Monthly goal: never a life goal, and never a WEEKLY goal, because an item has no week and a weekly goal would give it one. Converted items are never listed. ORDER: within one goal the order is the OWNER\'S — they can arrange it by hand, and the list comes back in that arrangement, newest first only until they rearrange it. Across goals there is no manual order at all: goals appear newest item first, and two items on different goals have no relative position, so never present the whole list as one ranked sequence. To see what could become work this week, call convert_backlog_item_to_task and read its refusal, or check the weekly lens for a weekly goal under the item\'s goal.',
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
        return ok({
          items: res.items.map((i) => ({ ...i, goal_path: pathOf(i) })),
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
        'Park work under a Yearly, Quarterly or Monthly goal. NEVER a life goal and NEVER a weekly goal — both are refused, the second because an item has no week. Use find_goal(only="can_hold_backlog") to pick a valid target. The new item lands at the TOP of that goal\'s list, above anything the owner has arranged by hand.',
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
        "Edit a parked item's title, description or links. `links` REPLACES the whole list rather than appending. Only open items can be edited; an item that has already been converted into a task is refused. This tool cannot change an item's POSITION and there is no field for one — use reorder_backlog_item.",
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
        'Re-home a parked item under a different Yearly, Quarterly or Monthly goal. Its captured date and its "from week of …" note do not change, but its MANUAL POSITION does not travel with it: it lands at the top of the destination goal\'s list, because a hand-made order belongs to one goal and means nothing in another. A life goal and a WEEKLY goal are both refused. If you read this item id off a life goal\'s get_goal response, check backlog_is_aggregate first — that list is a read-only roll-up of descendants and its ids belong to those descendants, not to the life goal.',
      inputSchema: z.object({ item_id: Ulid, goal_id: Ulid.describe('The new owner. Yearly, Quarterly or Monthly.') }).strict(),
    },
    async ({ item_id, goal_id }) =>
      guard(async () => {
        stampIdempotencyKey(deps);
        const res = await dc.resolve(BacklogService).move(ctx, item_id, { goalId: goal_id });
        return ok({ item: res.item, new_goal_path: pathOf(res.item), server_now: res.serverNow });
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

  // ── reorder_backlog_item ───────────────────────────────────────────────────────────────────────
  server.registerTool(
    'reorder_backlog_item',
    {
      title: 'Rearrange a goal\'s parked items',
      description:
        'Move a parked item within its OWN goal\'s list. Name exactly one of: after_item_id (put it immediately after that item), before_item_id (immediately before it), or to ("top" / "bottom"). There is no position number and there never will be — an index is a claim about the whole list and is wrong the moment anything else moved, and the owner is usually rearranging on another device at the same time. The neighbour must be an OPEN item on the SAME goal; a neighbour on another goal, an already-converted one, or one that does not exist is refused and nothing moves. Manual order exists only within one goal: to change which goal an item belongs to, use move_backlog_item, and be aware that doing so sends it to the top of the destination. Never reorder a list the owner did not ask you to rearrange — position is one of the few things in this product that is purely theirs.',
      inputSchema: z
        .object({
          item_id: Ulid,
          after_item_id: Ulid.optional().describe('Land immediately after this item. Same goal, still open.'),
          before_item_id: Ulid.optional().describe('Land immediately before this item. Same goal, still open.'),
          to: z.enum(['top', 'bottom']).optional().describe('The end of the item\'s own goal\'s list.'),
        })
        .strict()
        .refine(
          (v) => [v.after_item_id, v.before_item_id, v.to].filter((x) => x !== undefined).length === 1,
          'name exactly one of after_item_id, before_item_id or to',
        ),
    },
    async ({ item_id, after_item_id, before_item_id, to }) =>
      guard(async () => {
        stampIdempotencyKey(deps);
        const res = await dc.resolve(BacklogService).reorder(ctx, item_id, {
          ...(after_item_id !== undefined ? { after: after_item_id } : {}),
          ...(before_item_id !== undefined ? { before: before_item_id } : {}),
          ...(to !== undefined ? { to } : {}),
        });
        return ok({ item: res.item, goal_path: pathOf(res.item), server_now: res.serverNow });
      }),
  );

  // ── convert_backlog_item_to_task ───────────────────────────────────────────────────────────────
  server.registerTool(
    'convert_backlog_item_to_task',
    {
      title: 'Pull a parked item into a week',
      description:
        'The ONLY way backlog becomes work. The item is CONSUMED and becomes a task in one atomic operation — never duplicated, never left behind. Say so before the first conversion. The task lands on a WEEKLY GOAL at or under the item\'s goal whose week is the target week: if exactly one qualifies it is used; if several do you MUST name one with goal_id, because the server refuses to pick and that id decides which week the task belongs to for the rest of its life; if NONE does, the call is refused with NO_WEEKLY_GOAL and you should offer new_weekly_goal, which creates one in the same transaction rather than sending the user away. week_offset names the target week and may not be negative — nothing is created into a past week. A second conversion of the same item is refused and creates no second task. Conversion leaves a GAP in the goal\'s hand-made order: the surviving items keep their relative positions and nothing is renumbered.',
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
