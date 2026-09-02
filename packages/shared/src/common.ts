import { z } from 'zod';
import { isMonday } from './calendar/weeks';

// ─────────────────────────────────────────────────────────────────────────────
// Scalars. Normalisation happens HERE, in the schema — never in a handler. A value
// that has been through one of these is already in the exact form the API stores.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ISO-8601 instant. Accepts `Z` or an offset on input and NORMALIZES to `Date#toISOString()` form
 * (`2026-08-29T03:14:07.000Z`, 24 chars, millisecond precision, UTC). The API stores and compares
 * timestamps as strings (SPEC Q-7 ordering, range scans, cursors), so every persisted value must be in
 * this exact form; validating through this schema guarantees it for client input.
 */
export const Iso = z.iso
  .datetime({ offset: true })
  .transform((s, ctx) => {
    const t = Date.parse(s);
    if (!Number.isFinite(t)) {
      ctx.addIssue({ code: 'custom', message: 'invalid ISO-8601 datetime' });
      return z.NEVER;
    }
    return new Date(t).toISOString();
  })
  .describe('ISO-8601 UTC timestamp');

/** Every id this product mints is a ULID: sortable by creation time, collision-free (SPEC Q-8). */
export const Ulid = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, 'ULID');

/** Better Auth user ids are not ULIDs; any non-empty id string. */
export const UserId = z.string().min(1).max(64);

export const DateOnly = z.iso.date().describe('YYYY-MM-DD');
export const IanaTimezone = z.string().min(1).max(64);

/**
 * A WEEK, absolutely: the ISO date (`YYYY-MM-DD`) of that week's **Monday**.
 *
 * SPEC D-1 — this is the ONLY form a week is ever stored in. The mockup stored relative offsets, which
 * means every persisted row changes meaning at midnight on Monday: a task written with `originWeek: -2`
 * silently reads as three weeks old the following week, with no write, and the red "N weeks" carry chip
 * fires on tasks nobody neglected. A date is correct forever.
 *
 * Date-only arithmetic makes DST irrelevant (Q-9). The Monday is resolved from the OWNER's timezone
 * (R-auth-5), never the client clock, so two devices in different zones agree on "this week".
 *
 * ⚠ **A2 (R-goal-33)** — a Weekly goal's `periodKey` IS a `WeekStart`. The week model is now a special
 * case of the period model rather than a parallel one, and this is the shared half.
 */
export const WeekStart = z.iso
  .date()
  .refine((d) => new Date(`${d}T00:00:00.000Z`).getUTCDay() === 1, 'weekStart must be a Monday')
  .describe('ISO date of a week Monday');

/**
 * A week, expressed to the CLIENT as an offset from the current week: 0 = this week, -1 = last week,
 * **+1 = next week**.
 *
 * ⚠ **A2 (R-goal-36, R-lens-7, R-rm-3)** — the former `.max(0)` is gone. There is NO forward bound at any
 * horizon: any future period is reachable and writable, and the forward chevron is never disabled. The
 * bound that remains is the absolute storage range in both directions, not a product rule.
 *
 * **This widening is a silent break** and the reason `CompleteTaskRequest.week` now carries its own
 * explicit `.max(0)`: it used to inherit its future-week guard from this line, and would have lost it
 * with no diff of its own (R-task-44, S-rm-3-1).
 *
 * This is a WIRE-FORMAT convenience only (D-1): a request may address a week by offset, and the API
 * resolves it to an absolute `WeekStart` against the owner's timezone at the boundary. Read models
 * always answer with the absolute `WeekStart`, so the client never re-derives one.
 */
export const WeekOffset = z.int().max(520).min(-520).describe('week offset from the current week; 0 = this week');

/** Same thing arriving as a query-string parameter, where every value is a string. */
export const WeekOffsetParam = z.coerce.number().int().max(520).min(-520);

/**
 * ⚠ **A2 (R-goal-30)** — the FIVE horizons, longest first. Rank is the array index:
 * Life 0 › Yearly 1 › Quarterly 2 › Monthly 3 › **Weekly 4**.
 *
 * A child's horizon must be strictly SHORTER (higher rank) than its parent's, so **Weekly** is now the
 * terminal horizon (R-goal-31) and Monthly accepts children; Life is still the only horizon that may sit
 * at the root (R-goal-3). Levels may be SKIPPED (R-goal-32): a Weekly goal may hang off a Monthly,
 * Quarterly, Yearly or Life goal, and none of those is an error.
 *
 * The literals are exactly the strings the UI renders. There is deliberately no display-name mapping.
 */
export const HORIZONS = ['Life', 'Yearly', 'Quarterly', 'Monthly', 'Weekly'] as const;
export const Horizon = z.enum(HORIZONS);

/** R-goal-15 — per-goal health signal. Quiet: it colours a dot, it never gates an action. */
export const PULSES = ['On track', 'At risk', 'Rethink'] as const;
export const Pulse = z.enum(PULSES);

