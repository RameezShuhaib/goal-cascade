import { z } from 'zod';

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
 */
export const WeekStart = z.iso
  .date()
  .refine((d) => new Date(`${d}T00:00:00.000Z`).getUTCDay() === 1, 'weekStart must be a Monday')
  .describe('ISO date of a week Monday');

/**
 * A week, expressed to the CLIENT as an offset from the current week: 0 = this week, -1 = last week.
 * Future weeks are not selectable anywhere in the product (R-nav-3), so a positive offset is a
 * validation failure rather than an empty result.
 *
 * This is a WIRE-FORMAT convenience only (D-1): a request may address a week by offset, and the API
 * resolves it to an absolute `WeekStart` against the owner's timezone at the boundary. Read models
 * always answer with the absolute `WeekStart`, so the client never re-derives one.
 */
export const WeekOffset = z.int().max(0).min(-520).describe('week offset from the current week; 0 = this week, <= 0');

/** Same thing arriving as a query-string parameter, where every value is a string. */
export const WeekOffsetParam = z.coerce.number().int().max(0).min(-520);

/**
 * R-nav-4 / D-24 — ONE bound for both week controls. The mockup's chevron clamped at 8 and its picker
 * listed 6, so two weeks were reachable by one control and invisible to the other. Everything older than
 * this is still readable by naming its `weekStart` explicitly (Q-13); this is only the picker's range.
 */
export const WEEK_HISTORY_WEEKS = 8 as const;

/**
 * The four horizons, longest first. Rank is the array index: Life 0 › Yearly 1 › Quarterly 2 › Monthly 3
 * (R-goal-2). A child's horizon must be strictly SHORTER (higher rank) than its parent's, so Monthly is
 * terminal (R-goal-6) and Life is the only horizon that may sit at the root (R-goal-3).
 *
 * The literals are exactly the strings the UI renders. There is deliberately no display-name mapping.
 */
export const HORIZONS = ['Life', 'Yearly', 'Quarterly', 'Monthly'] as const;
export const Horizon = z.enum(HORIZONS);

/** R-goal-15 — per-goal health signal. Quiet: it colours a dot, it never gates an action. */
export const PULSES = ['On track', 'At risk', 'Rethink'] as const;
export const Pulse = z.enum(PULSES);

/**
 * R-goal-13 — a goal's target period label. Free text, because its shape depends on the horizon: `2026`
 * (Yearly), `Q4 2026` (Quarterly), `Sep 2026` (Monthly), and `''` for a Life goal, which has none.
 * Deliberately NOT an enum: the defaults are derived from TODAY (D-3), and the owner may type any label.
 */
export const Period = z.string().trim().max(32);

export const Theme = z.enum(['light', 'dark', 'system']);

/** R-task-2 — the four creation sources. Recorded once, on the `created` event, and never changed. */
export const TASK_SOURCES = ['planning', 'backlog', 'idea', 'drawer'] as const;
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
 * R-task-30 — the COMPLETE set of activity kinds. The timeline can contain these and nothing else, and
 * every entry is appended by the server as a side effect of the operation that caused it (R-task-31).
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
] as const;
export const TaskEventKind = z.enum(TASK_EVENT_KINDS);

/** R-backlog-6 / D-19 — a backlog item is CONVERTED, not deleted, so a repeat conversion is refusable. */
export const BACKLOG_STATUSES = ['open', 'converted'] as const;
export const BacklogStatus = z.enum(BACKLOG_STATUSES);

