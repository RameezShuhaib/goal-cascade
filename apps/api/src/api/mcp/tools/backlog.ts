import { LongText, MAX_LINKS, OneLiner, Title, Ulid, Url } from '@goal-cascade/shared';
import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { BacklogService, GoalService } from '../../../application/services';
import { guard } from '../errors';
import { activeLeafCandidates, ok, pathIndex, stampIdempotencyKey, subtreeIds, taskOut, week, type McpDeps } from '../shapes';

export function registerBacklogTools(server: McpServer, deps: McpDeps): void {
  const { dc, ctx } = deps;

  // ── list_backlog ───────────────────────────────────────────────────────────────────────────────
  server.registerTool(
    'list_backlog',
    {
      title: 'Deferred work, by branch',
      description:
        'Deferred future work, grouped by branch, newest first. Backlog items have no checkbox, no done-condition, no due date and no status — that poverty is deliberate, not missing features. Converted items are never listed. `convertible` says whether an active leaf exists at or under the item\'s goal right now, i.e. whether it could become a task this week; `active_leaf_candidates` names them.',
      inputSchema: z
        .object({
          goal_id: Ulid.optional().describe("Narrow to one goal's OWN items."),
          under_goal_id: Ulid.optional().describe('Narrow to a whole subtree — use this for "everything under my health line".'),
          convertible_only: z.boolean().default(false),
        })
        .strict(),
    },
    async ({ goal_id, under_goal_id, convertible_only }) =>
      guard(async () => {
        const w = week(ctx, 0);
        const [res, tree] = await Promise.all([
          dc.resolve(BacklogService).list(ctx, goal_id ? { goalId: goal_id } : {}),
          dc.resolve(GoalService).list(ctx, w),
        ]);
        const paths = pathIndex(tree.goals);
        const scope = under_goal_id ? subtreeIds(tree.goals, under_goal_id) : null;
        const items = res.items
          .filter((i) => !scope || scope.has(i.goalId))
          .map((i) => {
            const candidates = activeLeafCandidates(tree.goals, i.goalId);
            return { ...i, goal_path: paths.get(i.goalId), convertible: candidates.length > 0, active_leaf_candidates: candidates };
          })
          .filter((i) => !convertible_only || i.convertible);
        return ok({ items, server_now: res.serverNow });
      }),
  );

  // ── create_backlog_item ────────────────────────────────────────────────────────────────────────
  server.registerTool(
    'create_backlog_item',
    {
      title: 'Park work under a goal',
      description:
        'Park work under a Yearly, Quarterly or Monthly goal. NEVER a Life goal and never a week — a Life goal is refused. Use find_goal(only="can_hold_backlog") to pick a valid target.',
      inputSchema: z
        .object({
          goal_id: Ulid.describe('A non-Life goal.'),
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
        'Re-home a parked item under a different NON-Life goal. Its captured date and its "from week of …" note do not change. If you read this item id off a Life goal\'s get_goal response, check backlog_is_aggregate first — that list is a read-only roll-up of descendants and its ids belong to those descendants, not to the Life goal.',
      inputSchema: z.object({ item_id: Ulid, goal_id: Ulid.describe('The new owner. Non-Life.') }).strict(),
    },
    async ({ item_id, goal_id }) =>
      guard(async () => {
        stampIdempotencyKey(deps);
        const res = await dc.resolve(BacklogService).move(ctx, item_id, { goalId: goal_id });
        const tree = await dc.resolve(GoalService).list(ctx, week(ctx, 0));
        return ok({ item: res.item, new_goal_path: pathIndex(tree.goals).get(res.item.goalId), server_now: res.serverNow });
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
      title: 'Pull a parked item into this week',
      description:
        'The ONLY way backlog becomes work. The item is CONSUMED and becomes a task in one atomic operation — never duplicated, never left behind. Say so before the first conversion. The task lands under an ACTIVE leaf at or under the item\'s goal: if exactly one such leaf exists it is used; if several do you MUST name one with goal_id (the server refuses to pick, because that id decides which focus the task belongs to for the rest of its life); if none does, the branch is not active this week and you must activate it with set_goal_focus first. A second conversion of the same item is refused and creates no second task.',
      inputSchema: z
        .object({
          item_id: Ulid,
          goal_id: Ulid.optional().describe('An ACTIVE leaf at or under the item\'s goal. Required when more than one qualifies.'),
          title: Title.optional().describe("Override the item's title on the created task."),
          cond: OneLiner.default(''),
        })
        .strict(),
    },
    async ({ item_id, goal_id, title, cond }) =>
      guard(async () => {
        stampIdempotencyKey(deps);
        const res = await dc.resolve(BacklogService).convert(ctx, item_id, {
          ...(goal_id !== undefined ? { goalId: goal_id } : {}),
          ...(title !== undefined ? { title } : {}),
          cond,
        });
        const tree = await dc.resolve(GoalService).list(ctx, week(ctx, 0));
        // Through `taskOut` like every other task result: a conversion must not hand the agent a
        // differently-shaped task from the one `create_task` returns.
        return ok({ task: taskOut(res.task, pathIndex(tree.goals).get(res.task.goalId)), item: res.item, server_now: res.serverNow });
      }),
  );
}
