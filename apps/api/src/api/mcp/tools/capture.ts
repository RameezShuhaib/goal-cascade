import { CaptureText, Ulid } from '@goal-cascade/shared';
import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { GoalService, LearningService } from '../../../application/services';
import { guard } from '../errors';
import { ok, stampIdempotencyKey, type McpDeps } from '../shapes';

/**
 * Learnings — the capture surface.
 *
 * A learning's TAG must be a LIFE goal (or null), and a learning is never converted into work: there is
 * deliberately no tool here that turns one into a task or a backlog item.
 *
 * ⚠ **A2 (R-lens-16, R-lens-27)** — the tag titles come from the **Life lens**, which is bounded by the
 * number of Life lines. It used to read the whole goal tree to build a path index, for a label.
 */
export function registerCaptureTools(server: McpServer, deps: McpDeps): void {
  const { dc, ctx } = deps;

  const lifeTitles = async () => {
    const life = await dc.resolve(GoalService).lens(ctx, { lens: 'Life' });
    return new Map(life.items.map((g) => [g.id, { title: g.title }]));
  };

  // ── Learnings ──────────────────────────────────────────────────────────────────────────────────
  server.registerTool(
    'list_learnings',
    {
      title: 'Insights that might change the plan',
      description:
        'Insights that might change the plan, newest first, with their Life-goal tag (null = "Unsorted") and the `applied` ("changed the plan") badge. Not a journal, and never converted into work — there is no tool that turns a learning into a task or a backlog item.',
      inputSchema: z.object({}).strict(),
    },
    async () =>
      guard(async () => {
        const [res, titles] = await Promise.all([dc.resolve(LearningService).list(ctx), lifeTitles()]);
        return ok({
          learnings: res.learnings.map((l) => ({ ...l, goal_title: l.goalId ? (titles.get(l.goalId)?.title ?? null) : null })),
          server_now: res.serverNow,
        });
      }),
  );

  server.registerTool(
    'capture_learning',
    {
      title: 'Record an insight',
      description:
        'Record an insight. The optional tag is a LIFE goal or nothing. Set applied=true only when the user states that a decision actually changed as a result — the badge is a claim about something they did, not something to infer from the text.',
      inputSchema: z
        .object({
          text: CaptureText,
          goal_id: Ulid.nullable().default(null).describe('A LIFE goal, or null.'),
          applied: z.boolean().default(false).describe('The "changed the plan" badge. Only on an explicit statement.'),
        })
        .strict(),
    },
    async ({ text, goal_id, applied }) =>
      guard(async () => {
        stampIdempotencyKey(deps);
        const res = await dc.resolve(LearningService).create(ctx, { text, goalId: goal_id, applied });
        return ok({ learning: res.learning, server_now: res.serverNow });
      }),
  );

  server.registerTool(
    'update_learning',
    {
      title: 'Edit a learning',
      description:
        "Edit a learning's text, or set/clear the \"changed the plan\" badge. Only set applied=true when the user says a decision actually changed. At least one field must be given.",
      inputSchema: z.object({ learning_id: Ulid, text: CaptureText.optional(), applied: z.boolean().optional() }).strict(),
    },
    async ({ learning_id, ...patch }) =>
      guard(async () => {
        stampIdempotencyKey(deps);
        const res = await dc.resolve(LearningService).patch(ctx, learning_id, patch);
        return ok({ learning: res.learning, server_now: res.serverNow });
      }),
  );

  server.registerTool(
    'attach_learning_to_goal',
    {
      title: 'Re-tag a learning',
      description:
        'Re-tag a learning to a LIFE goal, or pass null to move it back to "Unsorted". A non-Life goal is refused. A learning is never converted into work — there is deliberately no tool that turns one into a task or a backlog item.',
      inputSchema: z.object({ learning_id: Ulid, goal_id: Ulid.nullable().describe('A LIFE goal, or null for Unsorted.') }).strict(),
    },
    async ({ learning_id, goal_id }) =>
      guard(async () => {
        stampIdempotencyKey(deps);
        const res = await dc.resolve(LearningService).attach(ctx, learning_id, { goalId: goal_id });
        return ok({ learning: res.learning, server_now: res.serverNow });
      }),
  );

  server.registerTool(
    'discard_learning',
    {
      title: 'Delete a learning',
      description: 'Permanently delete a learning. There is no archive and no undo. Say what you are discarding first.',
      inputSchema: z.object({ learning_id: Ulid }).strict(),
    },
    async ({ learning_id }) =>
      guard(async () => {
        stampIdempotencyKey(deps);
        const res = await dc.resolve(LearningService).remove(ctx, learning_id);
        return ok({ deleted: res.deleted, server_now: res.serverNow });
      }),
  );
}
