import type { BacklogStatus, Horizon, MeasureKind, Pulse, TaskEventKind, TaskScope, TaskStatus, Theme } from './enums';

/**
 * Persistence-shaped domain records. Column names are camelCase here and snake_case in D1; the Drizzle
 * schema maps 1:1 so repos return these directly. Booleans are real booleans (integer 0|1 in D1),
 * timestamps are ISO-8601 UTC strings (never `Date`, never epoch millis), and every WEEK is the ISO date
 * of its Monday (SPEC D-1 — never a relative offset).
 *
 * EVERY row carries `userId` (SPEC calls it `ownerId`; same thing, named for Better Auth). Reads take it
 * as an explicit argument; it never comes from request input (R-auth-2).
 */

/** Better Auth's user, as the rest of the app sees it. */
export type AuthUser = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
};

/** R-auth-5 — `timezone` is authoritative for every week boundary in the product. */
export type Preferences = {
  userId: string;
  theme: Theme;
  timezone: string;
  updatedAt: string;
};

/**
 * A node of the goal tree, stored as an adjacency list (`parentId`). There is no materialised path and no
 * closure table.
 *
 * ⚠ **A2 (R-lens-27)** — the old comment here said the tree is "at most 500 nodes and 4 levels deep, so
 * every derivation is done in memory over the full list". Both halves were false: the 500 was prose
 * enforced nowhere, and a Weekly horizon makes the list grow with USE. **No read loads every goal any
 * more.** What legitimately needs a tree — grouping, the Life-root walk, the parent lines — reads the
 * INTERIOR tree (`horizon <> 'Weekly'`), which grows with the plan rather than with use; a create guard
 * reads one row and a move or delete guard reads one subtree. See `domain/goal-tree.ts`.
 *
 * ⚠ **A2 (R-goal-37)** — `isLeaf`, `isActive`, `dormant` and `subtreeActive` are gone from the derived
 * set as well as from the wire. "Leaf" is RETIRED as a product word, not renamed.
 */
export type Goal = {
  id: string;
  userId: string;
  parentId: string | null;
  horizon: Horizon;
  title: string;
  /** Optional one-liner. `''` when unset — never null, so the client never branches on it. */
  why: string;
  pulse: Pulse;
  /**
   * ⚠ **A2 (R-goal-33)** — the canonical, sortable period key: `2026` / `2026-Q3` / `2026-09` / a Monday
   * `2026-09-07`. `''` for a Life goal. **This is the column every lens filters on** and the reason
   * `ix_goals_lens` exists; its lexicographic order IS chronological order, which is what makes
   * R-goal-47's range read and R-lens-26's forward probe index seeks.
   *
   * On a **Weekly** goal it is immutable after creation (R-goal-40): a Weekly goal *is* a week.
   */
  periodKey: string;
  /**
   * ⚠ **A2 (R-goal-33)** — **[srv], derived**: the rendered LABEL of `periodKey` (`Q3 2026`, `Sep 2026`,
   * `Week of 7 Sep`). It is stored rather than computed per read so a query can order or display it
   * without a join, and it is written only by the same code that writes `periodKey`. A client-supplied
   * value is ignored — there is no `period` field on any request schema at all.
   */
  period: string;
  createdAt: string;
  updatedAt: string;
  version: number;
};

/*
 * ⚠ **A2 (R-rm-2)** — the `WeeklyFocus` entity is **DELETED**, with its table, indexes, repository,
 * service, routes, schemas and MCP tools. Nothing replaces it as an entity: a weekly intent is now an
 * ordinary goal with `horizon = 'Weekly'`, and several of them under one parent is how a week holds
 * several intentions (R-goal-31). The type is removed rather than deprecated, so no later caller can
 * reintroduce it.
 */

/**
 * ⚠ **A2 (R-task-39)** — a task under a **Weekly goal**, and under nothing else. The condition is the
 * horizon, never leaf-ness (R-goal-37).
 *
 * `originPeriodKey` / `donePeriodKey` are absolute Monday dates (D-1). Carrying is DERIVED, not written:
 * an open task is visible in every week >= its origin with no job and no row change (R-task-7), which is
 * why this product has no cron.
 *
 * A task that has left the board keeps its row with a terminal `status`, `exitReason` and `exitedAt`
 * (D-15), because the `Moved to Backlog` / `Canceled` entries the ruleset requires cannot live on a
 * deleted row. Exited tasks are excluded from every week view and every count.
 */
