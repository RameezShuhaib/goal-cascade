import { ERROR_STATUS } from '@goal-cascade/shared';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/server';
import { BacklogService, GoalService, LearningService, MeService } from '../../application/services';
import { DomainError } from '../../domain/errors';
import { offsetOf } from '../../domain/weeks';
import { BUSINESS_RULES_MD } from './business-rules';
import { errorCatalogue } from './errors';
import { goalOut, lensOutline, week, weekOut, type McpDeps } from './shapes';


/**
 * ~350 words on the one thing an agent is most likely to get wrong. It is static, so it costs nothing to
 * read and can be pulled once per session instead of being re-derived from tool descriptions.
 *
 * ⚠ **A2** — **this is the resource most likely to be got wrong, and it is rewritten.** Its old text
 * said positive offsets do not exist, that only the current week can be planned, and that
 * `save_weekly_plan` is the one exception that takes an absolute Monday. All three are now false: future
 * weeks are ordinary (R-lens-7), there is no plan to save (R-rm-3), and the refusal that survives is a
 * different one — a write into a PAST period.
 */
const WEEK_MODEL_MD = `# The Goal Cascade week and period model

**Weeks start on Monday, in the OWNER's timezone.** The server resolves it from \`preferences.timezone\`
on every request. Never compute a week from your own clock, and never from the user's stated location —
two devices in different zones must agree on "this week", and the server is what makes them.

**A week is stored as an absolute date: the ISO \`YYYY-MM-DD\` of its Monday.** Never an offset. An offset
means something different every Monday with no write, so a task recorded as "-2 weeks" would silently age
by one every seven days and the red carry chip would fire on tasks nobody neglected.

**Every horizon has a period, and every period has a canonical key.** A year (\`2026\`), a quarter
(\`2026-Q3\`), a month (\`2026-09\`), a week (a Monday, \`2026-09-07\`), and \`''\` for a life goal, which has
none. That key is what every lens filters on, and it sorts chronologically, so you can compare two
periods with a string comparison. Call \`get_period\` to turn "this quarter" into a key rather than
building one.

**Tools address a week by OFFSET.** \`0\` is this week, \`-1\` last week, \`+2\` two weeks ahead. Positive
offsets are **ordinary**: any future period is readable and writable, at every horizon, with no cap.

**What IS refused is a write into the past.** Creating a goal into an earlier period, or moving one
there, is \`PERIOD_IN_PAST\`: planning does not rewrite history. A past period is closed to new plan and to
NOTHING else — you may still edit a title, complete a task that was live that week, or uncheck one. And
completing a task is bounded the other way too: \`origin_week ≤ week ≤ this week\`, so you cannot finish
work in a week that has not happened.

**A weekly goal's week is fixed for good.** It is set at creation and is not re-plannable; moving the
goal to a different parent never changes it. An intention that did not happen carries forward through its
open tasks, or is written again as a new weekly goal.

**A task's week is its OWN field**, taken from its weekly goal when the task is created and immutable
after. It is never re-read from the goal, which is why deleting a goal from a query result changes no
task's week — and why the two legitimately differ once a task carries.

**Carrying is a read, not a job.** An open task is visible in every week whose Monday is >= its
\`origin_week_start\`. Nothing rewrites rows on a Monday; there is no cron in this product at all. Its
weekly goal carries with it, shown separately as CARRIED and labelled with the week it was written for. A
DONE task is visible only in the week it was completed. A cancelled or moved-to-backlog task is visible
in no week.

**Carry age is SIGNED and measured against today**, not against the week you asked for: a task planned
for next week reads \`-1\`, never \`+1\`, so a plan never ages and the red chip never fires at one.`;

