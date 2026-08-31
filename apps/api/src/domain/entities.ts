import type { BacklogStatus, Horizon, Pulse, TaskEventKind, TaskStatus, Theme } from './enums';

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
 * closure table: the tree is at most 500 nodes for one owner (Q-12) and at most 4 levels deep (R-goal-7),
 * so every derivation — leaf, active, ancestors, descendants, cycle checks — is done in memory over the
 * full list. See `domain/goal-tree.ts`; those functions are the ONLY place those rules live.
 *
 * `isLeaf` / `isActive` / `dormant` / `subtreeActive` are derived and never stored (SPEC §1).
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
  /** R-goal-13 — target period label (`2026`, `Q4 2026`, `Sep 2026`). Always `''` for a Life goal. */
  period: string;
  createdAt: string;
  updatedAt: string;
  version: number;
};

/**
 * D-2 — one non-Life leaf's focus sentence for ONE week. A row exists ONLY while the leaf is active in
 * that week: unchecking a leaf DELETES its row rather than storing an empty string, so "active this week"
 * is exactly "a row exists for this week" and there is no second, contradictory representation of
 * dormancy. Unique on `(userId, goalId, weekStart)`.
 *
 * `weekStart` is the ISO date of that week's Monday, so last week's plan survives this week's save and a
 * past week renders its own sentence.
 */
export type WeeklyFocus = {
  id: string;
  userId: string;
  goalId: string;
  weekStart: string;
  sentence: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * A task under an active leaf's weekly focus.
 *
 * `originWeekStart` / `doneWeekStart` are absolute Monday dates (D-1). Carrying is DERIVED, not written:
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
  title: string;
  /** R-task-3 — done-condition. Optional by design; `''` when unset. */
  cond: string;
  description: string;
  status: TaskStatus;
  originWeekStart: string;
  doneWeekStart: string | null;
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
 * `weekStart` is set ONLY on a `carried` event and is the week the task was carried INTO. It exists to
 * make the lazy carry-log producer idempotent: a unique index on `(userId, taskId, weekStart)` for
 * `kind = 'carried'` means re-reading a week can never duplicate an entry (Q-17, R-task-29).
 */
export type TaskEvent = {
  id: string;
  userId: string;
  taskId: string;
  kind: TaskEventKind;
  text: string;
  glyph: string;
  detail: string | null;
  weekStart: string | null;
  at: string;
};

/**
 * R-backlog-1/2/3 — deferred future work under a Yearly/Quarterly/Monthly goal. Never a Life goal, never
 * a week. `fromWeekStart` is the Monday of the week a task was LIVE in when it was moved out (D-12), or
 * null when captured directly.
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
  fromWeekStart: string | null;
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