export type Task = {
  id: string;
  userId: string;
  goalId: string;
  /**
   * ⚠ **A8, new (R-task-52)** — **the task's own horizon**, seeded from its goal's at creation and
   * rewritten by exactly one operation, Park (R-task-56).
   *
   * It is what every visibility, carry and completion comparison is made *within*, and it is the format
   * `originPeriodKey` must be in. **It is not a second horizon system**: it may only ever be `Monthly` or
   * `Weekly`, because only those two horizons hold tasks (R-task-51).
   *
   * The invariant `scope === 'Weekly'` ⇔ `originPeriodKey` is a Monday, and `scope === 'Monthly'` ⇔ it
   * matches `YYYY-MM`, is an APPLICATION invariant with one test: this schema carries no SQL `CHECK`
   * (only `_guard`), exactly as the Weekly-only rule it replaces did not.
   */
  scope: TaskScope;
  title: string;
  /** R-task-3 — done-condition. Optional by design; `''` when unset. */
  cond: string;
  description: string;
  status: TaskStatus;
  /**
   * ⚠ **A2 (R-task-40)** — **the task's OWN stored week**, seeded once at creation from its Weekly
   * parent's `periodKey` and immutable for the life of the task. It is **not implied by, and never
   * re-read from, the Weekly parent**, and there is no client input for it.
   *
   * Why stored and not implied, in the order the reasons bind: **carry** is a comparison against this
   * column with no write and no job — the single fact that lets this product have no cron; **uncheck**
   * needs the ORIGINAL origin to survive a completion and its reversal; and **D-1** — a week that is
   * looked up rather than recorded changes meaning without a write, which is the most damaging thing this
   * spec inherited. It costs nothing: the column exists, is indexed, and every week-scoped read stays an
   * index seek instead of a join to `goals`.
   *
   * The Weekly goal says what the work is FOR; this says when it was LIVE. What legitimately diverges is
   * exactly one thing — **the task carried** — and that divergence is the product working (R-lens-12).
   */
  originPeriodKey: string;
  donePeriodKey: string | null;
  /**
   * ⚠ **A8, new (R-measure-1)** — the measure, flattened into five nullable columns.
   *
   * **The invariant is total**: `measureKind === null` ⇔ all five are null. There is no half-measure and
   * no `binary` kind — a checkbox is the ABSENCE of a measure (S-measure-1-1).
   *
   * `measureCurrent` is **derived** (R-measure-3) — the value of the latest surviving reading, or
   * `measureStart` when there are none — and is maintained in the same transaction as every reading write
   * and delete. It is never client-supplied and never patchable. It is denormalised onto the task so a
   * lens row can render `12 / 15 leads` without a per-task subquery, which is the same argument
   * R-task-52 makes for `scope`.
   *
   * `measureTarget === null` is a **legitimate no-target measure** (R-measure-4), told apart from "no
   * measure" by `measureKind IS NULL` and by nothing else.
   */
  measureKind: MeasureKind | null;
  measureStart: number | null;
  measureCurrent: number | null;
  measureTarget: number | null;
  measureUnit: string | null;
  /** D-4 — the instant Completed was logged. The "Done Fri 28 Aug" label is DERIVED from it, never stored. */
  doneAt: string | null;
  exitReason: string | null;
  exitedAt: string | null;
  /** The backlog item a `movedToBacklog` task became, so the log can point at it. */
  movedToBacklogItemId: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
};

/**
 * ⚠ **A8, new (R-measure-5)** — one recorded value on a task.
 *
 * **There is no week, month, period or scope field here, and there must never be one** (S-measure-5-2).
 * A reading is keyed by `taskId` and by nothing else, so it survives carrying, parking, un-parking,
 * re-parenting, completion and unchecking without exception. A history that reset at any boundary would
 * be worthless — the sparkline of a workout that resets every Monday shows nothing — and that is the whole
 * reason the feature exists.
 *
 * `value` is the **absolute** value of the measure after this reading; a counter's `+3` is resolved to an
 * absolute by the server before storage, which is what makes deletion correct with one rule for both
 * kinds (R-measure-3). Append-only and individually deletable: never edited in place, because correcting
 * a mistyped 240 is deleting it and recording 24.
 *
 * `taskId` carries no FK, matching `taskLinks` / `taskEvents`; deletion is by the same subtree-cascade
 * batch (Q-5).
 */