/**
 * Resources — stable, re-readable context an agent pulls once and stops asking for.
 *
 * Every one is owner-scoped through the same closed-over `ctx` the tools use. Deliberately NOT resources:
 * anything paginated or unbounded (task activity timelines, historical tasks across all weeks). Those
 * stay behind tools so the agent pays for what it asks for.
 *
 * ⚠ **A2 (R-lens-16, R-rm-2)** — `goalcascade://tree` and `tree/outline` are **deleted**, and nothing
 * replaced them at that URI: there is no whole-tree read to expose, because the goal list grows with every
 * week the owner uses the product (R-lens-27). What an agent reaches for instead is `goalcascade://life`
 * and `goalcascade://week/*` — the latter having lost its plan half and gained the carried band.
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
    'life-goals',
    'goalcascade://life',
    {
      title: 'Life goals (JSON)',
      description:
        'Every life goal — one of the two reads that is not scoped to a period (the other is learnings), and the one list an account never outgrows: life goals are few by construction. Each carries its carrying signal ("N tasks carrying · oldest W weeks"). Everything else is read by lens, one horizon and one period at a time.',
      mimeType: 'application/json',
    },
    async (uri) => {
      const res = await dc.resolve(GoalService).lens(ctx, { lens: 'Life' });
      return json(uri, { goals: res.items.map(goalOut), server_now: res.serverNow });
    },
  );

  server.registerResource(
    'week-current',
    'goalcascade://week/current',
    {
      title: 'This week',
      description:
        "This week's lens: the weekly goals written for it, the ones carrying open work in from earlier weeks, and every task visible in the week with its carry label.",
      mimeType: 'application/json',
    },
    async (uri) => json(uri, await weekSnapshot(deps, week(ctx, 0).weekStart)),
  );

  server.registerResource(
    'week-by-date',
    new ResourceTemplate('goalcascade://week/{week_start}', { list: undefined }),
    {
      title: 'Any week',
      description:
        'The same snapshot for another week, addressed by its Monday (YYYY-MM-DD). ⚠ A2 — a FUTURE week resolves now: planning ahead is unbounded, and a future week renders its plan with no late styling.',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const raw = String(variables.week_start ?? '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new DomainError('VALIDATION_FAILED', 'week must be YYYY-MM-DD');
      // Resolving through `offsetOf` and back is what enforces "Monday" with the SAME code path a tool's
      // `week_offset` takes — a second date check here would be a second rule.
      const w = week(ctx, offsetOf(raw, ctx.currentWeekStart));
      if (w.weekStart !== raw) throw new DomainError('WEEK_OUT_OF_RANGE', `${raw} is not a week Monday`);
      return json(uri, await weekSnapshot(deps, w.weekStart));
    },
  );

  server.registerResource(
    'backlog',
    'goalcascade://backlog',
    { title: 'Backlog', description: 'Every open backlog item, newest first.', mimeType: 'application/json' },
    async (uri) => {
      const res = await dc.resolve(BacklogService).list(ctx, {});
      return json(uri, { items: res.items, next_cursor: res.nextCursor, server_now: res.serverNow });
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
    { title: 'Account', description: 'User, preferences, the authoritative timezone, and the current period at every horizon.', mimeType: 'application/json' },
    async (uri) => {
      const [me, zoom] = await Promise.all([dc.resolve(MeService).getMe(ctx), dc.resolve(GoalService).zoom(ctx)]);
      return json(uri, {
        user: { id: me.user.id, name: me.user.name, email: me.user.email, email_verified: me.user.emailVerified },
        preferences: me.preferences,
        week: weekOut(week(ctx, 0)),
        // R-goal-34 — every "current period" is computed server-side from the account timezone and
        // echoed, so the agent never derives one. Four of them now, not one.
        current_periods: zoom.rows.map((r) => ({ lens: r.lens, period_key: r.periodKey, label: r.label, goals: r.count })),
        server_now: me.serverNow,
      });
    },
  );

  server.registerResource(
    'rules-business-rules',
    'goalcascade://rules/business-rules',
    { title: 'Business rules', description: "The product's own rules document, verbatim. The authoritative prose on horizons, periods, the three exits and the week model.", mimeType: 'text/markdown' },
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
    { title: 'The week and period model', description: 'Monday weeks, canonical period keys, offsets vs. absolute dates, the past-period refusal, auto-carry and signed carry age. The single thing most likely to be got wrong.', mimeType: 'text/markdown' },
    async (uri) => md(uri, WEEK_MODEL_MD),
  );
}

/**
 * One week: its own weekly goals, the ones carrying into it, and its tasks with their carry ages.
 *
 * ⚠ **A2** — the `plan` half is gone with `weekly_focus` (R-rm-2) and `dormant_leaves` with the concept
 * (R-goal-38): nothing in the product is muted or labelled dormant, and the successor signal lives one
 * horizon up on a Monthly goal (R-goal-47). What replaced them is `carried`, which is the half an agent
 * most needs — an open task whose goal's week has passed renders nowhere else.
 */
async function weekSnapshot(deps: McpDeps, weekStart: string) {
  const { dc, ctx } = deps;
  const lens = await dc.resolve(GoalService).lens(ctx, { lens: 'Weekly', period: weekStart });
  return {
    week: weekOut(week(ctx, offsetOf(weekStart, ctx.currentWeekStart))),
    groups: lens.groups.map((g) => ({ id: g.id, title: g.title, open_tasks: g.openTasks })),
    this_week: lens.items.map(goalOut),
    carried: lens.carried.map(goalOut),
    tasks: lens.tasks,
    outline: lensOutline(lens.groups, [...lens.items, ...lens.carried]),
    has_forward_content: lens.hasForwardContent,
    server_now: lens.serverNow,
  };
}