// ─────────────────────────────────────────────────────────────────────────────
// Periods — R-goal-33. The key every lens filters on.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * R-goal-33 — the canonical shape of a `periodKey`, one per horizon. Lexicographic sort order IS
 * chronological order for all four, which is what makes R-goal-47's `BETWEEN` range read and R-lens-26's
 * "any later period" probe single index seeks rather than scans.
 *
 * | Horizon | key | example |
 * |---|---|---|
 * | Life | `''` | — |
 * | Yearly | `YYYY` | `2026` |
 * | Quarterly | `YYYY-Qn` | `2026-Q3` |
 * | Monthly | `YYYY-MM` | `2026-09` |
 * | Weekly | a **Monday** `YYYY-MM-DD` | `2026-09-07` |
 */
const YEAR_RE = /^\d{4}$/;
const QUARTER_RE = /^\d{4}-Q[1-4]$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/*
 * ⚠ **R-lens-30** — the local `isMondayKey` is deleted and `calendar/weeks.isMonday` is used instead.
 * It was the same six lines, and it was the *third* place in the repo that decided what a Monday is.
 * There is one now, and this file's dependency on it is the reason `calendar/weeks.ts` imports nothing:
 * `weeks → nothing`, `common → weeks`, `periods → common`, `period-view → periods` is a DAG.
 */

/**
 * Is `key` the canonical period key for `horizon`?
 *
 * Exported so the client and the server run the **same** predicate. Two implementations of a date rule
 * drift on the first boundary (D-3), and R-goal-33's whole point is that a period is comparable.
 */
export function isPeriodKeyFor(horizon: Horizon, key: string): boolean {
  switch (horizon) {
    case 'Life':
      return key === '';
    case 'Yearly':
      return YEAR_RE.test(key);
    case 'Quarterly':
      return QUARTER_RE.test(key);
    case 'Monthly':
      return MONTH_RE.test(key);
    case 'Weekly':
      return isMonday(key);
  }
}

/**
 * A period key of SOME horizon. Use it where the horizon is not yet known (a query parameter, a view
 * field); a request that knows its horizon refines against it with `isPeriodKeyFor` (see
 * `CreateGoalRequest`), which is what refuses `2026-Q5`, `2026-13` and a Weekly key that is not a Monday
 * (S-goal-33-2).
 */
export const PeriodKey = z
  .string()
  .max(10)
  .refine((k) => HORIZONS.some((h) => isPeriodKeyFor(h, k)), 'not a canonical period key')
  .describe('YYYY | YYYY-Qn | YYYY-MM | a Monday YYYY-MM-DD | "" for Life');

/** Same thing arriving as a query-string parameter. `''` (the Life lens) is not addressable here. */
export const PeriodKeyParam = z
  .string()
  .min(1)
  .max(10)
  .refine((k) => HORIZONS.some((h) => h !== 'Life' && isPeriodKeyFor(h, k)), 'not a canonical period key');

/**
 * ⚠ **A2 (R-goal-33)** — `period` is now **[srv], derived**: the rendered LABEL of `periodKey`
 * (`2026`, `Q3 2026`, `Sep 2026`, `Week of 7 Sep`). It is no longer owner-typed free text and a
 * client-supplied value is ignored — there is no `period` field on any request schema at all, which is
 * what makes S-goal-33-3 hold by construction rather than by a handler remembering to drop it.
 *
 * **Why the free-text field could not survive:** a lens is "every goal at this horizon in this period"
 * (R-lens-2), which requires the period to PARTITION the goals at a horizon. Free text partitions
 * nothing — `Sep 2026`, `September 2026`, `sept 26` and `''` are four periods — and a goal whose label
 * parses as none of them appears in no lens at all.
 */
export const Period = z.string().max(32);

export const Theme = z.enum(['light', 'dark', 'system']);

/**
 * ⚠ **A1 (R-backlog-17)** — a backlog item's manual position within its **own goal's** list.
 *
 * **Opaque, lexicographically ordered, server-minted, and never a position index.** An index has to be
 * rewritten across the whole list on every insert and is racy against a concurrent one; a key that sorts
 * lexicographically lets a move write ONE row. The client never parses, computes or sends one — there is
 * no `sortKey` field on any request schema, which is what makes that true by construction rather than by
 * a handler remembering to drop it (R-backlog-19).
 *
 * The server's scheme is fixed-width zero-padded decimal (`000001000000`), so lexicographic order **is**
 * numeric order; the bound and the alphabet here are the contract, not the scheme. See
 * `apps/api/src/domain/sort-keys.ts`.
 */
export const SortKey = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9]+$/, 'sortKey is opaque and alphanumeric')
  .describe('opaque, lexicographically ordered manual position within one goal');

/**
 * ⚠ **A2 (R-task-46)** — the three creation sources. `planning` became `goal` (there is no planning
 * screen) and `idea` is gone with the entity. Recorded once, on the `created` event, and never changed.
 */
export const TASK_SOURCES = ['goal', 'backlog', 'drawer'] as const;
export const TaskSource = z.enum(TASK_SOURCES);

/**
 * R-task-32 / D-15 / Q-6 — a task's lifecycle. `open` and `done` are the two live states; `canceled` and
 * `movedToBacklog` are the two of the three exits that take a task off the board.
 *
 * Exited tasks keep their row rather than being deleted: the activity log is append-only, and the
 * `Moved to Backlog` / `Canceled` entries the ruleset requires cannot live on a deleted row (nor can the
 * optional reason). Exited tasks are excluded from every week view and every count.
 */
export const TASK_STATUSES = ['open', 'done', 'canceled', 'movedToBacklog'] as const;
export const TaskStatus = z.enum(TASK_STATUSES);

