import { ERROR_STATUS, WEEK_HISTORY_WEEKS } from '@goal-cascade/shared';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/server';
import {
  BacklogService,
  GoalService,
  LearningService,
  MeService,
  PlanService,
  TaskService,
} from '../../application/services';
import { DomainError } from '../../domain/errors';
import { offsetOf } from '../../domain/weeks';
import { BUSINESS_RULES_MD } from './business-rules';
import { errorCatalogue } from './errors';
import { goalOut, outline, pathIndex, week, weekOut, type McpDeps } from './shapes';

/**
 * ~300 words on the one thing an agent is most likely to get wrong. It is static, so it costs nothing to
 * read and can be pulled once per session instead of being re-derived from tool descriptions.
 */
const WEEK_MODEL_MD = `# The Goal Cascade week model

**Weeks start on Monday, in the OWNER's timezone.** The server resolves it from \`preferences.timezone\`
on every request. Never compute a week from your own clock, and never from the user's stated location —
two devices in different zones must agree on "this week", and the server is what makes them.

**A week is stored as an absolute date: the ISO \`YYYY-MM-DD\` of its Monday.** Never an offset. An offset
means something different every Monday with no write, so a task recorded as "-2 weeks" would silently age
by one every seven days and the red carry chip would fire on tasks nobody neglected.

**Tools address a week by OFFSET.** \`0\` is this week, \`-1\` last week, \`-8\` eight weeks back. Positive
offsets do not exist: no screen and no tool in this product can select a future week, and a positive
value is a validation failure rather than an empty result.

**The one exception is \`save_weekly_plan\`,** which takes the absolute Monday (\`week_start\`) that a read
just handed you. That is deliberate: a plan save that crossed a Monday boundary while you were composing
it fails loudly with \`WEEK_NOT_CURRENT\` instead of writing into last week. Always take the value from a
\`get_weekly_plan\` or \`get_overview\` response in the same session — never construct it.

**Carrying is a read, not a job.** An open task is visible in every week whose Monday is >= its
\`origin_week_start\`. Nothing rewrites rows on a Monday; there is no cron in this product at all. A DONE
task is visible only in the week it was completed. A cancelled or moved-to-backlog task is visible in no
week.

**Carry age is computed against the week you asked for**, not against today. \`list_tasks(week_offset=-3)\`
reports ages as they stood in that week.

**Only the CURRENT week can be planned.** Past weeks stay fully editable for TASKS — you may complete a
task into any week from its origin onward — but their focus sentences are history and cannot be rewritten.

The week switcher in the UI reaches back ${WEEK_HISTORY_WEEKS} weeks; MCP tools reach back 520.`;

/**
 * Resources — stable, re-readable context an agent pulls once and stops asking for.
 *
 * Every one is owner-scoped through the same closed-over `ctx` the tools use. Deliberately NOT resources:
 * anything paginated or unbounded (task activity timelines, historical tasks across all weeks). Those
 * stay behind tools so the agent pays for what it asks for.
 *
 * Note the per-family error surfacing the SDK applies: a thrown error in a `resources/read` becomes a
 * JSON-RPC error, not an `isError` result. So these throw rather than returning the tool-error envelope.
 */