export type Reading = {
  id: string;
  userId: string;
  taskId: string;
  value: number;
  /** When it was recorded. The sparkline's x-axis order, and the tie-break for "latest" is `id` desc. */
  at: string;
  createdAt: string;
};

export type TaskLink = {
  id: string;
  userId: string;
  taskId: string;
  url: string;
  createdAt: string;
};

/**
 * R-task-30/31 — one line of a task's read-only activity timeline. Append-only: rows are never updated or
 * deleted, and nothing in the product asks the user to write one.
 *
 * `text` and `glyph` are rendered when the event is APPENDED, so the log reads the same forever even if
 * the copy changes later. `detail` is the structured form (old/new values, reason, source) as JSON.
 *
 * `periodKey` is set ONLY on a `carried` event and is the period the task was carried INTO. It exists to
 * make the lazy carry-log producer idempotent: a unique index on `(userId, taskId, periodKey)` for
 * `kind = 'carried'` means re-reading a period can never duplicate an entry (Q-17, R-task-29).
 *
 * ⚠ **A8 (R-task-53)** — it is a PERIOD and not a week: a month task carries between months and earns the
 * same line at the month scale, so the uniqueness key had to widen with it. The two scopes cannot collide,
 * because a month key and a Monday are never the same string.
 */
export type TaskEvent = {
  id: string;
  userId: string;
  taskId: string;
  kind: TaskEventKind;
  text: string;
  glyph: string;
  detail: string | null;
  periodKey: string | null;
  at: string;
};

/**
 * R-backlog-1/2/3 — deferred future work under a Yearly/Quarterly/Monthly goal. Never a Life goal, and
 * ⚠ **A8 (R-backlog-30)** never a PERIOD: a backlog item is the only work object in this product with no
 * period key, and a period key is exactly what makes something appear in a lens. That single absence is
 * the whole enforceable difference between it and a month task on the same Monthly goal.
 *
 * `fromPeriodKey` is the period a task was LIVE in when it was moved out, **at that task's own scope** —
 * a Monday for a week task (D-12, unchanged) or a month key for a month task (R-task-59) — or null when
 * the item was captured directly. It is provenance on a row that has no period of its own, not a period.
 *
 * D-19 — a converted item keeps its row with `status: 'converted'` and a pointer to the task it became,
 * so "converted, never duplicated" is enforced by a uniqueness constraint rather than by hope.
 */
export type BacklogItem = {
  id: string;
  userId: string;
  goalId: string;
  title: string;
  description: string;
  capturedAt: string;
  fromPeriodKey: string | null;
  /**
   * ⚠ **A1 (R-backlog-17)** — the manual position within this item's own goal's list: an opaque,
   * lexicographically ordered string minted by the server (`domain/sort-keys.ts`) and never by a client.
   * Order within a goal is this asc, then `capturedAt` desc, then `id` desc.
   */
  sortKey: string;
  status: BacklogStatus;
  convertedToTaskId: string | null;
  convertedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type BacklogLink = {
  id: string;
  userId: string;
  itemId: string;
  url: string;
  createdAt: string;
};

/** R-learning-4 — a short insight. `applied` drives the "changed the plan" badge. */
export type Learning = {
  id: string;
  userId: string;
  goalId: string | null;
  text: string;
  applied: boolean;
  capturedAt: string;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type IdempotencyRecord = {
  scope: string;
  key: string;
  userId: string;
  requestHash: string;
  statusCode: number | null;
  responseBody: string | null;
  createdAt: string;
};

export type OutboxEmail = {
  id: string;
  to: string;
  subject: string;
  body: string;
  createdAt: string;
};

/**
 * The ONE agent-access token for an account. `tokenHash` is `sha256Hex(plaintext)` — the plaintext is
 * returned once at creation and then exists nowhere on the server. `userId` is the primary key, so
 * creating a token replaces the previous one and the old one stops authenticating in the same write.
 */
export type ApiToken = {
  userId: string;
  tokenHash: string;
  last4: string;
  createdAt: string;
};
