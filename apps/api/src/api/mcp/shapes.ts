import { labelOf, type GoalView, type ReadingView, type TaskDetailView, type TaskView, type WeekView } from '@goal-cascade/shared';
import type { CallToolResult } from '@modelcontextprotocol/server';
import type { DependencyContainer } from 'tsyringe';
import type { RequestContext } from '../../application/context';
import { IIdGenerator } from '../../application/ports';
import { notFound } from '../../domain/errors';
import { resolveWeek } from '../week';

/**
 * Everything a tool needs, resolved ONCE per HTTP request.
 *
 * `ctx` is the load-bearing field. It carries the `userId` resolved from the verified bearer token in
 * `mcp.routes.ts`, and it is CLOSED OVER by the server factory — no tool receives a user id as an
 * argument, so no tool can forget to scope and no tool argument can be made to point at another account.
 * That is the whole scoping story; there is no second mechanism and no per-tool check to get wrong.
 */
export type McpDeps = {
  dc: DependencyContainer;
  ctx: RequestContext;
  /**
   * Better Auth's password change, injected rather than resolved, because password hashing belongs to
   * Better Auth and Better Auth is built per REQUEST (it needs the D1 binding and the origin) — an
   * `application/` service cannot reach it. `mcp.routes.ts` supplies the closure.
   *
   * The design document recommended not exposing this at all (rail 2: an agent that changes the password
   * from a mis-parsed instruction or a prompt injection locks the owner out permanently, and this
   * deployment cannot send recovery mail). The owner was shown that reasoning and explicitly chose full
   * unrestricted access, so the tool ships. The risk is real and unchanged; it is accepted, not solved.
   */
  changePassword: (currentPassword: string, newPassword: string, revokeOtherSessions: boolean) => Promise<void>;
};

/**
 * An offset (0 = this week, negative = back, **positive = ahead**) as the absolute Monday everything
 * below the wire uses.
 *
 * ⚠ **A2 (R-lens-7, R-rm-3)** — this used to clamp at `MCP_WEEK_HISTORY = 521` and refuse every positive
 * offset, because `/api/*` clamped at the week switcher's 8-week window and an agent has no switcher.
 * Both bounds are gone from `resolveWeek` itself: there is no forward cap at any horizon and no backward
 * one either. What remains is `WeekOffset`'s own `±520`, which each tool's input schema enforces — the
 * absolute storage range, not a product rule.
 */
export function week(ctx: RequestContext, offset = 0): WeekView {
  return resolveWeek(ctx, offset);
}

/** The `week` block on every week-scoped tool result, in the surface's snake_case. */
export function weekOut(w: WeekView) {
  return { week_start: w.weekStart, offset: w.offset, is_current: w.isCurrent, is_past: w.isPast };
}

/**
 * A fresh idempotency key for ONE mutating tool call.
 *
 * The design's rail 6 is that the AGENT never supplies one: a model cannot reliably reason about when
 * two calls are "the same operation", and a reused key across genuinely different intents replays a
 * stale result that looks like success. So the server mints one per invocation.
 *
 * What that does NOT buy, and the design document overstates: protection against a dropped response.
 * That requires the CLIENT to send the identical key again, and the stateless MCP transport gives us no
 * hook to make it do so — one POST is one complete interaction. A per-invocation key is exactly the
 * guarantee that is implementable here, and it is recorded on `ctx` so anything downstream that reads
 * it sees a real value rather than `null`.
 */
export function stampIdempotencyKey(deps: McpDeps): void {
  deps.ctx.idempotencyKey = deps.dc.resolve<{ ulid(): string }>(IIdGenerator).ulid();
}