export function registerResources(server: McpServer, deps: McpDeps): void {
  const { dc, ctx } = deps;
  const json = (uri: URL, value: unknown) => ({
    contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(value, null, 2) }],
  });
  const md = (uri: URL, text: string) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text }] });

  server.registerResource(
    'goal-tree',
    'goalcascade://tree',
    { title: 'Goal tree (JSON)', description: "The full goal tree for the current week, with the server's derived active/dormant flags.", mimeType: 'application/json' },
    async (uri) => {
      const w = week(ctx, 0);
      const { goals, serverNow } = await dc.resolve(GoalService).list(ctx, w);
      const paths = pathIndex(goals);
      return json(uri, { week: weekOut(w), goals: goals.map((g) => goalOut(g, paths, goals)), server_now: serverNow });
    },
  );

  server.registerResource(
    'goal-tree-outline',
    'goalcascade://tree/outline',
    {
      title: 'Goal tree (outline)',
      description: 'The tree as an indented outline, one line per goal with its ULID. Read THIS to reason; read goalcascade://tree for exact field access.',
      mimeType: 'text/markdown',
    },
    async (uri) => {
      const { goals } = await dc.resolve(GoalService).list(ctx, week(ctx, 0));
      return md(uri, outline(goals));
    },
  );

  server.registerResource(
    'week-current',
    'goalcascade://week/current',
    { title: 'This week', description: "This week's plan entries, tasks with carry labels, and the leaves that are dormant.", mimeType: 'application/json' },
    async (uri) => json(uri, await weekSnapshot(deps, week(ctx, 0).weekStart)),
  );

  server.registerResource(
    'week-by-date',
    new ResourceTemplate('goalcascade://week/{week_start}', { list: undefined }),
    {
      title: 'A past week',
      description: 'The same snapshot for a past week, addressed by its Monday (YYYY-MM-DD). Future weeks are never resolvable.',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const raw = String(variables.week_start ?? '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new DomainError('VALIDATION_FAILED', 'week must be YYYY-MM-DD');
      // Resolving through `offsetOf` and back is what enforces "Monday" and "not the future" with the
      // SAME code path a tool's `week_offset` takes — a second date check here would be a second rule.
      const offset = offsetOf(raw, ctx.currentWeekStart);
      const w = week(ctx, offset);
      if (w.weekStart !== raw) throw new DomainError('WEEK_OUT_OF_RANGE', `${raw} is not an addressable week Monday`);
      return json(uri, await weekSnapshot(deps, w.weekStart));
    },
  );

  server.registerResource(
    'backlog',
    'goalcascade://backlog',
    { title: 'Backlog', description: 'Every open backlog item with its branch path.', mimeType: 'application/json' },
    async (uri) => {
      const [res, tree] = await Promise.all([
        dc.resolve(BacklogService).list(ctx, {}),
        dc.resolve(GoalService).list(ctx, week(ctx, 0)),
      ]);
      const paths = pathIndex(tree.goals);
      return json(uri, { items: res.items.map((i) => ({ ...i, goal_path: paths.get(i.goalId) })), server_now: res.serverNow });
    },
  );

  server.registerResource(
    'learnings',
    'goalcascade://learnings',
    { title: 'Learnings', description: 'Insights, newest first, with the "changed the plan" badge.', mimeType: 'application/json' },
    async (uri) => json(uri, await dc.resolve(LearningService).list(ctx)),
  );

  server.registerResource(
    'account',
    'goalcascade://account',
    { title: 'Account', description: 'User, preferences, the authoritative timezone, and the current week.', mimeType: 'application/json' },
    async (uri) => {
      const me = await dc.resolve(MeService).getMe(ctx);
      return json(uri, {
        user: { id: me.user.id, name: me.user.name, email: me.user.email, email_verified: me.user.emailVerified },
        preferences: me.preferences,
        week: weekOut(week(ctx, 0)),
        week_history_weeks: WEEK_HISTORY_WEEKS,
        server_now: me.serverNow,
      });
    },
  );

  server.registerResource(
    'rules-business-rules',
    'goalcascade://rules/business-rules',
    { title: 'Business rules', description: "The product's own rules document, verbatim. The authoritative prose on horizons, the three exits and the week model.", mimeType: 'text/markdown' },
    async (uri) => md(uri, BUSINESS_RULES_MD),
  );

  server.registerResource(
    'rules-errors',
    'goalcascade://rules/errors',
    { title: 'Error catalogue', description: 'Every error code with its status, whether retrying could ever help, and the recovery move.', mimeType: 'application/json' },
    async (uri) => json(uri, errorCatalogue(ERROR_STATUS)),
  );

  server.registerResource(
    'rules-week-model',
    'goalcascade://rules/week-model',
    { title: 'The week model', description: 'Monday weeks, offsets vs. absolute week_start, auto-carry, and which tools take which. The single thing most likely to be got wrong.', mimeType: 'text/markdown' },
    async (uri) => md(uri, WEEK_MODEL_MD),
  );
}

/** One week: its plan with goal paths, its tasks with carry ages, and the leaves that are dormant. */
async function weekSnapshot(deps: McpDeps, weekStart: string) {
  const { dc, ctx } = deps;
  const [plan, tasks, tree] = await Promise.all([
    dc.resolve(PlanService).get(ctx, { weekStart }),
    dc.resolve(TaskService).list(ctx, { weekStart }),
    dc.resolve(GoalService).list(ctx, { weekStart }),
  ]);
  const paths = pathIndex(tree.goals);
  return {
    week: weekOut(plan.week),
    plan: plan.entries.map((e) => ({ goal_id: e.goalId, goal_path: paths.get(e.goalId), sentence: e.sentence })),
    tasks: tasks.tasks.map((t) => ({ ...t, goal_path: paths.get(t.goalId) })),
    dormant_leaves: tree.goals.filter((g) => g.dormant).map((g) => ({ id: g.id, path: paths.get(g.id) })),
    server_now: plan.serverNow,
  };
}
