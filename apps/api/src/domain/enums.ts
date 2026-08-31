/**
 * Domain enums — the canonical lists. Wire-level Zod enums live in `@goal-cascade/shared`; these exist so
 * the domain and the Drizzle schema never import the wire package (the dependency rule points one way).
 */

/** R-goal-2 — longest horizon first. The array index IS the rank: Life 0 › Yearly 1 › Quarterly 2 › Monthly 3. */
export const HORIZONS = ['Life', 'Yearly', 'Quarterly', 'Monthly'] as const;
export const PULSES = ['On track', 'At risk', 'Rethink'] as const;
export const THEMES = ['light', 'dark', 'system'] as const;
/** R-task-32 / D-15 — exited tasks keep their row so the activity log survives the exit. */
export const TASK_STATUSES = ['open', 'done', 'canceled', 'movedToBacklog'] as const;
export const TASK_SOURCES = ['planning', 'backlog', 'drawer'] as const;
/** R-task-30 — the complete set; the timeline can contain these and nothing else. */
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
/** R-backlog-6 / D-19 — an item is CONVERTED, not deleted, so a repeat conversion is refusable. */
export const BACKLOG_STATUSES = ['open', 'converted'] as const;

export type Horizon = (typeof HORIZONS)[number];
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
};

/** R-auth-6 — a brand-new account gets these and nothing else. The goal tree starts EMPTY. */
export const PREFERENCE_DEFAULTS = {
  theme: 'system' as Theme,
  timezone: 'UTC',
} as const;