/** A successful tool result: the JSON payload as text, which is what a model actually reads. */
export function ok(payload: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

function shortDate(date: string): string {
  const [, month, day] = date.split('-');
  return `${Number(day)} ${MONTHS[Number(month) - 1]}`;
}

/**
 * The carry chip, rendered server-side so the agent quotes the same words the owner sees in the UI.
 *
 * ⚠ **A2 (R-task-43)** — `carryAge` is SIGNED, so `<= 0` covers both "created this period" and "planned
 * for a period that has not arrived". No label fires at either, which is R-lens-11: the only escalation
 * in the product must never fire at a plan.
 *
 * ⚠ **A8 (R-task-54)** — counted in the task's own unit, `weeks` or `months`, and rendered in it. A month
 * task that has carried since August says `3 months · since Aug` in November, in the one place where the
 * unit means something. **It says nothing at all inside a week** — the month band renders no label of any
 * kind (S-lens-31-2) — and that suppression belongs to the surface, not to this string.
 */
function carryLabel(carryAge: number, carryUnit: 'weeks' | 'months', originPeriodKey: string): string {
  if (carryAge <= 0) return '';
  const since = carryUnit === 'months' ? labelOf('Monthly', originPeriodKey).split(' ')[0]! : shortDate(originPeriodKey);
  return carryAge === 1 ? `since ${since}` : `${carryAge} ${carryUnit} · since ${since}`;
}

/**
 * ⚠ **A8, new (R-measure-2/3/4)** — a measure, as the surface shapes it.
 *
 * `progress` is **absent from the payload** when there is no target or when `target === start`, rather
 * than being `null`, `0`, `NaN` or `100`: an agent reading a field that is not there cannot report a
 * percentage the product refuses to compute (R-measure-4, S-measure-4-3).
 *
 * `reading_count` is here and the readings themselves are not: a list result must not carry ninety values
 * per row. `list_readings` fetches them when they are actually wanted.
 */
function measureOut(m: NonNullable<TaskView['measure']>) {
  return {
    kind: m.kind,
    start: m.start,
    /** **Derived** from the readings (R-measure-3). Never sent by an agent, never patchable. */
    current: m.current,
    target: m.target,
    unit: m.unit,
    ...(m.progress === null ? {} : { progress: m.progress }),
    /** What the owner sees on the row: `12 / 15 leads`, or `12 leads` with no target. */
    label: `${m.current}${m.target === null ? '' : ` / ${m.target}`}${m.unit ? ` ${m.unit}` : ''}`,
  };
}

/** ⚠ **A8 (R-measure-5)** — one reading. No week, no month, no period: it follows the TASK. */
export function readingOut(r: ReadingView) {
  return { id: r.id, task_id: r.taskId, value: r.value, at: r.at };
}

/**
 * A task as the MCP surface shapes it. `TaskDetailView` extends `TaskView` with `events`, so one
 * function covers both list and detail results and the timeline rides along only when it exists.
 */
export function taskOut(
  v: TaskView | TaskDetailView,
  goalPath: string | undefined,
  opts: { suppressCarryLabel?: boolean } = {},
) {
  const events = 'events' in v ? v.events : undefined;
  const readings = 'readings' in v ? v.readings : undefined;
  return {
    id: v.id,
    goal_id: v.goalId,
    goal_path: goalPath,
    title: v.title,
    cond: v.cond,
    description: v.description,
    links: v.links.map((l) => ({ id: l.id, url: l.url, created_at: l.createdAt })),
    status: v.status,
    done: v.done,
    /**
     * ⚠ **A8 (R-task-52)** — `Monthly` or `Weekly`, and the key's FORMAT matches it: `2026-09` or the
     * Monday `2026-09-07`. Every visibility, carry and completion comparison is made within one scope.
     */
    scope: v.scope,
    origin_period_key: v.originPeriodKey,
    done_period_key: v.donePeriodKey,
    done_at: v.doneAt,
    exit_reason: v.exitReason,
    exited_at: v.exitedAt,
    /** ⚠ **A2** — signed. Negative means "planned ahead, not yet due" (R-task-43). */
    carry_age: v.carryAge,
    /** ⚠ **A8 (R-task-54)** — `weeks` or `months`. Never report an age without reading this. */
    carry_unit: v.carryUnit,
    /**
     * ⚠ **A8 (R-task-54)** — `''` when the SURFACE is a week and the task is a month task
     * (S-lens-31-2). The caller passes the flag; the age beside it stays honest, because the same task
     * in the Monthly lens must still earn its chip.
     */
    carry_label: opts.suppressCarryLabel ? '' : carryLabel(v.carryAge, v.carryUnit, v.originPeriodKey),
    /**
     * R-task-44 / R-task-55 — false in a future period; there is no legal completion period for it yet.
     * ⚠ **A8** — the bound is at the TASK'S OWN SCOPE, so for a month task this answers about its MONTH.
     */
    completable: v.completable,
    /** ⚠ **A8 (R-measure-1)** — `null` on an ordinary checkbox, which is most tasks. */
    measure: v.measure ? measureOut(v.measure) : null,
    created_at: v.createdAt,
    updated_at: v.updatedAt,
    ...(events ? { events } : {}),
    ...(readings ? { reading_count: readings.length } : {}),
  };
}

/**
 * One goal, as the MCP surface shapes it: snake_case, with the derived fields the SERVER computed.
 * Nothing here is re-derived from a client clock.
 *
 * ⚠ **A2 (R-rm-2, R-goal-37)** — `focus`, `is_leaf`, `is_active`, `dormant`, `subtree_active`,
 * `branches` and `can_hold_focus` are all GONE, because the concepts are. What replaced them:
 *
 *  - **`is_weekly`** — the ONE thing that decides whether a goal can hold a task (R-goal-39). It is the
 *    horizon and never leaf-ness: `can_hold_focus` used to answer "is this a non-Life leaf", and a
 *    childless Monthly goal answered yes to that and must answer NO to this.
 *  - **`period_key`** — the canonical period (R-goal-33), so an agent can compare and sort periods
 *    rather than parsing a label.
 *  - **`life_root_id`** — the group the item belongs to, resolved by the server (R-lens-3). `null` means
 *    the chain does not reach a life goal: the item is UNSORTED, which is a data problem to surface, not
 *    a state to act on.
 */
export function goalOut(g: GoalView) {
  return {
    id: g.id,
    path: g.title,
    title: g.title,
    horizon: g.horizon,
    period: g.period,
    period_key: g.periodKey,
    why: g.why,
    pulse: g.pulse,
    parent_id: g.parentId,
    life_root_id: g.lifeRootId,
    /** R-goal-39 — the whole task-ownership condition, stated once so an agent never has to infer it. */
    is_weekly: g.horizon === 'Weekly',
    backlog_count: g.backlogCount,
    carrying: g.carrying ? { open_tasks: g.carrying.openTasks, oldest_weeks: g.carrying.oldestWeeks } : null,
    /** R-goal-43 — on a weekly goal whose week has arrived; the UI shows a muted line from 2 up. */
    planned_age_weeks: g.plannedAgeWeeks,
    /** R-goal-47 — on a monthly goal: how the month is broken into weeks. Null at every other horizon. */
    weekly_breakdown: g.weeklyBreakdown
      ? { weekly_goals: g.weeklyBreakdown.weeklyGoals, this_week: g.weeklyBreakdown.thisWeek }
      : null,
    created_at: g.createdAt,
    updated_at: g.updatedAt,
  };
}

/**
 * A lens as an indented, readable block — the form an agent should read to REASON, as opposed to the
 * JSON one, which is for exact field access.
 *
 * ⚠ **A2 (R-lens-1)** — this used to be a TREE outline, indented by ancestor depth, with an `ACTIVE:`
 * line carrying the focus sentence. There is no tree to indent and no focus to print. A lens is a FLAT
 * list grouped under the life goal each item belongs to, so the grouping is the only indentation there
 * is, and `UNSORTED` is pinned last (R-lens-20).
 */
export function lensOutline(groups: readonly { id: string | null; title: string; openTasks: number }[], items: readonly GoalView[]): string {
  const lines: string[] = [];
  for (const group of groups) {
    const count = group.openTasks > 0 ? ` · ${group.openTasks} open` : '';
    lines.push(`${group.title}${count}`);
    for (const g of items.filter((i) => i.lifeRootId === group.id)) {
      const meta = [g.horizon, g.period, g.pulse].filter(Boolean).join(' · ');
      const backlog = g.backlogCount > 0 ? ` · ${g.backlogCount} in backlog` : '';
      const stale = g.plannedAgeWeeks !== null && g.plannedAgeWeeks >= 2 ? ` · planned ${g.plannedAgeWeeks} weeks ago` : '';
      lines.push(`  - ${g.title} [${g.id}] (${meta})${backlog}${stale}`);
    }
  }
  return lines.join('\n');
}

/** The owner's goal, or `NOT_FOUND` — the same refusal another owner's id gets (R-auth-3). */
export function requireGoal(goals: readonly GoalView[], goalId: string): GoalView {
  const g = goals.find((x) => x.id === goalId);
  if (!g) throw notFound('goal');
  return g;
}

// ─────────────────────────────────────────────────────────────────────────────
// find_goal — the ONE place fuzziness is allowed, and it is read-only
// ─────────────────────────────────────────────────────────────────────────────
//
// ⚠ **R-nav-31 — `fold`, `GoalMatch`, `rankGoals` and `isAmbiguous` MOVED to
// `packages/shared/src/search/rank-goals.ts`.** The web app's one goal picker ranks its options with the
// same function, so a phrase the owner types and a phrase the assistant is given resolve in the same
// order. `tools/goals.ts` imports them from `@goal-cascade/shared`; nothing here re-exports them, because
// a re-export would let a second copy grow back behind this file's name.
