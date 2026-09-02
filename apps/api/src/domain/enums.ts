/**
 * Domain enums — the canonical lists. Wire-level Zod enums live in `@goal-cascade/shared`; these exist so
 * the domain and the Drizzle schema never import the wire package (the dependency rule points one way).
 */

/**
 * ⚠ **A2 (R-goal-30)** — longest horizon first. The array index IS the rank:
 * Life 0 › Yearly 1 › Quarterly 2 › Monthly 3 › **Weekly 4**.
 *
 * **There are three copies of this list** — here, in `@goal-cascade/shared`, and in
 * `domain/goal-tree.ts` — plus the Drizzle column's `enum`. They must ship in ONE change: `rank()` throws
 * `RangeError` on an unknown horizon, so any build still holding four members that meets a persisted
 * `'Weekly'` raises rather than degrading (the delta's silent break #4).
 */
export const HORIZONS = ['Life', 'Yearly', 'Quarterly', 'Monthly', 'Weekly'] as const;
export const PULSES = ['On track', 'At risk', 'Rethink'] as const;
export const THEMES = ['light', 'dark', 'system'] as const;
/** R-task-32 / D-15 — exited tasks keep their row so the activity log survives the exit. */
export const TASK_STATUSES = ['open', 'done', 'canceled', 'movedToBacklog'] as const;
/** ⚠ **A2 (R-task-46)** — `planning` → `goal` (there is no planning screen); `idea` retired with the entity. */
export const TASK_SOURCES = ['goal', 'backlog', 'drawer'] as const;
/**
 * ⚠ **A8 (R-task-51, R-task-52)** — the two horizons that hold tasks, and the value of `tasks.scope`.
 *
 * It is a denormalisation of `goal.horizon`, and it is admitted as one: it is redundant with the key's
 * format and with the parent's horizon, and it is stored for the same reason `origin_period_key` is — a
 * week-scoped read must not join to `goals` (R-task-40's reason 4), and **no index can key on the length
 * of a string**, which is what `scope` leading `origin_period_key` in `ix_tasks_open_period` buys.
 */
export const TASK_SCOPES = ['Monthly', 'Weekly'] as const;

/** ⚠ **A8 (R-measure-1)** — two kinds and no third. A checkbox is `measure = null`, not a `binary` kind. */
export const MEASURE_KINDS = ['counter', 'gauge'] as const;

/**
 * R-task-30 — the complete set; the timeline can contain these and nothing else.
 *
 * ⚠ **A8 (R-task-58)** — five added, none removed. The month form of carrying reuses `carried`, and
 * **no reading produces an event in either direction** (R-measure-7): there is deliberately no
 * `reading_recorded` member for a build to reach for.
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
  'parked',
  'unparked',
  'measure_added',
  'measure_edited',
  'measure_removed',
] as const;
/** R-backlog-6 / D-19 — an item is CONVERTED, not deleted, so a repeat conversion is refusable. */
export const BACKLOG_STATUSES = ['open', 'converted'] as const;

export type Horizon = (typeof HORIZONS)[number];
export type TaskScope = (typeof TASK_SCOPES)[number];
export type MeasureKind = (typeof MEASURE_KINDS)[number];
export type Pulse = (typeof PULSES)[number];
export type Theme = (typeof THEMES)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskSource = (typeof TASK_SOURCES)[number];
export type TaskEventKind = (typeof TASK_EVENT_KINDS)[number];
export type BacklogStatus = (typeof BACKLOG_STATUSES)[number];

/** R-task-30 — the glyph each activity kind renders with. Stamped on the row when the event is appended. */
export const TASK_EVENT_GLYPHS: Record<TaskEventKind, string> = {
  created: '＋',
  carried: '↻',
  renamed: '✎',
  cond_edited: '✎',
  description_updated: '✎',
  link_added: '↗',
  link_removed: '↗',
  completed: '✓',
  unchecked: '↩',
  moved_to_backlog: '→',
  canceled: '→',
  // ⚠ **A8 (R-task-58)** — Park is a MOVE (`→`, the same glyph the exits use, because the row leaves the
  // period it was in) and a measure change is an EDIT (`✎`, the same glyph a rename uses). Neither earns
  // a glyph of its own: the timeline's alphabet is deliberately seven symbols and stays seven.
  parked: '→',
  unparked: '→',
  measure_added: '✎',
  measure_edited: '✎',
  measure_removed: '✎',
};

/** R-auth-6 — a brand-new account gets these and nothing else. The goal tree starts EMPTY. */
export const PREFERENCE_DEFAULTS = {
  theme: 'system' as Theme,
  timezone: 'UTC',
} as const;