// Field lengths — SPEC Q-11. All strings trimmed before validation.
export const Title = z.string().trim().min(1).max(200);
/** `why`, `cond`, and the weekly focus sentence. */
export const OneLiner = z.string().trim().max(200);
/** WeeklyFocus.sentence and an exit/re-plan reason. */
export const Sentence = z.string().trim().max(280);
export const Reason = z.string().trim().max(280);
/** Idea.text and Learning.text. */
export const CaptureText = z.string().trim().min(1).max(500);
export const LongText = z.string().trim().max(4000);
/** Q-11 — 2048 chars and it must parse as http/https; other schemes are refused, not stored. */
export const Url = z
  .url()
  .max(2048)
  .refine((u) => /^https?:\/\//i.test(u), 'link must be http(s)');

// Collection caps — SPEC Q-12.
export const MAX_LINKS = 20;
export const MAX_PLAN_ENTRIES = 500;
export const MAX_PAGE = 200;

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
 * it against today, included so the client can drive the week switcher without re-deriving Monday from
 * its own clock — which is exactly the disagreement R-auth-5 exists to prevent.
 */
export const WeekView = z.object({
  weekStart: WeekStart,
  offset: WeekOffset,
  isCurrent: z.boolean(),
});

/**
 * A goal node. `parentId` is the adjacency list — the client rebuilds the tree from a flat array,
 * siblings ordered by `createdAt` then `id` (Q-7).
 *
 * `isLeaf` / `isActive` / `dormant` / `subtreeActive` are DERIVED and sent by the SERVER (R-goal-8..11):
 * the server owns the invariants, the client just renders. They are never stored (§1).
 * `focus` is this goal's weekly focus sentence **for the week the read model is about** (`''` = none),
 * which is only ever non-empty on an active non-Life leaf.
 */
export const GoalView = z.object({
  id: Ulid,
  parentId: Ulid.nullable(),
  horizon: Horizon,
  title: z.string(),
  why: z.string(),
  pulse: Pulse,
  period: z.string(),
  focus: z.string(),
  isLeaf: z.boolean(),
  isActive: z.boolean(),
  dormant: z.boolean(),
  subtreeActive: z.boolean(),
  /** R-goal-25 — `N in backlog` on the tree row. Counts this goal's OWN open items only. */
  backlogCount: z.int().nonnegative(),
  /**
   * R-goal-24 — the quiet signal on a life-goal card: "N tasks carrying · oldest W weeks". Non-null only
   * for Life goals that actually have open tasks below them originating before the viewed week; there is
   * no audit page behind it (R-nav-14).
   */
  carrying: z.object({ openTasks: z.int().positive(), oldestWeeks: z.int().positive() }).nullable(),
  /** R-goal-26 — `<A> of <B> branches active`. `B` is 0, not 1, when the line has no leaves (D-16). */
  branches: z.object({ active: z.int().nonnegative(), total: z.int().nonnegative() }).nullable(),
  createdAt: Iso,
  updatedAt: Iso,
  version: z.int().positive(),
});

/**
 * One line of the weekly plan: a non-Life leaf and its focus sentence for `weekStart`.
 * A row exists ONLY while the leaf is active in that week — a blank sentence means the record must not
 * exist (§1 WeeklyFocus), so there is no second, contradictory representation of dormancy.
 */
export const PlanEntryView = z.object({
  id: Ulid,
  goalId: Ulid,
  weekStart: WeekStart,
  sentence: z.string(),
  createdAt: Iso,
  updatedAt: Iso,
});

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
 * A task, as it appears in a list.
 *
 * Weeks are ABSOLUTE Monday dates (D-1). Visibility is applied by the SERVER and never re-derived by the
 * client: an OPEN task is visible in every week >= its origin — it carries forward with no prompt
 * (R-task-7) — while a DONE task is visible only in the week it was completed (R-task-8), and an exited
 * task is visible in none (R-task-32).
 *
 * `carryWeeks` is `viewedWeek - originWeekStart` in whole weeks, for the week THIS view was built for.
 * It is what drives the gray "since Mon 24 Aug" (age 1, R-task-10) and the red "N weeks · since 10 Aug"
 * chip (age >= 2, R-task-11) — the only escalation in the product.
 */
export const TaskView = z.object({
  id: Ulid,
  goalId: Ulid,
  title: z.string(),
  cond: z.string(),
  description: z.string(),
  links: z.array(ExternalLinkView),
  status: TaskStatus,
  done: z.boolean(),
  originWeekStart: WeekStart,
  doneWeekStart: WeekStart.nullable(),
  doneAt: Iso.nullable(),
  /** R-task-32 / D-15 — the optional reason given on the Move-to-Backlog or Cancel confirm sheet. */
  exitReason: z.string().nullable(),
  exitedAt: Iso.nullable(),
  carryWeeks: z.int().nonnegative(),
  createdAt: Iso,
  updatedAt: Iso,
  version: z.int().positive(),
});

/** A single task with its full activity log. Lists omit `events`; only the detail sheet needs them. */
export const TaskDetailView = TaskView.extend({ events: z.array(TaskEventView) });

/**
 * R-backlog-1/2/3 — deferred future work under a Yearly/Quarterly/Monthly goal. Never a Life goal, never
 * a week. No checkbox, no done-condition, no due date: this shape is intentionally poorer than a task.
 * `fromWeekStart` is set only when the item arrived by Move-to-Backlog, and is the Monday of the week the
 * task was LIVE in — not "this week" (D-12).
 */
export const BacklogItemView = z.object({
  id: Ulid,
  goalId: Ulid,
  title: z.string(),
  description: z.string(),
  links: z.array(ExternalLinkView),
  capturedAt: Iso,
  fromWeekStart: WeekStart.nullable(),
  status: BacklogStatus,
  /** R-backlog-6 — set when the item became a task. A converted item never appears in a backlog list. */
  convertedToTaskId: Ulid.nullable(),
  convertedAt: Iso.nullable(),
  createdAt: Iso,
  updatedAt: Iso,
  version: z.int().positive(),
});

/** R-idea-1/2 — parking lot. `goalId` is an optional LIFE-goal tag; null renders as "Unsorted". */
export const IdeaView = z.object({
  id: Ulid,
  goalId: Ulid.nullable(),
  text: z.string(),
  capturedAt: Iso,
  createdAt: Iso,
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
export type Period = z.infer<typeof Period>;
export type Theme = z.infer<typeof Theme>;
export type TaskSource = z.infer<typeof TaskSource>;
export type TaskStatus = z.infer<typeof TaskStatus>;
export type TaskEventKind = z.infer<typeof TaskEventKind>;
export type BacklogStatus = z.infer<typeof BacklogStatus>;
export type UserView = z.infer<typeof UserView>;
export type PreferencesView = z.infer<typeof PreferencesView>;
export type WeekView = z.infer<typeof WeekView>;
export type GoalView = z.infer<typeof GoalView>;
export type PlanEntryView = z.infer<typeof PlanEntryView>;
export type ExternalLinkView = z.infer<typeof ExternalLinkView>;
export type TaskEventView = z.infer<typeof TaskEventView>;
export type TaskView = z.infer<typeof TaskView>;
export type TaskDetailView = z.infer<typeof TaskDetailView>;
export type BacklogItemView = z.infer<typeof BacklogItemView>;
export type IdeaView = z.infer<typeof IdeaView>;
export type LearningView = z.infer<typeof LearningView>;