/**
 * R-task-30 / R-task-46 — the COMPLETE set of activity kinds. The timeline can contain these and nothing
 * else, and every entry is appended by the server as a side effect of the operation that caused it
 * (R-task-31).
 */
export const TASK_EVENT_KINDS = [
  'created',
  'carried',
  'renamed',
  'cond_edited',
  'description_updated',
  'link_added',
  'link_removed',
  'completed',
  'unchecked',
  'moved_to_backlog',
  'canceled',
  /**
   * ⚠ **A8 (R-task-58)** — five added, none removed. `parked` / `unparked` are R-task-56's two
   * directions; the three `measure_*` kinds record the measure's SHAPE and never its values.
   *
   * **A reading is not an event, in either direction** (R-measure-7) — not on record, not on delete. A
   * counter bumped daily for a quarter would put ninety rows into a log whose job is to answer "what
   * happened to this task", and those ninety rows are already on the page, above it, in the right shape.
   * There is deliberately no `reading_recorded` member here for a build to reach for.
   *
   * The month form of carrying reuses `carried`: it is the same event at a different scale, and a
   * `carried_month` member would make every timeline reader branch on scope for one word of copy.
   */
  'parked',
  'unparked',
  'measure_added',
  'measure_edited',
  'measure_removed',
] as const;
export const TaskEventKind = z.enum(TASK_EVENT_KINDS);

/**
 * ⚠ **A8, new (R-task-51, R-task-52)** — **the two horizons that hold tasks, and nothing else.**
 *
 * A task's `scope` is its goal's horizon, copied at creation. It is not a second horizon system: it may
 * only ever be `Monthly` or `Weekly`, because only those two horizons hold tasks. It is what every
 * visibility, carry and completion comparison is made *within*, and it is the format `originPeriodKey`
 * must be in.
 */
export const TASK_SCOPES = ['Monthly', 'Weekly'] as const;
export const TaskScope = z.enum(TASK_SCOPES);

/** ⚠ **A8 (R-task-54)** — the unit `carryAge` is counted in, one per scope. Never mixed. */
export const CARRY_UNITS = ['weeks', 'months'] as const;
export const CarryUnit = z.enum(CARRY_UNITS);

/**
 * ⚠ **A8, new (R-measure-1)** — **two kinds, and there is no third.**
 *
 * A `counter` is added to (`+3`); a `gauge` is set (`= 78.5`). That is the whole difference between them
 * and it is an **input affordance, not a storage difference** — every reading stores an absolute value
 * either way (R-measure-3).
 *
 * **There is no `binary` member and there must never be one.** A checkbox is `measure = null`, not a
 * degenerate counter that stops at 1: completion is already modelled and is not a number, a gauge with no
 * target has no completion at all, unifying would grow a measure on every task in the product, and the
 * migration would have to invent a reading with a timestamp for every task ever completed (R-measure-1,
 * S-measure-1-1).
 */
export const MEASURE_KINDS = ['counter', 'gauge'] as const;
export const MeasureKind = z.enum(MEASURE_KINDS);

/** R-backlog-6 / D-19 — a backlog item is CONVERTED, not deleted, so a repeat conversion is refusable. */
export const BACKLOG_STATUSES = ['open', 'converted'] as const;
export const BacklogStatus = z.enum(BACKLOG_STATUSES);

