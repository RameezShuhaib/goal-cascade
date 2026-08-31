import { CaptureText, OneLiner, Title, Ulid } from '@goal-cascade/shared';
import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { GoalService, IdeaService, LearningService } from '../../../application/services';
import { guard } from '../errors';
import { ok, pathIndex, stampIdempotencyKey, taskOut, week, type McpDeps } from '../shapes';

/**
 * Ideas and learnings — the two capture surfaces.
 *
 * Note the asymmetry the tool descriptions have to teach, because it is genuinely counter-intuitive and
 * an agent will otherwise get it backwards: an idea's TAG must be a LIFE goal (or null), while an idea's
 * ATTACH target must be a NON-Life goal. Different fields, different rules, both enforced server-side.
 */
export function registerCaptureTools(server: McpServer, deps: McpDeps): void {
  const { dc, ctx } = deps;

  const lifeTitles = async () => {
    const tree = await dc.resolve(GoalService).list(ctx, week(ctx, 0));
    const paths = pathIndex(tree.goals);
    return new Map(tree.goals.map((g) => [g.id, { title: g.title, path: paths.get(g.id) }]));
  };

  // ── Ideas ──────────────────────────────────────────────────────────────────────────────────────
  server.registerTool(
    'list_ideas',
    {
      title: 'The parking lot',
      description:
        'Parked thoughts, newest first, each with its optional Life-goal tag (null = "Unsorted"). These are two-second captures, not documents — keep any summary short.',
      inputSchema: z.object({}).strict(),
    },
    async () =>
      guard(async () => {
        const [res, titles] = await Promise.all([dc.resolve(IdeaService).list(ctx), lifeTitles()]);
        return ok({
          ideas: res.ideas.map((i) => ({ ...i, goal_title: i.goalId ? (titles.get(i.goalId)?.title ?? null) : null })),
          server_now: res.serverNow,
        });
      }),
  );

  server.registerTool(
    'capture_idea',
    {
      title: 'Park a thought',
      description:
        'Park a distracting thought in two seconds. Text only. The optional tag is a LIFE goal or nothing — a non-Life goal is refused here (that rule is the opposite of attach_idea_to_goal, which requires a non-Life goal).',
      inputSchema: z.object({ text: CaptureText, goal_id: Ulid.nullable().default(null).describe('A LIFE goal, or null.') }).strict(),
    },
    async ({ text, goal_id }) =>
      guard(async () => {
        stampIdempotencyKey(deps);
        const res = await dc.resolve(IdeaService).create(ctx, { text, goalId: goal_id });
        return ok({ idea: res.idea, server_now: res.serverNow });
      }),
  );

  server.registerTool(
    'attach_idea_to_goal',
    {
      title: "Send an idea to a goal's backlog",
      description:
        "Send an idea to a goal's backlog. The idea's text becomes a backlog item on the chosen NON-Life goal and the idea is removed, in one operation. The target must be Yearly, Quarterly or Monthly — a Life goal is refused, because Life goals hold no backlog.",
      inputSchema: z.object({ idea_id: Ulid, goal_id: Ulid.describe('A NON-Life goal.') }).strict(),
    },
    async ({ idea_id, goal_id }) =>
      guard(async () => {
        stampIdempotencyKey(deps);
        const res = await dc.resolve(IdeaService).attach(ctx, idea_id, { goalId: goal_id });
        return ok({ item: res.item, idea_id: res.ideaId, server_now: res.serverNow });
      }),
  );

  server.registerTool(
    'convert_idea_to_task',
    {
      title: 'Turn an idea into a task this week',
      description:
        '"Task this week": the idea becomes a task under an ACTIVE non-Life leaf and is consumed — but ONLY if the task is actually created; a failure leaves the idea parked. If no branch is active, activate one with set_goal_focus first and ask the user; never route the task to a fallback goal. Without a title override the task takes the idea\'s text.',
      inputSchema: z
        .object({ idea_id: Ulid, goal_id: Ulid.describe('An ACTIVE non-Life leaf.'), title: Title.optional(), cond: OneLiner.default('') })
        .strict(),
    },
    async ({ idea_id, goal_id, title, cond }) =>
      guard(async () => {
        stampIdempotencyKey(deps);
        const res = await dc
          .resolve(IdeaService)
          .convert(ctx, idea_id, { goalId: goal_id, ...(title !== undefined ? { title } : {}), cond });
        const tree = await dc.resolve(GoalService).list(ctx, week(ctx, 0));
        return ok({ task: taskOut(res.task, pathIndex(tree.goals).get(res.task.goalId)), idea_id: res.ideaId, server_now: res.serverNow });
      }),
  );

  server.registerTool(
    'delete_idea',
    {
      title: 'Discard a parked idea',
      description:
        'Discard a parked idea. There is no undo. The product requires no confirmation, but say what you are deleting first, and do not batch — one decision at a time.',
      inputSchema: z.object({ idea_id: Ulid }).strict(),
    },
    async ({ idea_id }) =>
      guard(async () => {
        stampIdempotencyKey(deps);
        const res = await dc.resolve(IdeaService).remove(ctx, idea_id);
        return ok({ deleted: res.deleted, server_now: res.serverNow });
      }),
  );

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