// Field lengths — SPEC Q-11. All strings trimmed before validation.
export const Title = z.string().trim().min(1).max(200);
/** `why` and `cond`. */
export const OneLiner = z.string().trim().max(200);
/** ⚠ **A2** — an exit or re-plan reason. The weekly-focus half of this type went with the entity (R-rm-2). */
export const Sentence = z.string().trim().max(280);
export const Reason = z.string().trim().max(280);
/** Learning.text. */
export const CaptureText = z.string().trim().min(1).max(500);
export const LongText = z.string().trim().max(4000);
/** Q-11 — 2048 chars and it must parse as http/https; other schemes are refused, not stored. */
export const Url = z
  .url()
  .max(2048)
  .refine((u) => /^https?:\/\//i.test(u), 'link must be http(s)');

// ─────────────────────────────────────────────────────────────────────────────
// Caps — SPEC Q-12, rewritten by the reconciliation pass against measured numbers.
//
// The old numbers (500 goals, 100 children) were PROSE in five files and code in
// none: raising them would have shipped nothing. These three are enforced, and each
// bounds a thing that actually costs something.
// ─────────────────────────────────────────────────────────────────────────────

export const MAX_LINKS = 20;

/**
 * The page cap on every list read. It has existed since the foundation and was **referenced nowhere**;
 * R-lens-16 says a lens read is "paginated (Q-12's page cap)" against a constant nothing read. It is
 * wired now — the lens read, the backlog read and the week read all take it (S-lens-16-1).
 */
export const MAX_PAGE = 200;

/**
 * **Interior goals per owner** — every goal whose horizon is not `Weekly`.
 *
 * This is the only set a request ever holds in memory (R-lens-27): grouping, the Life-root walk and the
 * parent lines read it once and index it by id. It grows with the PLAN, not with use — roughly one
 * Yearly, four Quarterly and twelve Monthly goals per Life line per year, so ~85/year for a five-line
 * account and ~2,100 at twenty-five years. 1,000 is a decade of headroom on that, and it is the one
 * number that protects the read strategy.
 *
 * Deliberately NOT a lifetime cap on goals: a lifetime cap on Weekly goals is a cap on how long you may
 * use the product, and it would fire on the most engaged owner.
 */
export const MAX_INTERIOR_GOALS = 1000;

/**
 * **Weekly goals per (owner, week)** — a SHAPE cap, not a lifetime one.
 *
 * Fifty intentions in one week is already past what a person can hold, so it never trips in ordinary
 * use; what it buys is a bounded Weekly lens page. Scoping it to the week is also the honest answer to
 * fan-out: a Weekly goal hung off a Life goal gives that parent one child per week forever, so no fixed
 * children-per-goal number could ever be right (Q-12, amended).
 */
export const MAX_WEEKLY_GOALS_PER_WEEK = 50;

/**
 * ⚠ **A8, new (Q-26)** — **readings per task**, enforced on write.
 *
 * A daily counter produces ~365 a year and a task can carry indefinitely, so one payload needs a bound.
 * **There is no compaction, no rollup and no pruning** — the same answer Q-12 gives for goals and for the
 * same reason: the owner's dislike of clutter is about screens, not rows, and the task page renders a
 * sparkline plus the *recent* values, so a long history costs a scroll nobody performs. Averaging or
 * bucketing them would be the app editing the owner's own numbers, which is R-measure-8's line.
 *
 * The cap exists to bound one payload, and the refusal names it. If it is ever raised, the task-page read
 * must page instead (Q-27).
 */
export const MAX_READINGS = 2000;

/**
 * ⚠ **A8, new (R-measure-2)** — the numeric floor for `start`, `target` and every reading `value`.
 *
 * Finite doubles, `|v| <= 1e9`. `NaN` and `±Infinity` are **refused**, never stored and never rendered
 * (S-measure-2-2): a measure is the one place in this product where a number the owner did not write can
 * reach a screen, and the answer to that is to refuse it at the edge.
 */
export const MEASURE_MAX_ABS = 1e9;
export const MeasureNumber = z
  .number()
  .refine((v) => Number.isFinite(v), 'must be a finite number')
  .refine((v) => Math.abs(v) <= MEASURE_MAX_ABS, `must be within ±${MEASURE_MAX_ABS}`);

/**
 * R-measure-2 — `leads`, `kg`, `£`. **Never parsed, converted, pluralised against a list, or validated
 * against one**: they are all the same kind of thing to this product, a word you wrote. 16 graphemes.
 */
export const MeasureUnit = z.string().trim().max(16);

// ─────────────────────────────────────────────────────────────────────────────
// View types — the shapes every read model is built out of.
// ─────────────────────────────────────────────────────────────────────────────

export const UserView = z.object({
  id: UserId,
  name: z.string(),
  email: z.string(),
  emailVerified: z.boolean(),
  image: z.string().nullable(),
});

/**
 * The only thing provisioned for a brand-new account (R-auth-6: no default tree, no seed goals).
 * `timezone` is authoritative for every week boundary in the product (R-auth-5).
 */
export const PreferencesView = z.object({
  theme: Theme,
  timezone: IanaTimezone,
  updatedAt: Iso,
});

/**
 * The week a read model is talking about. `weekStart` is the truth (D-1); `offset` is the projection of
 * it against today, included so the client can drive the week control without re-deriving Monday from
 * its own clock — which is exactly the disagreement R-auth-5 exists to prevent.
 *
 * ⚠ **A2** — `isPast` is new. Write-eligibility is a `periodKey` comparison the SERVER owns (R-goal-34);
 * a client that re-derived it would be a second implementation of the rule R-goal-36 refuses on.
 */
export const WeekView = z.object({
  weekStart: WeekStart,
  offset: WeekOffset,
  isCurrent: z.boolean(),
  isPast: z.boolean(),
});

/**
 * ⚠ **A2, new (R-lens-7, R-goal-34)** — the period control's whole contract, for any horizon.
 *
 * Every past/future judgement in A2 is a `periodKey` comparison computed SERVER-side from the owner's
 * account timezone and echoed on the wire, so the client never re-derives one — four times over now
 * rather than once (R-goal-34). `label` is the rendered form (`Q3 2026`), `periodKey` the canonical one
 * (`2026-Q3`); the URL carries the key and the screen shows the label (R-nav-24).
 */
export const PeriodView = z.object({
  periodKey: PeriodKey,
  label: z.string(),
  isCurrent: z.boolean(),
  isPast: z.boolean(),
  /** Whether the selected period holds at least one goal at this horizon. */
  hasWork: z.boolean(),
  /**
   * ⚠ **A4, new (R-lens-28)** — the **whole weeks this period contains**, e.g. `Mon 7 Sep – Sun 4 Oct`
   * for `2026-09`. `label` names the period and this measures it.
   *
   * A week is keyed by its Monday (R-goal-33), so `Sep 2026` is the four weeks beginning 7, 14, 21 and
   * 28 Sep: it excludes the week of Mon 31 Aug and runs four days past the 30th. The name alone reads
   * as 1–30 September and over-promises; the range is what makes the label honest, and it is computed
   * here rather than on the client because the client holds no Monday rule at all (D-1).
   */
  weekRange: z.string(),
  /**
   * ⚠ **A4, new (R-lens-29)** — the period of this same horizon that holds **the week containing
   * today**, when that is not this one. `null` whenever this period holds it, which is the ordinary
   * case: the field's mere presence is the fact the UI flags.
   *
   * On Tue 1 Sep 2026 the Monthly lens's current period is `2026-09` while the current week begins Mon
   * 31 Aug, so `2026-09` carries `{ periodKey: '2026-08', label: 'Aug 2026' }`. It is a **statement of
   * fact, not a chrome decision**: the server says where the week is and the client decides when to say
   * so (R-lens-29 renders it only on the current period, where the off-now row does not).
   */
  currentWeekPeriod: z.object({ periodKey: PeriodKey, label: z.string() }).nullable(),
});

/**
 * A goal node.
 *
 * ⚠ **A2 (R-rm-2, R-goal-37)** — `focus`, `isLeaf`, `isActive`, `dormant`, `subtreeActive` and `branches`
 * have all left the wire. `isLeaf` is **retired**, not renamed: before A2 "leaf", "holds a focus" and
 * "holds tasks" named one set of goals, and after A2 they do not — a Monthly goal with no Weekly children
 * is a leaf by the structural definition while being precisely the goal that must never hold a task. A
 * surface that needs "has children" reads `GoalDetailResponse.children`.
 *
 * ⚠ **A2, new** — `periodKey` (R-goal-33) and `lifeRootId` (R-lens-3): the SERVER resolves each item's
 * Life-goal group by walking `parentId` to the root, so the client never walks an ancestor chain it does
 * not hold and must never assume it holds the whole tree (R-lens-16, S-lens-16-2). `lifeRootId` is
 * **null** when the chain does not reach a Life goal — a dangling `parentId` or a cycle — and that item
 * groups under `UNSORTED` (R-lens-20). It is never dropped: a data problem must surface in the UI.
 */
export const GoalView = z.object({
  id: Ulid,
  parentId: Ulid.nullable(),
  horizon: Horizon,
  title: z.string(),
  why: z.string(),
  pulse: Pulse,
  /** R-goal-33 — the canonical key. `''` on a Life goal. */
  periodKey: z.string(),
  /** R-goal-33 — **[srv]**, the rendered label of `periodKey`. Never client-supplied. */
  period: z.string(),
  /** R-lens-3 / R-lens-20 — the Life goal this item groups under; `null` means `UNSORTED`. */
  lifeRootId: Ulid.nullable(),
  /** R-goal-25 — `N in backlog` on a card. Counts this goal's OWN open items only. */
  backlogCount: z.int().nonnegative(),
  /**
   * R-goal-24 — the quiet signal on a life-goal card: "N tasks carrying · oldest W weeks". Non-null only
   * for Life goals that actually have open tasks below them originating before the viewed week; there is
   * no audit page behind it (R-nav-14).
   */
  carrying: z.object({ openTasks: z.int().positive(), oldestWeeks: z.int().positive() }).nullable(),
  /**
   * R-goal-43 — `planned N weeks ago`, on a **Weekly** goal whose week has ARRIVED. Null everywhere else,
   * including a week that has not arrived: that goal is early, not stale. The client renders the muted
   * line at `>= 2` and nothing at all below it; the threshold is here so both sides read one number.
   */
  plannedAgeWeeks: z.int().nullable(),
  /**
   * R-goal-47 — the planned-ness line, on a **Monthly** goal and nowhere else. `weeklyGoals` counts the
   * Weekly goals below it whose week's **Monday** falls in the viewed month; `thisWeek` is that count
   * restricted to the current week, or **null** when the viewed month does not contain today.
   *
   * The four states map 1:1 onto the four copy lines: `0` → `Nothing planned yet`; `n` with
   * `thisWeek: null` → `n weekly goals`; `n` with `thisWeek > 0` → `n weekly goals · k this week`;
   * `n` with `thisWeek: 0` → `n weekly goals · nothing this week`. This is dormancy's ONLY surface
   * (R-goal-38, amended) and it is muted body text, never a state, a chip or a link.
   */
  weeklyBreakdown: z.object({ weeklyGoals: z.int().nonnegative(), thisWeek: z.int().nonnegative().nullable() }).nullable(),
  createdAt: Iso,
  updatedAt: Iso,
  version: z.int().positive(),
});

/**
 * R-lens-3/4/5/19 — one Life-goal group header on a lens: the title, the pulse dot, and the count of
 * OPEN tasks under that Life goal visible in the anchoring week (the selected week in the Weekly lens,
 * the current week everywhere else).
 *
 * A group with no items in the selected period is not sent at all (R-lens-19), and a zero count is not
 * rendered (R-lens-4, amended) — the count is still carried truthfully so the client can decide.
 */
export const LifeGroupView = z.object({
  /** `null` is the `UNSORTED` group (R-lens-20): items whose chain does not reach a Life goal. */
  id: Ulid.nullable(),
  title: z.string(),
  pulse: Pulse.nullable(),
  openTasks: z.int().nonnegative(),
});

/**
 * ⚠ **A2, new (R-lens-23)** — **the parent line's one name.**
 *
 * A lens is deliberately flat and period-scoped, so an item's parent is usually NOT in `items` — a Weekly
 * goal's Monthly parent is in another lens entirely. `GoalView.parentId` alone therefore renders nothing,
 * and the client may not walk an ancestor chain it does not hold (R-lens-16, S-lens-16-2).
 *
 * **At most one name** (R-lens-23): this is the immediate parent, never a breadcrumb path. The full path
 * is the tree wearing a different hat, which is the thing A2 removed.
 *
 * `period` is carried because a parent named from a lens has no other way to say *which* `Q3` it is; the
 * line itself renders the title alone.
 */
export const GoalRefView = z.object({ id: Ulid, title: z.string(), period: z.string() });

export const ExternalLinkView = z.object({
  id: Ulid,
  url: z.string(),
  createdAt: Iso,
});

/**
 * R-task-30/31 — one auto-logged activity line, newest first. `text` and `glyph` are rendered by the
 * SERVER when the event is APPENDED, so the log reads the same forever even if the copy changes later,
 * and the client never reconstructs a sentence from `detail`. Append-only: never edited, never deleted.
 */
export const TaskEventView = z.object({
  id: Ulid,
  kind: TaskEventKind,
  at: Iso,
  text: z.string(),
  /** One of `＋ ↻ ✎ ↗ ✓ ↩ →` (R-task-30). */
  glyph: z.string(),
  detail: z.record(z.string(), z.unknown()).nullable(),
});

/**
 * ⚠ **A8, new (R-measure-2, R-measure-4)** — **the number a task carries**, or `null` on the vast
 * majority of tasks, which are ordinary checkboxes and render exactly as they did before A8.
 *
 * `current` is **derived** (R-measure-3): the value of the latest surviving reading ordered
 * `(at desc, id desc)`, or `start` when there are none. It is never client-supplied and never patchable;
 * it is on the wire, and denormalised in storage, so a lens row can render `12 / 15 leads` without a
 * per-task subquery.
 *
 * **Direction is implied and there is no direction flag** (R-measure-2): `target > start` counts up,
 * `target < start` counts down. A flag would restate a fact the two numbers already make, and the first
 * row where they disagreed would be unanswerable.
 *
 * ── `progress`, and the three ways it can be absent ────────────────────────────
 * `(current − start) / (target − start)` — **one formula for both directions**, no branch:
 * `start 80, target 75, current 78` is `(−2)/(−5) = 0.4`. It is `null`, and **no division is performed**,
 * when:
 *  1. there is no `target` — the AMRAP case, a first-class tracked measurement with no completion
 *     criterion, no percentage and no bar (R-measure-4);
 *  2. `target === start` — refused at the edge with `MEASURE_TARGET_EQUALS_START`, and if such a row
 *     exists anyway (a migration, a hand-edit) the field is **omitted from the wire** rather than
 *     computed. `NaN`, `Infinity`, `0%` and `100%` are each specifically forbidden as the answer: this is
 *     the one place a divide-by-zero can reach a screen, and a wrong number is worse than no number
 *     (S-measure-4-3).
 *
 * **The raw ratio may exceed 1 and is never clamped here.** 18 leads against a target of 15 is `1.2` and
 * renders as `18 / 15 leads` — never `120%`, never a bar drawn past its own end. Only the bar's *drawn
 * fill* is clamped, in the client, for drawing (S-measure-4-4).
 *
 * **Nothing derived from this is a verdict** (R-measure-8): no pace, projection, forecast, trend line,
 * moving average, on-track/behind/ahead state in any form, streak, completion rate, burndown, per-period
 * summary, or aggregation across two or more tasks. A number the owner recorded is data; a number the app
 * derived about the owner is a judgment.
 */
export const MeasureView = z.object({
  kind: MeasureKind,
  start: z.number(),
  /** **[srv], derived** from the readings (R-measure-3). Never sent, never patched. */
  current: z.number(),
  /** `null` is a legitimate measure with no completion and no percentage — not a degraded one. */
  target: z.number().nullable(),
  /** `''` when unset — never null, so the client never branches on it. */
  unit: z.string(),
  /** `null` when there is no target, or when `target === start`. See the doc block. */
  progress: z.number().nullable(),
});

/**
 * ⚠ **A8, new (R-measure-5)** — one recorded value, and its whole lifecycle.
 *
 * **There is no week, month, period or scope field here, and there must never be one.** A task carries
 * across weeks and months and may be parked between them; if its readings reset at any boundary the
 * history is worthless, which is the whole reason the feature exists — the sparkline of a workout that
 * resets every Monday shows nothing (S-measure-5-2).
 *
 * `value` is the **absolute** value of the measure after this reading. A counter's `+3` is resolved to an
 * absolute by the server before it is stored, which is what makes deletion correct with **one** rule for
 * both kinds: deleting the latest falls back to the one before it, deleting a middle one changes nothing,
 * deleting the only one returns `current` to `start` (R-measure-3).
 *
 * Append-only and individually deletable, and that is the whole of it: a reading is never edited in
 * place, because correcting one is deleting it and recording another. No reset, no archive, no "clear
 * history", and **no timeline entry in either direction** (R-measure-7).
 */
export const ReadingView = z.object({
  id: Ulid,
  taskId: Ulid,
  value: z.number(),
  at: Iso,
});

/**
 * A task, as it appears in a list.
 *
 * ⚠ **A8 (R-task-52) — a task belongs to one PERIOD at one SCOPE, and the key's format is the
 * discriminator.** `scope` is `Monthly` or `Weekly`, seeded from its goal's horizon at creation;
 * `originPeriodKey` is `2026-09` or the Monday `2026-09-07` accordingly. Every visibility, carry and
 * completion comparison in the product is made **within one scope**, against keys of one format. The week
 * model is the Weekly scope's special case, not a parallel system.
 *
 * Visibility is applied by the SERVER and never re-derived by the client: an OPEN task is visible in every
 * period >= its origin at its own scope — it carries forward with no prompt, no write and no job
 * (R-task-53) — while a DONE task is visible only in the period it was completed in, and an exited task
 * in none (R-task-32). Visibility is a function of the task's OWN period and never of its goal's
 * (R-task-42), which is what makes both the carried band and a carried month task possible.
 *
 * ⚠ **A2 (R-task-43) / A8 (R-task-54) — `carryAge` is SIGNED and is counted in `carryUnit`.** It is
 * `periodsBetween(scope, originPeriodKey, min(viewedPeriod, currentPeriod))`, so work planned for a future
 * period has a NEGATIVE age: `<= 0` renders nothing, `= 1` the gray "since …", `>= 2` the red
 * "N weeks · since …" / "N months · since …" chip — the only escalation in the product, which must never
 * fire at a plan (R-lens-11). Anything SUMMING these values, or re-parsing them as `nonnegative`, is
 * wrong; anything rendering the word "weeks" without reading `carryUnit` is now wrong too.
 *
 * ⚠ **A8 — a month task wears NO carry label of any kind inside a week** (R-task-54, S-lens-31-2): not
 * the chip, not the gray line, not a muted variant. **The suppression is the CALL SITE's, not this
 * field's** — `LensResponse.monthTasks` is where a month task appears in a week, and the band that
 * renders it passes the suppression; the same task in the Monthly lens carries its chip normally, which
 * is why the value on the wire is the honest month-scale age either way.
 */
export const TaskView = z.object({
  id: Ulid,
  goalId: Ulid,
  /** ⚠ **A8, new, required** (R-task-52). `Monthly` or `Weekly` — never any other horizon. */
  scope: TaskScope,
  title: z.string(),
  cond: z.string(),
  description: z.string(),
  links: z.array(ExternalLinkView),
  status: TaskStatus,
  done: z.boolean(),
  /** ⚠ **A8** — widened from a Monday to a key at the task's own `scope`. */
  originPeriodKey: PeriodKeyParam,
  donePeriodKey: PeriodKeyParam.nullable(),
  doneAt: Iso.nullable(),
  /** R-task-32 / D-15 — the optional reason given on the Move-to-Backlog or Cancel confirm sheet. */
  exitReason: z.string().nullable(),
  exitedAt: Iso.nullable(),
  /** ⚠ signed (R-task-43), and counted in `carryUnit` (R-task-54). See the doc block above. */
  carryAge: z.int(),
  /** ⚠ **A8, new, required** — `weeks` for a week task, `months` for a month task. Never mixed. */
  carryUnit: CarryUnit,
  /**
   * R-task-44 / R-task-50 / **R-task-55** — whether a completion is legal for the period this view was
   * built for (`origin <= period <= currentPeriod`, **at the task's own scope**). The row renders no
   * checkbox when it is false, and the server refuses one anyway; this is on the wire so the client does
   * not re-derive a date rule.
   *
   * ⚠ **A8 — the NAME did not move and the MEANING did.** It is now the bound at the task's own scope,
   * so a month task viewed in a week band answers about its MONTH. A client that assumed "this week" is
   * reading a different sentence than the one being written.
   */
  completable: z.boolean(),
  /** ⚠ **A8, new** — `null` on an ordinary checkbox, which is the vast majority (R-measure-1). */
  measure: MeasureView.nullable(),
  createdAt: Iso,
  updatedAt: Iso,
  version: z.int().positive(),
});

/**
 * A single task with its full activity log, and — ⚠ **A8** — its readings.
 *
 * Lists omit both: a lens row needs `measure.current` and `measure.target`, which `TaskView` already
 * carries, and never the history. `readings` is **oldest first**, which is sparkline order, and is
 * bounded by `MAX_READINGS` (Q-26).
 */
export const TaskDetailView = TaskView.extend({
  events: z.array(TaskEventView),
  readings: z.array(ReadingView),
});

/**
 * R-backlog-1/2/3 — deferred future work under a Yearly/Quarterly/Monthly goal. ⚠ **A2 (R-backlog-26)** —
 * never a Life goal and now never a **Weekly** goal either: the whole point of a backlog item is that it
 * has no week, and a Weekly goal would give it one. No checkbox, no done-condition, no due date: this
 * shape is intentionally poorer than a task.
 *
 * ⚠ **A8 (R-backlog-30) — and now, deliberately, no PERIOD either.** A backlog item is the only work
 * object in this product with no period key, and a period key is exactly what makes something appear in a
 * lens. That single absence is the whole enforceable difference between it and a **month task** on the
 * same Monthly goal — the owner's *"backlog is maybe-someday; a month task is yes-this-month"* is the
 * right thing to say to a person and the wrong thing to build on, because no rule can check a feeling.
 * Backlog never appears in a week *because it has no week to appear in*; a month task always does
 * *because its month contains that week*. Everything else — no checkbox, no ageing, manual order —
 * follows (S-backlog-30-1).
 *
 * `fromPeriodKey` is set only when the item arrived by Move-to-Backlog, and is ⚠ **A8 (R-task-59)** the
 * period the task was LIVE in **at its own scope**: the Monday of a week task's week (D-12, unchanged in
 * value and meaning) or a month key for a month task, which renders `from Sep 2026` rather than
 * `from week of …`. The format is the discriminator, exactly as it is on a task.
 */
export const BacklogItemView = z.object({
  id: Ulid,
  goalId: Ulid,
  /**
   * ⚠ **A2, new (R-backlog-13)** — **the owning goal's own title**, and with `lifeGoalTitle` the whole of
   * the `<Life goal> › <owning goal>` branch path R-backlog-13 groups by.
   *
   * It is on the wire because the client cannot resolve it: an item's goal is a Yearly, Quarterly or
   * Monthly goal in whatever period it happens to sit in, and a client holding one lens page holds neither
   * that goal nor a tree to walk (R-lens-16). Resolving it from the client meant guessing from the current
   * period's lens reads and bucketing the misses under `Elsewhere` — an accurate label for a client
   * limitation and a meaningless one for an owner.
   *
   * The server resolves both from the INTERIOR tree it already reads (R-lens-27): a backlog item can only
   * ever sit on a non-Weekly goal (R-backlog-2), so the interior set always contains its owner.
   */
  goalTitle: z.string(),
  /**
   * R-backlog-13 — the Life goal at the head of the branch path, or `null` when the chain does not reach
   * one (R-lens-20's `UNSORTED` condition, restated here). The client renders `<life> › <goal>` when it is
   * present and the goal's own title alone when it is not; it never invents a bucket.
   */
  lifeGoalTitle: z.string().nullable(),
  title: z.string(),
  description: z.string(),
  links: z.array(ExternalLinkView),
  capturedAt: Iso,
  fromPeriodKey: PeriodKeyParam.nullable(),
  /**
   * ⚠ **A1, new (R-backlog-17)** — the item's manual position within its OWN goal's list.
   *
   * Within a goal the order is `sortKey` asc, then `capturedAt` desc, then `id` desc — total and stable
   * even if two keys ever collide, which is why no unique index enforces one (Q-7). **Across** goals there
   * is no manual order at all (R-backlog-21): the Backlog page's group order and the Life-goal aggregate
   * stay `capturedAt` desc, and two items on different goals have no relative position.
   *
   * It is on the wire so a list can be rendered in the server's order without a second sort rule, and so
   * a reorder's optimistic result can be checked against what came back. It is never sent.
   */
  sortKey: SortKey,
  status: BacklogStatus,
  /** R-backlog-6 — set when the item became a task. A converted item never appears in a backlog list. */
  convertedToTaskId: Ulid.nullable(),
  convertedAt: Iso.nullable(),
  createdAt: Iso,
  updatedAt: Iso,
  version: z.int().positive(),
});

/** R-learning-1/4 — a short insight. `applied` drives the "changed the plan" badge (D-23). */
export const LearningView = z.object({
  id: Ulid,
  goalId: Ulid.nullable(),
  text: z.string(),
  applied: z.boolean(),
  capturedAt: Iso,
  createdAt: Iso,
  updatedAt: Iso,
  version: z.int().positive(),
});

export type Iso = z.infer<typeof Iso>;
export type Ulid = z.infer<typeof Ulid>;
export type UserId = z.infer<typeof UserId>;
export type DateOnly = z.infer<typeof DateOnly>;
export type WeekStart = z.infer<typeof WeekStart>;
export type Horizon = z.infer<typeof Horizon>;
export type Pulse = z.infer<typeof Pulse>;
export type WeekOffset = z.infer<typeof WeekOffset>;
export type PeriodKey = z.infer<typeof PeriodKey>;
export type Period = z.infer<typeof Period>;
export type SortKey = z.infer<typeof SortKey>;
export type Theme = z.infer<typeof Theme>;
export type TaskSource = z.infer<typeof TaskSource>;
export type TaskStatus = z.infer<typeof TaskStatus>;
export type TaskEventKind = z.infer<typeof TaskEventKind>;
export type TaskScope = z.infer<typeof TaskScope>;
export type CarryUnit = z.infer<typeof CarryUnit>;
export type MeasureKind = z.infer<typeof MeasureKind>;
export type MeasureView = z.infer<typeof MeasureView>;
export type ReadingView = z.infer<typeof ReadingView>;
export type BacklogStatus = z.infer<typeof BacklogStatus>;
export type UserView = z.infer<typeof UserView>;
export type PreferencesView = z.infer<typeof PreferencesView>;
export type WeekView = z.infer<typeof WeekView>;
export type PeriodView = z.infer<typeof PeriodView>;
export type GoalView = z.infer<typeof GoalView>;
export type LifeGroupView = z.infer<typeof LifeGroupView>;
export type GoalRefView = z.infer<typeof GoalRefView>;
export type ExternalLinkView = z.infer<typeof ExternalLinkView>;
export type TaskEventView = z.infer<typeof TaskEventView>;
export type TaskView = z.infer<typeof TaskView>;
export type TaskDetailView = z.infer<typeof TaskDetailView>;
export type BacklogItemView = z.infer<typeof BacklogItemView>;
export type LearningView = z.infer<typeof LearningView>;
